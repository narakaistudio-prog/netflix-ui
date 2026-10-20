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
    MOVIEBOX_STAGE_PLAYER_HEIGHT,
    MOVIEBOX_STAGE_PLAYER_WIDTH,
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
            `${MOVIEBOX_STAGE_PLAYER_HEIGHT + MOVIEBOX_STAGE_CROP_TOP}px`,
        );

        // Stage scales to the screen, so the crop lands in the same place everywhere.
        // Sirf player: 968 wide (Resources panel kabhi andar nahi aata).
        const scale = 1440 / MOVIEBOX_STAGE_PLAYER_WIDTH;
        expect(stage()!.style.width).toBe(`${MOVIEBOX_STAGE_PLAYER_WIDTH}px`);
        expect(stage()!.style.height).toBe(`${MOVIEBOX_STAGE_PLAYER_HEIGHT}px`);
        expect(stage()!.style.transform).toBe(`scale(${scale})`);

        // Visible dabba: full width, 16:9 (545 × scale)
        expect(box()!.style.width).toBe('1440px');
        expect(box()!.style.height).toBe(`${Math.round(MOVIEBOX_STAGE_PLAYER_HEIGHT * scale)}px`);
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
        // Site ka fullscreen button band — warna browser sirf iframe fullscreen
        // karta hai aur poora MovieBox page dikhne lagta hai.
        expect(allow).not.toContain('fullscreen');
        expect(frame()!.hasAttribute('allowfullscreen')).toBe(false);
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

    it('on a narrow screen keeps the same player-only crop (PC window chhoti ho)', () => {
        rectSpy.mockRestore();
        measureAs(420, 900);
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} title="My Demon" />);
        });
        const iframe = frame()!;
        // Wahi stage crop — sirf poora stage chhota scale hota hai. Isliye
        // player ke neeche title/description/bottom-nav kabhi nahi aate.
        expect(iframe.style.left).toBe(`-${MOVIEBOX_STAGE_CROP_LEFT}px`);
        expect(iframe.style.top).toBe(`-${MOVIEBOX_STAGE_CROP_TOP}px`);
        expect(iframe.style.width).toBe(`${MOVIEBOX_STAGE_WIDTH}px`);
        expect(iframe.getAttribute('scrolling')).toBe('no');
        expect(box()!.style.width).toBe('420px');
        expect(box()!.style.height).toBe(
            `${Math.round(MOVIEBOX_STAGE_PLAYER_HEIGHT * (420 / MOVIEBOX_STAGE_PLAYER_WIDTH))}px`,
        );
    });

    it('leaves scroll open for the search page on a narrow screen', () => {
        rectSpy.mockRestore();
        measureAs(420, 900);
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} mode="page" allowScroll />);
        });
        const iframe = frame()!;
        expect(iframe.style.left).toBe('0px');
        expect(iframe.style.top).toBe('-104px');
        expect(iframe.style.width).toBe('420px');
        expect(iframe.hasAttribute('scrolling')).toBe(false);
    });

    it('keeps the crop after a fullscreen change (poora page kabhi nahi)', () => {
        act(() => {
            root.render(<MovieboxCroppedFrame src={PAGE} />);
        });
        const iframe = frame()!;
        // Fullscreen hone par host ka naap badalta hai — crop wahi rehna
        // chahiye, 100% wide nahi hona chahiye (warna poora page dikhta hai).
        rectSpy.mockRestore();
        measureAs(1920, 1080);
        act(() => {
            document.dispatchEvent(new Event('fullscreenchange'));
        });
        expect(iframe.style.width).toBe(`${MOVIEBOX_STAGE_WIDTH}px`);
        expect(iframe.style.left).toBe(`-${MOVIEBOX_STAGE_CROP_LEFT}px`);
        expect(iframe.style.top).toBe(`-${MOVIEBOX_STAGE_CROP_TOP}px`);
        // contain: 1920 × 9/16 = 1080 → height limit lagti hai, isliye 1918
        expect(box()!.style.width).toBe('1918px');
        // contain me height hi limit thi → 1080 (screen bhar), 16:9 barkarar
        expect(box()!.style.height).toBe('1080px');
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
            `${Math.round(MOVIEBOX_STAGE_PLAYER_HEIGHT * (1440 / MOVIEBOX_STAGE_PLAYER_WIDTH))}px`,
        );
        const stored = JSON.parse(localStorage.getItem('netflix-moviebox-links-v1') || '{}');
        expect(stored['tmdb:1:movie'].url).toBe(PAGE);
    });

    it('puts a Next Episode button on series and opens the next episode', () => {
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:2:tv"
                    initialLink={PAGE}
                    title="My Demon"
                    mediaType="tv"
                    season={1}
                    episode={2}
                    episodeCount={16}
                    autoResolve={false}
                    onClose={() => {}}
                />,
            );
        });

        expect(frame()!.getAttribute('src')).toContain('detailEp=2');
        const next = document.querySelector('[data-testid="moviebox-next-episode"]') as HTMLElement;
        expect(next).toBeTruthy();
        expect(next.textContent).toContain('Next Episode');

        act(() => {
            next.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });

        // Agla episode usi watch page par khul jata hai
        expect(frame()!.getAttribute('src')).toContain('detailEp=3');
        expect(frame()!.getAttribute('src')).toContain('detailSe=1');
        // episode patti bhi agle episode par
        expect(
            document.querySelector('[data-testid="moviebox-episode-strip"]')!.textContent,
        ).toContain('S1 • E3');
    });

    it('hides Next Episode after the idle timeout, even with the pointer on the player', () => {
        jest.useFakeTimers();
        try {
            act(() => {
                root.render(
                    <MovieboxPagePlayer
                        linkKey="tmdb:4:tv"
                        initialLink={PAGE}
                        title="My Demon"
                        mediaType="tv"
                        season={1}
                        episode={2}
                        episodeCount={16}
                        autoResolve={false}
                        onClose={() => {}}
                    />,
                );
            });
            const wrap = () =>
                document.querySelector('[data-testid="moviebox-next-episode"]')!
                    .parentElement as HTMLElement;
            const player = document.querySelector(
                '[data-tv-scope="player"], [data-tvScope="player"]',
            ) as HTMLElement | null;
            expect(player).toBeTruthy();
            expect(wrap().style.opacity).toBe('1');

            // Pointer khamoshi se video par hi hai — site ke controls 3s me
            // gayab ho jate hain, to humara button bhi gayab.
            act(() => {
                player!.dispatchEvent(new MouseEvent('mouseenter'));
                jest.advanceTimersByTime(4000);
            });
            expect(wrap().style.opacity).toBe('0');

            // Pointer hilte hi wapas.
            act(() => {
                player!.dispatchEvent(new MouseEvent('mousemove'));
            });
            expect(wrap().style.opacity).toBe('1');

            // Player se bahar nikal gaye — turant gayab.
            act(() => {
                player!.dispatchEvent(new MouseEvent('mouseleave'));
                jest.advanceTimersByTime(1200);
            });
            expect(wrap().style.opacity).toBe('0');
        } finally {
            jest.useRealTimers();
        }
    });

    it('shows the S1 • E2 + episode-name strip and keeps it in sync with Next', () => {
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:5:tv"
                    initialLink={PAGE}
                    title="My Demon"
                    mediaType="tv"
                    season={1}
                    episode={2}
                    episodeCount={16}
                    episodeTitle="Everyone Has a Demon in Their Heart"
                    autoResolve={false}
                    onClose={() => {}}
                />,
            );
        });
        const strip = () =>
            document.querySelector('[data-testid="moviebox-episode-strip"]') as HTMLElement;
        expect(strip()).toBeTruthy();
        expect(strip().textContent).toContain('S1 • E2');
        expect(strip().textContent).toContain('My Demon');
        expect(strip().textContent).toContain('Everyone Has a Demon in Their Heart');

        // Next dabane par patti bhi agle episode par
        const next = document.querySelector('[data-testid="moviebox-next-episode"]') as HTMLElement;
        act(() => {
            next.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(strip().textContent).toContain('S1 • E3');
    });

    it('shows no episode strip for a movie', () => {
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:6:movie"
                    initialLink={PAGE}
                    title="Mandaadi"
                    mediaType="movie"
                    autoResolve={false}
                    onClose={() => {}}
                />,
            );
        });
        expect(document.querySelector('[data-testid="moviebox-episode-strip"]')).toBeNull();
    });

    it('puts our fullscreen in the player corner, not in the top bar', () => {
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:7:tv"
                    initialLink={PAGE}
                    title="My Demon"
                    mediaType="tv"
                    season={1}
                    episode={5}
                    episodeCount={16}
                    autoResolve={false}
                    onClose={() => {}}
                />,
            );
        });
        const fs = document.querySelector('[data-testid="moviebox-fullscreen"]') as HTMLElement;
        expect(fs).toBeTruthy();
        // video ke dabbe ke andar, bottom-right (site ke fullscreen icon ki jagah)
        // jsdom me onLayout nahi chalta, isliye fallback geometry lagti hai.
        // react-native-web layout ko classes me daalta hai (inline style nahi)
        expect(fs.className).toContain('r-position');
        expect(fs.className).toContain('r-bottom');
        // koi bhi corner geometry lagi ho — root ke andar hi

        // top bar me koi fullscreen / link icon nahi
        const topBar = fs.closest('[data-tv-scope="player"], [data-tvScope="player"]')!;
        expect(topBar).toBeTruthy();
        expect(document.querySelectorAll('[aria-label="Change M2Box link"]').length).toBe(0);
        expect(document.querySelector('[aria-label="Fullscreen player"]')).toBe(fs);
    });

    it('tells the parent when the episode changed', () => {
        const onEpisodeChange = jest.fn();
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:2:tv"
                    initialLink={PAGE}
                    title="My Demon"
                    mediaType="tv"
                    season={2}
                    episode={4}
                    episodeCount={10}
                    autoResolve={false}
                    onEpisodeChange={onEpisodeChange}
                    onClose={() => {}}
                />,
            );
        });
        const next = document.querySelector('[data-testid="moviebox-next-episode"]') as HTMLElement;
        act(() => {
            next.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(onEpisodeChange).toHaveBeenCalledWith({ season: 2, episode: 5 });
    });

    it('hides Next Episode on the last episode of the season, and for movies', () => {
        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:2:tv"
                    initialLink={PAGE}
                    title="My Demon"
                    mediaType="tv"
                    season={1}
                    episode={16}
                    episodeCount={16}
                    autoResolve={false}
                    onClose={() => {}}
                />,
            );
        });
        expect(document.querySelector('[data-testid="moviebox-next-episode"]')).toBeNull();

        act(() => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:3:movie"
                    initialLink={PAGE}
                    title="Mandaadi"
                    mediaType="movie"
                    autoResolve={false}
                    onClose={() => {}}
                />,
            );
        });
        expect(document.querySelector('[data-testid="moviebox-next-episode"]')).toBeNull();
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

    it('falls back to MovieBox search when the title has no page there', async () => {
        (globalThis as any).fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ found: false, reason: 'no-match' }),
        }));

        await act(async () => {
            root.render(
                <MovieboxPagePlayer
                    linkKey="tmdb:999:movie"
                    title="Vishwanath & Sons"
                    year={2026}
                    mediaType="movie"
                    onClose={() => {}}
                />,
            );
        });

        // Paste nahi maanga — MovieBox ke apne search results khul gaye
        expect(document.querySelector('input[data-testid="moviebox-link-input"]')).toBeNull();
        expect(frame()!.getAttribute('src')).toBe(
            'https://m2box.org/en/web/searchResult?keyword=Vishwanath%20%26%20Sons',
        );
        // search page par andar scroll khula rehta hai
        expect(frame()!.hasAttribute('scrolling')).toBe(false);
        expect(document.querySelector('[data-testid="moviebox-manual-link"]')).toBeTruthy();
    });

    it('lets the viewer paste a link from the search fallback', async () => {
        (globalThis as any).fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ found: false, reason: 'no-match' }),
        }));

        await act(async () => {
            root.render(
                <MovieboxPagePlayer linkKey="tmdb:998:movie" title="Koi Anjaan Film" onClose={() => {}} />,
            );
        });

        const paste = document.querySelector('[data-testid="moviebox-manual-link"]') as HTMLElement;
        act(() => {
            paste.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });

        expect(frame()).toBeNull();
        expect(document.querySelector('input[data-testid="moviebox-link-input"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="moviebox-link-notice"]')).toBeTruthy();
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
