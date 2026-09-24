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

class SpatialNavigationManager {
    private isInitialized = false;
    private isTvModeActive = false;
    private currentFocusedElement: HTMLElement | null = null;
    private backHandlerStack: BackHandler[] = [];
    private listeners: Array<(active: boolean) => void> = [];
    private scrollTimer: any = null;

    constructor() {
        if (typeof window !== 'undefined') {
            this.isTvModeActive = this.detectTvDevice();
        }
    }

    /**
     * Detects whether the current device is a Smart TV (Samsung Tizen, LG webOS, Android TV, etc.)
     */
    public detectTvDevice(): boolean {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        return (
            /SmartTV|SMART-TV|Tizen|SamsungBrowser.*TV|Web0S|webOS|AppleTV|BRAVIA|GoogleTV|Android.*TV|NetCast|POV_TV|Viera/i.test(ua) ||
            /SamsungBrowser/i.test(ua) ||
            (typeof window !== 'undefined' && ('tizen' in window || 'webapis' in window))
        );
    }

    public isTvMode(): boolean {
        return this.isTvModeActive;
    }

    public setTvMode(active: boolean) {
        if (this.isTvModeActive === active) return;
        this.isTvModeActive = active;
        if (typeof document !== 'undefined' && document.body) {
            if (active) {
                document.body.classList.add('tv-remote-mode');
            } else {
                document.body.classList.remove('tv-remote-mode');
            }
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
            document.body.classList.add('tv-remote-mode');
        }

        window.addEventListener('keydown', this.handleKeyDown, { capture: true });

        // Auto-focus on first user interaction or route load
        if (this.isTvModeActive) {
            setTimeout(() => this.focusInitialElement(), 400);
        }
    }

    public destroy() {
        if (!this.isInitialized || typeof window === 'undefined') return;
        this.isInitialized = false;
        window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    }

    private handleKeyDown = (event: KeyboardEvent) => {
        const key = event.key;
        const keyCode = event.keyCode;

        // Activate TV mode automatically on arrow / TV keys
        const isDirectionalKey = (
            key === 'ArrowUp' || keyCode === 38 ||
            key === 'ArrowDown' || keyCode === 40 ||
            key === 'ArrowLeft' || keyCode === 37 ||
            key === 'ArrowRight' || keyCode === 39
        );
        const isEnterKey = key === 'Enter' || keyCode === 13;
        const isBackKey = (
            key === 'GoBack' || key === 'Back' || keyCode === 10009 ||
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
            if (!this.isTvModeActive) {
                this.setTvMode(true);
            }
        }

        // If user is currently typing in an input field, let native handling happen
        if (this.isEditingText()) {
            if (isBackKey && (key === 'Escape' || keyCode === 10009)) {
                // Blur input on escape/return
                (document.activeElement as HTMLElement)?.blur();
                event.preventDefault();
                event.stopPropagation();
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
            if (key === 'ArrowUp' || keyCode === 38) dir = 'up';
            else if (key === 'ArrowDown' || keyCode === 40) dir = 'down';
            else if (key === 'ArrowLeft' || keyCode === 37) dir = 'left';
            else if (key === 'ArrowRight' || keyCode === 39) dir = 'right';

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

export function setTvMode(active: boolean) {
    spatialNav.setTvMode(active);
}

export function getTvMode() {
    return spatialNav.isTvMode();
}

export function pushBackHandler(handler: BackHandler) {
    return spatialNav.pushBackHandler(handler);
}

export function triggerTvFocus(element: HTMLElement | null) {
    spatialNav.setFocus(element);
}
