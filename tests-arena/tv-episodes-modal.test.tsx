// @ts-nocheck — jsdom test: a TV title lists its seasons and episodes in the modal; an episode plays in the player.
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
    return { EmbedPlayer: ({ src, title }: any) => ReactLocal.createElement('div', { 'data-testid': 'embed-player', 'data-src': src, 'data-title': title }) };
});
jest.mock('expo-linear-gradient', () => {
    const ReactLocal = require('react');
    return { LinearGradient: (props: any) => ReactLocal.createElement('div', null, props.children) };
});
jest.mock('@/lib/tvEpisodes', () => {
    const actual = jest.requireActual('@/lib/tvEpisodes');
    const seasons = [
        {
            season_number: 1,
            name: 'Season 1',
            overview: '',
            episode_count: 2,
            episodes: [
                { season: 1, episode: 1, name: 'Pilot', overview: 'First night.', runtime: 66 },
                { season: 1, episode: 2, name: 'Second Act', overview: 'Then the rain.', runtime: 70 },
            ],
        },
        {
            season_number: 2,
            name: 'Season 2',
            overview: '',
            episode_count: 1,
            episodes: [{ season: 2, episode: 1, name: 'Return', overview: 'Back again.', runtime: 50 }],
        },
    ];
    return { ...actual, getTvSeasons: (id: string) => (id === '777' ? seasons : []) };
});

// Ye tests Nxsha (embed) wala rasta dekhte hain — MovieBox available na hone
// par hi wo chalta hai (owner ka naya rule: MovieBox ho to wahi default hai).
jest.mock('@/hooks/useMovieboxAvailable', () => ({
    useMovieboxAvailable: () => ({ available: false, checking: false }),
}));
jest.mock('@/lib/movieboxLinks', () => {
    const actual = jest.requireActual('@/lib/movieboxLinks');
    return { ...actual, resolveMovieboxLink: () => null };
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

const show = {
    id: 'netflix-genre-1',
    tmdb_id: '777',
    embed_provider: 'nxsha',
    mediaType: 'tv',
    title: 'Sacred Games',
    imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
};

const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement;

test('lists the season picker and the episodes of season 1 with runtime and description', () => {
    act(() => root.render(<MovieDetailModal movie={show} onClose={() => {}} />));
    const text = document.body.textContent || '';
    expect(text).toContain('Episodes');
    expect(text).toContain('Season 1 (2 EP)');
    expect(text).toContain('Pilot');
    expect(text).toContain('1h 10m');
    expect(text).toContain('Then the rain.');
    expect(byLabel('Play episode 2: Second Act')).not.toBeNull();
});

test('choosing another season shows its episodes', () => {
    act(() => root.render(<MovieDetailModal movie={show} onClose={() => {}} />));
    act(() => { byLabel('Choose season').click(); });
    act(() => { byLabel('Season 2').click(); });
    expect(document.body.textContent).toContain('Return');
    expect(document.body.textContent).not.toContain('Pilot');
});

test('pressing an episode plays that episode in the player (not the first one)', () => {
    act(() => root.render(<MovieDetailModal movie={show} onClose={() => {}} />));
    act(() => { byLabel('Play episode 2: Second Act').click(); });
    const player = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
    expect(player).not.toBeNull();
    expect(player.getAttribute('data-src')).toContain('/embed/tv/777/1/2');
    expect(player.getAttribute('data-src')).toContain('color=netflix');
    expect(player.getAttribute('data-title')).toContain('S1 E2');
});

test('the Play button still starts with episode 1 of season 1', () => {
    act(() => root.render(<MovieDetailModal movie={show} onClose={() => {}} />));
    act(() => { byLabel('Play Sacred Games').click(); });
    const player = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
    expect(player.getAttribute('data-src')).toContain('/embed/tv/777/1/1');
});

test('a title without episode data shows no Episodes section', () => {
    act(() => root.render(<MovieDetailModal movie={{ ...show, tmdb_id: '999' }} onClose={() => {}} />));
    expect(document.body.textContent).not.toContain('Episodes');
});
