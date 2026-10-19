// @ts-nocheck — Android-phone-only fullscreen + landscape lock for the player.
// The real expo-screen-orientation ships ESM that jest can't parse here, and
// its native lock can't run under jsdom anyway — the mock keeps the import
// resolvable; the web branch (Platform.OS === 'web') is what we exercise.
jest.mock('expo-screen-orientation', () => ({
    OrientationLock: { LANDSCAPE: 'landscape-lock', PORTRAIT_UP: 'portrait-up' },
    lockAsync: jest.fn(() => Promise.resolve()),
}));

import {
    enterPlayerFullscreen,
    exitPlayerFullscreen,
    isAndroidWeb,
} from '../lib/playerFullscreen';

const ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function setUA(ua: string) {
    Object.defineProperty(window.navigator, 'userAgent', {
        value: ua,
        configurable: true,
    });
}

function stubOrientation() {
    const lock = jest.fn(() => Promise.resolve());
    const unlock = jest.fn();
    (screen as any).orientation = { lock, unlock };
    return { lock, unlock };
}

function makeHost() {
    const el = document.createElement('div');
    el.requestFullscreen = jest.fn(() => Promise.resolve());
    return el;
}

beforeEach(() => {
    setUA(DESKTOP_UA);
});

afterEach(() => {
    delete (screen as any).orientation;
    jest.clearAllMocks();
});

describe('isAndroidWeb', () => {
    test('Android phone: true, desktop and iPhone: false', () => {
        setUA(ANDROID_UA);
        expect(isAndroidWeb()).toBe(true);

        setUA(DESKTOP_UA);
        expect(isAndroidWeb()).toBe(false);

        setUA(IPHONE_UA);
        expect(isAndroidWeb()).toBe(false);
    });
});

describe('enterPlayerFullscreen', () => {
    test('Android phone: fullscreen on the player box + landscape lock', async () => {
        setUA(ANDROID_UA);
        const { lock } = stubOrientation();
        const host = makeHost();

        await enterPlayerFullscreen(host);

        expect(host.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
        expect(lock).toHaveBeenCalledWith('landscape');
    });

    test('desktop browser: nothing happens (sirf android)', async () => {
        setUA(DESKTOP_UA);
        const { lock } = stubOrientation();
        const host = makeHost();

        await enterPlayerFullscreen(host);

        expect(host.requestFullscreen).not.toHaveBeenCalled();
        expect(lock).not.toHaveBeenCalled();
    });

    test('iPhone: untouched too', async () => {
        setUA(IPHONE_UA);
        const { lock } = stubOrientation();
        const host = makeHost();

        await enterPlayerFullscreen(host);

        expect(host.requestFullscreen).not.toHaveBeenCalled();
        expect(lock).not.toHaveBeenCalled();
    });

    test('fullscreen refused (no gesture) -> the landscape lock is still attempted, never throws', async () => {
        setUA(ANDROID_UA);
        const { lock } = stubOrientation();
        const host = makeHost();
        host.requestFullscreen = jest.fn(() => Promise.reject(new Error('Not allowed')));

        await expect(enterPlayerFullscreen(host)).resolves.toBeUndefined();
        expect(lock).toHaveBeenCalledWith('landscape');
    });

    test('already fullscreen -> does not request again, still re-pins the orientation', async () => {
        setUA(ANDROID_UA);
        const { lock } = stubOrientation();
        const host = makeHost();
        Object.defineProperty(document, 'fullscreenElement', {
            value: document.createElement('div'),
            configurable: true,
        });

        await enterPlayerFullscreen(host);

        expect(host.requestFullscreen).not.toHaveBeenCalled();
        expect(lock).toHaveBeenCalledWith('landscape');
        delete (document as any).fullscreenElement;
    });
});

describe('exitPlayerFullscreen', () => {
    test('unlocks the orientation and leaves fullscreen', async () => {
        setUA(ANDROID_UA);
        const { unlock } = stubOrientation();
        document.exitFullscreen = jest.fn(() => Promise.resolve());
        Object.defineProperty(document, 'fullscreenElement', {
            value: document.createElement('div'),
            configurable: true,
        });

        await exitPlayerFullscreen();

        expect(unlock).toHaveBeenCalled();
        expect(document.exitFullscreen).toHaveBeenCalled();
        delete (document as any).fullscreenElement;
    });
});
