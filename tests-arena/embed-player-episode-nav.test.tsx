// @ts-nocheck — jsdom verification for the web-only episode controls.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});

import { EmbedPlayer } from '../components/EmbedPlayer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const src = 'https://nxsha.space/embed/tv/30984/1/2?server=GbruHindi';
const nextButton = () => container.querySelector('[aria-label="Next episode"]') as HTMLElement;
const previousButton = () => container.querySelector('[aria-label="Previous episode"]') as HTMLElement;
const nextHotspot = () => container.querySelector('[data-testid="next-episode-hotspot"]') as HTMLElement;
const visible = () => getComputedStyle(nextButton()).opacity !== '0' && getComputedStyle(previousButton()).opacity !== '0';

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
});

function mount(onNextEpisode = jest.fn()) {
    act(() => root.render(
        <EmbedPlayer src={src} title="Test show" isTv onNextEpisode={onNextEpisode} onPrevEpisode={jest.fn()} />,
    ));
    const iframe = container.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    act(() => iframe.dispatchEvent(new Event('load')));
    return { iframe, onNextEpisode };
}

it('fades Prev/Next after cursor inactivity without unmounting or reloading the video', () => {
    const { iframe } = mount();
    expect(visible()).toBe(true);
    act(() => jest.advanceTimersByTime(2499));
    expect(visible()).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(visible()).toBe(false);
    expect(getComputedStyle(nextButton()).opacity).toBe('0');
    expect(getComputedStyle(previousButton()).opacity).toBe('0');
    expect(getComputedStyle(nextButton()).transitionProperty).toBe('opacity');
    expect(getComputedStyle(nextButton()).transitionDuration).toBe('180ms');
    expect(getComputedStyle(nextButton()).pointerEvents).toBe('none');
    expect(getComputedStyle(nextHotspot()).pointerEvents).toBe('auto');
    expect(getComputedStyle(container.querySelector('[data-testid="episode-navigation"]')!).pointerEvents).toBe('none');
    expect(iframe).toBe(container.querySelector('iframe[data-arena-embed="1"]'));
    expect(iframe.src).toBe(src);
});

it('brings both controls back on button-area hover and hides on pointer leave', () => {
    const { onNextEpisode } = mount();
    act(() => jest.advanceTimersByTime(2500));
    expect(visible()).toBe(false);

    act(() => nextHotspot().dispatchEvent(new Event('pointerover', { bubbles: true })));
    expect(visible()).toBe(true);
    act(() => jest.advanceTimersByTime(5000));
    expect(visible()).toBe(true); // Keep them available while the pointer hovers here.
    act(() => nextButton().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onNextEpisode).toHaveBeenCalledTimes(1);

    act(() => nextHotspot().dispatchEvent(new Event('pointerout', { bubbles: true })));
    expect(visible()).toBe(false);
});

it('reappears briefly when pointer movement reaches the parent player', () => {
    mount();
    act(() => jest.advanceTimersByTime(2500));
    expect(visible()).toBe(false);
    const player = container.querySelector('[data-testid="embed-player"]') as HTMLElement;
    act(() => player.dispatchEvent(new Event('pointermove', { bubbles: true })));
    expect(visible()).toBe(true);
    act(() => jest.advanceTimersByTime(2500));
    expect(visible()).toBe(false);
});

it('hides immediately when the cursor leaves the player', () => {
    mount();
    expect(visible()).toBe(true);
    const player = container.querySelector('[data-testid="embed-player"]') as HTMLElement;
    act(() => player.dispatchEvent(new Event('pointerout', { bubbles: true })));
    expect(visible()).toBe(false);
});

it('reveals hidden navigation on keyboard focus as well as mouse hover', () => {
    mount();
    act(() => jest.advanceTimersByTime(2500));
    expect(visible()).toBe(false);
    act(() => nextButton().focus());
    expect(visible()).toBe(true);
    act(() => nextButton().blur());
    expect(visible()).toBe(false);
});

it('resets the idle timer when the next episode is selected', () => {
    const { iframe, onNextEpisode } = mount();
    act(() => jest.advanceTimersByTime(2500));
    expect(visible()).toBe(false);
    act(() => root.render(
        <EmbedPlayer src="https://nxsha.space/embed/tv/30984/1/3?server=GbruHindi"
            title="Test show" isTv onNextEpisode={onNextEpisode} onPrevEpisode={jest.fn()} />,
    ));
    expect(visible()).toBe(true);
    expect(container.querySelector('iframe[data-arena-embed="1"]')).not.toBe(iframe);
    act(() => jest.advanceTimersByTime(2500));
    expect(visible()).toBe(false);
});

it('does not show episode controls on a movie', () => {
    act(() => root.render(<EmbedPlayer src="https://nxsha.space/embed/movie/550?server=GbruHindi" />));
    expect(container.querySelector('[data-testid="episode-navigation"]')).toBeNull();
});
