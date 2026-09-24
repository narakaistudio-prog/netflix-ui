// @ts-nocheck — unit tests for Smart TV remote control and spatial navigation
import {
    spatialNav,
    initSpatialNavigation,
    isTvDevice,
    setTvMode,
    getTvMode,
    pushBackHandler,
} from '../lib/spatialNavigation';

describe('Spatial Navigation & Samsung Smart TV Remote Control', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        window.scrollBy = jest.fn();
        spatialNav.init();
        // Programmatic reset (persist = false): an explicit user "off" is now
        // remembered separately and would block the auto-activation tests.
        spatialNav.setTvMode(false, false);
    });

    afterEach(() => {
        spatialNav.destroy();
        container.remove();
        document.body.classList.remove('tv-remote-mode');
    });

    it('identifies Samsung Smart TV Tizen and other TV browsers correctly', () => {
        const samsungTizenUa =
            'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.1 Chrome/69.0.3497.106 TV Safari/537.36';

        const originalUa = navigator.userAgent;
        try {
            Object.defineProperty(navigator, 'userAgent', {
                value: samsungTizenUa,
                configurable: true,
            });
            expect(spatialNav.detectTvDevice()).toBe(true);
        } finally {
            Object.defineProperty(navigator, 'userAgent', {
                value: originalUa,
                configurable: true,
            });
        }
    });

    it('registers hardware keys on Samsung Tizen devices when available', () => {
        const registeredKeys: string[] = [];
        (window as any).tizen = {
            tvinputdevice: {
                registerKey: (keyName: string) => {
                    registeredKeys.push(keyName);
                },
            },
        };

        try {
            spatialNav.registerTizenKeys();
            expect(registeredKeys).toContain('MediaPlayPause');
            expect(registeredKeys).toContain('MediaPlay');
            expect(registeredKeys).toContain('MediaPause');
        } finally {
            delete (window as any).tizen;
        }
    });

    it('automatically activates TV remote mode when arrow keys or TV keys are pressed', () => {
        const originalUa = navigator.userAgent;
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.1 Chrome/69.0.3497.106 TV Safari/537.36',
            configurable: true,
        });

        try {
            expect(spatialNav.isTvMode()).toBe(false);
            expect(document.body.classList.contains('tv-remote-mode')).toBe(false);

            // Simulate pressing Samsung TV remote ArrowRight key
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true })
            );

            expect(spatialNav.isTvMode()).toBe(true);
            expect(document.body.classList.contains('tv-remote-mode')).toBe(true);
        } finally {
            Object.defineProperty(navigator, 'userAgent', { value: originalUa, configurable: true });
        }
    });

    it('navigates horizontally across cards in the same shelf with ArrowRight and ArrowLeft', () => {
        container.innerHTML = `
            <div data-tv-row="top-10" style="display: flex;">
                <button id="card-0" data-tv-focusable="true" data-tv-row="top-10" data-tv-index="0" style="width: 100px; height: 150px; margin-right: 10px;">Card 0</button>
                <button id="card-1" data-tv-focusable="true" data-tv-row="top-10" data-tv-index="1" style="width: 100px; height: 150px; margin-right: 10px;">Card 1</button>
                <button id="card-2" data-tv-focusable="true" data-tv-row="top-10" data-tv-index="2" style="width: 100px; height: 150px;">Card 2</button>
            </div>
        `;

        const card0 = container.querySelector('#card-0') as HTMLButtonElement;
        const card1 = container.querySelector('#card-1') as HTMLButtonElement;
        const card2 = container.querySelector('#card-2') as HTMLButtonElement;

        // Mock getBoundingClientRect
        card0.getBoundingClientRect = () => ({ left: 0, right: 100, top: 100, bottom: 250, width: 100, height: 150 } as any);
        card1.getBoundingClientRect = () => ({ left: 110, right: 210, top: 100, bottom: 250, width: 100, height: 150 } as any);
        card2.getBoundingClientRect = () => ({ left: 220, right: 320, top: 100, bottom: 250, width: 100, height: 150 } as any);

        spatialNav.setTvMode(true);
        spatialNav.setFocus(card0);
        expect(spatialNav.getCurrentFocus()).toBe(card0);
        expect(card0.getAttribute('data-tv-focused')).toBe('true');

        // Press ArrowRight -> moves to card 1
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true })
        );
        expect(spatialNav.getCurrentFocus()).toBe(card1);
        expect(card1.getAttribute('data-tv-focused')).toBe('true');
        expect(card0.hasAttribute('data-tv-focused')).toBe(false);

        // Press ArrowRight again -> moves to card 2
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true })
        );
        expect(spatialNav.getCurrentFocus()).toBe(card2);

        // Press ArrowLeft -> moves back to card 1
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowLeft', keyCode: 37, bubbles: true, cancelable: true })
        );
        expect(spatialNav.getCurrentFocus()).toBe(card1);
    });

    it('does not move the ring into an inactive tab screen with the same shelf row', () => {
        container.innerHTML = `
            <div style="position:absolute;opacity:0">
                <div data-tv-row="same-row">
                    <button id="ghost-0" data-tv-focusable="true" data-tv-row="same-row" data-tv-index="0">Ghost 0</button>
                    <button id="ghost-1" data-tv-focusable="true" data-tv-row="same-row" data-tv-index="1">Ghost 1</button>
                </div>
            </div>
            <div>
                <div data-tv-row="same-row">
                    <button id="real-0" data-tv-focusable="true" data-tv-row="same-row" data-tv-index="0">Real 0</button>
                    <button id="real-1" data-tv-focusable="true" data-tv-row="same-row" data-tv-index="1">Real 1</button>
                </div>
            </div>
        `;
        const ghost0 = container.querySelector('#ghost-0') as HTMLButtonElement;
        const ghost1 = container.querySelector('#ghost-1') as HTMLButtonElement;
        const real0 = container.querySelector('#real-0') as HTMLButtonElement;
        const real1 = container.querySelector('#real-1') as HTMLButtonElement;
        const rect = (left: number) => ({ left, right: left + 100, top: 100, bottom: 250, width: 100, height: 150 } as any);
        ghost0.getBoundingClientRect = () => rect(0);
        ghost1.getBoundingClientRect = () => rect(110);
        real0.getBoundingClientRect = () => rect(0);
        real1.getBoundingClientRect = () => rect(110);

        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(real0);
        window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true,
        }));

        expect(spatialNav.getCurrentFocus()).toBe(real1);
        expect(spatialNav.getCurrentFocus()).not.toBe(ghost1);
    });

    it('recovers when the focused tab becomes hidden instead of navigating from it', () => {
        container.innerHTML = `
            <div id="old-tab" style="position:absolute;opacity:0">
                <button id="old-card" data-tv-focusable="true" data-tv-row="old-row" data-tv-index="0">Old</button>
            </div>
            <div id="new-tab">
                <button id="new-card" data-tv-focusable="true" data-tv-row="new-row" data-tv-index="0">New</button>
            </div>
        `;
        const oldCard = container.querySelector('#old-card') as HTMLButtonElement;
        const newCard = container.querySelector('#new-card') as HTMLButtonElement;
        oldCard.getBoundingClientRect = () => ({ left: 0, right: 100, top: 100, bottom: 250, width: 100, height: 150 } as any);
        newCard.getBoundingClientRect = () => ({ left: 0, right: 100, top: 100, bottom: 250, width: 100, height: 150 } as any);

        spatialNav.setTvMode(true, false);
        // Simulate the tab transition completing after the ring was on it.
        oldCard.style.opacity = '1';
        spatialNav.setFocus(oldCard);
        oldCard.style.opacity = '0';

        window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true,
        }));

        expect(spatialNav.getCurrentFocus()).toBe(newCard);
    });

    it('recovers beside a card when a virtualized shelf unmounts it', () => {
        container.innerHTML = `
            <div data-tv-row="windowed-row">
                <button id="card-0" data-tv-focusable="true" data-tv-row="windowed-row" data-tv-index="0">Card 0</button>
                <button id="card-1" data-tv-focusable="true" data-tv-row="windowed-row" data-tv-index="1">Card 1</button>
                <button id="card-2" data-tv-focusable="true" data-tv-row="windowed-row" data-tv-index="2">Card 2</button>
            </div>
        `;
        const card0 = container.querySelector('#card-0') as HTMLButtonElement;
        const card1 = container.querySelector('#card-1') as HTMLButtonElement;
        const card2 = container.querySelector('#card-2') as HTMLButtonElement;
        const rect = (left: number) => ({ left, right: left + 100, top: 100, bottom: 250, width: 100, height: 150 } as any);
        card0.getBoundingClientRect = () => rect(0);
        card1.getBoundingClientRect = () => rect(110);
        card2.getBoundingClientRect = () => rect(220);

        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(card1);
        card1.remove();

        window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true,
        }));

        expect(spatialNav.getCurrentFocus()).toBe(card2);
        expect(card2.getAttribute('data-tv-focused')).toBe('true');
    });

    it('navigates vertically between rows, preserving horizontal alignment', () => {
        container.innerHTML = `
            <div id="row-0" data-tv-row="row-0" style="display: flex;">
                <button id="r0-c0" data-tv-focusable="true" data-tv-row="row-0">R0 C0</button>
                <button id="r0-c1" data-tv-focusable="true" data-tv-row="row-0">R0 C1</button>
            </div>
            <div id="row-1" data-tv-row="row-1" style="display: flex;">
                <button id="r1-c0" data-tv-focusable="true" data-tv-row="row-1">R1 C0</button>
                <button id="r1-c1" data-tv-focusable="true" data-tv-row="row-1">R1 C1</button>
            </div>
        `;

        const r0c0 = container.querySelector('#r0-c0') as HTMLButtonElement;
        const r0c1 = container.querySelector('#r0-c1') as HTMLButtonElement;
        const r1c0 = container.querySelector('#r1-c0') as HTMLButtonElement;
        const r1c1 = container.querySelector('#r1-c1') as HTMLButtonElement;

        r0c0.getBoundingClientRect = () => ({ left: 0, right: 100, top: 100, bottom: 250, width: 100, height: 150 } as any);
        r0c1.getBoundingClientRect = () => ({ left: 110, right: 210, top: 100, bottom: 250, width: 100, height: 150 } as any);
        r1c0.getBoundingClientRect = () => ({ left: 0, right: 100, top: 300, bottom: 450, width: 100, height: 150 } as any);
        r1c1.getBoundingClientRect = () => ({ left: 110, right: 210, top: 300, bottom: 450, width: 100, height: 150 } as any);

        spatialNav.setTvMode(true);
        spatialNav.setFocus(r0c1); // Focus column 1 in row 0

        // Press ArrowDown -> should move to r1c1 (closest horizontal match)
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true })
        );
        expect(spatialNav.getCurrentFocus()).toBe(r1c1);

        // Press ArrowUp -> should move back to r0c1
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowUp', keyCode: 38, bubbles: true, cancelable: true })
        );
        expect(spatialNav.getCurrentFocus()).toBe(r0c1);
    });

    it('triggers click when Enter / OK button is pressed', () => {
        container.innerHTML = `
            <button id="play-btn" data-tv-focusable="true">Play</button>
        `;
        const playBtn = container.querySelector('#play-btn') as HTMLButtonElement;
        const clickSpy = jest.fn();
        playBtn.addEventListener('click', clickSpy);

        spatialNav.setTvMode(true);
        spatialNav.setFocus(playBtn);

        // Press Enter key (13)
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true })
        );
        expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('executes back handlers on Samsung TV Return key (keyCode 10009) or Escape', () => {
        const modalBackHandler = jest.fn(() => true);
        const unregister = spatialNav.pushBackHandler(modalBackHandler);

        // Press Samsung Tizen Return key (keyCode 10009)
        const event = new KeyboardEvent('keydown', {
            key: 'GoBack',
            keyCode: 10009,
            bubbles: true,
            cancelable: true,
        });
        window.dispatchEvent(event);

        expect(modalBackHandler).toHaveBeenCalledTimes(1);

        unregister();
    });

    it('traps focus inside an active modal scope', () => {
        container.innerHTML = `
            <div id="background-page">
                <button id="bg-btn" data-tv-focusable="true">Background Button</button>
            </div>
            <div id="active-modal" data-tv-scope="modal">
                <button id="modal-close" data-tv-focusable="true">Close</button>
                <button id="modal-action" data-tv-focusable="true">Confirm</button>
            </div>
        `;

        const modalClose = container.querySelector('#modal-close') as HTMLButtonElement;
        const modalAction = container.querySelector('#modal-action') as HTMLButtonElement;

        modalClose.getBoundingClientRect = () => ({ left: 200, right: 300, top: 100, bottom: 150, width: 100, height: 50 } as any);
        modalAction.getBoundingClientRect = () => ({ left: 320, right: 420, top: 100, bottom: 150, width: 100, height: 50 } as any);

        spatialNav.setTvMode(true);
        spatialNav.setFocus(modalClose);

        // Press ArrowRight inside modal -> moves to modalAction
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true })
        );
        expect(spatialNav.getCurrentFocus()).toBe(modalAction);
    });
});

