// @ts-nocheck — jsdom test: the K-Dramas section lists only the K-Drama rows, with the
// "K-Dramas: " prefix removed, and the Movies/TV browse screens leave them out.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kdramas',
    Stack: { Screen: () => null },
}));
jest.mock('@/app/(tabs)/_layout', () => ({ TAB_SCREENS: [{ name: 'index' }, { name: 'movies' }, { name: 'kdramas' }] }));
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

const kdramaItem = (id: string) => ({
    id: `netflix-kdrama-${id}`,
    netflixId: id,
    title: `K-Drama ${id}`,
    imageUrl: 'https://image.tmdb.org/t/p/w500/k.jpg',
    mediaType: 'tv',
    catalogCollection: 'netflix-genre-2638104',
});
const genreItem = (id: string) => ({
    id: `netflix-genre-${id}`,
    title: `Genre ${id}`,
    imageUrl: 'https://image.tmdb.org/t/p/w500/g.jpg',
    mediaType: 'movie',
    catalogCollection: 'netflix-genre-100381',
});
const rows = [
    { rowTitle: 'Your Next Watch', type: 'normal', movies: [genreItem('1')] },
    { rowTitle: 'K-Dramas: Your Next Watch', type: 'normal', movies: [kdramaItem('10'), kdramaItem('11')] },
    { rowTitle: 'K-Dramas: TV Dramas', type: 'normal', movies: [kdramaItem('10')] },
];
let mockRows = rows;
jest.mock('@/hooks/useCatalog', () => ({ useCatalog: () => ({ rows: mockRows, isLive: false }) }));

import { KdramaBrowseScreen } from '../components/KdramaBrowseScreen';
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

test('the K-Dramas section shows only its rows, prefixes removed and no genre rows', () => {
    act(() => root.render(<KdramaBrowseScreen />));
    const shelves = Array.from(container.querySelectorAll('section')).map(el => el.getAttribute('data-row'));
    expect(shelves).toEqual(['Your Next Watch', 'TV Dramas']);
    expect(container.textContent).toContain('K-Dramas');
    expect(container.textContent).toContain('Your Next Watch:2');
    expect(container.textContent).toContain('2 titles available');
});

test('Movies and TV browse leave the K-Drama rows out', () => {
    const movieRows = getCatalogSections(rows, 'movie');
    expect(movieRows.map(r => r.rowTitle)).toEqual(['Your Next Watch']);
    expect(movieRows[0].movies.map(m => m.id)).toEqual(['netflix-genre-1']);
    const tvRows = getCatalogSections(rows, 'tv');
    expect(tvRows.map(r => r.rowTitle)).toEqual([]);
});
