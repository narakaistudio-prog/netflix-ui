// @ts-nocheck — jsdom test: a pressed title opens its details over the row.
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
    act(() => root.render(<MovieDetailModal movie={null} onClose={() => {}} onPlay={() => {}} />));
    expect(container.textContent).not.toContain('Play');
});

test('shows backdrop, title, meta, cast and genres for the pressed title', () => {
    act(() => root.render(<MovieDetailModal movie={movie} onClose={() => {}} onPlay={() => {}} />));
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

test('Play hands the title to onPlay', () => {
    const onPlay = jest.fn();
    act(() => root.render(<MovieDetailModal movie={movie} onClose={() => {}} onPlay={onPlay} />));
    const play = Array.from(document.querySelectorAll('[aria-label]')).find((el) =>
        (el.getAttribute('aria-label') || '').startsWith('Play Irumudi') || el.getAttribute('aria-label') === 'Play Irumudi');
    expect(play).toBeDefined();
    act(() => { (play as HTMLElement).click(); });
    expect(onPlay).toHaveBeenCalledWith(movie);
});