/**
 * Netflix-style billboard hero navigation:
 *   1. ArrowDown on the hero Play button must land on the first poster shelf.
 *   2. ArrowUp from that first shelf must come back to the hero.
 * The hero art and the first shelf overlap on screen (the shelf starts under
 * the hero's bottom gradient), which is exactly what broke plain geometric
 * navigation.
 */
describe('Smart TV hero billboard navigation', () => {
    let container: HTMLDivElement;

    const rect = (left: number, top: number, width: number, height: number) => ({
        left, top, width, height,
        right: left + width, bottom: top + height,
        x: left, y: top,
    });

    const press = (key: string, keyCode: number) => {
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true })
        );
    };

    /**
     * Hero billboard + Top 10 shelf pulled up under the hero + a second shelf.
     * Every shelf also carries its "Explore All" header link, which is marked
     * `data-tv-vertical-ignore` so it is skipped by row-aware navigation but
     * NOT by the generic geometric fallback - that is what made ArrowDown from
     * the hero land on the little text link instead of the first poster.
     */
    function mountHome() {
        container.innerHTML = `
            <div id="billboard" data-tv-pointer-catch-zone="true" data-tv-pointer-redirect="hero-play">
                <button id="hero-play" data-tv-focusable="true" data-tv-id="hero-play"
                        data-tv-row="billboard" data-tv-index="0">Play</button>
                <button id="hero-info" data-tv-focusable="true" data-tv-id="hero-info"
                        data-tv-row="billboard" data-tv-index="1">More Info</button>
            </div>
            <div data-tv-row="top-10">
                <button id="explore-top10" data-tv-focusable="true" data-tv-row="top-10-header"
                        data-tv-id="explore-top10" data-tv-vertical-ignore="true">Explore All</button>
                <button id="t10-0" data-tv-focusable="true" data-tv-card="true"
                        data-tv-row="top-10" data-tv-index="0">Top 10 #1</button>
                <button id="t10-1" data-tv-focusable="true" data-tv-card="true"
                        data-tv-row="top-10" data-tv-index="1">Top 10 #2</button>
            </div>
            <div data-tv-row="trending">
                <button id="explore-trending" data-tv-focusable="true" data-tv-row="trending-header"
                        data-tv-id="explore-trending" data-tv-vertical-ignore="true">Explore All</button>
                <button id="tr-0" data-tv-focusable="true" data-tv-card="true"
                        data-tv-row="trending" data-tv-index="0">Trending 1</button>
            </div>
        `;
        const el = (id: string) => container.querySelector(`#${id}`) as HTMLElement;
        // The hero buttons sit inside the hero art, so the Top 10 posters start
        // ABOVE the bottom edge of the Play button (the shelf slides under the
        // hero's bottom gradient, exactly like netflix.com).
        el('hero-play').getBoundingClientRect = () => rect(64, 460, 150, 40) as any;
        el('hero-info').getBoundingClientRect = () => rect(230, 460, 170, 40) as any;
        el('explore-top10').getBoundingClientRect = () => rect(1080, 440, 120, 24) as any;
        el('t10-0').getBoundingClientRect = () => rect(48, 470, 175, 255) as any;
        el('t10-1').getBoundingClientRect = () => rect(235, 470, 175, 255) as any;
        el('explore-trending').getBoundingClientRect = () => rect(1080, 840, 120, 24) as any;
        el('tr-0').getBoundingClientRect = () => rect(48, 860, 175, 255) as any;
        return el;
    }

    beforeEach(() => {
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
    });

    it('moves ArrowDown from the hero Play button to the first card of the first shelf', () => {
        const el = mountHome();
        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(el('hero-play'));

        press('ArrowDown', 40);

        expect(spatialNav.getCurrentFocus()).toBe(el('t10-0'));
        expect(el('t10-0').getAttribute('data-tv-focused')).toBe('true');
        expect(el('hero-play').hasAttribute('data-tv-focused')).toBe(false);
    });

    it('keeps the column when dropping from More Info into the first shelf', () => {
        const el = mountHome();
        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(el('hero-info'));

        press('ArrowDown', 40);

        // More Info sits over the second poster, so that is the card it lands on.
        expect(spatialNav.getCurrentFocus()).toBe(el('t10-1'));
    });

    it('moves ArrowUp from the first shelf back to the hero Play button', () => {
        container.innerHTML = `
            <button id="nav-home" data-tv-focusable="true" data-tv-row="navbar">Home</button>
            <button id="hero-play" data-tv-focusable="true" data-tv-id="hero-play"
                    data-tv-row="billboard" data-tv-index="0">Play</button>
            <button id="t10-0" data-tv-focusable="true" data-tv-card="true"
                    data-tv-row="top-10" data-tv-index="0">Top 10 #1</button>
            <button id="tr-0" data-tv-focusable="true" data-tv-card="true"
                    data-tv-row="trending" data-tv-index="0">Trending 1</button>
        `;
        const el = (id: string) => container.querySelector(`#${id}`) as HTMLElement;
        el('nav-home').getBoundingClientRect = () => rect(48, 20, 90, 44) as any;
        el('hero-play').getBoundingClientRect = () => rect(64, 120, 150, 280) as any;
        el('t10-0').getBoundingClientRect = () => rect(48, 380, 175, 220) as any;
        el('tr-0').getBoundingClientRect = () => rect(48, 900, 175, 255) as any;

        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(el('t10-0'));

        press('ArrowUp', 38);

        expect(spatialNav.getCurrentFocus()).toBe(el('hero-play'));
    });

    it('still walks up shelf by shelf from the second row', () => {
        const el = mountHome();
        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(el('tr-0'));

        press('ArrowUp', 38);

        // ArrowUp from a deeper shelf goes to the shelf above, not to the hero.
        expect(spatialNav.getCurrentFocus()).toBe(el('t10-0'));
    });
});
