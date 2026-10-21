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

test('portrait phone par player 90° ghuma kar poora screen leta hai', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderPlayer();

    const stage = document.querySelector('[data-testid="moviebox-phone-stage"]') as HTMLElement;
    expect(stage).toBeTruthy();
    // layout dabba ulta (chaudai = screen ki unchai) taaki rotate ke baad
    // poora viewport bhare
    expect(stage.className).toContain('r-position');
    const frame = document.querySelector('[data-m2box="frame"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
});

test('phone par koi overlay nahi — na hamara fullscreen, na title/Next', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderPlayer();

    // owner: "jitna title aur next button hai sab hata do — phone me sirf
    // pura moviebox ka player"
    expect(document.querySelector('[data-testid="moviebox-fullscreen"]')).toBeNull();
    expect(document.querySelector('[data-testid="moviebox-next-episode"]')).toBeNull();
    expect(document.querySelector('[data-testid="moviebox-episode-strip"]')).toBeNull();
    expect(document.querySelector('[data-testid="moviebox-close"]')).toBeTruthy();
});

test('phone par player FREE — koi crop nahi, tap hamesha seedha player par', () => {
    jest.useFakeTimers();
    try {
        setUA(IPHONE_UA);
        setViewport(390, 844);
        renderPlayer({ linkKey: 'controls:1' });

        const frame = () => document.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement;
        // free mode: iframe poora dabba bharta hai (koi scale/offset nahi)
        expect(frame().style.width).toBe('100%');
        expect(frame().style.height).toBe('100%');
        expect(frame().style.top).toBe('0px');
        expect(frame().style.left).toBe('0px');
        expect(frame().hasAttribute('scrolling')).toBe(false);

        // tap hamesha seedha player tak — koi overlay nahi, koi pointer gate nahi
        expect(frame().style.pointerEvents).toBe('auto');
        act(() => {
            jest.advanceTimersByTime(6000);
        });
        expect(frame().style.pointerEvents).toBe('auto');
    } finally {
        jest.useRealTimers();
    }
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

test('phone ko landscape ghuma dene par (width > height) rotation band ho jata hai', () => {
    setUA(IPHONE_UA);
    setViewport(844, 390);
    renderPlayer({ linkKey: 'land:1' });

    expect(document.querySelector('[data-testid="moviebox-phone-stage"]')).toBeNull();
    // fullscreen button phir bhi nahi (phone hai)
    expect(document.querySelector('[data-testid="moviebox-fullscreen"]')).toBeNull();
});
