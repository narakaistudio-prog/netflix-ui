// @ts-nocheck — jsdom test for the web detail modal's recommendation tiles.
import React from 'react';
import { ScrollView } from 'react-native';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});
jest.mock('expo-av', () => ({ Video: () => null, ResizeMode: {} }));
jest.mock('react-native-awesome-slider', () => ({ Slider: () => null }));
jest.mock('react-native-reanimated', () => ({ useSharedValue: (value: number) => ({ value }) }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { ExpandedPlayer } from '../components/BottomSheet/ExpandedPlayer';
import catalog from '../data/movies.json';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const Scroll = (props: any) => <ScrollView {...props} />;
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

it('shows compact, keyboard-accessible posters and sends the clicked title to navigation', () => {
    const current = catalog.movies[0].movies[0];
    const onSelectRelated = jest.fn();
    act(() => root.render(
        <ExpandedPlayer movie={current} scrollComponent={Scroll} onSelectRelated={onSelectRelated} />,
    ));
    const cards = Array.from(container.querySelectorAll('[data-testid^="related-title-"]')) as HTMLElement[];
    expect(cards).toHaveLength(10);
    expect(cards.every(card => card.getAttribute('role') === 'button')).toBe(true);
    expect(cards.every(card => card.getAttribute('aria-label')?.startsWith('Open '))).toBe(true);
    expect(cards.map(card => card.dataset.testid)).not.toContain(`related-title-${current.id}`);
    expect(getComputedStyle(cards[0]).width).toBe('18%');
    expect(getComputedStyle(cards[0]).maxWidth).toBe('178px');
    expect(getComputedStyle(cards[0]).minWidth).toBe('130px');
    expect(getComputedStyle(cards[0]).cursor).toBe('pointer');

    act(() => cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(onSelectRelated).toHaveBeenCalledTimes(1);
    expect(onSelectRelated.mock.calls[0][0].id).toBe(cards[0].dataset.testid?.replace('related-title-', ''));
});
