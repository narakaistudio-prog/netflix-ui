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
 * `data-tv-row` value of the web billboard hero (its Play / More Info buttons).
 * The hero is the one row that does not follow the shelf geometry rules, so it
 * is recognised by name instead of by position.
 */
const HERO_ROW = 'billboard';

/**
 * Marks a large non-interactive region (the hero billboard) as a pointer catch
 * zone: when the TV arrow stops anywhere inside it, the ring goes to the
 * element named by `data-tv-pointer-redirect` instead of nowhere.
 */
const POINTER_CATCH_ATTR = 'data-tv-pointer-catch-zone';
const POINTER_REDIRECT_ATTR = 'data-tv-pointer-redirect';

/**
 * A held D-pad can send many repeated keydowns. The first press is always
 * handled synchronously; repeated events are coalesced only inside one 60fps
 * frame so we never add a visible remote-to-ring delay while avoiding duplicate
 * layout work during key repeat.
 */
const MIN_MOVE_INTERVAL_MS = 16;

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
    /** Pointer-only TV browsers move a cursor instead of emitting D-pad keys. */
    private pointerAnchor: { x: number; y: number } | null = null;
    private pendingPointerDirection: Direction | null = null;
    private pointerSteering = false;
    private pointerSteeredAt = 0;
    /** The cursor's old hit can remain on the logo/hero after a D-pad step. */
    private pointerSteerOrigin: HTMLElement | null = null;
    private pointerSteerPosition: { x: number; y: number } | null = null;
    /** A deferred shelf / virtualized poster may arrive on the next React commit. */
    private pendingFocus: {
        shelf: HTMLElement;
        index: number | null;
        preferredX: number;
        origin: HTMLElement;
        observer: MutationObserver | null;
        timeout: ReturnType<typeof setTimeout>;
    } | null = null;

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
        this.pointerAnchor = null;
        this.pendingPointerDirection = null;
        this.resetPointerSteering();
        if (this.pointerModePreference === 'off') this.exitPointerMode();
        if (this.pointerModePreference === 'on') this.lastKeyInputAt = 0;
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
                this.cancelPendingFocus();
                this.clearFocusRing();
                this.exitPointerMode();
                this.resetPointerSteering();
                this.pointerAnchor = null;
                this.pendingPointerDirection = null;
                this.stopFocusWatchdog();
            }
            return;
        }
        this.isTvModeActive = active;
        if (!active) {
            this.cancelPendingFocus();
            this.clearFocusRing();
            this.exitPointerMode();
            this.resetPointerSteering();
            this.pointerAnchor = null;
            this.pendingPointerDirection = null;
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
        this.cancelPendingFocus();
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
        document.addEventListener('click', this.handlePointerClick, { capture: true });
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
        this.pointerPosition = null;
        this.pointerTarget = null;
        this.pointerAnchor = null;
        this.pendingPointerDirection = null;
        this.resetPointerSteering();
        this.pendingEdgeScroll = 0;
    }

    private resetPointerSteering() {
        this.pointerSteering = false;
        this.pointerSteerOrigin = null;
        this.pointerSteerPosition = null;
    }

    /**
     * Some TV remotes emit ArrowDown AND leave a native cursor parked on the
     * old logo. Once key-priority expires, its mouseover must not reset focus.
     */
    private latchParkedPointerAfterKey() {
        const pos = this.pointerPosition;
        const hit = this.pointerTarget;
        if (!pos || !hit || !this.pointerFollowActive()) return;
        const scope = this.getActiveScope();
        if (!scope.contains(hit)) return;
        const origin = this.closestFocusable(hit, scope) || this.resolvePointerTarget(hit, scope);
        if (!origin || origin === this.currentFocusedElement ||
            this.isInsideHiddenSubtree(origin, scope)) return;
        this.pointerSteering = true;
        this.pointerSteerOrigin = origin;
        this.pointerSteerPosition = { ...pos };
        this.pointerSteeredAt = Date.now();
    }

    /** Has the TV cursor really left where a D-pad step started? */
    private isPointerStillParked(direct: HTMLElement | null, x: number, y: number): boolean {
        if (!this.pointerSteering || !this.pointerSteerPosition) return false;
        // A scroll/repaint may change the element under a cursor that never
        // actually moved. Equally, repeated mouseover on the logo (including
        // its child text) must not drag the ring back from Play/a poster.
        const near = Math.abs(x - this.pointerSteerPosition.x) < 8 &&
            Math.abs(y - this.pointerSteerPosition.y) < 8;
        const origin = this.pointerSteerOrigin;
        return near || !!(origin && direct && (direct === origin || origin.contains(direct)));
    }

    /**
     * In pointer-only TV browsers a D-pad press is observable only as cursor
     * motion. Small moves INSIDE the same poster/hero must still count as a
     * directional step; otherwise Down requires dragging the cursor hundreds
     * of pixels to the bottom edge before the page scrolls at all. Accumulate
     * sub-pixel moves and coalesce mousemove + pointermove in one animation frame.
     */
    private trackPointerDirection(event: MouseEvent | PointerEvent, x: number, y: number) {
        // Some Samsung browsers send mouseover instead of mousemove as the
        // remote crosses header/hero layers. Mousedown (OK) only seeds the
        // anchor; clicking must never manufacture another D-pad step.
        if (event.type !== 'mousemove' && event.type !== 'pointermove' && event.type !== 'mouseover') {
            if (!this.pointerAnchor) this.pointerAnchor = { x, y };
            return;
        }
        const previous = this.pointerAnchor;
        if (!previous) this.pointerAnchor = { x, y };
        // Some TV browsers send ONE mousemove per press but include movementY.
        // Use that first event rather than requiring an extra Down press just
        // to establish an anchor; other browsers fall back to x/y accumulation.
        const dx = previous ? x - previous.x : (event as MouseEvent).movementX || 0;
        const dy = previous ? y - previous.y : (event as MouseEvent).movementY || 0;
        // A Magic Remote can teleport its cursor: follow the actual hit target
        // in that case rather than interpreting a large jump as 20 D-pad taps.
        if (Math.abs(dx) > 160 || Math.abs(dy) > 160) {
            this.pointerAnchor = { x, y };
            return;
        }
        if (Math.abs(dy) >= 8 && Math.abs(dy) > Math.abs(dx) * 1.4) {
            this.pendingPointerDirection = dy > 0 ? 'down' : 'up';
        } else if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            this.pendingPointerDirection = dx > 0 ? 'right' : 'left';
        } else {
            return;
        }
        this.pointerAnchor = { x, y };
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
        this.trackPointerDirection(event, x, y);
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
     * A native click on an actual button/card must reach React exactly once.
     * But after a pointer-only D-pad step the cursor can still sit on empty
     * hero art: on that background OK should activate the visible focus ring,
     * not silently do nothing (or snap back to Play).
     */
    private handlePointerClick = (event: MouseEvent) => {
        if (!this.isTvModeActive || !this.pointerFollowActive()) return;
        if (this.isEditingText()) return;
        const target = event.target as HTMLElement | null;
        if (!target || target.nodeType !== 1) return;
        const scope = this.getActiveScope();
        if (!scope.contains(target)) return;
        const direct = this.closestFocusable(target, scope);
        const parked = this.isPointerStillParked(direct, event.clientX, event.clientY);
        const steeredFocus = this.pointerSteering && parked &&
            this.isFocusAttachedToScope(this.currentFocusedElement, scope)
            ? this.currentFocusedElement : null;
        const focusTarget = steeredFocus || direct || this.resolvePointerTarget(target, scope);
        if (!focusTarget) return;
        this.lastInputSource = 'pointer';
        if (focusTarget !== this.currentFocusedElement) this.setFocus(focusTarget, 'none');
        if (direct === focusTarget) {
            this.pointerSteering = false;
            return; // React handles an ordinary button/card click exactly once.
        }
        if (steeredFocus || target.closest(`[${POINTER_CATCH_ATTR}="true"]`)) {
            // The browser's cursor can remain on Play after a Down step. Do not
            // let its native click open the hero while the ring is on a poster.
            event.preventDefault();
            event.stopPropagation();
            this.triggerClick(focusTarget);
        }
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

        // A D-pad-like pointer move already steps/scrolls its destination row;
        // adding edge assist in the same frame would jump two shelves at once.
        const edgeScroll = this.pendingPointerDirection ? 0 : this.pendingEdgeScroll;
        this.pendingEdgeScroll = 0;
        if (edgeScroll !== 0) {
            const scrolled = this.scrollEdgeBy(hit, edgeScroll);
            // Re-hit-test: the scroll moved the content under the arrow.
            if (scrolled) hit = this.hitTest(x, y) || hit;
        }

        const scope = this.getActiveScope();
        if (!scope.contains(hit)) return;
        const direct = this.closestFocusable(hit, scope);
        const intent = this.pendingPointerDirection;
        this.pendingPointerDirection = null;
        const current = this.currentFocusedElement;
        // The navbar is outside the page ScrollView. It needs the SAME pointer
        // steering as Play/posters or Down on the NETFLIX logo only moves the
        // firmware's arrow, with no focus/scroll at all.
        const browseFocus = current?.getAttribute('data-tv-row') === HERO_ROW ||
            current?.getAttribute('data-tv-row') === 'navbar' ||
            current?.getAttribute('data-tv-card') === 'true';
        if (this.pointerSteerOrigin && !document.body.contains(this.pointerSteerOrigin)) {
            this.resetPointerSteering();
        }
        const parked = this.isPointerStillParked(direct, x, y);
        const settling = this.pointerSteering && Date.now() - this.pointerSteeredAt < 140;

        // D-pad in a pointer-only browser: moving within the logo, a button,
        // poster or blank hero art IS a directional press. In particular, a
        // second Down must keep advancing even if the OS cursor is STILL on
        // the logo several seconds after the first Down.
        if (intent && browseFocus && (!direct || direct === current || parked || settling)) {
            this.moveFocus(intent);
            this.pointerSteering = true;
            this.pointerSteeredAt = Date.now();
            if (!parked || !this.pointerSteerPosition) this.pointerSteerOrigin = direct || hit;
            this.pointerSteerPosition = { x, y };
            return;
        }
        const target = direct || this.resolvePointerTarget(hit, scope);
        // A parked cursor, or artwork that slid underneath it on scroll, must
        // never undo the logical D-pad move. Once it truly leaves, a different
        // control OR a new catch zone (blank hero art) may take focus again.
        if (this.pointerSteering && (parked || settling || !target)) return;
        this.resetPointerSteering();
        if (!target || target === this.currentFocusedElement) return;
        // Direct pointer hits never reposition the page: the cursor must remain
        // over the thing it is pointing at. Directional steps above DO scroll.
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
        const selector = '[data-tv-scroll-container="true"], [data-tvscrollcontainer="true"]';
        const tagged = (hit?.closest?.(selector) || this.currentFocusedElement?.closest?.(selector)) as HTMLElement | null;
        if (tagged && this.getActiveScope().contains(tagged) &&
            tagged.scrollHeight > tagged.clientHeight + 20) {
            const before = tagged.scrollTop;
            try { tagged.scrollTop = before + step; } catch { return false; }
            return tagged.scrollTop !== before;
        }
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

    /**
     * Pointer hit-test that also understands "catch zones".
     *
     * The TV arrow spends most of its time over the hero billboard, which is
     * art + gradients + text with only two focusable buttons in it. A plain
     * hit-test resolves to nothing there, so the ring stayed parked on the
     * shelf below (or vanished with it) and the TV browser fell back to its own
     * mouse arrow — the blank hero gap. Walking up through a marked catch zone
     * redirects the arrow to that zone's primary action instead.
     */
    private resolvePointerTarget(hit: HTMLElement | null, scope: HTMLElement): HTMLElement | null {
        if (typeof document === 'undefined' || !hit || !scope.contains(hit)) return null;
        // A real focusable ancestor always wins over a catch zone redirect.
        const direct = this.closestFocusable(hit, scope);
        if (direct) return direct;

        let node: HTMLElement | null = hit;
        let guard = 0;
        while (node && node.nodeType === 1 && guard++ < 40) {
            const zoneId: string | null = node.getAttribute(POINTER_REDIRECT_ATTR);
            if (node.getAttribute(POINTER_CATCH_ATTR) === 'true' && zoneId) {
                const redirect: HTMLElement | null = scope.querySelector<HTMLElement>(
                    `[data-tv-id="${zoneId}"]`
                );
                if (redirect && redirect !== node && this.isSelfVisible(redirect)) return redirect;
            }

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

    /** The TV firmware sometimes gives DOM focus back to its parked cursor. */
    private isSteeredPointerOrigin(element: HTMLElement | null): boolean {
        const origin = this.pointerSteerOrigin;
        return !!(this.pointerSteering && origin && element &&
            (element === origin || origin.contains(element)));
    }

    private assertFocusHeld() {
        if (!this.isTvModeActive || typeof document === 'undefined' || !document.body) return;
        if (this.isEditingText()) return;
        if (this.pendingFocus) return; // React is mounting the next card/row.

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
        // Do not yank focus from a player/input/another real control. The one
        // exception is the parked TV cursor's OLD control: the ring has already
        // stepped away, so the logo must not steal native focus back.
        if (!stillHolding && (!active || active === document.body ||
            active === document.documentElement || this.isSteeredPointerOrigin(active))) {
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
        // Focus moving to a real control is legitimate, except when the TV
        // browser re-focuses the logo under its parked cursor AFTER the ring
        // was steered to Play/a poster. Repair that in the next frame too.
        const next = (event.relatedTarget as HTMLElement | null) || null;
        if (next && next !== document.body && next !== document.documentElement &&
            !this.isSteeredPointerOrigin(next)) return;
        if (this.isEditingText()) return;
        const current = this.currentFocusedElement;
        if (this.pendingFocus?.origin === current) return;
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
            if (!active || active === document.body || active === document.documentElement ||
                this.isSteeredPointerOrigin(active)) {
                this.retainFocus(current);
            }
        });
    };

    private handleRouteChange = () => {
        if (typeof window === 'undefined') return;
        // A new screen has new hit targets; don't keep the old logo/cursor
        // suppression latched across navigation.
        this.resetPointerSteering();
        this.pointerAnchor = null;
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
            // A pointer-only TV still sends Enter for OK. Suppress pointer motion
            // only after an ACTUAL directional key, not for 1.2 seconds after
            // every OK/Back press (which made Down feel dead after selecting).
            if (isDirectionalKey) {
                this.lastInputSource = 'keys';
                this.lastKeyInputAt = Date.now();
                this.resetPointerSteering();
                // Preserve the old cursor location: the next TV mousemove may
                // be its first pointer-only Down after a key-driven step.
                this.pointerAnchor = this.pointerPosition ? { ...this.pointerPosition } : null;
                this.pendingPointerDirection = null;
            } else if (this.lastInputSource !== 'pointer') {
                this.lastInputSource = 'keys';
            }
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
            this.latchParkedPointerAfterKey();
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
    private isOwnFocusBlocked(element: HTMLElement): boolean {
        if (!element || element.nodeType !== 1) return true;
        if ((element as any).hidden) return true;
        if (element.getAttribute('aria-hidden') === 'true') return true;
        const inline = element.style;
        if (inline) {
            if (inline.display === 'none' || inline.visibility === 'hidden' || inline.visibility === 'collapse') {
                return true;
            }
            if (inline.opacity === '0') return true;
        }
        return false;
    }

    private getSelfVisibleRect(element: HTMLElement): DOMRect | null {
        if (this.isOwnFocusBlocked(element)) return null;
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
     * Build the candidate list without forcing layout. Ancestor visibility is
     * memoised, and geometry is read lazily by the returned context only for
     * candidates that the current direction actually compares.
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
            // Do not call getBoundingClientRect for every card here. Horizontal
            // D-pad navigation usually needs only the current shelf; measuring
            // all mounted cards was the remaining source of key-to-ring delay.
            // Geometry is read lazily by ctx.rect only for candidates considered
            // in this move.
            if (this.isOwnFocusBlocked(el)) continue;
            elements.push(el);
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
        this.cancelPendingFocus();

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

        // Focus natively without default window jump. Older TV Chromium may
        // reject focus options: fall back immediately instead of waiting for
        // the watchdog while the browser draws its own arrow.
        try {
            element.focus({ preventScroll: true });
        } catch {
            try { element.focus(); } catch {}
        }

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

        // The web page deliberately locks body scrolling: Home/Catalog scroll
        // inside a React Native ScrollView. Scroll *that* element directly.
        // Nudging window.scrollBy afterwards forced another layout/repaint on
        // every remote step and on some TVs triggered the browser's own cursor.
        let scrollParent: HTMLElement | null = null;
        try {
            const tagged = element.closest?.(
                '[data-tv-scroll-container="true"], [data-tvscrollcontainer="true"]'
            ) as HTMLElement | null;
            if (tagged && tagged.scrollHeight > tagged.clientHeight + 10) scrollParent = tagged;
        } catch {}
        if (!scrollParent) {
            let p = element.parentElement;
            let guard = 0;
            while (p && p !== document.body && guard++ < 40) {
                // A horizontal carousel can be wider but is not the page scroller.
                if (p.scrollHeight > p.clientHeight + 10) {
                    scrollParent = p;
                    break;
                }
                p = p.parentElement;
            }
        }
        if (!scrollParent) {
            const doc = document.scrollingElement as HTMLElement | null;
            if (doc && doc.scrollHeight > doc.clientHeight + 10) scrollParent = doc;
        }
        if (scrollParent) {
            try { scrollParent.scrollTop += diff; } catch {}
        }
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
     * Netflix billboard step: the hero's Play / More Info buttons sit INSIDE the
     * hero art, and the first poster shelf starts under the hero's bottom
     * gradient — so the two bands visually overlap. Strict geometry
     * ("candidate must start below the button's bottom edge") therefore finds no
     * shelf at all on ArrowDown and the ring stays stuck on Play, which is the
     * "hero se niche nahi jaata" bug. Step explicitly instead: nearest card row
     * below the hero, card closest to the button's horizontal centre.
     */
    private stepFromHeroToFirstShelf(
        current: HTMLElement,
        currentRect: DOMRect,
        ctx: FocusContext
    ): boolean {
        const currentCenterX = currentRect.left + currentRect.width / 2;
        const cards = this.shelfCards(ctx);
        if (cards.length === 0) return false;
        // DOM order is the shelf order even when the hero and posters overlap.
        // Only read geometry for the FIRST row, not every poster on the page.
        const firstRow = cards[0].getAttribute('data-tv-row');
        let closest: HTMLElement | null = null;
        let distance = Infinity;
        for (const card of cards) {
            if (card.getAttribute('data-tv-row') !== firstRow) break;
            const r = ctx.rect(card);
            if (r.width <= 0 || r.height <= 0) continue;
            const d = Math.abs(r.left + r.width / 2 - currentCenterX);
            if (d < distance) {
                closest = card;
                distance = d;
            }
        }
        if (!closest) return false;
        this.setFocus(closest);
        return true;
    }

    /**
     * Mirror of the step above: ArrowUp from the FIRST shelf returns to the hero
     * Play button instead of the navbar. Only the first shelf does this — from
     * any deeper row ArrowUp must keep walking up the shelves.
     */
    private stepFromFirstShelfToHero(current: HTMLElement, ctx: FocusContext): boolean {
        // The catch-zone wrapper comes BEFORE the Play button in DOM order.
        // Focusing that wrapper gives the *whole banner* the ring, and the next
        // Down press cannot find its billboard row — the real-TV stuck bug.
        const hero = ctx.elements.find(el => el.getAttribute('data-tv-id') === 'hero-play');
        if (!hero || !this.isFirstShelfCard(current, ctx)) return false;
        if (!this.isSelfVisible(hero)) return false;

        this.setFocus(hero);
        return true;
    }

    /**
     * Is `el` a card of the topmost shelf? Compared by shelf identity in DOM
     * order, not by measured position: this costs one DOM read instead of a
     * getBoundingClientRect per card, and it stays correct while the page is
     * scrolled (where the first shelf can sit above the viewport).
     */
    private isFirstShelfCard(el: HTMLElement, ctx: FocusContext): boolean {
        const row = el.getAttribute('data-tv-row');
        if (!row) return false;
        const firstCard = ctx.elements.find(card => card.getAttribute('data-tv-card') === 'true');
        return !!firstCard && firstCard.getAttribute('data-tv-row') === row;
    }

    /** Every poster/title card in scope — i.e. the shelves, never the hero or navbar. */
    private shelfCards(ctx: FocusContext): HTMLElement[] {
        return ctx.elements.filter(el => el.getAttribute('data-tv-card') === 'true');
    }

    /** Home/catalog shelves are siblings inside a tagged vertical ScrollView. */
    private adjacentShelf(shelf: HTMLElement, dir: 'up' | 'down'): HTMLElement | null {
        let node = dir === 'down' ? shelf.nextElementSibling : shelf.previousElementSibling;
        while (node) {
            if (node.getAttribute('data-tv-shelf') === 'true' &&
                !this.isOwnFocusBlocked(node as HTMLElement)) return node as HTMLElement;
            node = dir === 'down' ? node.nextElementSibling : node.previousElementSibling;
        }
        return null;
    }

    /** Only measure posters in the *destination* row, never the whole catalog. */
    private cardInShelf(shelf: HTMLElement, preferredX: number, index: number | null): HTMLElement | null {
        if (index !== null) {
            const card = shelf.querySelector<HTMLElement>(`[data-tv-card="true"][data-tv-index="${index}"]`);
            return card && this.isSelfVisible(card) ? card : null;
        }
        let closest: HTMLElement | null = null;
        let distance = Infinity;
        const cards = shelf.querySelectorAll<HTMLElement>('[data-tv-card="true"]');
        for (const card of Array.from(cards)) {
            if (this.isOwnFocusBlocked(card)) continue;
            const r = card.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const d = Math.abs(r.left + r.width / 2 - preferredX);
            if (d < distance) {
                distance = d;
                closest = card;
            }
        }
        return closest;
    }

    private cancelPendingFocus() {
        const pending = this.pendingFocus;
        if (!pending) return;
        this.pendingFocus = null;
        pending.observer?.disconnect();
        clearTimeout(pending.timeout);
    }

    private tryPendingFocus(pending: NonNullable<SpatialNavigationManager['pendingFocus']>) {
        if (this.pendingFocus !== pending) return;
        const scope = this.getActiveScope();
        if (!this.isTvModeActive || this.currentFocusedElement !== pending.origin ||
            !document.body.contains(pending.shelf) || !scope.contains(pending.shelf) ||
            this.isOwnFocusBlocked(pending.shelf) ||
            this.hasHiddenAncestor(pending.shelf, scope, new Map())) {
            this.cancelPendingFocus();
            return;
        }
        // The origin can be virtualized away *during* the scroll that mounted
        // the requested card. Keep the target, as long as its shelf is active.
        const card = this.cardInShelf(pending.shelf, pending.preferredX, pending.index);
        if (!card) return;
        this.cancelPendingFocus();
        this.setFocus(card);
    }

    /**
     * React may not have mounted the next deferred shelf or virtualized poster
     * yet. Keep the ring where it is, ask JUST that row to mount, then focus on
     * its actual DOM card (never a blank placeholder or a card in another row).
     */
    private focusShelf(shelf: HTMLElement, preferredX: number, index: number | null = null) {
        const card = this.cardInShelf(shelf, preferredX, index);
        if (card) {
            this.setFocus(card);
            return;
        }
        this.cancelPendingFocus();
        const origin = this.currentFocusedElement;
        if (!origin) return;
        const pending: NonNullable<SpatialNavigationManager['pendingFocus']> = {
            shelf, index, preferredX, origin, observer: null, timeout: null as any,
        };
        this.pendingFocus = pending;
        if (typeof MutationObserver !== 'undefined') {
            pending.observer = new MutationObserver(() => this.tryPendingFocus(pending));
            pending.observer.observe(shelf, { childList: true, subtree: true });
        }
        pending.timeout = setTimeout(() => {
            if (this.pendingFocus !== pending) return;
            this.cancelPendingFocus();
            if (this.isFocusAttachedToScope(origin, this.getActiveScope())) this.retainFocus(origin);
            else this.recoverFocus();
        }, 1800);
        try {
            if (index === null) {
                shelf.dispatchEvent(new Event('arena-hydrate-shelf'));
            } else {
                shelf.dispatchEvent(new CustomEvent('arena-tv-reveal-card', { detail: { index } }));
            }
        } catch {}
        this.tryPendingFocus(pending);
    }

    /** Rapid presses while React is mounting should advance the pending target. */
    private advancePendingFocus(dir: Direction): boolean {
        const pending = this.pendingFocus;
        if (!pending || pending.origin !== this.currentFocusedElement) return false;
        if (pending.index !== null && (dir === 'left' || dir === 'right')) {
            const next = pending.index + (dir === 'right' ? 1 : -1);
            const count = Number(pending.shelf.getAttribute('data-tv-shelf-count'));
            if (next >= 0 && next < count) this.focusShelf(pending.shelf, pending.preferredX, next);
            return true;
        }
        if (pending.index === null && (dir === 'up' || dir === 'down')) {
            const next = this.adjacentShelf(pending.shelf, dir);
            if (next) this.focusShelf(next, pending.preferredX);
            else if (dir === 'up') this.cancelPendingFocus(); // back at source/hero
            return true;
        }
        this.cancelPendingFocus();
        return false;
    }

    /**
     * The fixed Netflix navbar sits OUTSIDE the page's tagged ScrollView.
     * Falling back to the global geometric search here used to measure every
     * poster and broadcast "hydrate all shelves" on a single Down from the
     * logo — on a low-end TV that stalls long enough for its arrow to return.
     * Enter only the visible page: Play on Home, the first shelf on a catalog.
     */
    private moveFromNavbarDown(dir: Direction, scope: HTMLElement): boolean {
        const current = this.currentFocusedElement;
        if (dir !== 'down' || !current || current.getAttribute('data-tv-row') !== 'navbar') return false;
        const centerX = (() => {
            const r = current.getBoundingClientRect();
            return r.left + r.width / 2;
        })();
        const roots = scope.querySelectorAll<HTMLElement>(
            '[data-tv-scroll-container="true"], [data-tvscrollcontainer="true"]'
        );
        const hidden = new Map<Element, boolean>();
        for (const root of Array.from(roots)) {
            if (this.isOwnFocusBlocked(root) || this.hasHiddenAncestor(root, scope, hidden)) continue;
            const play = root.querySelector<HTMLElement>('[data-tv-id="hero-play"]');
            if (play && this.isSelfVisible(play) && !this.hasHiddenAncestor(play, scope, hidden)) {
                this.setFocus(play);
                return true;
            }
            const first = root.querySelector<HTMLElement>('[data-tv-shelf="true"]');
            if (first && !this.isOwnFocusBlocked(first) && !this.hasHiddenAncestor(first, scope, hidden)) {
                this.focusShelf(first, centerX);
                return true;
            }
        }
        return false;
    }

    /** Header navigation only measures header controls, not every catalog card. */
    private focusNearestNavbar(scope: HTMLElement, preferredX: number): boolean {
        let closest: HTMLElement | null = null;
        let distance = Infinity;
        const hidden = new Map<Element, boolean>();
        for (const el of Array.from(scope.querySelectorAll<HTMLElement>('[data-tv-row="navbar"]'))) {
            if (!this.isFocusableElement(el) || this.isOwnFocusBlocked(el) ||
                this.hasHiddenAncestor(el, scope, hidden)) continue;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const d = Math.abs(r.left + r.width / 2 - preferredX);
            if (d < distance) { closest = el; distance = d; }
        }
        if (!closest) return false;
        this.setFocus(closest);
        return true;
    }

    /**
     * Fast path for the home billboard and catalog shelves: use their actual DOM
     * order, not hundreds of forced getBoundingClientRect reads per keypress.
     * Also prevents a Down press from skipping an unmounted placeholder row.
     */
    private moveInBrowseScroller(dir: Direction, scope: HTMLElement): boolean {
        const current = this.currentFocusedElement;
        if (!current) return false;
        const root = current.closest?.(
            '[data-tv-scroll-container="true"], [data-tvscrollcontainer="true"]'
        ) as HTMLElement | null;
        if (!root || !scope.contains(root)) return false;
        const isHero = current.getAttribute('data-tv-row') === HERO_ROW;
        const shelf = current.closest?.('[data-tv-shelf="true"]') as HTMLElement | null;
        if (!isHero && (current.getAttribute('data-tv-card') !== 'true' || !shelf)) return false;
        const currentRect = current.getBoundingClientRect();
        const centerX = currentRect.left + currentRect.width / 2;

        if (dir === 'left' || dir === 'right') {
            if (isHero || !shelf) return false; // Play / More Info use normal navigation.
            const index = Number(current.getAttribute('data-tv-index'));
            const count = Number(shelf.getAttribute('data-tv-shelf-count'));
            if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1) return false;
            const next = index + (dir === 'right' ? 1 : -1);
            if (next < 0 || next >= count) {
                this.retainFocus(current);
                return true;
            }
            this.focusShelf(shelf, centerX, next);
            return true;
        }

        if (isHero && dir === 'down') {
            const first = root.querySelector<HTMLElement>('[data-tv-shelf="true"]');
            if (first) {
                this.focusShelf(first, centerX);
                return true;
            }
            return false;
        }
        if (isHero && dir === 'up' && this.focusNearestNavbar(scope, centerX)) return true;
        if (!shelf) return false; // Other hero controls use the geometric fallback.
        const target = this.adjacentShelf(shelf, dir);
        if (target) {
            this.focusShelf(target, centerX);
            return true;
        }
        if (dir === 'up') {
            // Select the PLAY BUTTON, not the billboard's pointer catch-zone div.
            const play = root.querySelector<HTMLElement>('[data-tv-id="hero-play"]');
            if (play && this.isSelfVisible(play)) {
                this.setFocus(play);
                return true;
            }
            // A Movies/TV catalog has no hero; Up from its first shelf goes
            // back to the navbar without a global poster geometry scan.
            return this.focusNearestNavbar(scope, centerX);
        }
        this.retainFocus(current); // Last shelf: keep keyboard focus on the TV.
        return true;
    }

    /**
     * Move focus in given direction. Tagged shelves take the constant-size
     * adjacent-row path; grids/modals without tags retain geometric navigation.
     */
    public moveFocus(dir: Direction) {
        const scope = this.getActiveScope();

        // Focus was lost (a virtualised shelf unmounted the card, a row
        // re-rendered, or the previous tab became hidden). Recover NEARBY —
        // never teleport back to the hero, that is the "arrow wapas pehle card
        // par aa jaata hai" bug.
        if (this.pendingFocus && scope.contains(this.pendingFocus.shelf) &&
            !this.hasHiddenAncestor(this.pendingFocus.shelf, scope, new Map()) &&
            this.advancePendingFocus(dir)) return;
        if (!this.isFocusAttachedToScope(this.currentFocusedElement, scope)) {
            this.cancelPendingFocus();
            this.recoverFocus(scope, dir);
            return;
        }
        if (this.moveFromNavbarDown(dir, scope)) return;
        if (this.moveInBrowseScroller(dir, scope)) return;

        // Legacy/grid/modal fallback: hydrate nearby shelves only when the
        // markup does not provide targeted shelf navigation.
        if (dir === 'down') this.dispatchHydrateShelves();
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
            if (vertical) {
                // The web billboard hero is not a shelf: hand its vertical
                // moves to the explicit hero <-> first-shelf step above.
                if (currentRow === HERO_ROW && dir === 'down') {
                    if (this.stepFromHeroToFirstShelf(current, currentRect, ctx)) return;
                } else if (dir === 'up' && currentRow !== HERO_ROW) {
                    if (this.stepFromFirstShelfToHero(current, ctx)) return;
                }
            }

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
