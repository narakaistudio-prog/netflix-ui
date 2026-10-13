// @ts-nocheck — jsdom test: opening a title from search or a browse row shows the modal and never navigates to /movie/[id].
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ rowTitle: 'Action Movies', q: '' }),
    Stack: { Screen: () => null },
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
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
jest.mock('@/components/WebNavBar', () => ({ WEB_NAV_HEIGHT: 60 }));
jest.mock('@/hooks/useTvNavigation', () => ({ useTvBackHandler: () => {} }));
jest.mock('@/components/CatalogBrowseScreen', () => ({ CatalogBrowseScreen: () => null }));

const rows = [
    {
        rowTitle: 'Action Movies',
        type: 'normal',
        movies: [
            { id: 'netflix-genre-82034833', title: 'Jaat', imageUrl: 'https://image.tmdb.org/t/p/w500/a.jpg', mediaType: 'movie', embed_provider: 'nxsha', tmdb_id: '1' },
            { id: 'netflix-genre-1441228', title: 'Irumudi', imageUrl: 'https://image.tmdb.org/t/p/w500/b.jpg', mediaType: 'movie', embed_provider: 'nxsha', tmdb_id: '1441228' },
        ],
    },
];
jest.mock('@/hooks/useCatalog', () => ({ useCatalog: () => ({ rows, isLive: false }) }));

import Search from '../app/search';
import BrowseRow from '../app/browse/[rowTitle]';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

test('search: pressing a result opens the title modal and does not navigate to the detail page', () => {
    act(() => root.render(<Search />));
    const card = document.querySelector('[aria-label="Open Jaat"]') as HTMLElement;
    expect(card).not.toBeNull();
    act(() => { card.click(); });
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Play Jaat"]')).not.toBeNull();
});

test('browse row: pressing a title opens the title modal and does not navigate', () => {
    act(() => root.render(<BrowseRow />));
    const card = Array.from(document.querySelectorAll('[aria-label]')).find((el) =>
        (el.getAttribute('aria-label') || '').includes('Irumudi')) as HTMLElement | undefined;
    expect(card).toBeDefined();
    act(() => { card.click(); });
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Play Irumudi"]')).not.toBeNull();
});
