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
