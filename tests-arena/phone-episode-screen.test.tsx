// @ts-nocheck — jsdom test: phone ka Crunchyroll-style after-play screen.
/**
 * Owner: "crunchyroll me jaise play karne ke baad aisa aata hai waisa hi
 * netflix par kar do phone ke liye sirf… jab user full screen karega tab hi
 * landscape hoga".
 *
 * Phone par play dabne ke baad: top bar (back + title + S1 • E1), player upar,
 * neeche episode title/meta/description (SHOW MORE), NEXT EPISODE card, aur
 * SEE MORE EPISODES button. Koi auto-landscape nahi.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});
jest.mock('expo-linear-gradient', () => {
    const ReactLocal = require('react');
    return { LinearGradient: (props: any) => ReactLocal.createElement('div', null, props.children) };
});
jest.mock('@/hooks/useMovieboxAvailable', () => ({
    useMovieboxAvailable: () => ({ available: true, checking: false }),
}));
jest.mock('@/lib/movieboxLinks', () => {
    const actual = jest.requireActual('@/lib/movieboxLinks');
    return { ...actual, resolveMovieboxLink: () => null };
});
jest.mock('@/lib/tvEpisodes', () => {
    const actual = jest.requireActual('@/lib/tvEpisodes');
    return {
        ...actual,
        getTvSeasons: () => [
            {
                season_number: 1,
                name: 'Season 1',
                overview: '',
                episode_count: 2,
                episodes: [
                    {
                        season: 1,
                        episode: 1,
                        name: 'I’m Used to It',
                        overview: 'Around ten years ago, gates appeared.',
                        runtime: 24,
                        still: 'https://img/ep1.jpg',
                        air_date: '2024-01-07',
                    },
                    {
                        season: 1,
                        episode: 2,
                        name: 'If I Had One More Chance',
                        overview: 'Jinwoo faces the double dungeon.',
                        runtime: 24,
                        still: 'https://img/ep2.jpg',
                        air_date: '2024-01-14',
                    },
                ],
            },
        ],
    };
});
jest.mock('@/components/MovieboxPagePlayer', () => {
    const ReactLocal = require('react');
    return {
        MovieboxPagePlayer: (props: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'moviebox-player',
                'data-hide-close': props.hideClose ? '1' : '0',
            }),
    };
});
jest.mock('@/components/EmbedPlayer', () => {
    const ReactLocal = require('react');
    return {
        EmbedPlayer: (props: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'embed-player',
                'data-src': props.src || '',
            }),
    };
});

import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';

(globalThis as any). IS_REACT_ACT_ENVIRONMENT = true;

const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

let container: HTMLDivElement;
let root: Root;
const realUA = navigator.userAgent;

const movie = {
    id: 'solo-leveling',
    tmdb_id: '125988',
    embed_provider: 'nxsha',
    mediaType: 'tv' as const,
    type: 'SERIES',
    title: 'Solo Leveling',
    imageUrl: 'https://img/poster.jpg',
    backdropUrl: 'https://img/backdrop.jpg',
    year: '2024',
    rating: '4.8',
    description: 'Around ten years ago, gates that connected our world…',
};

function setUA(ua: string) {
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: ua });
}
function setViewport(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
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

function renderModal() {
    act(() => {
        root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />);
    });
}

function play() {
    // RN-web Pressable: accessibilityLabel → aria-label
    const btn = document.querySelector('[aria-label="Play Solo Leveling"]') as HTMLElement | null;
    expect(btn).toBeTruthy();
    act(() => {
        btn!.click();
    });
}

test('phone par play ke baad Crunchyroll jaisa screen — top bar, player, details', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderModal();
    play();

    // top bar: back + title + S1 • E1
    const back = document.querySelector('[data-testid="phone-player-back"]');
    expect(back).toBeTruthy();
    expect(document.body.textContent).toContain('Solo Leveling');
    expect(document.body.textContent).toContain('S1 • E1');

    // player upar (moviebox default) — phone par hideClose
    const player = document.querySelector('[data-testid="moviebox-player"]');
    expect(player).toBeTruthy();
    expect(player!.getAttribute('data-hide-close')).toBe('1');

    // neeche details: episode title, meta, released, description + SHOW MORE
    expect(document.body.textContent).toContain('E1 –');
    expect(document.body.textContent).toContain('I’m Used to It');
    expect(document.body.textContent).toContain('★ 4.8');
    expect(document.body.textContent).toContain('Released on Jan 7, 2024');
    expect(document.body.textContent).toContain('SHOW MORE');

    // NEXT EPISODE card + SEE MORE EPISODES
    const next = document.querySelector('[data-testid="phone-next-episode"]');
    expect(next).toBeTruthy();
    expect(next!.textContent).toContain('E2 – If I Had One More Chance');
    expect(document.querySelector('[data-testid="phone-see-episodes"]')).toBeTruthy();
});

test('phone: NEXT EPISODE dabane par S1 • E2 aa jata hai; back se player band', () => {
    setUA(IPHONE_UA);
    setViewport(390, 844);
    renderModal();
    play();

    act(() => {
        (document.querySelector('[data-testid="phone-next-episode"]') as HTMLElement).click();
    });
    expect(document.body.textContent).toContain('S1 • E2');
    expect(document.body.textContent).toContain('E2 – If I Had One More Chance');
    expect(document.body.textContent).toContain('Released on Jan 14, 2024');

    act(() => {
        (document.querySelector('[data-testid="phone-player-back"]') as HTMLElement).click();
    });
    expect(document.querySelector('[data-testid="phone-player-back"]')).toBeNull();
    expect(document.querySelector('[data-testid="moviebox-player"]')).toBeNull();
});

test('desktop par phone screen nahi — player seedha fullscreen layer me', () => {
    setUA(DESKTOP_UA);
    setViewport(1440, 900);
    renderModal();
    play();

    expect(document.querySelector('[data-testid="phone-player-back"]')).toBeNull();
    const player = document.querySelector('[data-testid="moviebox-player"]');
    expect(player).toBeTruthy();
    expect(player!.getAttribute('data-hide-close')).toBe('0');
});
