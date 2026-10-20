// @ts-nocheck — jsdom test: detail screen se server chunna (Hindi / Multi).
/**
 * Owner ka naya flow
 * ==================
 *   Hindi = MovieBox (M2Box crop player), Multi = Nxsha (embed).
 *   Default = **MovieBox** jab us title ka link mile.
 *   Player ke andar server badalne ka koi button nahi (wo kaam ab yahan hota
 *   hai) — aur play dabne ke baad to bilkul nahi.
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
jest.mock('@/components/MovieboxPagePlayer', () => {
    const ReactLocal = require('react');
    return {
        MovieboxPagePlayer: ({ onClose, onSwitchServer }: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'moviebox-player',
                'data-switch': onSwitchServer ? '1' : '0',
                onClick: onClose,
            }),
    };
});
jest.mock('@/components/EmbedPlayer', () => {
    const ReactLocal = require('react');
    return {
        EmbedPlayer: ({ src, onClose, onSwitchProvider }: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'embed-player',
                'data-src': src,
                'data-switch': onSwitchProvider ? '1' : '0',
                onClick: onClose,
            }),
    };
});

import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const movie = {
    id: 'tudum-top10-india-irumudi',
    tmdb_id: '1441228',
    embed_provider: 'nxsha',
    title: 'Irumudi',
    imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    year: '2026',
    duration: '2h 32m',
    description: 'A father undertakes a spiritual vow.',
    cast: ['Ravi Teja'],
    genres: ['Drama'],
};

const playButton = () => document.querySelector('[aria-label="Play Irumudi"]') as HTMLElement;

test('Hindi / Multi dikhte hain aur default MovieBox (Hindi) hota hai', () => {
    act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));

    const hindi = document.querySelector('[data-testid="server-hindi"]') as HTMLElement;
    const multi = document.querySelector('[data-testid="server-multi"]') as HTMLElement;
    expect(hindi).toBeTruthy();
    expect(multi).toBeTruthy();
    expect(hindi.textContent).toContain('Hindi');
    expect(multi.textContent).toContain('Multi');

    // default = MovieBox
    expect(hindi.getAttribute('data-selected')).toBe('1');
    expect(multi.getAttribute('data-selected')).toBe('0');

    // Play → seedha M2Box (crop) player, Nxsha embed nahi
    act(() => {
        playButton().click();
    });
    expect(document.querySelector('[data-testid="moviebox-player"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="embed-player"]')).toBeNull();
});

test('Multi chunne par embed (Nxsha) chalta hai', () => {
    act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));

    const multi = document.querySelector('[data-testid="server-multi"]') as HTMLElement;
    act(() => {
        multi.click();
    });
    expect(
        (document.querySelector('[data-testid="server-multi"]') as HTMLElement).getAttribute('data-selected'),
    ).toBe('1');

    act(() => {
        playButton().click();
    });
    const embed = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
    expect(embed).toBeTruthy();
    expect(embed.getAttribute('data-src')).toContain('/embed/movie/1441228');
    expect(document.querySelector('[data-testid="moviebox-player"]')).toBeNull();
});

test('player ke andar server badalne ka koi option nahi aata', () => {
    act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));
    act(() => {
        playButton().click();
    });
    // MovieBox player ko switch handler nahi milta → koi pill nahi
    const mb = document.querySelector('[data-testid="moviebox-player"]') as HTMLElement;
    expect(mb).toBeTruthy();
    expect(mb.getAttribute('data-switch')).toBe('0');

    // X se band karke Multi chuno → embed player ko bhi switch handler nahi
    act(() => {
        mb.click();
    });
    const multi = document.querySelector('[data-testid="server-multi"]') as HTMLElement;
    act(() => {
        multi.click();
    });
    act(() => {
        playButton().click();
    });
    const embed = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
    expect(embed).toBeTruthy();
    expect(embed.getAttribute('data-switch')).toBe('0');
});
