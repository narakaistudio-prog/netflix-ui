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
        if (this.isTvModeActive === active) return;
        this.isTvModeActive = active;
        if (!active) {
            this.exitPointerMode();
            this.stopFocusWatchdog();
        } else {
            this.startFocusWatchdog();
        }
        this.notifyListeners();
        if (active && !this.currentFocusedElement) {
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
        this.stopPointerTracking();
        this.stopFocusWatchdog();
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
        if (focusTarget !== this.currentFocusedElement) this.setFocus(focusTarget);
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
        this.setFocus(target);
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
            const inline = node.style;
            if (inline) {
                if (inline.display === 'none' || inline.visibility === 'hidden') return true;
                if (inline.pointerEvents === 'none') return true;
                // Reanimated writes "opacity: 0" inline while a screen slides out.
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
        this.focusWatchdog = setInterval(() => this.assertFocusHeld(), 1200);
    }

    private stopFocusWatchdog() {
        if (this.focusWatchdog == null) return;
        clearInterval(this.focusWatchdog);
        this.focusWatchdog = null;
    }

    private assertFocusHeld() {
        if (!this.isTvModeActive || typeof document === 'undefined' || !document.body) return;
        if (this.isEditingText()) return;

        const current = this.currentFocusedElement;
        if (current && !document.body.contains(current)) {
            this.currentFocusedElement = null;
            this.focusInitialElement();
            return;
        }
        if (!current) {
            const active = document.activeElement as HTMLElement | null;
            if (!active || active === document.body) this.focusInitialElement();
            return;
        }
        const active = document.activeElement as HTMLElement | null;
        const stillHolding =
            active === current ||
            (!!active && current.contains(active)) ||
            (!!active && active.contains(current));
        // Never yank focus away from a player iframe or a real control.
        if (!stillHolding && (!active || active === document.body)) {
            this.retainFocus(current);
        }
    }

    private handleRouteChange = () => {
        if (typeof window === 'undefined') return;
        if (this.routeDebounce != null) clearTimeout(this.routeDebounce);
        this.routeDebounce = setTimeout(() => {
            this.routeDebounce = null;
            if (!this.isTvModeActive) return;
            const current = this.currentFocusedElement;
            if (current && typeof document !== 'undefined' && document.body.contains(current)) return;
            this.currentFocusedElement = null;
            this.focusInitialElement();
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
            event.preventDefault();
            event.stopPropagation();
            let dir: Direction = 'right';
            if (key === 'ArrowUp' || key === 'Up' || keyCode === 38) dir = 'up';
            else if (key === 'ArrowDown' || key === 'Down' || keyCode === 40) dir = 'down';
            else if (key === 'ArrowLeft' || key === 'Left' || keyCode === 37) dir = 'left';
            else if (key === 'ArrowRight' || key === 'Right' || keyCode === 39) dir = 'right';

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

    public isVisible(element: HTMLElement): boolean {
        if (!element) return false;
        // Samsung TV 60fps: NEVER call window.getComputedStyle() here — it forces
        // a style recalc on every keypress across hundreds of candidates on
        // low-end TV SoCs. Inline + geometry checks are sufficient: display:none
        // and detached nodes report a zero rect, which already fails below.
        if ((element as any).hidden) return false;
        const inline = (element as HTMLElement).style;
        if (inline) {
            if (inline.display === 'none' || inline.visibility === 'hidden' || inline.opacity === '0') {
                return false;
            }
        }
        if (element.getAttribute('aria-hidden') === 'true') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
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
    }

    /**
     * Find all visible focusable elements within the active scope
     */
    public getFocusableElements(scope: HTMLElement = this.getActiveScope()): HTMLElement[] {
        if (!scope) return [];

        const selector = [
            '[data-tv-focusable="true"]',
            '[tabindex="0"]',
            '[role="button"]:not([aria-disabled="true"])',
            'button:not([disabled])',
            'a[href]',
            'input:not([disabled])',
        ].join(', ');

        const all = Array.from(scope.querySelectorAll(selector)) as HTMLElement[];
        return all.filter(el => {
            if (el.getAttribute('data-tv-ignore') === 'true') return false;
            return this.isVisible(el);
        });
    }

    /**
     * Set focus on a specific element
     */
    public setFocus(element: HTMLElement | null) {
        if (!element) return;

        if (this.currentFocusedElement && this.currentFocusedElement !== element) {
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

        this.scrollIntoViewSmart(element);
    }

    public getCurrentFocus(): HTMLElement | null {
        return this.currentFocusedElement;
    }

    /**
     * Smart scroll: centers element horizontally in shelf,
     * and positions row vertically in the main viewport.
     *
     * Samsung TV 60fps: no window.getComputedStyle() walks and no
     * behavior:'smooth' animations (CPU-blocking on Tizen). Direct hardware
     * scrollLeft / scrollTop positioning only — the compositor handles it.
     */
    public scrollIntoViewSmart(element: HTMLElement) {
        if (typeof window === 'undefined') return;

        // Geometry cached once per call — getBoundingClientRect() forces layout.
        const elRect = element.getBoundingClientRect();

        // 1. Horizontal Scroll: nearest horizontally scrollable parent via
        // direct geometry check (no computed-style overflow inspection).
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
            if (parent.scrollWidth > parent.clientWidth + 10) {
                const parentRect = parent.getBoundingClientRect();
                const targetScrollLeft = parent.scrollLeft + (elRect.left - parentRect.left) - (parent.clientWidth - elRect.width) / 2;
                try { parent.scrollLeft = Math.max(0, targetScrollLeft); } catch {}
                break;
            }
            parent = parent.parentElement;
        }

        // 2. Vertical Scroll: Position the row/element around 32% from top of viewport (Netflix style)
        const viewportHeight = window.innerHeight || 800;
        const desiredTop = viewportHeight * 0.32;
        const diff = elRect.top - desiredTop;

        if (Math.abs(diff) > 40) {
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
                while (p && p !== document.body) {
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
                if (Math.abs(stillOff) > 40 && typeof window.scrollBy === 'function') {
                    try { window.scrollBy(0, stillOff); } catch {}
                }
            } catch {}
        }
    }

    /**
     * Move focus in given direction.
     *
     * Samsung TV 60fps: candidate geometry is cached ONCE per keypress
     * (getBoundingClientRect forces layout). No window.getComputedStyle().
     */
    public moveFocus(dir: Direction) {
        // Samsung Smart TV (UA32T4410): ArrowDown hydrates deferred
        // below-the-fold shelves instantly so focus never drops into the
        // void (which triggers Samsung's mouse-pointer fallback + arrow).
        if (dir === 'down') {
            this.dispatchHydrateShelves();
        }

        const scope = this.getActiveScope();
        const focusables = this.getFocusableElements(scope);
        if (focusables.length === 0) return;

        // If no element currently focused or current focus is detached, find initial
        if (!this.currentFocusedElement || !document.body.contains(this.currentFocusedElement)) {
            this.focusInitialElement(scope);
            return;
        }

        const current = this.currentFocusedElement;

        // --- Geometry cached once per keypress (layout is expensive on TV) ---
        const rectCache = new Map<HTMLElement, DOMRect>();
        const getRect = (el: HTMLElement): DOMRect => {
            let r = rectCache.get(el);
            if (!r) {
                r = el.getBoundingClientRect();
                rectCache.set(el, r);
            }
            return r;
        };

        const currentRow = current.getAttribute('data-tv-row');
        const currentRect = getRect(current);
        const currentCenterX = currentRect.left + currentRect.width / 2;
        const currentCenterY = currentRect.top + currentRect.height / 2;

        // --- ROW-AWARE LOGIC (Shelves / Carousels) ---
        if (currentRow) {
            // Moving Left/Right within same row
            if (dir === 'right') {
                const sameRowRights = focusables.filter(el => {
                    if (el === current || el.getAttribute('data-tv-row') !== currentRow) return false;
                    const r = getRect(el);
                    return r.left >= currentRect.left + 5;
                }).sort((a, b) => getRect(a).left - getRect(b).left);

                if (sameRowRights.length > 0) {
                    this.setFocus(sameRowRights[0]);
                    return;
                }
            } else if (dir === 'left') {
                const sameRowLefts = focusables.filter(el => {
                    if (el === current || el.getAttribute('data-tv-row') !== currentRow) return false;
                    const r = getRect(el);
                    return r.right <= currentRect.right - 5;
                }).sort((a, b) => getRect(b).right - getRect(a).right);

                if (sameRowLefts.length > 0) {
                    this.setFocus(sameRowLefts[0]);
                    return;
                }
            } else if (dir === 'down') {
                // Find candidates in rows below
                const candidatesBelow = focusables.filter(el => {
                    const r = getRect(el);
                    return r.top >= currentRect.bottom - 10;
                });

                if (candidatesBelow.length > 0) {
                    // Find the nearest row top below
                    const rowTops = candidatesBelow.map(el => Math.round(getRect(el).top / 40) * 40);
                    const minRowTop = Math.min(...rowTops);
                    const immediateRowCandidates = candidatesBelow.filter(el =>
                        Math.abs(Math.round(getRect(el).top / 40) * 40 - minRowTop) <= 20
                    );

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
            } else if (dir === 'up') {
                // Find candidates in rows above
                const candidatesAbove = focusables.filter(el => {
                    const r = getRect(el);
                    return r.bottom <= currentRect.top + 10;
                });

                if (candidatesAbove.length > 0) {
                    // Find nearest row bottom above
                    const rowBottoms = candidatesAbove.map(el => Math.round(getRect(el).bottom / 40) * 40);
                    const maxRowBottom = Math.max(...rowBottoms);
                    const immediateRowCandidates = candidatesAbove.filter(el =>
                        Math.abs(Math.round(getRect(el).bottom / 40) * 40 - maxRowBottom) <= 20
                    );

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
            if (candidate === current) continue;
            const cRect = getRect(candidate);
            const cCenterX = cRect.left + cRect.width / 2;
            const cCenterY = cRect.top + cRect.height / 2;

            let primaryDist = 0;
            let secondaryDist = 0;
            let hasOverlap = false;

            if (dir === 'right') {
                primaryDist = cRect.left - currentRect.right;
                if (primaryDist < -currentRect.width * 0.4) continue; // Behind or heavily overlapping
                secondaryDist = Math.abs(cCenterY - currentCenterY);
                hasOverlap = Math.max(0, Math.min(currentRect.bottom, cRect.bottom) - Math.max(currentRect.top, cRect.top)) > 0;
            } else if (dir === 'left') {
                primaryDist = currentRect.left - cRect.right;
                if (primaryDist < -currentRect.width * 0.4) continue;
                secondaryDist = Math.abs(cCenterY - currentCenterY);
                hasOverlap = Math.max(0, Math.min(currentRect.bottom, cRect.bottom) - Math.max(currentRect.top, cRect.top)) > 0;
            } else if (dir === 'down') {
                primaryDist = cRect.top - currentRect.bottom;
                if (primaryDist < -currentRect.height * 0.4) continue;
                secondaryDist = Math.abs(cCenterX - currentCenterX);
                hasOverlap = Math.max(0, Math.min(currentRect.right, cRect.right) - Math.max(currentRect.left, cRect.left)) > 0;
            } else if (dir === 'up') {
                primaryDist = currentRect.top - cRect.bottom;
                if (primaryDist < -currentRect.height * 0.4) continue;
                secondaryDist = Math.abs(cCenterX - currentCenterX);
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
        } else if (dir === 'down') {
            // Bottom shelf: retain focus on the current card so the Samsung
            // TV browser never falls back to mouse-pointer mode + arrow.
            this.retainFocus(current);
        }
    }

    /**
     * Focus initial prominent element (Hero Play button, first card, or primary action)
     */
    public focusInitialElement(scope: HTMLElement = this.getActiveScope()) {
        const focusables = this.getFocusableElements(scope);
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
