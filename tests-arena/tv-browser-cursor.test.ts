// @ts-nocheck — jsdom does not implement Pointer Lock; emulate the browser's events.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spatialNav } from '../lib/spatialNavigation';

const TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 Chrome/69.0 TV Safari/537.36';
const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height,
});

describe('Samsung TV browser cursor suppression', () => {
    let container: HTMLElement;
    const originalUA = navigator.userAgent;
    const lockDescriptor = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const exitDescriptor = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-24T12:00:00Z'));
        localStorage.clear();
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: TV_UA });
        Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
        container = document.createElement('div');
        document.body.appendChild(container);
        spatialNav.init();
        spatialNav.setPointerModePreference('auto');
        spatialNav.setTvMode(false, false);
    });

    afterEach(() => {
        spatialNav.setTvMode(false, false);
        spatialNav.destroy();
        container.remove();
        window.history.replaceState({}, '', '/');
        delete (document.body as any).requestPointerLock;
        if (lockDescriptor) Object.defineProperty(document, 'pointerLockElement', lockDescriptor);
        else delete (document as any).pointerLockElement;
        if (exitDescriptor) Object.defineProperty(document, 'exitPointerLock', exitDescriptor);
        else delete (document as any).exitPointerLock;
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUA });
        jest.useRealTimers();
    });

    it('keeps plain cursor:none when the TV rejects the transparent image fallback', () => {
        const source = readFileSync(join(__dirname, '../app/+html.tsx'), 'utf8');
        expect(source).toMatch(/cursor: none !important;\s*cursor: url\('data:image\/png;base64,/);
    });

    it('repairs TV-mode cursor classes after a category route re-renders html/body', async () => {
        spatialNav.setTvMode(true, false);
        document.documentElement.classList.remove('tv-remote-mode');
        document.body.classList.remove('tv-remote-mode');
        await Promise.resolve(); // class MutationObserver callback
        expect(document.documentElement.classList.contains('tv-remote-mode')).toBe(true);
        expect(document.body.classList.contains('tv-remote-mode')).toBe(true);

        spatialNav.setTvMode(false, false);
        await Promise.resolve();
        expect(document.documentElement.classList.contains('tv-remote-mode')).toBe(false);
        expect(document.body.classList.contains('tv-remote-mode')).toBe(false);
    });

    it('does not request pointer lock unless the user has turned TV Mode on', async () => {
        const request = jest.fn();
        Object.defineProperty(document.body, 'requestPointerLock', { configurable: true, value: request });
        expect(await spatialNav.tryLockTvPointer()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('falls back safely when Samsung Internet does not support pointer lock', async () => {
        spatialNav.setTvMode(true, false);
        expect(await spatialNav.tryLockTvPointer()).toBe(false);
        expect(spatialNav.isTvPointerLocked()).toBe(false);
    });

    it('reports browser refusal without changing the existing TV ring/navigation', async () => {
        spatialNav.setTvMode(true, false);
        const request = jest.fn(() => Promise.reject(new Error('not allowed by Samsung Internet')));
        Object.defineProperty(document.body, 'requestPointerLock', { configurable: true, value: request });
        Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: jest.fn() });
        expect(await spatialNav.tryLockTvPointer()).toBe(false);
        expect(request).toHaveBeenCalledTimes(1);
        expect(spatialNav.isTvPointerLocked()).toBe(false);
        expect(document.documentElement.classList.contains('tv-remote-mode')).toBe(true);
    });

    it('keeps the cursor rules and optional lock across Home → Movies route changes', async () => {
        spatialNav.setTvMode(true, false);
        Object.defineProperty(document.body, 'requestPointerLock', { configurable: true, value: () => {
            Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: document.body });
            document.dispatchEvent(new Event('pointerlockchange'));
        } });
        Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => {
            Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
            document.dispatchEvent(new Event('pointerlockchange'));
        } });
        expect(await spatialNav.tryLockTvPointer()).toBe(true);
        document.documentElement.classList.remove('tv-remote-mode');
        window.history.pushState({}, '', '/browse/movies');
        expect(document.documentElement.classList.contains('tv-remote-mode')).toBe(true);
        document.body.classList.remove('tv-remote-mode');
        await Promise.resolve();
        expect(document.body.classList.contains('tv-remote-mode')).toBe(true);
        expect(spatialNav.isTvPointerLocked()).toBe(true);

        spatialNav.setTvMode(false, false);
        expect(spatialNav.isTvPointerLocked()).toBe(false);
        expect(document.body.classList.contains('tv-remote-mode')).toBe(false);
    });

    it('keeps D-pad direction + OK working if browser pointer lock succeeds', async () => {
        container.innerHTML = `
            <div data-tv-scroll-container="true" data-tv-route-page="/">
                <div data-tv-shelf="true" data-tv-shelf-count="1">
                    <button id="one" data-tv-card="true" data-tv-focusable="true" data-tv-row="one" data-tv-index="0">One</button>
                </div>
                <div data-tv-shelf="true" data-tv-shelf-count="1">
                    <button id="two" data-tv-card="true" data-tv-focusable="true" data-tv-row="two" data-tv-index="0">Two</button>
                </div>
                <div data-tv-shelf="true" data-tv-shelf-count="1">
                    <button id="three" data-tv-card="true" data-tv-focusable="true" data-tv-row="three" data-tv-index="0">Three</button>
                </div>
            </div>
        `;
        const one = container.querySelector('#one') as HTMLElement;
        const two = container.querySelector('#two') as HTMLElement;
        const three = container.querySelector('#three') as HTMLElement;
        one.getBoundingClientRect = () => rect(40, 200, 160, 220) as any;
        two.getBoundingClientRect = () => rect(40, 520, 160, 220) as any;
        three.getBoundingClientRect = () => rect(40, 840, 160, 220) as any;
        const request = jest.fn(() => {
            Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: document.body });
            document.dispatchEvent(new Event('pointerlockchange'));
        });
        Object.defineProperty(document.body, 'requestPointerLock', { configurable: true, value: request });
        const exit = jest.fn(() => {
            Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
            document.dispatchEvent(new Event('pointerlockchange'));
        });
        Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: exit });
        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(one);

        expect(await spatialNav.tryLockTvPointer()).toBe(true);
        expect(request).toHaveBeenCalledTimes(1);
        expect(spatialNav.isTvPointerLocked()).toBe(true);
        const move = new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true });
        Object.defineProperty(move, 'movementY', { value: 18 });
        document.body.dispatchEvent(move);
        // A second event for the same physical move must not skip a shelf.
        const echoedMove = new MouseEvent('pointermove', { clientX: 0, clientY: 0, bubbles: true });
        Object.defineProperty(echoedMove, 'movementY', { value: 18 });
        document.body.dispatchEvent(echoedMove);
        jest.advanceTimersByTime(35);
        expect(spatialNav.getCurrentFocus()).toBe(two);
        expect(document.activeElement).toBe(two);

        const clicked = jest.fn();
        two.addEventListener('click', clicked);
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(clicked).toHaveBeenCalledTimes(1);

        // Hybrid TVs also send real ArrowDown; that remains a single fast step
        // even while Pointer Lock is active (no second step from a pointer echo).
        window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true,
        }));
        expect(spatialNav.getCurrentFocus()).toBe(three);
        document.body.dispatchEvent(move);
        jest.advanceTimersByTime(16);
        expect(spatialNav.getCurrentFocus()).toBe(three);

        // Return must release the lock rather than trap the remote in the page.
        window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
        }));
        expect(exit).toHaveBeenCalledTimes(1);
        expect(spatialNav.isTvPointerLocked()).toBe(false);
        expect(spatialNav.getCurrentFocus()).toBe(three);
    });
});
