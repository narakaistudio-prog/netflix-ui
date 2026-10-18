// @ts-nocheck — jsdom test: Play prefers OUR 1080p direct player and falls
// back to the nxsha embed when the stream cannot be resolved.
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

const mockResolve = jest.fn();
jest.mock('@/lib/nxshaStream', () => ({
    resolveNxshaStream: (...args: any[]) => mockResolve(...args),
}));

import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no media pipeline — the player only wires the element up.
beforeAll(() => {
    window.HTMLMediaElement.prototype.load = () => {};
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    mockResolve.mockReset();
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
    imdb_id: 'tt1441228',
    embed_provider: 'nxsha',
    title: 'Irumudi',
    imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    year: '2026',
    mediaType: 'movie',
};

function renderAndPlay() {
    act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));
    const play = document.querySelector('[aria-label="Play Irumudi"]') as HTMLElement;
    expect(play).toBeTruthy();
    act(() => { play.click(); });
}

test('a resolved stream opens OUR player with the direct source', async () => {
    mockResolve.mockResolvedValue({
        source: { name: 'GbruHindi', kind: 'm3u8', url: 'https://cdn/hindi.m3u8' },
        alternates: [],
    });
    renderAndPlay();

    // The resolver was asked for the right title/episode shape.
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({
        type: 'movie',
        tmdbId: '1441228',
        imdbId: 'tt1441228',
    }));

    await act(async () => { await Promise.resolve(); });
    const direct = document.querySelector('[data-testid="direct-stream-player"]') as HTMLElement;
    expect(direct).not.toBeNull();
    expect(document.querySelector('iframe[data-arena-embed="1"]')).toBeNull();
});

test('an unresolved stream opens the classic nxsha embed, as before', async () => {
    mockResolve.mockResolvedValue(null);
    renderAndPlay();

    await act(async () => { await Promise.resolve(); });
    const frame = document.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toContain('color=netflix');
    expect(document.querySelector('[data-testid="direct-stream-player"]')).toBeNull();
});

test('a failed resolve is silent — the embed still opens', async () => {
    mockResolve.mockRejectedValue(new Error('api down'));
    renderAndPlay();

    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('iframe[data-arena-embed="1"]')).toBeTruthy();
});
