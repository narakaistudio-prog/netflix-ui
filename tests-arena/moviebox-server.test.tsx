// @ts-nocheck — jest-only verification harness (jsdom), not part of the app build.
/**
 * Arena verification: the M2Box "sirf player" frame really does crop.
 *
 * Runs on the WEB preset (react-native -> react-native-web) with a real jsdom
 * document, so the imperative iframe + the three-dabba crop are observable —
 * exactly the code a browser runs.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return {
        Ionicons: (props: any) => ReactLocal.createElement('i', props),
    };
});

import { MovieboxCroppedFrame } from '../components/MovieboxCroppedFrame';
import { MovieboxPagePlayer } from '../components/MovieboxPagePlayer';
import {
    MOVIEBOX_STAGE_CROP_LEFT,
    MOVIEBOX_STAGE_CROP_TOP,
    MOVIEBOX_STAGE_VISIBLE_HEIGHT,
    MOVIEBOX_STAGE_WIDTH,
} from '../lib/moviebox';

const PAGE =
    'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let rectSpy: jest.SpyInstance;

/** Har element 1440×900 naape (frame ke bahari dabbe jaisa). */
function measureAs(width: number, height: number) {
    rectSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        () =>
            ({
                width,
                height,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            } as DOMRect),
    );
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    measureAs(1440, 900);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    rectSpy?.mockRestore();
    localStorage.clear();
});

const frame = () => document.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement | null;
const box = () => document.querySelector('[data-m2box="box"]') as HTMLDivElement | null;
const stage = () => document.querySelector('[data-m2box="stage"]') as HTMLDivElement | null;

describe('MovieboxCroppedFrame', () => {
    it('renders the iframe on a fixed 1536px stage, cropped left/top', () => {
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} title="My Demon" />);
        });

        const iframe = frame();
        expect(iframe).toBeTruthy();
        expect(iframe!.getAttribute('src')).toBe(PAGE);
        expect(iframe!.title).toBe('My Demon — M2Box');

        // iframe is pushed up and left by the measured crop
        expect(iframe!.style.top).toBe(`-${MOVIEBOX_STAGE_CROP_TOP}px`);
        expect(iframe!.style.left).toBe(`-${MOVIEBOX_STAGE_CROP_LEFT}px`);
        expect(iframe!.style.width).toBe(`${MOVIEBOX_STAGE_WIDTH}px`);
        expect(iframe!.style.height).toBe(
            `${MOVIEBOX_STAGE_VISIBLE_HEIGHT + MOVIEBOX_STAGE_CROP_TOP}px`,
        );

        // Stage scales to the screen, so the crop lands in the same place everywhere
        const scale = 1440 / (MOVIEBOX_STAGE_WIDTH - MOVIEBOX_STAGE_CROP_LEFT);
        expect(stage()!.style.width).toBe(`${MOVIEBOX_STAGE_WIDTH - MOVIEBOX_STAGE_CROP_LEFT}px`);
        expect(stage()!.style.height).toBe(`${MOVIEBOX_STAGE_VISIBLE_HEIGHT}px`);
        expect(stage()!.style.transform).toBe(`scale(${scale})`);

        // Visible dabba: full width, height = 545 × scale (never taller)
        expect(box()!.style.width).toBe('1440px');
        expect(box()!.style.height).toBe(`${Math.round(MOVIEBOX_STAGE_VISIBLE_HEIGHT * scale)}px`);
        expect(box()!.style.overflow).toBe('hidden');
    });

    it('keeps the sandbox safe: no allow-top-navigation, no popup hijack', () => {
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} />);
        });
        const sandbox = frame()!.getAttribute('sandbox') || '';
        expect(sandbox).toContain('allow-scripts');
        expect(sandbox).toContain('allow-same-origin');
        expect(sandbox).toContain('allow-presentation');
        expect(sandbox).not.toContain('allow-top-navigation');

        const allow = frame()!.getAttribute('allow') || '';
        expect(allow).toContain('fullscreen');
        expect(allow).toContain('autoplay');
        expect(allow).toContain('encrypted-media');
        expect(frame()!.getAttribute('referrerpolicy')).toBe('no-referrer-when-downgrade');
    });

    it('locks scrolling on desktop so the cropped header/title cannot come back', () => {
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} />);
        });
        expect(frame()!.getAttribute('scrolling')).toBe('no');
    });

    it('on a narrow screen uses the real width and leaves scroll open for episodes', () => {
        rectSpy.mockRestore();
        measureAs(420, 900);
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} />);
        });
        const iframe = frame()!;
        expect(iframe.style.left).toBe('0px');
        expect(iframe.style.top).toBe('-104px');
        expect(iframe.style.width).toBe('420px');
        expect(iframe.hasAttribute('scrolling')).toBe(false);
        expect(box()!.style.width).toBe('420px');
    });

    it('kills the frame on unmount (no background audio)', () => {
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} />);
        });
        const iframe = frame()!;
        act(() => {
            root.unmount();
        });
        root = createRoot(container);
        expect(iframe.isConnected).toBe(false);
        expect(document.querySelector('iframe[data-m2box="frame"]')).toBeNull();
    });
});

