/**
 * Spatial Navigation and Samsung Smart TV Remote Control Engine for Netflix UI.
 *
 * Supports Samsung Smart TV (Tizen OS), Samsung Internet Browser for TV,
 * and standard D-pad / arrow-key keyboard navigation:
 *   - ArrowUp (38), ArrowDown (40), ArrowLeft (37), ArrowRight (39)
 *   - Enter / Select (13)
 *   - Samsung Tizen Return / Back (10009), Escape (27), Backspace (8)
 *   - Samsung Media keys: MediaPlayPause (10252), MediaPlay (415), MediaPause (19)
 */

import { Platform } from 'react-native';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface SpatialNavOptions {
    autoFocus?: boolean;
    scrollOffsetTop?: number;
}

// Back handler callback returns true if it handled the event, false to pass to next
type BackHandler = () => boolean;

const TV_MODE_STORAGE_KEY = 'netflix-tv-mode-enabled';
const POINTER_MODE_STORAGE_KEY = 'netflix-tv-pointer-mode';
const POINTER_MODE_CLASS = 'tv-pointer-mode';

/**
 * A held D-pad sends 15-30 keydowns per second. Each one used to run a full
 * candidate scan + a shelf scroll + a React re-render, which on a TV SoC drops
 * frames and makes the ring stutter. Coalesce repeats to ~12 moves/second:
 * still faster than anyone can tap, but the browser keeps up.
 */
const MIN_MOVE_INTERVAL_MS = 80;

/** Broad net for candidate nodes; `isFocusableElement()` then refines it. */
const FOCUSABLE_SELECTOR = [
    '[data-tv-focusable="true"]',
    '[tabindex="0"]',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="link"]',
    '[role="tab"]',
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
].join(', ');

/** Candidate list plus a cached geometry accessor, built in one layout pass. */
interface FocusContext {
    elements: HTMLElement[];
    rect(el: HTMLElement): DOMRect;
}

/** How much the page is allowed to move when the ring lands on a card. */
type ScrollAxis = 'both' | 'x' | 'y' | 'none';

/** How the user's remote drives the TV browser. */
export type TvPointerPreference = 'auto' | 'on' | 'off';

class SpatialNavigationManager {
    private isInitialized = false;
    private isTvModeActive = false;
    private currentFocusedElement: HTMLElement | null = null;
    private backHandlerStack: BackHandler[] = [];
    private listeners: Array<(active: boolean) => void> = [];
    private scrollTimer: any = null;

    // --- Smart TV pointer-mode support -------------------------------------
    // Samsung Internet for TV, LG webOS and most Android TV browsers move an
    // on-screen mouse arrow with the D-pad instead of sending ArrowDown/ArrowUp
    // keydowns. When that happens the remote looks "dead" (nothing scrolls,
    // nothing highlights) no matter how good the key handling is. We mirror the
    // TV pointer onto the Netflix-style focus ring so the D-pad keeps working.
    private pointerFollowEnabled = true;
    private lastInputSource: 'none' | 'keys' | 'pointer' = 'none';
    private pointerPosition: { x: number; y: number } | null = null;
    private pointerRaf: any = null;
    private pointerListening = false;
    private pendingEdgeScroll: 0 | 1 | -1 = 0;
    private lastEdgeScrollAt = 0;
    private focusWatchdog: any = null;
    private routeDebounce: any = null;
    /** True once the user explicitly switched TV mode off - auto-detect must not undo it. */
    private userDisabledTvMode = false;
    /** 'auto' = detect, 'on' = remote drives an on-screen arrow, 'off' = arrow keys only. */
    private pointerModePreference: TvPointerPreference = 'auto';
    /** Element the last pointer event hit - fallback when elementFromPoint is unusable. */
    private pointerTarget: HTMLElement | null = null;
    /** Timestamp of the last key event, so remote keys always win over a parked pointer. */
    private lastKeyInputAt = 0;
    /** rAF handle used to re-assert focus the instant the browser drops it. */
    private focusRepairFrame: any = null;
    /** Where the ring was before its element was unmounted, so we can recover nearby. */
    private lastKnownRect: { left: number; top: number; width: number; height: number } | null = null;
    /** Last direction + time of an accepted move: coalesces D-pad auto-repeat. */
    private lastMoveDir: Direction | null = null;
    private lastMoveAt = 0;

    constructor() {
        if (typeof window === 'undefined') return;
        let stored: string | null = null;
        let storedPointer: string | null = null;
        try {
            if (typeof localStorage !== 'undefined') {
                stored = localStorage.getItem(TV_MODE_STORAGE_KEY);
                storedPointer = localStorage.getItem(POINTER_MODE_STORAGE_KEY);
            }
        } catch {}
        if (storedPointer === 'on' || storedPointer === 'off') {
            this.pointerModePreference = storedPointer;
        }
        if (stored === 'true') this.isTvModeActive = true;
        else if (stored === 'false') {
            this.isTvModeActive = false;
            this.userDisabledTvMode = true;
        } else this.isTvModeActive = this.detectTvDevice() || this.isPointerDrivenTvScreen();
    }

    /**
     * Detects whether the current device is a Smart TV (Samsung Tizen, LG webOS, Android TV, etc.)
     */
    public detectTvDevice(): boolean {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        // NOTE: a bare /SamsungBrowser/ match used to live here and made every
        // Samsung *phone* boot into TV mode. Only real TV tokens count now.
        return (
            /SmartTV|SMART-TV|Tizen|SamsungBrowser\/[\d.]+.*(TV|Tizen)|Web0S|webOS|NetCast|AppleTV|tvOS|BRAVIA|GoogleTV|Google TV|Android ?TV|AFT[BMRS]|FireTV|Fire TV|MiBOX|MiTV|VIDAA|Hisense|Skyworth|Philips ?TV|Roku|POV_TV|Viera|HbbTV|TV Safari|CE-HTML/i.test(ua) ||
            (typeof window !== 'undefined' && ('tizen' in window || 'webapis' in window))
        );
    }

