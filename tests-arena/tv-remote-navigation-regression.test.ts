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
    const oldUA = navigator.userAgent;
    const oldHeight = window.innerHeight;

    function mountHome() {
        container.innerHTML = `
            <div id="scroller" data-tv-scroll-container="true">
                <div id="hero" data-tv-pointer-catch-zone="true" data-tv-pointer-redirect="hero-play">
                    <button id="play" data-tv-focusable="true" data-tv-id="hero-play" data-tv-row="billboard">Play</button>
                    <button id="info" data-tv-focusable="true" data-tv-id="hero-info" data-tv-row="billboard">Info</button>
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
        Object.defineProperties(scroller, {
            scrollHeight: { value: 2900, configurable: true },
            clientHeight: { value: 800, configurable: true },
        });
        scroller.scrollTop = 0;
        hero.getBoundingClientRect = () => rect(0, -scroller.scrollTop, 1280, 550) as any;
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

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        Object.defineProperty(navigator, 'userAgent', { value: TV_UA, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        window.scrollBy = jest.fn();
        container = document.createElement('div');
        document.body.appendChild(container);
        spatialNav.init();
        spatialNav.setPointerModePreference('auto');
        spatialNav.setTvMode(false, false);
        (spatialNav as any).lastKeyInputAt = 0;
        mountHome();
        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(play);
    });

    afterEach(() => {
        spatialNav.destroy();
        spatialNav.setTvMode(false, false);
        container.remove();
        Object.defineProperty(navigator, 'userAgent', { value: oldUA, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: oldHeight, configurable: true });
        jest.useRealTimers();
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
