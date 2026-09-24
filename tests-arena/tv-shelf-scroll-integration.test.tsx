// @ts-nocheck — exercise the real React Native Web ScrollView + deferred MovieList DOM.
import React from 'react';
import { Pressable, ScrollView } from 'react-native';
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
    return { SafeImage: () => ReactLocal.createElement('span') };
});

import { spatialNav } from '../lib/spatialNavigation';
import { DeferredMovieList } from '../components/MovieList/DeferredMovieList';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, right: left + width, bottom: top + height, width, height, x: left, y: top,
});

describe('TV spatial navigation with mounted RN Web shelves', () => {
    let container: HTMLDivElement;
    let root: Root;
    const oldObserver = globalThis.IntersectionObserver;
    const oldHeight = window.innerHeight;

    beforeEach(() => {
        mockPush.mockClear();
        globalThis.IntersectionObserver = class {
            observe() {}
            disconnect() {}
        } as any;
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        spatialNav.destroy();
        spatialNav.setTvMode(false, false);
        act(() => root.unmount());
        container.remove();
        if (oldObserver) globalThis.IntersectionObserver = oldObserver;
        else delete globalThis.IntersectionObserver;
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: oldHeight });
    });

    it('focuses Play → first poster → deferred next poster, scrolling the page (not window)', async () => {
        act(() => root.render(
            <ScrollView {...({ dataSet: { tvScrollContainer: 'true' } } as any)} style={{ height: 800 }}>
                <Pressable {...({ dataSet: { tvFocusable: 'true', tvRow: 'billboard', tvId: 'hero-play' } } as any)} testID="hero-play">Play</Pressable>
                <DeferredMovieList eager rowTitle="Top 10" movies={[{ id: 'top', imageUrl: 'local:top' }]} />
                <DeferredMovieList rowTitle="Trending" movies={[{ id: 'trending', imageUrl: 'local:trending' }]} />
            </ScrollView>,
        ));
        const scroller = container.querySelector<HTMLElement>('[data-tv-scroll-container="true"]')!;
        const play = container.querySelector<HTMLElement>('[data-testid="hero-play"]')!;
        const first = container.querySelector<HTMLElement>('[data-testid="movie-card-top"]')!;
        expect(scroller).toBeTruthy();
        expect(first).toBeTruthy();
        expect(container.querySelector('[data-testid="movie-card-trending"]')).toBeNull();
        Object.defineProperties(scroller, {
            scrollHeight: { configurable: true, value: 2600 },
            clientHeight: { configurable: true, value: 800 },
        });
        play.getBoundingClientRect = () => rect(50, 400 - scroller.scrollTop, 160, 45) as any;
        first.getBoundingClientRect = () => rect(48, 660 - scroller.scrollTop, 175, 255) as any;
        const windowScroll = jest.spyOn(window, 'scrollBy').mockImplementation(() => {});
        const realRect = HTMLElement.prototype.getBoundingClientRect;
        const newCardRect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return this.getAttribute('data-testid') === 'movie-card-trending'
                ? rect(48, 1070 - scroller.scrollTop, 175, 255) as any
                : realRect.call(this);
        });
        spatialNav.init();
        spatialNav.setTvMode(true, false);
        spatialNav.setFocus(play);

        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, cancelable: true })));
        expect(spatialNav.getCurrentFocus()).toBe(first);
        expect(scroller.scrollTop).toBeGreaterThan(0);
        expect(windowScroll).not.toHaveBeenCalled();

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, cancelable: true }));
            await Promise.resolve(); // React commits the targeted deferred shelf.
        });
        const second = container.querySelector<HTMLElement>('[data-testid="movie-card-trending"]');
        expect(second).toBeTruthy();
        expect(spatialNav.getCurrentFocus()).toBe(second);
        expect(scroller.scrollTop).toBeGreaterThan(300);
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, cancelable: true })));
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/movie/[id]', params: { id: 'trending' } });
        windowScroll.mockRestore();
        newCardRect.mockRestore();
    });
});
