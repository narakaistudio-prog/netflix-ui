// @ts-nocheck — jsdom test: Continue Watching resumes the SAME episode at the
// SAME playback position — the behaviour the Crunchyroll page already has.
//
// The player frame is cross-origin, so the position is pinned by the player
// time events it posts, with a wall-clock estimator as a fallback, and the
// resume is sprayed back into the frame as seek commands.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});
jest.mock('expo-linear-gradient', () => {
    const ReactLocal = require('react');
    return { LinearGradient: (props: any) => ReactLocal.createElement('div', null, props.children) };
});
jest.mock('@/hooks/useCatalog', () => ({
    useCatalog: () => ({ rows: [], isLive: false }),
}));

import { ContinueWatchingRow } from '../components/ContinueWatchingRow';
import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';
import {
    getRecentlyWatched,
    markWatched,
    updateWatchPosition,
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

function entry(id: string, title: string, extra: any = {}) {
    markWatched({
        id,
        titleId: id,
        title,
        type: 'movie',
        tmdbId: '1441228',
        imdbId: 'tt1441228',
        provider: 'nxsha',
        imageUrl: 'https://image.tmdb.org/t/p/w500/x.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/w780/x.jpg',
        year: '2026',
        ...extra,
    });
}

/** A player time event, the way the provider frame reports it. */
function postPlayerMessage(data: unknown) {
    window.dispatchEvent(new window.MessageEvent('message', { data }));
}

function clickCard(title: string) {
    const card = container.querySelector(`[aria-label="Continue ${title}"]`) as HTMLElement;
    expect(card).toBeTruthy();
    act(() => { card.click(); });
}

test('a player time event pins the position, the row shows it and it is stored', () => {
    entry('a', 'Irumudi');
    act(() => root.render(<ContinueWatchingRow />));

    // The card is there; open the title so the player is mounted.
    clickCard('Irumudi');
    const frame = document.querySelector('iframe[data-arena-embed="1"]');
    expect(frame).toBeTruthy();

    act(() => {
        // The viewer pressed play inside the frame, then the player reports
        // where playback is: 6m12s of a 24m movie.
        frame.dispatchEvent(new window.Event('focus'));
        postPlayerMessage({
            type: 'MEDIA_DATA',
            data: { event: 'timeupdate', currentTime: 372, duration: 1440 },
        });
    });

    const stored = getRecentlyWatched()[0];
    expect(stored.positionSec).toBe(372);
    expect(stored.durationSec).toBe(1440);
    expect(stored.progress).toBe(26);

    // The card now tells where the viewer stopped.
    const text = container.textContent || '';
    expect(text).toContain('6:12 in');
    expect(text).toContain('18 min left');
});

test('resuming a card opens the player and sprays the resume point into the frame', () => {
    jest.useFakeTimers();
    try {
        entry('a', 'Irumudi');
        updateWatchPosition('a', 372, 1440);
        act(() => root.render(<ContinueWatchingRow />));

        clickCard('Irumudi');
        const frame = document.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
        expect(frame).toBeTruthy();

        // Stand in for the provider frame: capture what is posted into it.
        const seen: unknown[] = [];
        const target = frame.contentWindow as any;
        target.postMessage = (data: any) => { seen.push(data); };

        act(() => { jest.advanceTimersByTime(400); });
        expect(seen.length).toBeGreaterThan(0);
        expect(JSON.stringify(seen)).toContain('372');
    } finally {
        jest.useRealTimers();
    }
});

test('a series resumes the very same episode', () => {
    entry('tv-1399-s1-e3', 'Irumudi', { type: 'tv', season: 1, episode: 3 });
    updateWatchPosition('tv-1399-s1-e3', 372, 1440);
    act(() => root.render(<ContinueWatchingRow />));

    clickCard('Irumudi');
    const frame = document.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    // S1 · E3 of the series, not the first episode.
    expect(frame.getAttribute('src')).toContain('/embed/tv/');
    expect(frame.getAttribute('src')).toContain('/1/3');
});

test('with no player events the wall-clock estimator still records the position', () => {
    jest.useFakeTimers();
    try {
        entry('a', 'Irumudi');
        act(() => root.render(<ContinueWatchingRow />));
        clickCard('Irumudi');
        const frame = document.querySelector('iframe[data-arena-embed="1"]');
        expect(frame).toBeTruthy();

        act(() => {
            // The viewer pressed play inside the frame; the provider stays
            // silent about the playhead. The estimator stores the position
            // every few seconds.
            frame.dispatchEvent(new window.Event('focus'));
            jest.advanceTimersByTime(5200);
        });

        const stored = getRecentlyWatched()[0];
        expect(stored.positionSec).toBeGreaterThanOrEqual(4);
        expect(stored.positionSec).toBeLessThanOrEqual(7);
    } finally {
        jest.useRealTimers();
    }
});

test('pressing Play on a title that was started before continues from the saved position', () => {
    jest.useFakeTimers();
    try {
        const movie = {
            id: 'a',
            title: 'Irumudi',
            imageUrl: 'https://image.tmdb.org/t/p/w500/x.jpg',
            backdropUrl: 'https://image.tmdb.org/t/p/w780/x.jpg',
            tmdb_id: '1441228',
            imdb_id: 'tt1441228',
            embed_provider: 'nxsha',
            mediaType: 'movie',
        };
        entry('a', 'Irumudi');
        updateWatchPosition('a', 372, 1440);
        act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));

        const play = document.querySelector('[aria-label="Play Irumudi"]') as HTMLElement;
        expect(play).toBeTruthy();
        act(() => { play.click(); });

        const frame = document.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
        expect(frame).toBeTruthy();
        const seen: unknown[] = [];
        const target = frame.contentWindow as any;
        target.postMessage = (data: any) => { seen.push(data); };

        act(() => { jest.advanceTimersByTime(400); });
        expect(JSON.stringify(seen)).toContain('372');
    } finally {
        jest.useRealTimers();
    }
});

test('a finished title leaves the Continue Watching row', () => {
    entry('a', 'Irumudi');
    act(() => root.render(<ContinueWatchingRow />));
    clickCard('Irumudi');
    const frame = document.querySelector('iframe[data-arena-embed="1"]');
    expect(frame).toBeTruthy();

    act(() => {
        // The player reports the last position, then the end of the media.
        postPlayerMessage({
            type: 'MEDIA_DATA',
            data: { event: 'timeupdate', currentTime: 1400, duration: 1440 },
        });
        postPlayerMessage({
            type: 'PLAYER_EVENT',
            data: { event: 'ended' },
        });
    });

    expect(getRecentlyWatched()).toHaveLength(0);
    expect(container.textContent || '').not.toContain('Continue Watching');
});
