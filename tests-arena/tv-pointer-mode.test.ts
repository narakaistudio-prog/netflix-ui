// @ts-nocheck — unit tests for Smart TV *pointer* remote navigation
// (Samsung Internet for TV / LG webOS / Android TV browsers move an on-screen
// arrow with the D-pad and never send ArrowDown/ArrowUp keydowns).
import { spatialNav, initSpatialNavigation } from '../lib/spatialNavigation';

const SAMSUNG_TV_UA =
    'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.1 Chrome/69.0.3497.106 TV Safari/537.36';

function setUserAgent(value: string) {
    Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function movePointerTo(element: HTMLElement | null, x = 100, y = 100) {
    document.elementFromPoint = jest.fn(() => element);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
}

describe('Smart TV pointer-mode remote navigation', () => {
    let container: HTMLDivElement;
    const originalUa = navigator.userAgent;

    beforeEach(() => {
        jest.useFakeTimers();
        try { localStorage.clear(); } catch {}
        setUserAgent(SAMSUNG_TV_UA);
        container = document.createElement('div');
        document.body.appendChild(container);
        window.scrollBy = jest.fn();
        spatialNav.init();
        spatialNav.setTvMode(false, false);
    });

    afterEach(() => {
        spatialNav.destroy();
        container.remove();
        document.body.classList.remove('tv-remote-mode');
        document.body.classList.remove('tv-pointer-mode');
        setUserAgent(originalUa);
        jest.useRealTimers();
    });

    it('moves the focus ring to the card under the TV pointer', () => {
        container.innerHTML = `
            <div data-tv-row="row-0" style="display: flex;">
                <button id="card-0" data-tv-focusable="true" data-tv-row="row-0" data-tv-index="0">Card 0</button>
                <button id="card-1" data-tv-focusable="true" data-tv-row="row-0" data-tv-index="1">Card 1</button>
            </div>
        `;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;
        const card1 = container.querySelector('#card-1') as HTMLButtonElement;
        card0.getBoundingClientRect = () => ({ left: 0, right: 100, top: 500, bottom: 700, width: 100, height: 200 } as any);
        card1.getBoundingClientRect = () => ({ left: 110, right: 210, top: 500, bottom: 700, width: 100, height: 200 } as any);

        spatialNav.setTvMode(true, false);
        expect(spatialNav.getCurrentFocus()).toBeTruthy();

        // D-pad pushes the TV pointer onto card 1 — no keydown is ever fired.
        movePointerTo(card1, 150, 600);
        jest.advanceTimersByTime(32);

        expect(spatialNav.getCurrentFocus()).toBe(card1);
        expect(card1.getAttribute('data-tv-focused')).toBe('true');
        expect(card0.hasAttribute('data-tv-focused')).toBe(false);
        expect(document.body.classList.contains('tv-pointer-mode')).toBe(true);
        expect(spatialNav.getLastInputSource()).toBe('pointer');
    });

    it('scrolls the shelf container when the TV arrow parks on the bottom edge', () => {
        container.innerHTML = `
            <div id="scroller" data-tv-scroll-container="true">
                <div data-tv-row="row-0" style="display: flex;">
                    <button id="card-0" data-tv-focusable="true" data-tv-row="row-0">Card 0</button>
                </div>
            </div>
        `;
        const scroller = container.querySelector('#scroller') as HTMLDivElement;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;
        Object.defineProperty(scroller, 'scrollHeight', { value: 4000, configurable: true });
        Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
        scroller.scrollTop = 0;
        // Card already sits at the Netflix "32% from top" spot, so only the edge
        // assist can move the container.
        card0.getBoundingClientRect = () => ({ left: 0, right: 200, top: 256, bottom: 456, width: 200, height: 200 } as any);

        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        spatialNav.setTvMode(true, false);

        // Arrow pushed to the very bottom of the screen (edge = last 48px).
        movePointerTo(card0, 150, 795);
        jest.advanceTimersByTime(32);

        expect(scroller.scrollTop).toBeGreaterThan(0);
    });

    it('ignores the pointer while typing in a text field', () => {
        container.innerHTML = `
            <input id="search" type="text" data-tv-focusable="true" />
            <button id="card-0" data-tv-focusable="true" data-tv-row="row-0">Card 0</button>
        `;
        const input = container.querySelector('#search') as HTMLInputElement;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;
        input.focus();

        spatialNav.setTvMode(true, false);
        const before = spatialNav.getCurrentFocus();
        movePointerTo(card0, 150, 600);
        jest.advanceTimersByTime(32);

        expect(spatialNav.getCurrentFocus()).toBe(before);
        expect(card0.hasAttribute('data-tv-focused')).toBe(false);
    });

    it('never lets a desktop mouse steal focus in TV mode', () => {
        setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36');
        window.matchMedia = ((query: string) => ({
            matches: /hover: hover/.test(query),
            media: query,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as any;

        container.innerHTML = `<button id="card-0" data-tv-focusable="true" data-tv-row="row-0">Card 0</button>`;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;

        spatialNav.setTvMode(true, false);
        const before = spatialNav.getCurrentFocus();
        movePointerTo(card0, 42, 42);
        jest.advanceTimersByTime(32);

        expect(spatialNav.getCurrentFocus()).toBe(before);
        expect(document.body.classList.contains('tv-pointer-mode')).toBe(false);
    });

    it('ignores cards inside inactive (opacity: 0) tab screens', () => {
        container.innerHTML = `
            <div style="opacity: 0">
                <button id="ghost-card" data-tv-focusable="true" data-tv-row="row-9">Ghost card</button>
            </div>
            <button id="real-card" data-tv-focusable="true" data-tv-row="row-0">Real card</button>
        `;
        const ghost = container.querySelector('#ghost-card') as HTMLButtonElement;
        const real = container.querySelector('#real-card') as HTMLButtonElement;

        spatialNav.setTvMode(true, false);
        movePointerTo(ghost, 10, 10);
        jest.advanceTimersByTime(32);
        expect(spatialNav.getCurrentFocus()).not.toBe(ghost);

        movePointerTo(real, 10, 10);
        jest.advanceTimersByTime(32);
        expect(spatialNav.getCurrentFocus()).toBe(real);
    });

    it('follows the pointer even on an unrecognised TV when the user forces Pointer arrow', () => {
        // Desktop-like UA and a fine pointer: auto-detection says "not a TV".
        setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
        window.matchMedia = ((query: string) => ({
            matches: /hover: hover/.test(query),
            media: query,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as any;

        container.innerHTML = `<button id="card-0" data-tv-focusable="true" data-tv-row="row-0">Card 0</button>`;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;
        card0.getBoundingClientRect = () => ({ left: 0, right: 200, top: 100, bottom: 300, width: 200, height: 200 } as any);

        // Before the override the page is not in TV mode at all.
        expect(spatialNav.isTvMode()).toBe(false);

        spatialNav.setPointerModePreference('on');
        expect(spatialNav.getPointerModePreference()).toBe('on');
        expect(spatialNav.isTvMode()).toBe(true);

        movePointerTo(card0, 150, 200);
        jest.advanceTimersByTime(32);

        expect(spatialNav.getCurrentFocus()).toBe(card0);
        expect(spatialNav.getLastInputSource()).toBe('pointer');

        // The choice survives a reload.
        expect(localStorage.getItem('netflix-tv-pointer-mode')).toBe('on');
    });

    it('stops following the pointer when the user picks Arrow keys', () => {
        container.innerHTML = `<button id="card-0" data-tv-focusable="true" data-tv-row="row-0">Card 0</button>`;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;

        spatialNav.setTvMode(true, false);
        spatialNav.setPointerModePreference('off');
        const before = spatialNav.getCurrentFocus();

        movePointerTo(card0, 150, 200);
        jest.advanceTimersByTime(32);

        expect(spatialNav.getCurrentFocus()).toBe(before);
        expect(spatialNav.isPointerDrivenDevice()).toBe(false);

        // Arrow keys still work in that mode.
        spatialNav.setFocus(card0);
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true })
        );
        expect(spatialNav.getLastInputSource()).toBe('keys');
    });

    it('re-asserts the focus ring so the TV browser cannot fall back to pointer mode', () => {
        container.innerHTML = `<button id="card-0" data-tv-focusable="true" data-tv-row="row-0">Card 0</button>`;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;

        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(card0);
        expect(spatialNav.getCurrentFocus()).toBe(card0);

        // The TV browser silently drops keyboard focus to <body>.
        (document.activeElement as HTMLElement)?.blur();
        jest.advanceTimersByTime(1400);

        expect(spatialNav.getCurrentFocus()).toBe(card0);
        expect(card0.getAttribute('data-tv-focused')).toBe('true');
    });

    it('keeps TV mode after a reload when the user enabled it manually', () => {
        spatialNav.setTvMode(true, true);
        expect(localStorage.getItem('netflix-tv-mode-enabled')).toBe('true');

        spatialNav.setTvMode(false, true);
        expect(localStorage.getItem('netflix-tv-mode-enabled')).toBe('false');

        // init/destroy cycle keeps working after the watchdog + pointer listeners
        spatialNav.destroy();
        const cleanup = initSpatialNavigation();
        expect(() => cleanup()).not.toThrow();
    });
});