describe('MovieboxPagePlayer (Server 2)', () => {
    it('asks for the link when the title has none, then plays the cropped page', () => {
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:1:movie"
                    title="My Demon"
                    autoResolve={false}
                    onClose={() => {}}
                />,
            );
        });

        // Panel: input + Server 2 badge, no frame yet
        const input = document.querySelector(
            'input[data-testid="moviebox-link-input"]',
        ) as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(container.textContent).toContain('M2Box');
        expect(frame()).toBeNull();

        // Paste the watch-page link
        const setValue = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
        )!.set!;
        act(() => {
            setValue.call(input, PAGE);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        const play = container.querySelector('[aria-label="Play in M2Box"]') as HTMLElement;
        expect(play).toBeTruthy();
        act(() => {
            play.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });

        // Frame is up, cropped, and the link is remembered for this browser
        expect(frame()).toBeTruthy();
        expect(frame()!.getAttribute('src')).toContain(
            'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848',
        );
        expect(box()!.style.height).toBe(
            `${Math.round(MOVIEBOX_STAGE_VISIBLE_HEIGHT * (1440 / (MOVIEBOX_STAGE_WIDTH - MOVIEBOX_STAGE_CROP_LEFT)))}px`,
        );
        const stored = JSON.parse(localStorage.getItem('netflix-moviebox-links-v1') || '{}');
        expect(stored['tmdb:1:movie'].url).toBe(PAGE);
    });

    it('opens the exact episode from a row season/episode', () => {
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:2:tv"
                    initialLink={PAGE}
                    season={1}
                    episode={4}
                    onClose={() => {}}
                />,
            );
        });
        expect(frame()!.getAttribute('src')).toContain('detailEp=4');
        expect(frame()!.getAttribute('src')).toContain('detailSe=1');
    });

    it('reuses a saved link on the next visit (no second paste)', () => {
        localStorage.setItem(
            'netflix-moviebox-links-v1',
            JSON.stringify({ 'tmdb:3:movie': { url: PAGE, proxy: false, savedAt: 1 } }),
        );
        act(() => {
            root.render(<MovieboxPagePlayer linkKey="tmdb:3:movie" onClose={() => {}} />);
        });
        expect(frame()).toBeTruthy();
        expect(frame()!.getAttribute('src')).toContain('m2box.org/movies/my-demon-hindi-SfaaEeePcfa');
    });

    it('finds the link itself (live resolve) instead of asking for a paste', async () => {
        const resolved =
            'https://m2box.org/movies/vishwanath-and-sons-hindi-AbC123?id=4151920426815471968&type=/movie/detail&detailSe=&detailEp=&lang=en';
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                found: true,
                url: resolved,
                subjectId: '4151920426815471968',
                detailPath: 'vishwanath-and-sons-hindi-AbC123',
                title: 'Vishwanath & Sons [Hindi]',
                dub: 'hindi',
                score: 0.93,
            }),
        }));
        (globalThis as any).fetch = fetchMock;

        await act(async () => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:1408162:movie"
                    title="Vishwanath & Sons"
                    year={2026}
                    mediaType="movie"
                    onClose={() => {}}
                />,
            );
        });

        // Resolver ne API se poochha...
        expect(fetchMock).toHaveBeenCalled();
        expect(String(fetchMock.mock.calls[0][0])).toContain('/api/moviebox-resolve?');
        // ...aur frame khud khul gaya — paste panel aaya hi nahi
        expect(document.querySelector('input[data-testid="moviebox-link-input"]')).toBeNull();
        expect(frame()!.getAttribute('src')).toContain('vishwanath-and-sons-hindi-AbC123');
        expect(frame()!.getAttribute('src')).toContain('id=4151920426815471968');
    });

    it('shows the paste panel (with a note) only when live resolve finds nothing', async () => {
        (globalThis as any).fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ found: false, reason: 'no-match' }),
        }));

        await act(async () => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:999:movie"
                    title="Koi Anjaan Film"
                    year={2026}
                    mediaType="movie"
                    onClose={() => {}}
                />,
            );
        });

        expect(document.querySelector('input[data-testid="moviebox-link-input"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="moviebox-link-notice"]')).toBeTruthy();
        expect(frame()).toBeNull();
    });

    it('has a close button and a way back to Server 1', () => {
        const onClose = jest.fn();
        const onSwitch = jest.fn();
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:4:movie"
                    initialLink={PAGE}
                    onClose={onClose}
                    onSwitchServer={onSwitch}
                    switchLabel="Nxsha"
                />,
            );
        });

        const close = document.querySelector('[aria-label="Close player"]') as HTMLElement;
        expect(close).toBeTruthy();
        act(() => {
            close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(onClose).toHaveBeenCalled();

        const pill = document.querySelector('[data-testid="moviebox-switch-server"]') as HTMLElement;
        expect(pill).toBeTruthy();
        act(() => {
            pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(onSwitch).toHaveBeenCalled();
    });

    it('Esc closes the player', () => {
        const onClose = jest.fn();
        act(() => {
            root.render(
                <MovieboxPagePlayer linkKey="tmdb:5:movie" initialLink={PAGE} onClose={onClose} />,
            );
        });
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('proxy mode loads the same page through /api/moviebox-frame', () => {
        localStorage.setItem(
            'netflix-moviebox-links-v1',
            JSON.stringify({
                'tmdb:6:movie': { url: PAGE, proxy: true, savedAt: 1 },
            }),
        );
        act(() => {
            root.render(<MovieboxPagePlayer linkKey="tmdb:6:movie" onClose={() => {}} />);
        });
        const src = frame()!.getAttribute('src');
        expect(src.startsWith('/api/moviebox-frame?url=')).toBe(true);
        expect(decodeURIComponent(src.split('url=')[1])).toBe(PAGE);
    });
});
