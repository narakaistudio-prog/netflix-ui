// @ts-nocheck — phone detail screen par "NetMirror" chip (probe pass hone par).
/**
 * Owner: *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale"*.
 *
 * Chip sirf tab dikhta hai jab NetMirror par wo title sach me ho (`probe=1` ka
 * jawab `ok:true`). Nahi hai to chip hi nahi — dead button nahi.
 *
 * Yahan player aur probe dono mock hain, sirf wiring test hoti hai.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const mockProbe = jest.fn();

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
jest.mock('@/lib/netmirror', () => {
    const actual = jest.requireActual('@/lib/netmirror');
    return { ...actual, probeNetmirror: (...args: any[]) => mockProbe(...args) };
});
jest.mock('@/components/NetmirrorPlayer', () => {
    const ReactLocal = require('react');
    return {
        NetmirrorPlayer: ({ tmdbId }: any) =>
            ReactLocal.createElement('div', { 'data-testid': 'netmirror-player', 'data-tmdb': String(tmdbId) }),
    };
});
jest.mock('@/components/MovieboxPagePlayer', () => {
    const ReactLocal = require('react');
    return { MovieboxPagePlayer: () => ReactLocal.createElement('div', { 'data-testid': 'moviebox-player' }) };
});
jest.mock('@/components/EmbedPlayer', () => {
    const ReactLocal = require('react');
    return { EmbedPlayer: () => ReactLocal.createElement('div', { 'data-testid': 'embed-player' }) };
});

import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';
import { __clearNetmirrorAvailability } from '../hooks/useNetmirrorAvailable';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const movie = {
    id: 'netmirror-chip-mandaadi',
    tmdb_id: 'tmdb:1465943',
    embed_provider: 'nxsha',
    title: 'Mandaadi',
    imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    year: '2026',
    duration: '2h 12m',
    description: 'Test title.',
    cast: [],
    genres: ['Drama'],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    mockProbe.mockReset();
    // Hook apna jawab session bhar yaad rakhta hai — test ke beech saaf karo.
    __clearNetmirrorAvailability();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const flush = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

test('NetMirror par title ho to chip dikhta hai aur player khulta hai', async () => {
    mockProbe.mockResolvedValue(true);
    act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));
    await flush();

    const chip = document.querySelector('[data-testid="server-netmirror"]') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('NetMirror');

    act(() => chip.click());
    act(() => (document.querySelector('[aria-label="Play Mandaadi"]') as HTMLElement).click());

    const player = document.querySelector('[data-testid="netmirror-player"]') as HTMLElement;
    expect(player).toBeTruthy();
    expect(player.getAttribute('data-tmdb')).toBe('tmdb:1465943');
    expect(document.querySelector('[data-testid="moviebox-player"]')).toBeNull();
});

test('NetMirror par na ho to chip hi nahi (dead button nahi)', async () => {
    mockProbe.mockResolvedValue(false);
    act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));
    await flush();
    expect(document.querySelector('[data-testid="server-netmirror"]')).toBeNull();
});
