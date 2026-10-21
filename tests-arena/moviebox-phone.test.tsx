// @ts-nocheck — jsdom test: phone par player landscape + apna fullscreen nahi.
/**
 * Owner ke phone wale teen kaam
 * =============================
 *   1. Play dabate hi phone landscape (Android par asli fullscreen + lock,
 *      baaki jagah CSS rotation).
 *   2. Phone par **hamara** fullscreen button nahi (player ka apna rehta hai).
 *   3. Next Episode + title usi player ke andar, theek size me.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});

import { MovieboxPagePlayer } from '../components/MovieboxPagePlayer';

const PAGE =
    'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en';

const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const realUA = navigator.userAgent;

function setViewport(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
}

function setUA(ua: string) {
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: ua });
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setUA(realUA);
    setViewport(1024, 768);
});

function renderPlayer(props: any = {}) {
    act(() => {
        root.render(
            <MovieboxPagePlayer
                linkKey="phone:1"
                initialLink={PAGE}
                title="My Demon"
                mediaType="tv"
                season={1}
                episode={2}
                episodeCount={16}
                autoResolve={false}
                onClose={() => {}}
                {...props}
            />,
        );
    });
}

test('portrait phone par koi rotation nahi — player seedha portrait box me (crop ke saath)', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderPlayer();

    // owner: "humara landscape nahi… jab user full screen karega tab hi
    // landscape hoga" — play dabate hi koi ghuma hua stage nahi
    expect(document.querySelector('[data-testid="moviebox-phone-stage"]')).toBeNull();
    const frame = document.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.style.width).toMatch(/px$/);
});

test('phone par koi overlay nahi — na hamara fullscreen, na title/Next', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderPlayer({ hideClose: true });

    // owner: "jitna title aur next button hai sab hata do — phone me sirf
    // pura moviebox ka player"
    expect(document.querySelector('[data-testid="moviebox-fullscreen"]')).toBeNull();
    expect(document.querySelector('[data-testid="moviebox-next-episode"]')).toBeNull();
    expect(document.querySelector('[data-testid="moviebox-episode-strip"]')).toBeNull();
    // hideClose (modal ka top bar back hota hai) — X bhi nahi
    expect(document.querySelector('[data-testid="moviebox-close"]')).toBeNull();
});

test('hideClose na ho to close X dikhta hai (route/player jahan top bar nahi)', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderPlayer({ linkKey: 'withx:1' });

    expect(document.querySelector('[data-testid="moviebox-close"]')).toBeTruthy();
});

test('phone par site ka mobile layout — site ke apne bade controls (native scale)', () => {
    jest.useFakeTimers();
    try {
        setUA(IPHONE_UA);
        setViewport(390, 844);
        renderPlayer({ linkKey: 'controls:1' });

        const frame = () => document.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement;
        // mobile layout: iframe phone ki chaudai par (scale 1) — isliye site ke
        // apne controls bade rehte hain (1536 stage par wo ~8px ke ho jate the)
        expect(frame().style.width).toBe('390px');
        expect(frame().style.height).toMatch(/px$/);
        // upar ka crop header ke neeche (~108px)
        expect(frame().style.top).toBe('-108px');

        // tap hamesha seedha player par — koi overlay nahi, koi pointer gate nahi
        expect(frame().style.pointerEvents).toBe('auto');
        act(() => {
            jest.advanceTimersByTime(6000);
        });
        expect(frame().style.pointerEvents).toBe('auto');
    } finally {
        jest.useRealTimers();
    }
});

test('site ka fullscreen button → site ka APNA fullscreen (hamari koi interference nahi)', async () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderPlayer({ linkKey: 'guard:1' });

    const frame = document.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement;
    const exitSpy = jest.fn().mockResolvedValue(undefined);
    (document as any).exitFullscreen = exitSpy;
    Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => frame,
    });

    // site ne iframe fullscreen kiya → usme kuch nahi chhedna
    act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
    });
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });

    // guard nahi hai: site ka fullscreen chalta rehta hai
    expect(exitSpy).not.toHaveBeenCalled();

    Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => null,
    });
    delete (document as any).exitFullscreen;
});

test('phone par site ka apna fullscreen button chalu hai (desktop par nahi)', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderPlayer({ linkKey: 'fsallow:1' });

    const frame = document.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement;
    expect(frame.getAttribute('allow')).toContain('fullscreen');
    expect(frame.hasAttribute('allowfullscreen')).toBe(true);
});

test('desktop par kuch nahi badalta — rotation nahi, apna fullscreen + title/Next rehte hain', () => {
    setUA(DESKTOP_UA);
    setViewport(1440, 900);
    renderPlayer({ linkKey: 'desktop:1' });

    expect(document.querySelector('[data-testid="moviebox-phone-stage"]')).toBeNull();
    expect(document.querySelector('[data-testid="moviebox-fullscreen"]')).toBeTruthy();
    // desktop par title/Next jaisa pehle (hamara crop player)
    expect(document.querySelector('[data-testid="moviebox-next-episode"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="moviebox-episode-strip"]')).toBeTruthy();
    // desktop par iframe ko fullscreen ki permission nahi (crop toot jata hai)
    const frame = document.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement;
    expect(frame.getAttribute('allow')).not.toContain('fullscreen');
    expect(frame.hasAttribute('allowfullscreen')).toBe(false);
    expect(frame.style.width).not.toBe('100%');
});

test('phone landscape par bhi koi rotation/stage nahi', () => {
    setUA(IPHONE_UA);
    setViewport(844, 390);
    renderPlayer({ linkKey: 'land:1' });

    expect(document.querySelector('[data-testid="moviebox-phone-stage"]')).toBeNull();
    // fullscreen button phir bhi nahi (phone hai)
    expect(document.querySelector('[data-testid="moviebox-fullscreen"]')).toBeNull();
});
