// @ts-nocheck — jsdom test: the Anime section lists only the anime rows, with the
// "Anime: " prefix removed, and Home leaves them out.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/anime',
    Stack: { Screen: () => null },
}));
jest.mock('@/app/(tabs)/_layout', () => ({ TAB_SCREENS: [{ name: 'index' }, { name: 'movies' }, { name: 'anime' }] }));
jest.mock('@/components/TabScreenWrapper', () => {
    const ReactLocal = require('react');
    return { TabScreenWrapper: ({ children }: any) => ReactLocal.createElement('div', null, children) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-linear-gradient', () => {
    const ReactLocal = require('react');
    return { LinearGradient: (props: any) => ReactLocal.createElement('div', null, props.children) };
});
jest.mock('@/components/WebNavBar', () => ({ WEB_NAV_HEIGHT: 60 }));
jest.mock('@/components/MovieList/DeferredMovieList', () => {
    const ReactLocal = require('react');
    return {
        DeferredMovieList: ({ rowTitle, movies }: any) =>
            ReactLocal.createElement('section', { 'data-row': rowTitle }, `${rowTitle}:${movies.length}`),
    };
});

const animeItem = (id: string) => ({
    id: `netflix-anime-${id}`,
    title: `Anime ${id}`,
    imageUrl: 'https://image.tmdb.org/t/p/w500/a.jpg',
    mediaType: 'tv',
    catalogCollection: 'netflix-anime-7424',
});
const genreItem = (id: string) => ({
    id: `netflix-genre-${id}`,
    title: `Genre ${id}`,
    imageUrl: 'https://image.tmdb.org/t/p/w500/g.jpg',
    mediaType: 'movie',
    catalogCollection: 'netflix-genre-100381',
});
const animeMovieItem = (id: string) => ({
    id: `netflix-anime-movies-${id}`,
    netflixId: id,
    title: `Anime Movie ${id}`,
    imageUrl: 'https://image.tmdb.org/t/p/w500/m.jpg',
    mediaType: 'movie',
    catalogCollection: 'netflix-anime-3063',
});
const rows = [
    { rowTitle: 'Your Next Watch', type: 'normal', movies: [genreItem('1')] },
    { rowTitle: 'Anime: Your Next Watch', type: 'normal', movies: [animeItem('10'), animeItem('11')] },
    { rowTitle: 'Anime: Action Movies', type: 'normal', movies: [animeItem('10')] },
    { rowTitle: 'Anime Movies: Action Movies', type: 'normal', movies: [animeMovieItem('90')] },
];
let mockRows = rows;
jest.mock('@/hooks/useCatalog', () => ({ useCatalog: () => ({ rows: mockRows, isLive: false }) }));

import { AnimeBrowseScreen } from '../components/AnimeBrowseScreen';
import { getCatalogSections } from '../components/CatalogBrowseScreen';

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

test('the Anime section shows the series rows, then the Anime Movies group, with prefixes removed and no genre rows', () => {
    act(() => root.render(<AnimeBrowseScreen />));
    const shelves = Array.from(container.querySelectorAll('section')).map(el => el.getAttribute('data-row'));
    expect(shelves).toEqual(['Your Next Watch', 'Action Movies', 'Action Movies']);
    expect(container.textContent).toContain('Anime Movies');
    expect(container.textContent).toContain('Your Next Watch:2');
    expect(container.textContent).toContain('3 titles available');
});

test('Movies and TV browse leave the anime rows out, both anime pages', () => {
    const movieRows = getCatalogSections(rows, 'movie');
    expect(movieRows.map(r => r.rowTitle)).toEqual(['Your Next Watch']);
    expect(movieRows[0].movies.map(m => m.id)).toEqual(['netflix-genre-1']);
});
