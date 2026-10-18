// @ts-nocheck — jsdom test: Netflix genre TV shows open the TV player (first episode), in the Netflix accent.
jest.mock('@/lib/nxshaStream', () => ({
    resolveNxshaStream: () => Promise.resolve(null),
}));
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

import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';

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

function playSrc(title: string, mediaType: 'movie' | 'tv', tmdb: string): string {
    const show = {
        id: `netflix-genre-${tmdb}`,
        tmdb_id: tmdb,
        embed_provider: 'nxsha',
        mediaType,
        title,
        imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    };
    act(() => root.render(<MovieDetailModal movie={show} onClose={() => {}} />));
    const play = document.querySelector(`[aria-label="Play ${title}"]`) as HTMLElement;
    expect(play).not.toBeNull();
    act(() => { play.click(); });
    const player = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
    expect(player).not.toBeNull();
    return player.getAttribute('data-src') || '';
}

test('a TV show plays its first episode in the Netflix-accent TV player', () => {
    const src = playSrc('Sacred Games', 'tv', '1234');
    expect(src).toContain('/embed/tv/1234/1/1');
    expect(src).toContain('color=netflix');
    expect(src).not.toContain('/embed/movie/');
});

test('a movie still plays in the Netflix-accent movie player', () => {
    const src = playSrc('Irumudi', 'movie', '1441228');
    expect(src).toContain('/embed/movie/1441228');
    expect(src).toContain('color=netflix');
});
