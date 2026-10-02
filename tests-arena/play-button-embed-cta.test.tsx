// @ts-nocheck — jsdom test for the detail dialog's Play call-to-action.
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

const base = {
    id: 'jw-catalog-movie-saiyaara',
    title: 'Saiyaara',
    imageUrl: '',
    mediaType: 'movie',
    netflixId: '82034837',
};

it('keeps an in-app Play CTA while the embed id is still being resolved', () => {
    const onPlayFull = jest.fn();
    act(() => root.render(
        <ExpandedPlayer
            movie={{ ...base, playbackPending: true }}
            scrollComponent={Scroll}
            onPlayFull={onPlayFull}
        />,
    ));

    expect(container.textContent).not.toContain('Play on Netflix');
    const playButton = [...container.querySelectorAll('[aria-label="Play title"]')][0];
    act(() => {
        playButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPlayFull).toHaveBeenCalled();
});

it('plays in the embed once an id is known', () => {
    const onPlayFull = jest.fn();
    act(() => root.render(
        <ExpandedPlayer
            movie={{ ...base, imdb_id: 'tt28037987' }}
            scrollComponent={Scroll}
            onPlayFull={onPlayFull}
        />,
    ));
    expect(container.textContent).not.toContain('Play on Netflix');
});

it('only offers Netflix when nothing can be resolved', () => {
    act(() => root.render(
        <ExpandedPlayer movie={base} scrollComponent={Scroll} onPlayFull={jest.fn()} />,
    ));
    expect(container.textContent).toContain('Play on Netflix');
});
