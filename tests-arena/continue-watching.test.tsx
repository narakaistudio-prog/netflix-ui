// @ts-nocheck — jsdom test: Continue Watching row on home.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});
jest.mock('@/components/EmbedPlayer', () => {
    const ReactLocal = require('react');
    return { EmbedPlayer: ({ src }: any) => ReactLocal.createElement('div', { 'data-testid': 'embed-player', 'data-src': src }) };
});
jest.mock('expo-linear-gradient', () => {
    const ReactLocal = require('react');
    return { LinearGradient: (props: any) => ReactLocal.createElement('div', null, props.children) };
});
jest.mock('@/hooks/useCatalog', () => ({
    useCatalog: () => ({ rows: [], isLive: false }),
}));

import { ContinueWatchingRow, timeAgo } from '../components/ContinueWatchingRow';
import { markWatched, getRecentlyWatched, removeWatched } from '../lib/recentlyWatched';

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

function entry(id: string, title: string) {
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
    expect(container.textContent).toContain('Watched just now');
});

test('no progress bar or time-left label is shown (not measurable from the iframe)', () => {
    entry('a', 'Irumudi');
    act(() => root.render(<ContinueWatchingRow />));
    expect(container.textContent).not.toMatch(/left/i);
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
    expect(container.querySelector('[data-testid="embed-player"]')).toBeNull();
});

test('timeAgo formats minutes, hours and days', () => {
    const now = 10_000_000_000;
    expect(timeAgo(now - 30 * 1000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60000, now)).toBe('5 minutes ago');
    expect(timeAgo(now - 2 * 3600000, now)).toBe('2 hours ago');
    expect(timeAgo(now - 3 * 86400000, now)).toBe('3 days ago');
});
