// @ts-nocheck — DOM-level regressions for key and pointer driven TV browsers.
import { spatialNav } from '../lib/spatialNavigation';

const TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) SamsungBrowser/2.1 Chrome/69.0 TV Safari/537.36';
const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
});

function press(key: string, repeat = false) {
    const code = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 }[key] || 13;
    window.dispatchEvent(new KeyboardEvent('keydown', {
        key, keyCode: code, bubbles: true, cancelable: true, repeat,
    }));
}

describe('TV remote: hero, nested scrolling and rapid shelf navigation', () => {
    let container: HTMLDivElement;
    let scroller: HTMLElement;
    let play: HTMLElement;
    let topCard: HTMLElement;
    let nextCard: HTMLElement;
    let hero: HTMLElement;
    let logo: HTMLElement;
    let homeLink: HTMLElement;
    const oldUA = navigator.userAgent;
    const oldHeight = window.innerHeight;

    function mountHome() {
        container.innerHTML = `
            <nav id="navbar">
                <button id="logo" data-tv-focusable="true" data-tv-row="navbar">NETFLIX</button>
                <button id="home-link" data-tv-focusable="true" data-tv-row="navbar">Home</button>
            </nav>
            <div id="scroller" data-tv-scroll-container="true" data-tv-route-page="/">
                <div id="hero" data-tv-pointer-catch-zone="true" data-tv-pointer-redirect="hero-play">
                    <button id="play" data-tv-focusable="true" data-tv-id="hero-play" data-tv-row="billboard" data-tv-index="0">Play</button>
                    <button id="info" data-tv-focusable="true" data-tv-id="hero-info" data-tv-row="billboard" data-tv-index="1">Info</button>
                </div>
                <div id="top-shelf" data-tv-shelf="true" data-tv-shelf-count="2">
                    <button id="top-card" data-tv-focusable="true" data-tv-card="true" data-tv-row="top-10" data-tv-index="0">Top 10</button>
                    <button id="top-card-1" data-tv-focusable="true" data-tv-card="true" data-tv-row="top-10" data-tv-index="1">Next</button>
                </div>
                <div id="next-shelf" data-tv-shelf="true" data-tv-shelf-count="1">
                    <button id="next-card" data-tv-focusable="true" data-tv-card="true" data-tv-row="trending" data-tv-index="0">Trending</button>
                </div>
            </div>
        `;
        const el = (id: string) => container.querySelector<HTMLElement>(`#${id}`)!;
        scroller = el('scroller');
        hero = el('hero');
        play = el('play');
        topCard = el('top-card');
        nextCard = el('next-card');
        logo = el('logo');
        homeLink = el('home-link');
        Object.defineProperties(scroller, {
            scrollHeight: { value: 2900, configurable: true },
            clientHeight: { value: 800, configurable: true },
        });
        scroller.scrollTop = 0;
        hero.getBoundingClientRect = () => rect(0, -scroller.scrollTop, 1280, 550) as any;
        logo.getBoundingClientRect = () => rect(48, 14, 145, 42) as any;
        homeLink.getBoundingClientRect = () => rect(220, 16, 68, 40) as any;
        play.getBoundingClientRect = () => rect(60, 410 - scroller.scrollTop, 150, 45) as any;
        el('info').getBoundingClientRect = () => rect(230, 410 - scroller.scrollTop, 150, 45) as any;
        topCard.getBoundingClientRect = () => rect(48, 660 - scroller.scrollTop, 175, 255) as any;
        el('top-card-1').getBoundingClientRect = () => rect(235, 660 - scroller.scrollTop, 175, 255) as any;
        nextCard.getBoundingClientRect = () => rect(48, 1080 - scroller.scrollTop, 175, 255) as any;
        el('top-shelf').getBoundingClientRect = () => rect(0, 620 - scroller.scrollTop, 1280, 350) as any;
        el('next-shelf').getBoundingClientRect = () => rect(0, 1040 - scroller.scrollTop, 1280, 350) as any;
    }

    function pointer(hit: HTMLElement, x: number, y: number, type = 'mousemove') {
        document.elementFromPoint = jest.fn(() => hit);
        hit.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
        jest.advanceTimersByTime(20);
    }

    function mountCatalog(path: string) {
        const root = document.createElement('div');
        root.setAttribute('data-tv-scroll-container', 'true');
        root.setAttribute('data-tv-route-page', path);
        root.innerHTML = `
            <div data-tv-shelf="true" data-tv-shelf-count="2">
                <button id="catalog-first" data-tv-focusable="true" data-tv-card="true" data-tv-row="top-10" data-tv-index="0">First catalog poster</button>
                <button id="catalog-second" data-tv-focusable="true" data-tv-card="true" data-tv-row="top-10" data-tv-index="1">Second catalog poster</button>
            </div>
            <div data-tv-shelf="true" data-tv-shelf-count="1">
                <button id="catalog-next" data-tv-focusable="true" data-tv-card="true" data-tv-row="recent" data-tv-index="0">Next catalog shelf</button>
            </div>
        `;
        container.appendChild(root); // previous tab can still be mounted and opaque
        const first = root.querySelector<HTMLElement>('#catalog-first')!;
        const second = root.querySelector<HTMLElement>('#catalog-second')!;
        const next = root.querySelector<HTMLElement>('#catalog-next')!;
        Object.defineProperties(root, {
            scrollHeight: { value: 1900, configurable: true },
            clientHeight: { value: 800, configurable: true },
        });
        first.getBoundingClientRect = () => rect(48, 280 - root.scrollTop, 175, 255) as any;
        second.getBoundingClientRect = () => rect(235, 280 - root.scrollTop, 175, 255) as any;
        next.getBoundingClientRect = () => rect(48, 760 - root.scrollTop, 175, 255) as any;
        return { root, first, second, next };
    }

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        Object.defineProperty(navigator, 'userAgent', { value: TV_UA, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        window.scrollBy = jest.fn();
        container = document.createElement('div');
        document.body.appendChild(container);
        spatialNav.init();
        window.history.replaceState(null, '', '/');
        spatialNav.setPointerModePreference('auto');
        spatialNav.setTvMode(false, false);
        (spatialNav as any).lastKeyInputAt = 0;
        mountHome();
        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(play);
    });

    afterEach(() => {
        window.history.replaceState(null, '', '/');
        spatialNav.destroy();
        spatialNav.setTvMode(false, false);
        container.remove();
        Object.defineProperty(navigator, 'userAgent', { value: oldUA, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: oldHeight, configurable: true });
        jest.useRealTimers();
    });

    it('keeps every fast key press from the logo through the second shelf', () => {
        spatialNav.setFocus(logo);
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(nextCard);
        expect(document.activeElement).toBe(nextCard);
    });

    it.each(['/browse/movies', '/browse/tv', '/movies', '/tv'])(
        'Down enters the active %s catalog, not the still-mounted Home screen', path => {
            const { first, second, next } = mountCatalog(path);
            spatialNav.setFocus(logo);
            window.history.pushState(null, '', path);
            expect(spatialNav.getCurrentFocus()).toBe(first);
            expect(document.activeElement).toBe(first);
            expect(play.hasAttribute('data-tv-focused')).toBe(false);

            // The first Down after category entry reaches the next shelf;
            // rapid remote steps must never fall back to the old Home hero.
            press('ArrowDown');
            expect(spatialNav.getCurrentFocus()).toBe(next);
            press('ArrowUp');
            expect(spatialNav.getCurrentFocus()).toBe(first);
            press('ArrowRight');
            expect(spatialNav.getCurrentFocus()).toBe(second);
            expect(document.activeElement).toBe(second);
            press('ArrowUp');
            expect(spatialNav.getCurrentFocus()?.getAttribute('data-tv-row')).toBe('navbar');
        },
    );

    it('retains focus during a slow catalog mount and enters the shelf when it arrives', async () => {
        spatialNav.setFocus(logo);
        window.history.pushState(null, '', '/browse/movies');
        press('ArrowDown'); // React has not committed the next route yet.
        expect(spatialNav.getCurrentFocus()).toBe(logo);
        expect(document.activeElement).toBe(logo);
        expect(play.hasAttribute('data-tv-focused')).toBe(false);

        const { first } = mountCatalog('/browse/movies');
        await jest.advanceTimersByTimeAsync(240); // flush MutationObserver + route debounce
        expect(spatialNav.getCurrentFocus()).toBe(first);
        expect(document.activeElement).toBe(first);
    });

    it('waits for an outgoing tab transition to reveal the catalog page', async () => {
        const { root, first } = mountCatalog('/browse/tv');
        root.style.opacity = '0';
        spatialNav.setFocus(logo);
        window.history.pushState(null, '', '/browse/tv');
        expect(spatialNav.getCurrentFocus()).toBe(logo);

        root.style.opacity = '1'; // Reanimated changes style, not DOM children.
        await jest.advanceTimersByTimeAsync(50);
        expect(spatialNav.getCurrentFocus()).toBe(first);
    });

    it('switches from Movies to TV Shows without focusing the old catalog shelf', () => {
        const movies = mountCatalog('/browse/movies');
        spatialNav.setFocus(logo);
        window.history.pushState(null, '', '/browse/movies');
        expect(spatialNav.getCurrentFocus()).toBe(movies.first);

        const tv = mountCatalog('/browse/tv');
        window.history.pushState(null, '', '/browse/tv');
        expect(spatialNav.getCurrentFocus()).toBe(tv.first);
        expect(document.activeElement).toBe(tv.first);
        expect(movies.first.hasAttribute('data-tv-focused')).toBe(false);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(tv.next);
    });

    it('does not keep native focus on a Home poster when the Movies route replaces it', () => {
        const { first } = mountCatalog('/browse/movies');
        spatialNav.setFocus(topCard);
        window.history.pushState(null, '', '/browse/movies');
        expect(spatialNav.getCurrentFocus()).not.toBe(topCard);
        expect(document.activeElement).not.toBe(topCard);
        jest.advanceTimersByTime(240);
        expect(spatialNav.getCurrentFocus()).toBe(first);
    });

    it('still lets a non-catalog detail screen mount before recovering its focus', () => {
        spatialNav.setFocus(topCard);
        window.history.pushState(null, '', '/movie/example');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);

        const details = document.createElement('button');
        details.setAttribute('data-tv-focusable', 'true');
        details.textContent = 'Play this title';
        details.getBoundingClientRect = () => rect(48, 280, 175, 50) as any;
        container.appendChild(details);
        jest.advanceTimersByTime(240);
        expect(spatialNav.getCurrentFocus()).toBe(details);
        expect(document.activeElement).toBe(details);
    });

    it('ignores a parked pointer hit on an old Home card after entering TV Shows', () => {
        const { first } = mountCatalog('/browse/tv');
        spatialNav.setFocus(logo);
        window.history.pushState(null, '', '/browse/tv');
        spatialNav.setPointerModePreference('on');
        pointer(logo, 90, 28);
        pointer(logo, 90, 46);
        expect(spatialNav.getCurrentFocus()).toBe(first);
        jest.advanceTimersByTime(300);
        pointer(play, 110, 430, 'mouseover');
        expect(spatialNav.getCurrentFocus()).toBe(first);
        expect(document.activeElement).toBe(first);
    });

    it('does not snap back to a parked Movies-link cursor after the route auto-focuses a poster', () => {
        const link = document.createElement('button');
        link.setAttribute('data-tv-focusable', 'true');
        link.setAttribute('data-tv-row', 'navbar');
        link.setAttribute('data-tv-route-link', '/browse/movies');
        link.textContent = 'Movies';
        container.querySelector('#navbar')!.appendChild(link);
        link.getBoundingClientRect = () => rect(310, 16, 76, 40) as any;
        const { first, next } = mountCatalog('/browse/movies');
        spatialNav.setPointerModePreference('on');
        spatialNav.setFocus(link);
        pointer(link, 348, 28);
        window.history.pushState(null, '', '/browse/movies');
        expect(spatialNav.getCurrentFocus()).toBe(first);
        // Expo can replace the URL again after rendering the same path.
        window.history.replaceState(null, '', '/browse/movies');
        jest.advanceTimersByTime(300);

        pointer(link, 348, 28, 'mouseover'); // the old firmware hit is not a new navigation intent
        expect(spatialNav.getCurrentFocus()).toBe(first);
        pointer(link, 348, 45); // a real D-pad Down still advances immediately
        expect(spatialNav.getCurrentFocus()).toBe(next);
        expect(document.activeElement).toBe(next);
    });

    it('Down from the Netflix logo goes to Play, then the first shelf without hydrating the whole page', () => {
        const hydrateAll = jest.fn();
        window.addEventListener('arena-hydrate-shelf', hydrateAll);
        try {
            spatialNav.setFocus(logo);
            press('ArrowDown');
            expect(spatialNav.getCurrentFocus()).toBe(play);
            expect(document.activeElement).toBe(play);
            expect(hydrateAll).not.toHaveBeenCalled();

            press('ArrowDown');
            expect(spatialNav.getCurrentFocus()).toBe(topCard);
            expect(scroller.scrollTop).toBeGreaterThan(0);
            press('ArrowUp');
            expect(spatialNav.getCurrentFocus()).toBe(play);
            press('ArrowUp');
            expect(spatialNav.getCurrentFocus()).toBe(logo);
        } finally {
            window.removeEventListener('arena-hydrate-shelf', hydrateAll);
        }
    });

    it('moves through the navbar and hero in either direction without scanning posters', () => {
        const farRows = Array.from({ length: 10 }, (_, row) => `<div data-tv-shelf="true">${
            Array.from({ length: 32 }, (_, i) => `<button data-tv-card="true" data-tv-row="far-${row}" data-tv-index="${i}">Far</button>`).join('')
        }</div>`).join('');
        scroller.insertAdjacentHTML('beforeend', farRows);
        let farReads = 0;
        scroller.querySelectorAll('[data-tv-row^="far-"]').forEach((card: HTMLElement) => {
            card.getBoundingClientRect = () => { farReads++; return rect(48, 2000, 175, 255) as any; };
        });
        spatialNav.setFocus(logo);
        press('ArrowRight');
        expect(spatialNav.getCurrentFocus()).toBe(homeLink);
        press('ArrowLeft');
        expect(spatialNav.getCurrentFocus()).toBe(logo);
        press('ArrowUp');
        expect(spatialNav.getCurrentFocus()).toBe(logo);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        press('ArrowRight');
        expect(spatialNav.getCurrentFocus()?.getAttribute('data-tv-id')).toBe('hero-info');
        press('ArrowLeft');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        press('ArrowLeft');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        expect(farReads).toBe(0);
    });

    it('does not read geometry repeatedly while holding Right at a shelf boundary', () => {
        spatialNav.setFocus(nextCard);
        const originalRect = nextCard.getBoundingClientRect;
        let reads = 0;
        nextCard.getBoundingClientRect = () => { reads++; return originalRect.call(nextCard); };
        for (let i = 0; i < 12; i++) press('ArrowRight');
        expect(spatialNav.getCurrentFocus()).toBe(nextCard);
        expect(document.activeElement).toBe(nextCard);
        expect(reads).toBeLessThan(3);
    });

    it('Down from the logo does not measure or hydrate hundreds of distant posters', () => {
        const otherRows = Array.from({ length: 20 }, (_, row) => `<div data-tv-shelf="true" data-tv-shelf-count="32">${
            Array.from({ length: 32 }, (_, index) => `<button data-tv-focusable="true" data-tv-card="true" data-tv-row="row-${row}" data-tv-index="${index}">Poster</button>`).join('')
        }</div>`).join('');
        scroller.insertAdjacentHTML('beforeend', otherRows);
        let reads = 0;
        scroller.querySelectorAll('[data-tv-row^="row-"]').forEach((card: HTMLElement) => {
            card.getBoundingClientRect = () => { reads++; return rect(48, 1600, 175, 255) as any; };
        });
        spatialNav.setFocus(logo);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        expect(reads).toBe(0);
    });

    it('does not enter the hero of a hidden inactive tab before the visible Home page', () => {
        const hiddenTab = document.createElement('div');
        hiddenTab.style.opacity = '0';
        hiddenTab.innerHTML = '<div data-tv-scroll-container="true"><button data-tv-id="hero-play" data-tv-row="billboard">Hidden Play</button></div>';
        const hiddenPlay = hiddenTab.querySelector<HTMLElement>('button')!;
        hiddenPlay.getBoundingClientRect = () => rect(60, 410, 150, 45) as any;
        container.insertBefore(hiddenTab, container.firstChild);
        spatialNav.setFocus(logo);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        expect(hiddenPlay.hasAttribute('data-tv-focused')).toBe(false);
    });

    it('a pointer-only remote moves Down from the logo without snapping back to the parked TV arrow', () => {
        spatialNav.setFocus(logo);
        pointer(logo, 90, 28);
        pointer(logo, 90, 46); // Down while the cursor is still ON the logo.
        expect(spatialNav.getCurrentFocus()).toBe(play);

        jest.advanceTimersByTime(250);
        pointer(logo, 90, 46, 'mouseover'); // Firmware repeats the old hit.
        expect(spatialNav.getCurrentFocus()).toBe(play);

        pointer(logo, 90, 63); // Another Down, even after the old 140ms grace period.
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        expect(scroller.scrollTop).toBeGreaterThan(0);

        jest.advanceTimersByTime(250);
        pointer(logo, 90, 63, 'mousedown');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        // If the TV gives the logo native DOM focus because its cursor is parked
        // there, repair it back to the actual, ringed poster on the next frame.
        logo.focus();
        // Repair in focusin, before the next TV paint (not 700ms later).
        expect(document.activeElement).toBe(topCard);
        jest.advanceTimersByTime(20);
        expect(document.activeElement).toBe(topCard);

        // A deliberate move to a DIFFERENT header control must still follow it.
        pointer(homeLink, 260, 35);
        expect(spatialNav.getCurrentFocus()).toBe(homeLink);
    });

    it('does not jump back to the logo when a mixed key/pointer TV repeats its parked cursor', () => {
        spatialNav.setFocus(logo);
        pointer(logo, 90, 28);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        jest.advanceTimersByTime(1300); // past the key-priority suppression window
        pointer(logo, 90, 28, 'mouseover');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        pointer(logo, 90, 46);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('lets a deliberately moved pointer return from a steered poster to blank hero art', () => {
        pointer(hero, 110, 320);
        pointer(hero, 110, 337);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        jest.advanceTimersByTime(250);
        pointer(hero, 700, 220); // A real move away, not a stale parked hit.
        expect(spatialNav.getCurrentFocus()).toBe(play);
    });

    it('can infer Down from a TV that only emits mouseover near the logo', () => {
        spatialNav.setFocus(logo);
        pointer(logo, 90, 28, 'mouseover');
        pointer(logo, 90, 46, 'mouseover');
        expect(spatialNav.getCurrentFocus()).toBe(play);
    });

    it('Down from the navbar on a catalog WITHOUT a hero targets its first shelf, then Up returns', () => {
        hero.remove();
        const hydrateAll = jest.fn();
        window.addEventListener('arena-hydrate-shelf', hydrateAll);
        try {
            spatialNav.setFocus(logo);
            press('ArrowDown');
            expect(spatialNav.getCurrentFocus()).toBe(topCard);
            expect(scroller.scrollTop).toBeGreaterThan(0);
            expect(hydrateAll).not.toHaveBeenCalled();
            press('ArrowUp');
            expect(spatialNav.getCurrentFocus()).toBe(logo);
        } finally {
            window.removeEventListener('arena-hydrate-shelf', hydrateAll);
        }
    });

    it('Down from Play scrolls the NESTED page to the first poster, and Up returns to Play (not the catch zone)', () => {
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        expect(scroller.scrollTop).toBeGreaterThan(0);
        expect(window.scrollBy).not.toHaveBeenCalled();

        press('ArrowUp');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        expect(hero.hasAttribute('data-tv-focused')).toBe(false);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('a TV pointer moved DOWN within the hero moves and scrolls to a shelf without any keydown', () => {
        pointer(play, 110, 432);
        pointer(hero, 110, 449);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        expect(scroller.scrollTop).toBeGreaterThan(0);
        // More TV mousemove/mouseover at the same point must not throw the ring back to Play.
        pointer(hero, 110, 449, 'mouseover');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('uses movementY when a TV supplies just one mousemove for the FIRST Down press', () => {
        document.elementFromPoint = jest.fn(() => hero);
        const event = new MouseEvent('mousemove', { clientX: 110, clientY: 430, bubbles: true });
        Object.defineProperty(event, 'movementY', { value: 18 });
        hero.dispatchEvent(event);
        jest.advanceTimersByTime(20);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        expect(scroller.scrollTop).toBeGreaterThan(0);
    });

    it('a held pointer moving inside the focused poster steps to the next shelf immediately', () => {
        pointer(topCard, 110, 330);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        pointer(topCard, 110, 350);
        expect(spatialNav.getCurrentFocus()).toBe(nextCard);
        expect(scroller.scrollTop).toBeGreaterThan(0);
    });

    it('keeps two rapid pointer Down presses before one paint, without double-counting duplicate mouse/pointer events', () => {
        spatialNav.setFocus(logo);
        pointer(logo, 90, 28); // Establish the TV arrow location.
        document.elementFromPoint = jest.fn(() => logo);
        logo.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 45, bubbles: true }));
        logo.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 45, bubbles: true }));
        logo.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 62, bubbles: true }));
        jest.advanceTimersByTime(20); // TV only renders one frame for both presses.
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        expect(scroller.scrollTop).toBeGreaterThan(0);
        jest.advanceTimersByTime(100);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('treats two small mousemoves from one physical press as a single step', () => {
        pointer(hero, 110, 320);
        document.elementFromPoint = jest.fn(() => hero);
        hero.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 329, bubbles: true }));
        hero.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 338, bubbles: true }));
        jest.advanceTimersByTime(20);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('drains a longer pointer burst across two frames without losing its destination', () => {
        const extra = Array.from({ length: 3 }, (_, i) => `
            <div data-tv-shelf="true" data-tv-shelf-count="1">
                <button id="burst-${i}" data-tv-card="true" data-tv-row="burst-${i}" data-tv-index="0">Row ${i}</button>
            </div>
        `).join('');
        scroller.insertAdjacentHTML('beforeend', extra);
        for (let i = 0; i < 3; i++) {
            container.querySelector<HTMLElement>(`#burst-${i}`)!.getBoundingClientRect = () =>
                rect(48, 1500 + 380 * i - scroller.scrollTop, 175, 255) as any;
        }
        pointer(hero, 110, 320);
        document.elementFromPoint = jest.fn(() => hero);
        for (const y of [337, 354, 371, 388, 405]) {
            hero.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: y, bubbles: true }));
        }
        jest.advanceTimersByTime(20);
        expect(spatialNav.getCurrentFocus()).toBe(container.querySelector('#burst-0'));
        jest.advanceTimersByTime(20);
        expect(spatialNav.getCurrentFocus()).toBe(container.querySelector('#burst-2'));
    });

    it('preserves rapid Down then Up before a paint instead of keeping only the last direction', () => {
        spatialNav.setFocus(topCard);
        pointer(topCard, 110, 330);
        document.elementFromPoint = jest.fn(() => topCard);
        topCard.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 347, bubbles: true }));
        topCard.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 330, bubbles: true }));
        jest.advanceTimersByTime(20);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('accepts pointer Down shortly after a key-driven step, but ignores its same-press echo', () => {
        spatialNav.setFocus(logo);
        pointer(logo, 90, 28);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(play);
        jest.advanceTimersByTime(50);
        pointer(logo, 90, 45); // Same physical press echoed as pointer motion.
        expect(spatialNav.getCurrentFocus()).toBe(play);
        jest.advanceTimersByTime(160);
        pointer(logo, 90, 62); // Next intentional Down should NOT wait 1.2s.
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('flushes pointer Down before OK when the user presses both faster than a paint', () => {
        const openCard = jest.fn();
        const openPlay = jest.fn();
        topCard.addEventListener('click', openCard);
        play.addEventListener('click', openPlay);
        spatialNav.setFocus(play);
        pointer(hero, 110, 320);
        document.elementFromPoint = jest.fn(() => hero);
        hero.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 337, bubbles: true }));
        hero.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 337, bubbles: true, cancelable: true }));
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        expect(openCard).toHaveBeenCalledTimes(1);
        expect(openPlay).not.toHaveBeenCalled();
        jest.advanceTimersByTime(20);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('flushes a pointer move before a same-frame Enter key selects the destination once', () => {
        const openCard = jest.fn();
        const openPlay = jest.fn();
        topCard.addEventListener('click', openCard);
        play.addEventListener('click', openPlay);
        pointer(hero, 110, 320);
        document.elementFromPoint = jest.fn(() => hero);
        hero.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 337, bubbles: true }));
        press('Enter');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        expect(openCard).toHaveBeenCalledTimes(1);
        expect(openPlay).not.toHaveBeenCalled();
    });

    it('a pointer-only TV can go Down through shelves and Up again while still over hero art', () => {
        pointer(hero, 110, 320);
        pointer(hero, 110, 337);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        pointer(hero, 110, 354);
        expect(spatialNav.getCurrentFocus()).toBe(nextCard);
        pointer(hero, 110, 337);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        pointer(hero, 110, 320);
        expect(spatialNav.getCurrentFocus()).toBe(play);
    });

    it('OK on empty hero art activates the ringed card once, not the Play button behind the TV cursor', () => {
        const openCard = jest.fn();
        const openPlay = jest.fn();
        topCard.addEventListener('click', openCard);
        play.addEventListener('click', openPlay);
        pointer(hero, 110, 320);
        pointer(hero, 110, 337);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);

        hero.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 337, bubbles: true, cancelable: true }));
        expect(openCard).toHaveBeenCalledTimes(1);
        expect(openPlay).not.toHaveBeenCalled();
    });

    it('OK selects the focused poster even if the TV cursor is still physically on Play', () => {
        const openCard = jest.fn();
        const openPlay = jest.fn();
        topCard.addEventListener('click', openCard);
        play.addEventListener('click', openPlay);
        pointer(play, 110, 428);
        pointer(play, 110, 443); // cursor has not left the Play button
        expect(spatialNav.getCurrentFocus()).toBe(topCard);

        play.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 443, bubbles: true, cancelable: true }));
        expect(openCard).toHaveBeenCalledTimes(1);
        expect(openPlay).not.toHaveBeenCalled();
    });

    it('OK from a pointer-only remote does not disable pointer Down for the next 1.2 seconds', () => {
        pointer(hero, 110, 320);
        press('Enter'); // Many TV remotes send Enter for OK but only mousemove for Down.
        pointer(hero, 110, 337);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('does not convert pointermove and mousemove at the same coordinates into two D-pad steps', () => {
        pointer(hero, 110, 320);
        pointer(hero, 110, 337);
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        pointer(hero, 110, 337, 'pointermove');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
    });

    it('stops geometry reads once it passes the matching poster in a large destination shelf', () => {
        const shelf = container.querySelector<HTMLElement>('#next-shelf')!;
        shelf.setAttribute('data-tv-shelf-count', '32');
        let distantReads = 0;
        for (let i = 1; i < 32; i++) {
            const card = document.createElement('button');
            card.setAttribute('data-tv-card', 'true');
            card.setAttribute('data-tv-row', 'trending');
            card.setAttribute('data-tv-index', String(i));
            card.getBoundingClientRect = () => {
                distantReads++;
                return rect(48 + i * 187, 1080 - scroller.scrollTop, 175, 255) as any;
            };
            shelf.appendChild(card);
        }
        spatialNav.setFocus(topCard);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(nextCard);
        expect(distantReads).toBeLessThan(3);
    });

    it('reads geometry only from the destination shelf, not every poster in the entire catalog', () => {
        const otherRows = Array.from({ length: 20 }, (_, row) => `<div data-tv-shelf="true" data-tv-shelf-count="32">${
            Array.from({ length: 32 }, (_, index) => `<button data-tv-focusable="true" data-tv-card="true" data-tv-row="row-${row}" data-tv-index="${index}">Poster</button>`).join('')
        }</div>`).join('');
        scroller.insertAdjacentHTML('beforeend', otherRows);
        let reads = 0;
        scroller.querySelectorAll('[data-tv-row^="row-"]').forEach((card: HTMLElement) => {
            card.getBoundingClientRect = () => { reads++; return rect(48, 1600, 175, 255) as any; };
        });
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        press('ArrowDown');
        expect(spatialNav.getCurrentFocus()).toBe(nextCard);
        expect(reads).toBeLessThan(50);
    });

    it('hydrates the very next deferred shelf and waits for its card, without skipping rows', async () => {
        const next = container.querySelector<HTMLElement>('#next-shelf')!;
        next.innerHTML = '<div class="placeholder">Loading</div>';
        next.addEventListener('arena-hydrate-shelf', () => {
            setTimeout(() => {
                next.innerHTML = '<button id="hydrated" data-tv-focusable="true" data-tv-card="true" data-tv-row="trending" data-tv-index="0">Trending</button>';
                next.querySelector<HTMLElement>('#hydrated')!.getBoundingClientRect = () =>
                    rect(48, 1080 - scroller.scrollTop, 175, 255) as any;
            }, 30);
        });
        spatialNav.setFocus(topCard);
        press('ArrowDown');
        // The old card keeps focus until the React shelf has actually mounted.
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        await jest.advanceTimersByTimeAsync(70);
        expect(spatialNav.getCurrentFocus()).toBe(next.querySelector('#hydrated'));
    });

    it('two fast Down presses pass through a loading shelf and do not snap back after it mounts', async () => {
        const next = container.querySelector<HTMLElement>('#next-shelf')!;
        next.innerHTML = '<div class="placeholder">Loading</div>';
        next.addEventListener('arena-hydrate-shelf', () => {
            setTimeout(() => {
                next.innerHTML = '<button data-tv-focusable="true" data-tv-card="true" data-tv-row="trending" data-tv-index="0">Ready</button>';
            }, 30);
        });
        next.insertAdjacentHTML('afterend', `
            <div data-tv-shelf="true" data-tv-shelf-count="1">
                <button id="third" data-tv-focusable="true" data-tv-card="true" data-tv-row="third" data-tv-index="0">Third</button>
            </div>
        `);
        const third = container.querySelector<HTMLElement>('#third')!;
        third.getBoundingClientRect = () => rect(48, 1450 - scroller.scrollTop, 175, 255) as any;
        spatialNav.setFocus(topCard);

        press('ArrowDown'); // target shelf still hydrating
        expect(spatialNav.getCurrentFocus()).toBe(topCard);
        press('ArrowDown'); // intent is the shelf AFTER the pending one
        expect(spatialNav.getCurrentFocus()).toBe(third);
        await jest.advanceTimersByTimeAsync(60);
        expect(spatialNav.getCurrentFocus()).toBe(third);
    });

    it('keeps a rapid pointer burst aimed past a hydrating shelf', async () => {
        const loading = container.querySelector<HTMLElement>('#next-shelf')!;
        loading.innerHTML = '<div class="placeholder">Loading</div>';
        loading.addEventListener('arena-hydrate-shelf', () => {
            setTimeout(() => {
                loading.innerHTML = '<button data-tv-card="true" data-tv-row="trending">Ready</button>';
            }, 30);
        });
        loading.insertAdjacentHTML('afterend', `
            <div data-tv-shelf="true" data-tv-shelf-count="1">
                <button id="third" data-tv-card="true" data-tv-row="third" data-tv-index="0">Third</button>
            </div>
        `);
        const third = container.querySelector<HTMLElement>('#third')!;
        third.getBoundingClientRect = () => rect(48, 1450 - scroller.scrollTop, 175, 255) as any;
        spatialNav.setFocus(topCard);
        pointer(topCard, 110, 330);
        document.elementFromPoint = jest.fn(() => topCard);
        topCard.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 347, bubbles: true }));
        topCard.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 364, bubbles: true }));
        await jest.advanceTimersByTimeAsync(20);
        expect(spatialNav.getCurrentFocus()).toBe(third);
        await jest.advanceTimersByTimeAsync(50);
        expect(spatialNav.getCurrentFocus()).toBe(third);
    });

    it('does not jump to another row when a virtualized shelf needs the next poster mounted', async () => {
        const shelf = container.querySelector<HTMLElement>('#top-shelf')!;
        shelf.setAttribute('data-tv-shelf-count', '40');
        const card = container.querySelector<HTMLElement>('#top-card-1')!;
        card.setAttribute('data-tv-index', '31');
        spatialNav.setFocus(card);
        shelf.addEventListener('arena-tv-reveal-card', (event: any) => {
            setTimeout(() => {
                const next = document.createElement('button');
                next.id = 'card-32';
                next.setAttribute('data-tv-card', 'true');
                next.setAttribute('data-tv-focusable', 'true');
                next.setAttribute('data-tv-row', 'top-10');
                next.setAttribute('data-tv-index', String(event.detail.index));
                next.getBoundingClientRect = () => rect(420, 660 - scroller.scrollTop, 175, 255) as any;
                shelf.appendChild(next);
            }, 25);
        });
        press('ArrowRight');
        expect(spatialNav.getCurrentFocus()).toBe(card);
        await jest.advanceTimersByTimeAsync(50);
        expect(spatialNav.getCurrentFocus()?.getAttribute('data-tv-index')).toBe('32');
        expect(spatialNav.getCurrentFocus()?.getAttribute('data-tv-row')).toBe('top-10');
    });
});