    /**
     * A big screen without a real mouse (no fine pointer / no hover) behaves like
     * a TV even when the user agent says nothing useful — e.g. a TV browser that
     * reports a plain Chrome/Android UA. Phones are excluded by screen size.
     */
    public isPointerDrivenTvScreen(): boolean {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
        try {
            const ua = navigator.userAgent || '';
            if (/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) && !/TV|Tizen|webOS|BRAVIA|AFT/i.test(ua)) return false;
            let noFinePointer = true;
            if (typeof window.matchMedia === 'function') {
                noFinePointer = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
            }
            const screenWidth = Math.max(
                (window.screen && window.screen.width) || 0,
                window.innerWidth || 0
            );
            // Phones report ~360-430 CSS px even on 4K panels, TVs report 1280+.
            return noFinePointer && screenWidth >= 960;
        } catch {
            return false;
        }
    }

    /** True when the D-pad drives an on-screen pointer instead of keydown events. */
    public isPointerDrivenDevice(): boolean {
        if (this.pointerModePreference === 'on') return true;
        if (this.pointerModePreference === 'off') return false;
        if (this.detectTvDevice()) return true;
        return this.isPointerDrivenTvScreen();
    }

    /**
     * Manual override for the TV guide UI. Some TVs hide their pointer mode
     * completely (no "Link Browsing" button in the browser toolbar), so the user
     * can force "Pointer arrow" and the engine will mirror the remote arrow onto
     * the focus ring even when auto-detection guessed wrong.
     */
    public setPointerModePreference(preference: TvPointerPreference) {
        this.pointerModePreference = preference === 'on' || preference === 'off' ? preference : 'auto';
        try {
            if (typeof localStorage !== 'undefined') {
                if (this.pointerModePreference === 'auto') {
                    localStorage.removeItem(POINTER_MODE_STORAGE_KEY);
                } else {
                    localStorage.setItem(POINTER_MODE_STORAGE_KEY, this.pointerModePreference);
                }
            }
        } catch {}
        // Forcing "pointer arrow" also arms TV mode, otherwise nothing would
        // follow the arrow on a TV that auto-detection did not recognise.
        if (this.pointerModePreference === 'on' && !this.isTvModeActive) {
            this.setTvMode(true, true);
        }
        this.notifyListeners();
    }

    public getPointerModePreference(): TvPointerPreference {
        return this.pointerModePreference;
    }

    /** Should pointer events be treated as remote input right now? */
    private pointerFollowActive(): boolean {
        if (!this.pointerFollowEnabled) return false;
        if (this.pointerModePreference === 'off') return false;
        if (this.pointerModePreference === 'on') return true;
        return this.detectTvDevice() || this.isPointerDrivenTvScreen();
    }

    public isTvMode(): boolean {
        return this.isTvModeActive;
    }

    public setPointerFollowEnabled(enabled: boolean) {
        this.pointerFollowEnabled = enabled;
    }

    public getLastInputSource(): 'none' | 'keys' | 'pointer' {
        return this.lastInputSource;
    }

    public hasReceivedRemoteInput(): boolean {
        return this.lastInputSource !== 'none';
    }

    public setTvMode(active: boolean, persist = true) {
        if (typeof document !== 'undefined' && document.body) {
            document.documentElement.classList.toggle('tv-remote-mode', active);
            document.body.classList.toggle('tv-remote-mode', active);
        }
        if (persist) {
            this.userDisabledTvMode = !active;
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(TV_MODE_STORAGE_KEY, active ? 'true' : 'false');
                }
            } catch {}
        }
        if (this.isTvModeActive === active) {
            if (!active) {
                this.clearFocusRing();
                this.exitPointerMode();
                this.stopFocusWatchdog();
            }
            return;
        }
        this.isTvModeActive = active;
        if (!active) {
            this.clearFocusRing();
            this.exitPointerMode();
            this.stopFocusWatchdog();
        } else {
            this.startFocusWatchdog();
        }
        this.notifyListeners();
        if (active && !this.isFocusAttachedToScope(this.currentFocusedElement, this.getActiveScope())) {
            this.focusInitialElement();
        }
    }

    public subscribe(listener: (active: boolean) => void): () => void {
        this.listeners.push(listener);
        listener(this.isTvModeActive);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        for (const l of this.listeners) {
            try { l(this.isTvModeActive); } catch {}
        }
    }

    /**
     * Register Samsung Tizen hardware keys (MediaPlay, MediaPause, etc.)
     */
    public registerTizenKeys() {
        if (typeof window === 'undefined') return;
        const tizen = (window as any).tizen;
        if (tizen && tizen.tvinputdevice && typeof tizen.tvinputdevice.registerKey === 'function') {
            const keysToRegister = [
                'MediaPlayPause',
                'MediaPlay',
                'MediaPause',
                'MediaStop',
                'MediaFastForward',
                'MediaRewind',
                'MediaTrackPrevious',
                'MediaTrackNext',
                '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            ];
            for (const key of keysToRegister) {
                try {
                    tizen.tvinputdevice.registerKey(key);
                } catch {}
            }
        }
    }

    /**
     * Push a back handler to the stack (e.g. when modal or player opens)
     */
    public pushBackHandler(handler: BackHandler): () => void {
        this.backHandlerStack.push(handler);
        return () => {
            this.removeBackHandler(handler);
        };
    }

    public removeBackHandler(handler: BackHandler) {
        const index = this.backHandlerStack.indexOf(handler);
        if (index !== -1) {
            this.backHandlerStack.splice(index, 1);
        }
    }

    /**
     * Initialize spatial navigation event listeners
     */
    public init() {
        if (this.isInitialized || typeof window === 'undefined') return;
        this.isInitialized = true;

        this.registerTizenKeys();

        if (this.isTvModeActive && typeof document !== 'undefined' && document.body) {
            document.documentElement.classList.add('tv-remote-mode');
            document.body.classList.add('tv-remote-mode');
        }

        window.addEventListener('keydown', this.handleKeyDown, { capture: true });
        window.addEventListener('keyup', this.handleKeyUp, { capture: true });
        window.addEventListener('popstate', this.handleRouteChange);
        window.addEventListener('hashchange', this.handleRouteChange);
        document.addEventListener('focusout', this.handleFocusOut, true);
        this.hookHistory();
        this.startPointerTracking();
        this.startFocusWatchdog();

        // Auto-focus on first user interaction or route load
        if (this.isTvModeActive) {
            [400, 1200, 2500].forEach(delay => {
                setTimeout(() => {
                    if (this.isTvModeActive && !this.currentFocusedElement) {
                        this.focusInitialElement();
                    }
                }, delay);
            });
        }
    }

    public destroy() {
        if (!this.isInitialized || typeof window === 'undefined') return;
        this.isInitialized = false;
        window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
        window.removeEventListener('keyup', this.handleKeyUp, { capture: true });
        window.removeEventListener('popstate', this.handleRouteChange);
        window.removeEventListener('hashchange', this.handleRouteChange);
        if (typeof document !== 'undefined') {
            document.removeEventListener('focusout', this.handleFocusOut, true);
        }
        this.stopPointerTracking();
        this.stopFocusWatchdog();
        if (this.focusRepairFrame != null) {
            this.cancelFrame(this.focusRepairFrame);
            this.focusRepairFrame = null;
        }
        if (this.routeDebounce != null) {
            clearTimeout(this.routeDebounce);
            this.routeDebounce = null;
        }
    }

    // ---------------------------------------------------------------------
    // Remote pointer (D-pad driven arrow) support
    // ---------------------------------------------------------------------

    private requestFrame(cb: () => void): any {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            return window.requestAnimationFrame(() => cb());
        }
        return setTimeout(cb, 16);
    }

    private cancelFrame(handle: any) {
        if (handle == null) return;
        try {
            if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(handle);
            } else {
                clearTimeout(handle);
            }
        } catch {}
    }

    private startPointerTracking() {
        if (this.pointerListening || typeof window === 'undefined') return;
        this.pointerListening = true;
        // mousemove covers Samsung/Tizen + desktop, pointermove covers webOS
        // Magic Remote and Android TV browsers that only emit pointer events.
        document.addEventListener('mousemove', this.handlePointerMove, { capture: true, passive: true });
        document.addEventListener('pointermove', this.handlePointerMove, { capture: true, passive: true });
        // Some TV browsers only emit mouseover while moving the arrow, and a few
        // jump straight to the click — keep the ring in sync for both.
        document.addEventListener('mouseover', this.handlePointerMove, { capture: true, passive: true });
        // A few TV browsers deliver the arrow as mouseover + mousedown only.
        document.addEventListener('mousedown', this.handlePointerMove, { capture: true, passive: true });
        document.addEventListener('click', this.handlePointerClick, { capture: true, passive: true });
    }

    private stopPointerTracking() {
        if (!this.pointerListening || typeof document === 'undefined') return;
        this.pointerListening = false;
        document.removeEventListener('mousemove', this.handlePointerMove, { capture: true });
        document.removeEventListener('pointermove', this.handlePointerMove, { capture: true });
        document.removeEventListener('mouseover', this.handlePointerMove, { capture: true });
        document.removeEventListener('mousedown', this.handlePointerMove, { capture: true });
        document.removeEventListener('click', this.handlePointerClick, { capture: true });
        if (this.pointerRaf != null) {
            this.cancelFrame(this.pointerRaf);
            this.pointerRaf = null;
        }
    }

    private handlePointerMove = (event: MouseEvent | PointerEvent) => {
        // On a desktop with a real mouse the pointer must never steal the remote
        // focus ring. TV-style pointers (or a forced "Pointer arrow" mode) do.
        if (!this.pointerFollowActive()) return;
        // A TV browser whose user agent is not recognisable still gets the TV
        // experience: the first D-pad press (which moves this pointer) switches
        // the page into TV mode automatically — unless the user turned it off.
        if (!this.isTvModeActive) {
            if (this.userDisabledTvMode && this.pointerModePreference !== 'on') return;
            this.setTvMode(true, false);
        }
        // Remote keys win: a parked pointer must not yank the ring back while
        // the user is navigating with ArrowUp/ArrowDown.
        if (Date.now() - this.lastKeyInputAt < 1200) return;

        const x = (event as MouseEvent).clientX;
        const y = (event as MouseEvent).clientY;
        if (typeof x !== 'number' || typeof y !== 'number' || (x === 0 && y === 0)) return;

        const target = event.target as HTMLElement | null;
        this.pointerTarget = target && target.nodeType === 1 ? target : this.pointerTarget;
        this.pointerPosition = { x, y };
        this.lastInputSource = 'pointer';
        this.enterPointerMode();

        // TV browsers scroll the *window* when the arrow hits the screen edge,
        // but this app scrolls inside its own shelves container — so a pointer
        // parked at the top/bottom edge did nothing before (the classic "ne
        // niche hota hai ne upar"). Assist it explicitly.
        const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800;
        const edge = 48;
        this.pendingEdgeScroll = y >= viewportHeight - edge ? 1 : y <= edge ? -1 : 0;

        if (this.pointerRaf != null) return;
        this.pointerRaf = this.requestFrame(() => {
            this.pointerRaf = null;
            this.applyPointerFocus();
        });
    };

    /**
     * OK was pressed while the TV was driving its on-screen arrow: keep the ring
     * on whatever got activated. Never preventDefault — the native click still
     * has to reach React so the card opens.
     */
    private handlePointerClick = (event: MouseEvent) => {
        if (!this.isTvModeActive || !this.pointerFollowActive()) return;
        if (this.isEditingText()) return;
        const target = event.target as HTMLElement | null;
        if (!target || target.nodeType !== 1) return;
        const scope = this.getActiveScope();
        const focusTarget = this.closestFocusable(target, scope);
        if (!focusTarget) return;
        this.lastInputSource = 'pointer';
        if (focusTarget !== this.currentFocusedElement) this.setFocus(focusTarget, 'none');
    };

    /**
     * The TV remote is driving an on-screen arrow. Mirror it onto the Netflix
     * focus ring so the user still gets a big visible highlight + auto scroll.
     */
    private applyPointerFocus() {
        if (typeof document === 'undefined' || !this.pointerPosition) return;
        if (!this.isTvModeActive) return;
        if (this.isEditingText()) return;

        const { x, y } = this.pointerPosition;
        let hit = this.hitTest(x, y);
        // Some TV browsers give an unusable elementFromPoint but still report a
        // real event target on the mouseover/mousemove that moved the arrow.
        if (!hit) hit = this.pointerTarget;
        if (!hit) return;

        const edgeScroll = this.pendingEdgeScroll;
        this.pendingEdgeScroll = 0;
        if (edgeScroll !== 0) {
            const scrolled = this.scrollEdgeBy(hit, edgeScroll);
            // Re-hit-test: the scroll moved the content under the arrow.
            if (scrolled) hit = this.hitTest(x, y) || hit;
        }

        const scope = this.getActiveScope();
        const target = this.closestFocusable(hit, scope);
        if (!target || target === this.currentFocusedElement) return;
        // Same reason as ArrowDown: hydrate deferred shelves so the pointer can
        // keep travelling into rows that are still below the fold.
        this.dispatchHydrateShelves();
        // 'none': the TV is drawing its own arrow at a fixed screen position. If
        // we scrolled the card into a "nice" spot, the arrow would end up over a
        // different card and the ring would visibly snap away on the very next
        // pointer event. Scrolling here is driven only by the edge assist above.
        this.setFocus(target, 'none');
    }

    private hitTest(x: number, y: number): HTMLElement | null {
        try {
            return typeof document.elementFromPoint === 'function'
                ? (document.elementFromPoint(x, y) as HTMLElement | null)
                : null;
        } catch {
            return null;
        }
    }

    /**
     * Scroll the scrollable ancestor of `hit` by roughly half a shelf when the
     * TV pointer sits on the screen edge. Throttled so a held D-pad scrolls
     * smoothly instead of flying to the bottom.
     */
    private scrollEdgeBy(hit: HTMLElement | null, direction: 1 | -1): boolean {
        if (typeof window === 'undefined' || typeof document === 'undefined') return false;
        const now = Date.now();
        if (now - this.lastEdgeScrollAt < 240) return false;
        this.lastEdgeScrollAt = now;

        const viewportHeight = window.innerHeight || 800;
        const step = Math.max(160, Math.round(viewportHeight * 0.28)) * direction;
        let node: HTMLElement | null = hit;
        let guard = 0;
        while (node && node !== document.body && guard++ < 40) {
            if (node.scrollHeight > node.clientHeight + 20 && node.clientHeight > 160) {
                const before = node.scrollTop;
                try { node.scrollTop = before + step; } catch { return false; }
                return node.scrollTop !== before;
            }
            node = node.parentElement;
        }
        const doc = document.scrollingElement as HTMLElement | null;
        if (doc && doc.scrollHeight > doc.clientHeight + 20) {
            const before = doc.scrollTop;
            try { doc.scrollTop = before + step; } catch { return false; }
            return doc.scrollTop !== before;
        }
        return false;
    }

    /** Walk up the DOM from a pointer hit-test to the nearest focusable card. */
    private closestFocusable(start: HTMLElement | null, scope: HTMLElement): HTMLElement | null {
        if (typeof document === 'undefined' || !start) return null;
        let node: HTMLElement | null = start;
        let guard = 0;
        while (node && node.nodeType === 1 && guard++ < 40) {
            if (this.isFocusableElement(node) && !this.isInsideHiddenSubtree(node, scope)) return node;
            if (node === scope || node === document.body || node === document.documentElement) break;
            node = node.parentElement;
        }
        return null;
    }

    private isFocusableElement(el: HTMLElement): boolean {
        if (!el || el.nodeType !== 1) return false;
        if (el.getAttribute('data-tv-ignore') === 'true') return false;
        if (el.getAttribute('aria-disabled') === 'true') return false;
        if ((el as any).disabled) return false;
        if (el.getAttribute('data-tv-focusable') === 'true') return true;
        const tabIndex = el.getAttribute('tabindex');
        if (tabIndex !== null && Number(tabIndex) >= 0) return true;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'tab') return true;
        if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea') return true;
        return false;
    }

    /**
     * React Navigation keeps inactive tab screens mounted with opacity 0 (and
     * modals keep the page behind them). Reject anything inside those so the
     * pointer can never focus an invisible card.
     */
    private isInsideHiddenSubtree(el: HTMLElement, scope: HTMLElement): boolean {
        if (typeof document === 'undefined') return false;
        let node: HTMLElement | null = el;
        let guard = 0;
        while (node && node.nodeType === 1 && guard++ < 40) {
            if ((node as any).hidden) return true;
            if (node !== el && node.getAttribute('aria-hidden') === 'true') return true;
            const inline = node.style;
            if (inline) {
                if (inline.display === 'none' || inline.visibility === 'hidden') return true;
                // Reanimated writes "opacity: 0" inline while a screen slides out,
                // and React Navigation parks inactive tab screens at opacity 0.
                // NOTE: pointer-events is deliberately NOT checked — React Native's
                // pointerEvents="box-none" sets it on containers whose children
                // stay interactive (the player's top and episode bars).
                if (inline.opacity === '0' && node !== el) return true;
            }
            if (node === scope || node === document.body) break;
            node = node.parentElement;
        }
        return false;
    }

    private enterPointerMode() {
        if (typeof document === 'undefined' || !document.body) return;
        if (document.body.classList.contains(POINTER_MODE_CLASS)) return;
        document.body.classList.add(POINTER_MODE_CLASS);
    }

    private exitPointerMode() {
        if (typeof document === 'undefined' || !document.body) return;
        document.body.classList.remove(POINTER_MODE_CLASS);
    }

    // ---------------------------------------------------------------------
    // Focus watchdog + route refocus
    // ---------------------------------------------------------------------

    /**
     * Samsung Internet for TV drops back to its mouse-pointer arrow when the
     * page stops holding keyboard focus, and React Navigation silently detaches
     * the focused card on every route change. Re-assert focus so the remote
     * always keeps working — that is what makes the site feel like the native
     * Netflix TV app.
     */
    private startFocusWatchdog() {
        if (typeof window === 'undefined' || this.focusWatchdog != null) return;
        // Safety net only: handleFocusOut repairs the common case on the next
        // frame, so this just catches browsers that never fire focusout.
        this.focusWatchdog = setInterval(() => this.assertFocusHeld(), 700);
    }

    private stopFocusWatchdog() {
        if (this.focusWatchdog == null) return;
        clearInterval(this.focusWatchdog);
        this.focusWatchdog = null;
    }

    private assertFocusHeld() {
        if (!this.isTvModeActive || typeof document === 'undefined' || !document.body) return;
        if (this.isEditingText()) return;

        const scope = this.getActiveScope();
        const current = this.currentFocusedElement;
        if (current && !this.isFocusAttachedToScope(current, scope)) {
            // The card was unmounted or its tab became inactive. Recover NEARBY
            // instead of restarting at the hero — restarting is what makes the
            // ring "jump back" on TV.
            this.recoverFocus(scope);
            return;
        }
        if (!current) {
            const active = document.activeElement as HTMLElement | null;
            if (!active || active === document.body) this.focusInitialElement(scope);
            return;
        }
        const active = document.activeElement as HTMLElement | null;
        const stillHolding =
            active === current ||
            (!!active && current.contains(active)) ||
            (!!active && active.contains(current));
        // Never yank focus away from a player iframe or a real control.
        if (!stillHolding && (!active || active === document.body || active === document.documentElement)) {
            this.retainFocus(current);
        }
    }

    /**
     * The instant the browser drops focus to <body> the TV browser redraws its
     * own mouse arrow on top of the site — for a full watchdog interval, which
     * is exactly the "arrow baar baar wapas aa jaata hai" flicker. React on the
     * focusout itself and put the ring back on the next frame instead.
     */
    private handleFocusOut = (event: FocusEvent) => {
        if (!this.isTvModeActive || typeof document === 'undefined') return;
        // Focus moving to another real control (search box, iframe, button) is
        // legitimate — only repair a drop to <body>/nothing.
        const next = (event.relatedTarget as HTMLElement | null) || null;
        if (next && next !== document.body && next !== document.documentElement) return;
        if (this.isEditingText()) return;
        const current = this.currentFocusedElement;
        if (!current || !document.body.contains(current)) return;
        if (this.focusRepairFrame != null) return;
        this.focusRepairFrame = this.requestFrame(() => {
            this.focusRepairFrame = null;
            if (!this.isTvModeActive) return;
            if (this.isEditingText()) return;
            const active = document.activeElement as HTMLElement | null;
            if (!document.body.contains(current)) {
                this.recoverFocus();
                return;
            }
            if (active === current || (active && current.contains(active))) return;
            if (!active || active === document.body || active === document.documentElement) {
                this.retainFocus(current);
            }
        });
    };

    private handleRouteChange = () => {
        if (typeof window === 'undefined') return;
        if (this.routeDebounce != null) clearTimeout(this.routeDebounce);
        this.routeDebounce = setTimeout(() => {
            this.routeDebounce = null;
            if (!this.isTvModeActive) return;
            const scope = this.getActiveScope();
            const current = this.currentFocusedElement;
            if (this.isFocusAttachedToScope(current, scope)) return;
            // New screen: recover near where the ring was rather than always
            // restarting at the hero.
            this.recoverFocus(scope);
        }, 220);
    };

    private hookHistory() {
        if (typeof window === 'undefined' || typeof window.history === 'undefined') return;
        const history = window.history as any;
        if (history.__arenaTvHooked) return;
        history.__arenaTvHooked = true;
        const self = this;
        (['pushState', 'replaceState'] as const).forEach(method => {
            const original = history[method];
            if (typeof original !== 'function') return;
            history[method] = function patched(...args: any[]) {
                const result = original.apply(this, args);
                try { self.handleRouteChange(); } catch {}
                return result;
            };
        });
    }

    private handleKeyDown = (event: KeyboardEvent) => {
        const key = event.key;
        const keyCode = event.keyCode || (event as any).which || 0;

        // Activate TV mode automatically on arrow / TV keys
        const isDirectionalKey = (
            key === 'ArrowUp' || key === 'Up' || keyCode === 38 ||
            key === 'ArrowDown' || key === 'Down' || keyCode === 40 ||
            key === 'ArrowLeft' || key === 'Left' || keyCode === 37 ||
            key === 'ArrowRight' || key === 'Right' || keyCode === 39
        );
        const isEnterKey = key === 'Enter' || keyCode === 13;
        const isBackKey = (
            key === 'GoBack' || key === 'Back' || key === 'Return' || keyCode === 10009 ||
            key === 'Escape' || keyCode === 27 ||
            keyCode === 8 && !this.isEditingText() // Backspace outside text input
        );
        const isMediaKey = (
            key === 'MediaPlayPause' || keyCode === 10252 ||
            key === 'MediaPlay' || keyCode === 415 ||
            key === 'MediaPause' || keyCode === 19 ||
            key === 'MediaStop' || keyCode === 413
        );

        if (isDirectionalKey || isEnterKey || isBackKey || isMediaKey) {
            this.lastInputSource = 'keys';
            this.lastKeyInputAt = Date.now();
            // Auto-enable on TV-like hardware only. A desktop/laptop keyboard
            // must keep scrolling normally - that is what the navbar TV Mode
            // button (and its localStorage memory) is for.
            if (!this.isTvModeActive && !this.userDisabledTvMode && this.isPointerDrivenDevice()) {
                this.setTvMode(true, false);
            }
            // Self-heal: a TV that only forwards OK/Return (no arrow keys) must
            // still light up the first card instead of looking dead.
            if (
                this.isTvModeActive &&
                !this.currentFocusedElement &&
                typeof document !== 'undefined' &&
                document.activeElement === document.body
            ) {
                this.focusInitialElement();
            }
        }

        // If user is currently typing in an input field, let native handling happen
        if (this.isEditingText()) {
            if (isBackKey && (key === 'Escape' || keyCode === 10009)) {
                // Blur input on escape/return
                (document.activeElement as HTMLElement)?.blur();
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            // TV remote: Up/Down must leave the keyboard instead of trapping the
            // user inside the search field (the native Netflix TV app does this).
            if (isDirectionalKey && (keyCode === 40 || keyCode === 38 || key === 'ArrowDown' || key === 'ArrowUp')) {
                const dir: Direction = keyCode === 38 || key === 'ArrowUp' ? 'up' : 'down';
                try { (document.activeElement as HTMLElement)?.blur(); } catch {}
                event.preventDefault();
                event.stopPropagation();
                this.moveFocus(dir);
            }
            return;
        }

        // Handle Return / Back key
        if (isBackKey) {
            event.preventDefault();
            event.stopPropagation();
            this.handleBackAction();
            return;
        }

        // Handle Media keys
        if (isMediaKey) {
            event.preventDefault();
            this.handleMediaAction(key, keyCode);
            return;
        }

        // Handle Directional navigation
        if (isDirectionalKey) {
            // With TV mode off the arrows belong to the browser: a laptop user
            // must be able to scroll the page. (The comment above promised this;
            // the code never actually did it.)
            if (!this.isTvModeActive) return;

            let dir: Direction = 'right';
            if (key === 'ArrowUp' || key === 'Up' || keyCode === 38) dir = 'up';
            else if (key === 'ArrowDown' || key === 'Down' || keyCode === 40) dir = 'down';
            else if (key === 'ArrowLeft' || key === 'Left' || keyCode === 37) dir = 'left';
            else if (key === 'ArrowRight' || key === 'Right' || keyCode === 39) dir = 'right';

            event.preventDefault();
            event.stopPropagation();

            // A held D-pad fires 15-30 repeats/second. Coalesce them so each
            // accepted move still gets a full frame to scroll + repaint.
            const now = Date.now();
            // Browsers mark a held key as `repeat`; do not debounce distinct OK
            // taps or two quick intentional presses (both are common on TVs and
            // must feel one-to-one). Older TV browsers sometimes omit `repeat`,
            // but the layout work below is now bounded enough to remain usable.
            if (event.repeat && dir === this.lastMoveDir && now - this.lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
            this.lastMoveDir = dir;
            this.lastMoveAt = now;

            this.moveFocus(dir);
            return;
        }

        // Handle Enter / OK
        if (isEnterKey) {
            const target = this.currentFocusedElement || (document.activeElement as HTMLElement);
            if (target && typeof target.click === 'function') {
                event.preventDefault();
                event.stopPropagation();
                this.triggerClick(target);
            }
        }
    };

    private handleKeyUp = (event: KeyboardEvent) => {
        if (this.isEditingText()) return;
        const key = event.key;
        const keyCode = event.keyCode || (event as any).which || 0;
        const isRemoteKey = (
            key === 'ArrowUp' || key === 'Up' || keyCode === 38 ||
            key === 'ArrowDown' || key === 'Down' || keyCode === 40 ||
            key === 'ArrowLeft' || key === 'Left' || keyCode === 37 ||
            key === 'ArrowRight' || key === 'Right' || keyCode === 39 ||
            key === 'Enter' || keyCode === 13 ||
            key === 'GoBack' || key === 'Back' || key === 'Return' || keyCode === 10009 ||
            key === 'Escape' || keyCode === 27 ||
            key === 'MediaPlayPause' || keyCode === 10252 ||
            key === 'MediaPlay' || keyCode === 415 ||
            key === 'MediaPause' || keyCode === 19 ||
            key === 'MediaStop' || keyCode === 413
        );
        if (isRemoteKey) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    private isEditingText(): boolean {
        if (typeof document === 'undefined') return false;
        const active = document.activeElement;
        if (!active) return false;
        const tagName = active.tagName.toLowerCase();
        if (tagName === 'input') {
            const type = (active as HTMLInputElement).type?.toLowerCase();
            return !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type);
        }
        return tagName === 'textarea' || (active as HTMLElement).isContentEditable;
    }

    private handleBackAction() {
        // Run from top of stack
        for (let i = this.backHandlerStack.length - 1; i >= 0; i--) {
            const handler = this.backHandlerStack[i];
            try {
                const handled = handler();
                if (handled) return;
            } catch {}
        }

        // Fallback: if browser history can go back, navigate back
        if (typeof window !== 'undefined' && window.history.length > 1) {
            window.history.back();
        }
    }

    private handleMediaAction(key: string, keyCode: number) {
        // Find any video element on page to toggle
        const video = document.querySelector('video') as HTMLVideoElement | null;
        if (video) {
            if (video.paused) {
                video.play().catch(() => {});
            } else {
                video.pause();
            }
            return;
        }

        // Otherwise if focused on play button or movie card, activate it
        if (this.currentFocusedElement) {
            this.triggerClick(this.currentFocusedElement);
        }
    }

    public triggerClick(element: HTMLElement) {
        element.click();
        // Also dispatch Pointer/Mouse events for React Native Web Touchables
        try {
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        } catch {}
    }

    /**
     * Find the active scope container (e.g. an open modal, embed player, or document body)
     */
    public getActiveScope(): HTMLElement {
        if (typeof document === 'undefined') return null as any;

        // Embed player overlay
        const player = document.querySelector('[data-tv-scope="player"]') as HTMLElement | null;
        if (player && this.isVisible(player)) return player;

        // Modal dialog (Movie Details / switch profile / etc.)
        const modal = document.querySelector('[data-tv-scope="modal"]') as HTMLElement | null;
        if (modal && this.isVisible(modal)) return modal;

        // WhoIsWatching screen
        const whoIsWatching = document.querySelector('[data-tv-scope="who-is-watching"]') as HTMLElement | null;
        if (whoIsWatching && this.isVisible(whoIsWatching)) return whoIsWatching;

        return document.body;
    }

    /**
     * Own-element checks only — no ancestor walk, no getComputedStyle.
     *
     * Samsung TV 60fps: NEVER call window.getComputedStyle() here, it forces a
     * style recalc per candidate on low-end TV SoCs. Inline + geometry checks
     * are enough: display:none and detached nodes report a zero rect.
     */
    private getSelfVisibleRect(element: HTMLElement): DOMRect | null {
        if (!element || element.nodeType !== 1) return null;
        if ((element as any).hidden) return null;
        const inline = element.style;
        if (inline) {
            if (inline.display === 'none' || inline.visibility === 'hidden' || inline.visibility === 'collapse') {
                return null;
            }
            if (inline.opacity === '0') return null;
        }
        if (element.getAttribute('aria-hidden') === 'true') return null;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? rect : null;
    }

    private isSelfVisible(element: HTMLElement): boolean {
        return this.getSelfVisibleRect(element) !== null;
    }

    /**
     * Does this ANCESTOR hide its whole subtree from the remote?
     *
     * Deliberately ignores `pointer-events`: React Native's
     * `pointerEvents="box-none"` sets pointer-events:none on a container while
     * its children stay interactive (the player's top/episode bars do exactly
     * that), so treating it as "hidden" would make those controls unreachable.
     */
    private ancestorBlocksFocus(node: HTMLElement): boolean {
        if ((node as any).hidden) return true;
        if (node.getAttribute('aria-hidden') === 'true') return true;
        const inline = node.style;
        if (inline) {
            if (inline.display === 'none' || inline.visibility === 'hidden' || inline.visibility === 'collapse') {
                return true;
            }
            // React Navigation keeps every tab screen mounted and stacks them at
            // the SAME coordinates, hiding the inactive ones with opacity:0.
            if (inline.opacity === '0') return true;
        }
        return false;
    }

    /**
     * Walk to `stop` looking for a hidden ancestor. `cache` memoises the verdict
     * per node so a whole shelf of cards sharing one screen wrapper costs one
     * walk instead of one per card.
     */
    private hasHiddenAncestor(el: HTMLElement, stop: HTMLElement | null, cache: Map<Element, boolean>): boolean {
        if (typeof document === 'undefined') return false;
        let node: HTMLElement | null = el.parentElement;
        const path: HTMLElement[] = [];
        let guard = 0;
        while (node && node.nodeType === 1 && guard++ < 60) {
            const cached = cache.get(node);
            if (cached !== undefined) {
                path.forEach(item => cache.set(item, cached));
                return cached;
            }

            path.push(node);
            if (this.ancestorBlocksFocus(node)) {
                path.forEach(item => cache.set(item, true));
                return true;
            }
            if (node === stop || node === document.body || node === document.documentElement) {
                path.forEach(item => cache.set(item, false));
                return false;
            }
            node = node.parentElement;
        }
        path.forEach(item => cache.set(item, false));
        return false;
    }

    public isVisible(element: HTMLElement): boolean {
        if (!element) return false;
        if (!this.isSelfVisible(element)) return false;
        // Without the ancestor walk the ring happily travels into an invisible
        // tab screen whose cards are pixel-for-pixel twins of the visible ones,
        // which is exactly the "white ring stops moving / snaps back" symptom.
        return !this.hasHiddenAncestor(element, document.body, new Map());
    }

    /**
     * Attachment/visibility without a geometry read. The watchdog uses this
     * version because a TV browser can briefly report a zero rect while a shelf
     * is repainting; that is not a reason to throw away a perfectly good ring.
     */
    private isFocusAttachedToScope(element: HTMLElement | null, scope: HTMLElement): boolean {
        if (!element || typeof document === 'undefined' || !document.body.contains(element)) return false;
        if (!scope || !scope.contains(element)) return false;
        if (this.ancestorBlocksFocus(element)) return false;
        return !this.hasHiddenAncestor(element, scope, new Map());
    }

    /**
     * Samsung Smart TV (UA32T4410): tell deferred below-the-fold shelves to
     * hydrate instantly so ArrowDown never focuses an empty placeholder.
     */
    private dispatchHydrateShelves() {
        if (typeof window === 'undefined') return;
        try {
            window.dispatchEvent(new CustomEvent('arena-hydrate-shelf'));
        } catch {
            try { window.dispatchEvent(new Event('arena-hydrate-shelf')); } catch {}
        }
    }

    private clearFocusRing() {
        if (this.currentFocusedElement) {
            this.currentFocusedElement.removeAttribute('data-tv-focused');
            this.currentFocusedElement.classList.remove('tv-focused');
        }
        this.currentFocusedElement = null;
        this.lastKnownRect = null;
        if (this.focusRepairFrame != null) {
            this.cancelFrame(this.focusRepairFrame);
            this.focusRepairFrame = null;
        }
    }

    /**
     * Samsung Smart TV (UA32T4410): retain focus on the current (bottom-shelf)
     * card when there is nowhere to go. If focus is lost, the Samsung browser
     * falls back to mouse-pointer mode and shows the arrow cursor.
     */
    private retainFocus(element: HTMLElement | null) {
        if (!element) return;
        try {
            element.setAttribute('data-tv-focused', 'true');
            element.classList.add('tv-focused');
            element.focus({ preventScroll: true });
        } catch {
            try { (element as HTMLElement).focus(); } catch {}
        }
        this.rememberPosition(element);
    }

    /**
     * One read-only layout pass over the scope: attributes -> visibility
     * (ancestor verdicts memoised) -> a single getBoundingClientRect() per
     * surviving candidate.
     *
     * The previous implementation measured every candidate inside isVisible()
     * and then measured them AGAIN in moveFocus(), so each keypress forced two
     * full layout passes over hundreds of nodes with DOM writes in between.
     * That is the "TV par bahut lag karta hai".
     */
    private createFocusContext(scope: HTMLElement): FocusContext {
        const rects = new Map<HTMLElement, DOMRect>();
        const elements: HTMLElement[] = [];
        if (!scope) return { elements, rect: (el: HTMLElement) => rects.get(el) || this.measure(el, rects) };

        const all = Array.from(scope.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
        const hiddenAncestors = new Map<Element, boolean>();

        for (const el of all) {
            if (el.getAttribute('data-tv-ignore') === 'true') continue;
            if (!this.isFocusableElement(el)) continue;
            // Reject an inactive tab BEFORE reading layout. On a real TV those
            // screens contain hundreds of mounted cards at the same coordinates.
            if (this.hasHiddenAncestor(el, scope, hiddenAncestors)) continue;
            const rect = this.getSelfVisibleRect(el);
            if (!rect) continue;
            elements.push(el);
            rects.set(el, rect);
        }

        return {
            elements,
            rect: (el: HTMLElement) => this.measure(el, rects),
        };
    }

    private measure(el: HTMLElement, cache: Map<HTMLElement, DOMRect>): DOMRect {
        const cached = cache.get(el);
        if (cached) return cached;
        const rect = el.getBoundingClientRect();
        cache.set(el, rect);
        return rect;
    }

    /**
     * Find all visible focusable elements within the active scope
     */
    public getFocusableElements(scope: HTMLElement = this.getActiveScope()): HTMLElement[] {
        return this.createFocusContext(scope).elements;
    }

    /**
     * Set focus on a specific element.
     *
     * `scroll` picks how much the page may move to reveal the card:
     *   'both' - key navigation (default)
     *   'none' - the TV is driving its own on-screen arrow; scrolling would move
     *            the card out from under the arrow and the ring would visibly
     *            snap somewhere else on the next pointer event.
     */
    public setFocus(element: HTMLElement | null, scroll: ScrollAxis = 'both') {
        if (!element) return;

        if (this.currentFocusedElement === element) {
            // Already ringed: only re-assert the native focus so the TV browser
            // never drops back to its mouse-pointer arrow.
            this.retainFocus(element);
            return;
        }

        if (this.currentFocusedElement) {
            this.currentFocusedElement.removeAttribute('data-tv-focused');
            this.currentFocusedElement.classList.remove('tv-focused');
        }

        this.currentFocusedElement = element;
        element.setAttribute('data-tv-focused', 'true');
        element.classList.add('tv-focused');

        // Focus natively without default window jump
        try {
            element.focus({ preventScroll: true });
        } catch {}

        this.scrollIntoViewSmart(element, { axis: scroll });
        this.rememberPosition(element);
    }

    /** Where the ring currently sits, so an unmount can be recovered nearby. */
    private rememberPosition(element: HTMLElement) {
        try {
            const r = element.getBoundingClientRect();
            if (r.width > 0 || r.height > 0) {
                this.lastKnownRect = { left: r.left, top: r.top, width: r.width, height: r.height };
            }
        } catch {}
    }

    public getCurrentFocus(): HTMLElement | null {
        return this.currentFocusedElement;
    }

    /** Nearest horizontally scrollable ancestor, found by geometry only. */
    private horizontalScroller(element: HTMLElement): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        let parent = element.parentElement;
        let guard = 0;
        while (parent && parent !== document.body && guard++ < 40) {
            if (parent.scrollWidth > parent.clientWidth + 10) return parent;
            parent = parent.parentElement;
        }
        return null;
    }

    /**
     * Netflix shelf behaviour: the row only scrolls when the focused card is
     * about to leave the visible band, and then only by the amount needed to
     * bring it back in (plus a sliver of the next card).
     *
     * The old code RE-CENTRED the card in the shelf on every single keypress.
     * Two consequences on a real TV:
     *   1. the ring looked stuck in the middle while the whole shelf slid under
     *      it ("white ring sahi se move nahi kar raha"), and
     *   2. every D-pad step repainted an entire 32-card shelf — the main source
     *      of the lag.
     */
    private revealHorizontally(element: HTMLElement, elRect: DOMRect) {
        const parent = this.horizontalScroller(element);
        if (!parent) return;
        const parentRect = parent.getBoundingClientRect();
        // Keep a sliver of the neighbouring card visible, like Netflix does.
        const edge = Math.max(12, Math.min(48, parent.clientWidth * 0.05));
        const overflowRight = elRect.right - (parentRect.right - edge);
        const overflowLeft = parentRect.left + edge - elRect.left;
        const delta = overflowRight > 0 ? overflowRight : overflowLeft > 0 ? -overflowLeft : 0;
        if (Math.abs(delta) < 2) return;
        try { parent.scrollLeft = Math.max(0, parent.scrollLeft + delta); } catch {}
    }

    /**
     * Vertical: leave the page alone while the card is comfortably on screen,
     * otherwise settle its row around 32% from the top (the Netflix band).
     */
    private revealVertically(element: HTMLElement, elRect: DOMRect) {
        const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800;
        // Already fully readable on screen -> never scroll. Moving left/right
        // inside a shelf must not make the whole page jump.
        if (elRect.top >= viewportHeight * 0.12 && elRect.bottom <= viewportHeight * 0.9) return;

        const desiredTop = viewportHeight * 0.32;
        const diff = elRect.top - desiredTop;
        if (Math.abs(diff) < 24) return;

        // Fast path: the tagged home TV scroll container (dataSet.tvScrollContainer).
        let scrollParent: HTMLElement | null = null;
        try {
            scrollParent = element.closest?.(
                '[data-tv-scroll-container="true"], [data-tvscrollcontainer="true"]'
            ) as HTMLElement | null;
        } catch {}
        // Fallback: nearest vertically scrollable parent via direct geometry.
        if (!scrollParent) {
            let p = element.parentElement;
            let guard = 0;
            while (p && p !== document.body && guard++ < 40) {
                if (p.scrollHeight > p.clientHeight + 10) {
                    scrollParent = p;
                    break;
                }
                p = p.parentElement;
            }
        }

        try {
            if (scrollParent) {
                scrollParent.scrollTop = scrollParent.scrollTop + diff;
            } else if (typeof document !== 'undefined' && document.documentElement) {
                const base = document.documentElement.scrollTop || window.scrollY || 0;
                document.documentElement.scrollTop = base + diff;
                // Keep body in sync for Samsung TV browser quirks.
                try { document.body.scrollTop = document.documentElement.scrollTop; } catch {}
            }
            // Some TV browsers only follow the window scroller. Nudge it too
            // when the tagged container could not absorb the whole delta.
            const stillOff = element.getBoundingClientRect().top - desiredTop;
            if (Math.abs(stillOff) > 40 && typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
                try { window.scrollBy(0, stillOff); } catch {}
            }
        } catch {}
    }

    /**
     * Smart scroll: reveals the focused card in its shelf and in the viewport.
     *
     * Samsung TV 60fps: no window.getComputedStyle() walks and no
     * behavior:'smooth' animations (CPU-blocking on Tizen). Direct
     * scrollLeft / scrollTop positioning only — the compositor handles it.
     */
    public scrollIntoViewSmart(element: HTMLElement, options: { axis?: ScrollAxis } = {}) {
        if (typeof window === 'undefined') return;
        const axis = options.axis || 'both';
        if (axis === 'none') return;

        // Geometry read once per call — getBoundingClientRect() forces layout.
        const elRect = element.getBoundingClientRect();
        if (axis === 'both' || axis === 'x') this.revealHorizontally(element, elRect);
        if (axis === 'both' || axis === 'y') this.revealVertically(element, elRect);
    }

    /**
     * Move focus in given direction.
     *
     * Samsung TV 60fps: candidate geometry is cached ONCE per keypress
     * (getBoundingClientRect forces layout). No window.getComputedStyle().
     */
    public moveFocus(dir: Direction) {
        // Samsung Smart TV (UA32T4410): ArrowDown hydrates deferred
        // below-the-fold shelves so focus never drops into the void (which
        // triggers Samsung's mouse-pointer fallback + arrow). DeferredMovieList
        // only hydrates the shelves that are actually near the viewport, so this
        // stays cheap instead of mounting every row in the app at once.
        if (dir === 'down') {
            this.dispatchHydrateShelves();
        }

        const scope = this.getActiveScope();

        // Focus was lost (a virtualised shelf unmounted the card, a row
        // re-rendered, or the previous tab became hidden). Recover NEARBY —
        // never teleport back to the hero, that is the "arrow wapas pehle card
        // par aa jaata hai" bug.
        if (!this.isFocusAttachedToScope(this.currentFocusedElement, scope)) {
            this.recoverFocus(scope, dir);
            return;
        }

        const ctx = this.createFocusContext(scope);
        const focusables = ctx.elements;
        if (focusables.length === 0) return;

        const getRect = ctx.rect;
        const current = this.currentFocusedElement as HTMLElement;
        const currentRow = current.getAttribute('data-tv-row');
        const currentRect = getRect(current);
        const currentCenterX = currentRect.left + currentRect.width / 2;
        const currentCenterY = currentRect.top + currentRect.height / 2;
        const vertical = dir === 'up' || dir === 'down';
        // Row headers ("Explore All") sit in the vertical flow of the page but
        // are not part of it: ArrowUp must land on the shelf above, not on the
        // small text link of the very row you are in.
        const inVerticalFlow = (el: HTMLElement) =>
            !vertical || el.getAttribute('data-tv-vertical-ignore') !== 'true';

        // --- ROW-AWARE LOGIC (Shelves / Carousels) ---
        if (currentRow) {
            // Moving Left/Right within same row
            if (dir === 'right' || dir === 'left') {
                const toRight = dir === 'right';
                const sameRow = focusables.filter(el => {
                    if (el === current || el.getAttribute('data-tv-row') !== currentRow) return false;
                    const r = getRect(el);
                    return toRight ? r.left >= currentRect.left + 5 : r.right <= currentRect.right - 5;
                });

                if (sameRow.length > 0) {
                    sameRow.sort((a, b) => {
                        const ra = getRect(a);
                        const rb = getRect(b);
                        return toRight ? ra.left - rb.left : rb.right - ra.right;
                    });
                    this.setFocus(sameRow[0]);
                    return;
                }
            } else {
                // Nearest shelf above / below, bucketed so cards of the same
                // row count as one line even when posters differ by a few px.
                const BUCKET = 40;
                const candidates = focusables.filter(el => {
                    if (el === current || !inVerticalFlow(el)) return false;
                    const r = getRect(el);
                    return dir === 'down'
                        ? r.top >= currentRect.bottom - 10
                        : r.bottom <= currentRect.top + 10;
                });

                if (candidates.length > 0) {
                    const bucketOf = (el: HTMLElement) => {
                        const r = getRect(el);
                        const edge = dir === 'down' ? r.top : r.bottom;
                        return Math.round(edge / BUCKET) * BUCKET;
                    };
                    let targetBucket = bucketOf(candidates[0]);
                    for (const el of candidates) {
                        const b = bucketOf(el);
                        if (dir === 'down' ? b < targetBucket : b > targetBucket) targetBucket = b;
                    }
                    const immediateRowCandidates = candidates.filter(el => Math.abs(bucketOf(el) - targetBucket) <= 20);

                    // Pick candidate with closest horizontal center
                    immediateRowCandidates.sort((a, b) => {
                        const ra = getRect(a);
                        const rb = getRect(b);
                        const da = Math.abs((ra.left + ra.width / 2) - currentCenterX);
                        const db = Math.abs((rb.left + rb.width / 2) - currentCenterX);
                        return da - db;
                    });

                    if (immediateRowCandidates.length > 0) {
                        this.setFocus(immediateRowCandidates[0]);
                        return;
                    }
                }
            }
        }

        // --- GEOMETRIC 2D FALLBACK (Grids, Navbars, Modals, Search) ---
        let bestCandidate: HTMLElement | null = null;
        let bestScore = Infinity;

        for (const candidate of focusables) {
            if (candidate === current || !inVerticalFlow(candidate)) continue;
            const cRect = getRect(candidate);

            let primaryDist = 0;
            let secondaryDist = 0;
            let hasOverlap = false;

            if (dir === 'right') {
                primaryDist = cRect.left - currentRect.right;
                if (primaryDist < -currentRect.width * 0.4) continue; // Behind or heavily overlapping
                secondaryDist = Math.abs((cRect.top + cRect.height / 2) - currentCenterY);
                hasOverlap = Math.max(0, Math.min(currentRect.bottom, cRect.bottom) - Math.max(currentRect.top, cRect.top)) > 0;
            } else if (dir === 'left') {
                primaryDist = currentRect.left - cRect.right;
                if (primaryDist < -currentRect.width * 0.4) continue;
                secondaryDist = Math.abs((cRect.top + cRect.height / 2) - currentCenterY);
                hasOverlap = Math.max(0, Math.min(currentRect.bottom, cRect.bottom) - Math.max(currentRect.top, cRect.top)) > 0;
            } else if (dir === 'down') {
                primaryDist = cRect.top - currentRect.bottom;
                if (primaryDist < -currentRect.height * 0.4) continue;
                secondaryDist = Math.abs((cRect.left + cRect.width / 2) - currentCenterX);
                hasOverlap = Math.max(0, Math.min(currentRect.right, cRect.right) - Math.max(currentRect.left, cRect.left)) > 0;
            } else {
                primaryDist = currentRect.top - cRect.bottom;
                if (primaryDist < -currentRect.height * 0.4) continue;
                secondaryDist = Math.abs((cRect.left + cRect.width / 2) - currentCenterX);
                hasOverlap = Math.max(0, Math.min(currentRect.right, cRect.right) - Math.max(currentRect.left, cRect.left)) > 0;
            }

            // Weighted score: penalize orthogonal offset
            let score = Math.max(0, primaryDist) + secondaryDist * 2.2;
            if (hasOverlap) {
                score *= 0.6; // Priority to elements directly in alignment
            }

            if (score < bestScore) {
                bestScore = score;
                bestCandidate = candidate;
            }
        }

        if (bestCandidate) {
            this.setFocus(bestCandidate);
            return;
        }

        // Edge of the page: hold the ring exactly where it is. Losing DOM focus
        // here is what makes the Samsung browser fall back to mouse-pointer
        // mode and draw its arrow on top of the site.
        this.retainFocus(current);
    }

    /**
     * The ring's element disappeared (virtualised shelf, re-rendered row, route
     * change). Netflix keeps you where you were, so recover the closest
     * surviving card in the same shelf, then the closest by position, and only
     * then fall back to the hero.
     */
    private recoverFocus(scope: HTMLElement = this.getActiveScope(), direction?: Direction) {
        const lost = this.currentFocusedElement;
        const lostRow = lost && typeof lost.getAttribute === 'function' ? lost.getAttribute('data-tv-row') : null;
        const lostIndexRaw = lost && typeof lost.getAttribute === 'function' ? lost.getAttribute('data-tv-index') : null;
        const lostIndex = lostIndexRaw === null ? NaN : Number(lostIndexRaw);
        const anchor = this.lastKnownRect;

        this.currentFocusedElement = null;
        const ctx = this.createFocusContext(scope);
        if (ctx.elements.length === 0) return;

        if (lostRow) {
            const sameShelf = ctx.elements.filter(el => el.getAttribute('data-tv-row') === lostRow);
            if (sameShelf.length > 0) {
                sameShelf.sort((a, b) => {
                    const ia = Number(a.getAttribute('data-tv-index'));
                    const ib = Number(b.getAttribute('data-tv-index'));
                    const da = Number.isFinite(ia) && Number.isFinite(lostIndex) ? Math.abs(ia - lostIndex) : Infinity;
                    const db = Number.isFinite(ib) && Number.isFinite(lostIndex) ? Math.abs(ib - lostIndex) : Infinity;
                    // If the card disappeared between two repeated remote
                    // presses, continue in the direction of that press rather
                    // than bouncing one card backwards on the tie.
                    if (direction === 'right' || direction === 'down') {
                        const aBehind = Number.isFinite(ia) && Number.isFinite(lostIndex) && ia < lostIndex ? 1 : 0;
                        const bBehind = Number.isFinite(ib) && Number.isFinite(lostIndex) && ib < lostIndex ? 1 : 0;
                        if (aBehind !== bBehind) return aBehind - bBehind;
                    } else if (direction === 'left' || direction === 'up') {
                        const aAhead = Number.isFinite(ia) && Number.isFinite(lostIndex) && ia > lostIndex ? 1 : 0;
                        const bAhead = Number.isFinite(ib) && Number.isFinite(lostIndex) && ib > lostIndex ? 1 : 0;
                        if (aAhead !== bAhead) return aAhead - bAhead;
                    }
                    if (da !== db) return da - db;
                    return ia - ib;
                });
                this.setFocus(sameShelf[0]);
                return;
            }
        }

        if (anchor) {
            let best: HTMLElement | null = null;
            let bestScore = Infinity;
            for (const el of ctx.elements) {
                const r = ctx.rect(el);
                const score = Math.abs(r.left - anchor.left) + Math.abs(r.top - anchor.top) * 1.6;
                if (score < bestScore) {
                    bestScore = score;
                    best = el;
                }
            }
            if (best) {
                this.setFocus(best);
                return;
            }
        }

        this.focusInitialElement(scope, ctx);
    }

    /**
     * Focus initial prominent element (Hero Play button, first card, or primary action)
     */
    public focusInitialElement(scope: HTMLElement = this.getActiveScope(), context?: FocusContext) {
        const ctx = context || this.createFocusContext(scope);
        const focusables = ctx.elements;
        if (focusables.length === 0) return;

        // 1. Explicit initial target
        const explicit = focusables.find(el => el.getAttribute('data-tv-initial') === 'true');
        if (explicit) {
            this.setFocus(explicit);
            return;
        }

        // 2. Hero Play button
        const heroPlay = focusables.find(el => el.getAttribute('data-tv-id') === 'hero-play');
        if (heroPlay) {
            this.setFocus(heroPlay);
            return;
        }

        // 3. First movie card in top row
        const firstCard = focusables.find(el => el.getAttribute('data-tv-row') && el.getAttribute('data-tv-index') === '0');
        if (firstCard) {
            this.setFocus(firstCard);
            return;
        }

        // 4. Fallback to first focusable
        this.setFocus(focusables[0]);
    }
}

// Global Singleton
export const spatialNav = new SpatialNavigationManager();

export function initSpatialNavigation() {
    spatialNav.init();
    return () => spatialNav.destroy();
}

export function isTvDevice() {
    return spatialNav.detectTvDevice();
}

export function setTvMode(active: boolean, persist = true) {
    spatialNav.setTvMode(active, persist);
}

export function getTvMode() {
    return spatialNav.isTvMode();
}

/** Latest remote input we actually saw: 'keys' (D-pad keydowns) or 'pointer'. */
export function getTvInputSource(): 'none' | 'keys' | 'pointer' {
    return spatialNav.getLastInputSource();
}

/** True when the D-pad drives an on-screen arrow instead of sending keydowns. */
export function isPointerDrivenDevice() {
    return spatialNav.isPointerDrivenDevice();
}

/** Manual override chosen in the TV guide: 'auto' | 'on' (pointer arrow) | 'off' (keys). */
export function setTvPointerPreference(preference: TvPointerPreference) {
    spatialNav.setPointerModePreference(preference);
}

export function getTvPointerPreference(): TvPointerPreference {
    return spatialNav.getPointerModePreference();
}

export function pushBackHandler(handler: BackHandler) {
    return spatialNav.pushBackHandler(handler);
}

export function triggerTvFocus(element: HTMLElement | null) {
    spatialNav.setFocus(element);
}
