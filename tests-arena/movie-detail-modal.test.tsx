// @ts-nocheck — jsdom test: a pressed title opens its details over the row.
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
    return { EmbedPlayer: ({ src, onClose }: any) => ReactLocal.createElement('div', { 'data-testid': 'embed-player', 'data-src': src, onClick: onClose }) };
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
    embed_provider: 'nxsha',
    title: 'Irumudi',
    imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    year: '2026',
    duration: '2h 32m',
    ranking_text: '#2 in Movies',
    description: 'A father undertakes a spiritual vow.',
    cast: ['Ravi Teja', 'Sai Kumar'],
    genres: ['Drama', 'Action'],
};

test('renders nothing visible without a movie', () => {
    act(() => root.render(<MovieDetailModal movie={null} onClose={() => {}}  />));
    expect(container.textContent).not.toContain('Play');
});

test('shows backdrop, title, meta, cast and genres for the pressed title', () => {
    act(() => root.render(<MovieDetailModal movie={movie} onClose={() => {}}  />));
    const text = document.body.textContent || '';
    expect(text).toContain('Irumudi');
    expect(text).toContain('2026');
    expect(text).toContain('2h 32m');
    expect(text).toContain('#2 in Movies');
    expect(text).toContain('Ravi Teja, Sai Kumar');
    expect(text).toContain('Drama, Action');
    const img = document.querySelector('img[src*="backdrop"]') || document.querySelector('[style*="backdrop"]');
    expect(img).not.toBeNull();
});

test('Play starts the player inside the modal, and closing the player returns to details', () => {
    const onClose = jest.fn();
    act(() => root.render(<MovieDetailModal movie={movie} onClose={onClose} />));
    const play = Array.from(document.querySelectorAll('[aria-label]')).find((el) =>
        (el.getAttribute('aria-label') || '').startsWith('Play Irumudi') || el.getAttribute('aria-label') === 'Play Irumudi');
    expect(play).toBeDefined();
    act(() => { (play as HTMLElement).click(); });
    const player = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
    expect(player.getAttribute('data-src')).toContain('/embed/movie/1441228');
    expect(player.getAttribute('data-src')).toContain('color=netflix');
    expect(player.getAttribute('data-src')).not.toContain('color=orange');
    expect(document.body.textContent).toContain('Irumudi');
    // Closing the player (its onClose) keeps the modal open on the same title.
    act(() => { player.click(); });
    expect(document.querySelector('[data-testid="embed-player"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Irumudi');
});

test('hero image loads eagerly so it is not blank inside the modal', () => {
    act(() => root.render(<MovieDetailModal movie={movie} onClose={() => {}}  />));
    const img = document.querySelector('img[src*="backdrop"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img.getAttribute('loading')).toBe('eager');
});

test('More Like This lists related titles and opens the picked one in place', () => {
    const onSelect = jest.fn();
    const related = [
        { id: 'r1', title: 'Vishwanath & Sons', imageUrl: 'https://image.tmdb.org/t/p/w500/v.jpg', year: '2026' },
        { id: 'r2', title: 'Lust Stories 3', imageUrl: 'https://image.tmdb.org/t/p/w500/l.jpg', year: '2026' },
    ];
    act(() => root.render(
        <MovieDetailModal movie={movie} related={related} onClose={() => {}} onSelect={onSelect} />,
    ));
    expect(document.body.textContent).toContain('More Like This');
    const pick = document.querySelector('[aria-label="Open Lust Stories 3"]') as HTMLElement;
    expect(pick).toBeTruthy();
    act(() => { pick.click(); });
    expect(onSelect).toHaveBeenCalledWith(related[1]);
});
