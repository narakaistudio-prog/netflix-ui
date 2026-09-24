// @ts-nocheck — browser-style rendering test for deferred and windowed shelves.
import React from 'react';
import { View } from 'react-native';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useVisionOS', () => ({ useVisionOS: () => ({ isVisionOS: false }) }));
jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});
jest.mock('@/components/SafeImage', () => {
    const ReactLocal = require('react');
    return { SafeImage: ({ fallbackLabel }: any) => ReactLocal.createElement('span', null, fallbackLabel) };
});

import { DeferredMovieList } from '../components/MovieList/DeferredMovieList';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let originalObserver: typeof IntersectionObserver | undefined;
let observers: any[];

beforeEach(() => {
    mockPush.mockClear();
    originalObserver = globalThis.IntersectionObserver;
    observers = [];
    (globalThis as any).IntersectionObserver = class {
        target: HTMLElement | null = null;
        constructor(public callback: any, public options: any) { observers.push(this); }
        observe(target: HTMLElement) { this.target = target; }
        disconnect() {}
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalObserver) globalThis.IntersectionObserver = originalObserver;
    else delete (globalThis as any).IntersectionObserver;
});

const movies = Array.from({ length: 80 }, (_, i) => ({
    id: `item-${i}`, title: `Movie ${i}`, mediaType: 'movie' as const, imageUrl: `local:item-${i}`,
}));
const cards = () => container.querySelectorAll('[data-testid^="movie-card-"]');

it('hydrates only near-viewport shelves, then opens any visible card immediately', () => {
    act(() => root.render(
        <View style={{ overflowY: 'auto', height: 600 }}>
            <DeferredMovieList rowTitle="Long Movies" movies={movies} />
        </View>,
    ));
    expect(container.querySelector('[data-testid="deferred-row-Long Movies"]')).toBeTruthy();
    expect(container.querySelector('[data-tv-shelf="true"]')?.getAttribute('data-tv-shelf-count')).toBe('80');
    expect(cards()).toHaveLength(0);
    expect(observers).toHaveLength(1);
    expect(observers[0].options.root).toBe(container.firstChild);
    expect(observers[0].options.rootMargin).toBe('700px 0px');

    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(container.querySelector('[data-testid="deferred-row-Long Movies"]')).toBeNull();
    expect(cards()).toHaveLength(32);
    expect(container.querySelector('[data-testid="carousel-spacer-after"]')).toBeTruthy();

    act(() => cards()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/movie/[id]', params: { id: 'item-0' } });
});

it('keeps nearby cards reachable when the horizontal carousel is scrolled', () => {
    act(() => root.render(<DeferredMovieList rowTitle="Long Movies" movies={movies} eager />));
    const carousel = container.querySelector('[data-testid="movie-carousel-Long Movies"]') as HTMLElement;
    expect(carousel.getAttribute('data-tv-carousel')).toBe('true');
    expect(cards()).toHaveLength(32);
    act(() => {
        carousel.scrollLeft = 40 * 187;
        carousel.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(cards()).toHaveLength(32);
    expect(container.querySelector('[data-testid="movie-card-item-36"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="movie-card-item-67"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="movie-card-item-0"]')).toBeNull();
    act(() => (container.querySelector('[data-testid="movie-card-item-67"]') as HTMLElement)
        .dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/movie/[id]', params: { id: 'item-67' } });
});

it('mounts exactly the requested virtual poster when the TV remote reaches an unmounted card', () => {
    act(() => root.render(<DeferredMovieList rowTitle="Long Movies" movies={movies} eager />));
    const shelf = container.querySelector('[data-tv-shelf="true"]') as HTMLElement;
    const carousel = container.querySelector('[data-tv-carousel="true"]') as HTMLElement;
    expect(container.querySelector('[data-testid="movie-card-item-64"]')).toBeNull();

    act(() => shelf.dispatchEvent(new CustomEvent('arena-tv-reveal-card', { detail: { index: 64 } })));

    expect(container.querySelector('[data-testid="movie-card-item-64"]')).toBeTruthy();
    expect(carousel.scrollLeft).toBeGreaterThan(0);
    expect(cards()).toHaveLength(32);
});

it('hydrates only the requested deferred shelf, preserving the other placeholders', () => {
    act(() => root.render(<>
        <DeferredMovieList rowTitle="First" movies={movies.slice(0, 2)} />
        <DeferredMovieList rowTitle="Second" movies={movies.slice(2, 4)} />
    </>));
    const [first] = Array.from(container.querySelectorAll('[data-tv-shelf="true"]'));
    expect(container.querySelectorAll('[data-testid^="deferred-row-"]')).toHaveLength(2);

    act(() => first.dispatchEvent(new Event('arena-hydrate-shelf')));

    expect(container.querySelector('[data-testid="deferred-row-First"]')).toBeNull();
    expect(container.querySelector('[data-testid="deferred-row-Second"]')).toBeTruthy();
    expect(cards()).toHaveLength(2);
});
