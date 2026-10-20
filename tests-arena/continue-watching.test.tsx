// @ts-nocheck — jsdom test: Continue Watching row on home.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});
jest.mock('@/components/EmbedPlayer', () => {
    const ReactLocal = require('react');
    return {
        EmbedPlayer: ({ src, resumeAt }: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'embed-player',
                'data-src': src,
                'data-resume': String(resumeAt ?? 0),
            }),
    };
});
jest.mock('expo-linear-gradient', () => {
    const ReactLocal = require('react');
    return { LinearGradient: (props: any) => ReactLocal.createElement('div', null, props.children) };
});
jest.mock('@/hooks/useCatalog', () => ({
    useCatalog: () => ({ rows: [], isLive: false }),
}));
// Ye test Nxsha (embed) wala rasta dekhta hai — MovieBox available na hone par
// hi wo chalta hai (naya default MovieBox hai jahan link milta hai).
jest.mock('@/hooks/useMovieboxAvailable', () => ({
    useMovieboxAvailable: () => ({ available: false, checking: false }),
}));
jest.mock('@/lib/movieboxLinks', () => {
    const actual = jest.requireActual('@/lib/movieboxLinks');
    return { ...actual, resolveMovieboxLink: () => null };
});

import { ContinueWatchingRow, timeAgo } from '../components/ContinueWatchingRow';
import {
    markWatched,
    getRecentlyWatched,
    removeWatched,
    updateWatchPosition,
    type WatchedEntry,
} from '../lib/recentlyWatched';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function entry(id: string, title: string, extra: Partial<WatchedEntry> = {}) {
    markWatched({
        id,
        titleId: id,
        title,
        type: 'movie',
        tmdbId: '1441228',
        provider: 'nxsha',
        imageUrl: 'https://image.tmdb.org/t/p/w500/x.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/w780/x.jpg',
        year: '2026',
        ...extra,
    });
}

test('renders nothing when nothing was played', () => {
    act(() => root.render(<ContinueWatchingRow />));
    expect(container.textContent).not.toContain('Continue Watching');
});

test('shows played titles newest first, with a remove button per card', () => {
    entry('tudum-top10-india-irumudi', 'Irumudi');
    entry('tudum-top10-india-dhamaal', 'Dhamaal 4');
    act(() => root.render(<ContinueWatchingRow />));

    expect(container.textContent).toContain('Continue Watching');
    const text = container.textContent;
    expect(text.indexOf('Dhamaal 4')).toBeLessThan(text.indexOf('Irumudi'));
    expect(container.querySelectorAll('[aria-label^="Remove "]').length).toBe(2);
    expect(text).toContain('just now');
});

test('a title with a known position shows the playhead, the time left and a progress bar', () => {
    entry('a', 'Irumudi');
    updateWatchPosition('a', 372, 1440);
    act(() => root.render(<ContinueWatchingRow />));

    const text = container.textContent;
    expect(text).toContain('6:12 in');
    expect(text).toContain('18 min left');
    expect(text).toContain('just now');
    // 372s of a 24m episode is a quarter of the way through.
    const bar = container.querySelector('[data-testid="continue-progress"]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe('26%');
});

test('a series entry names the episode it continues', () => {
    entry('tv-1399-s1-e3', 'Irumudi', { type: 'tv', season: 1, episode: 3 });
    updateWatchPosition('tv-1399-s1-e3', 372, 1440);
    act(() => root.render(<ContinueWatchingRow />));

    const text = container.textContent;
    expect(text).toContain('Episode 3');
    expect(text).toContain('S1 · EP3 · 6:12 in · 18 min left');
});

test('a nearly finished title says "Almost done" instead of a time left', () => {
    entry('a', 'Irumudi');
    updateWatchPosition('a', 1400, 1440);
    act(() => root.render(<ContinueWatchingRow />));

    const text = container.textContent;
    expect(text).toContain('23:20 in');
    expect(text).toContain('Almost done');
    expect(text).not.toContain('min left');
});

test('remove X drops the title and hides the row when empty', () => {
    entry('a', 'Irumudi');
    act(() => root.render(<ContinueWatchingRow />));

    const btn = container.querySelector('[aria-label="Remove Irumudi from Continue Watching"]');
    expect(btn).not.toBeNull();
    act(() => { btn.click(); });

    expect(getRecentlyWatched().map((e) => e.id)).toEqual([]);
    expect(container.textContent).not.toContain('Continue Watching');
});

test('removeWatched only removes the chosen title', () => {
    entry('a', 'Irumudi');
    entry('b', 'Dhamaal 4');
    removeWatched('a');
    expect(getRecentlyWatched().map((e) => e.id)).toEqual(['b']);
});

test('clicking a card opens the title modal, not a detail page', () => {
    entry('a', 'Irumudi');
    act(() => root.render(<ContinueWatchingRow />));
    const card = container.querySelector('[aria-label="Continue Irumudi"]');
    act(() => { card.click(); });
    expect(container.textContent).toContain('Irumudi');
    // The player is opened over the modal — the app never navigates away.
    expect(document.querySelector('[data-testid="embed-player"]')).not.toBeNull();
});

test('timeAgo formats minutes, hours and days', () => {
    const now = 10_000_000_000;
    expect(timeAgo(now - 30 * 1000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60000, now)).toBe('5 minutes ago');
    expect(timeAgo(now - 2 * 3600000, now)).toBe('2 hours ago');
    expect(timeAgo(now - 3 * 86400000, now)).toBe('3 days ago');
});
