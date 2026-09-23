// @ts-nocheck — web-only jsdom harness for the third-party iframe UI.
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
const cover = () => container.querySelector('[data-testid="nxsha-scan-cover"]');

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

function mount(src: string) {
    act(() => root.render(<EmbedPlayer src={src} title="Test episode" />));
    const iframe = container.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    act(() => iframe.dispatchEvent(new Event('load')));
    return iframe;
}

function focusFrame(iframe: HTMLIFrameElement) {
    act(() => {
        iframe.focus();
        window.dispatchEvent(new Event('blur'));
    });
}

describe('Nxsha scanning screen cover', () => {
    it('keeps the red Play button available, then covers the scan after the click and auto-reveals', () => {
        const src = 'https://nxsha.space/embed/tv/30984/1/1?server=GbruHindi&one_server=true';
        const iframe = mount(src);
        expect(cover()).toBeNull();

        focusFrame(iframe);
        act(() => jest.advanceTimersByTime(349));
        expect(cover()).toBeNull(); // The iframe click gets through before the cover appears.
        act(() => jest.advanceTimersByTime(1));
        expect(cover()).toBeTruthy();
        expect(iframe.src).toBe(src); // Never replace or retarget the user's server.

        act(() => jest.advanceTimersByTime(10000));
        expect(cover()).toBeTruthy();
        act(() => jest.advanceTimersByTime(1999));
        expect(cover()).toBeTruthy();
        act(() => jest.advanceTimersByTime(1));
        expect(cover()).toBeNull(); // Reveal automatically after 12 seconds.
    });

    it('starts on an iframe focus event even without a window blur event', () => {
        const iframe = mount('https://nxsha.space/embed/movie/550?server=GbruHindi');
        act(() => iframe.focus());
        act(() => jest.advanceTimersByTime(350));
        expect(cover()).toBeTruthy();
    });

    it('ignores unrelated blur events and other providers', () => {
        mount('https://nxsha.space/embed/movie/550?server=GbruHindi');
        act(() => window.dispatchEvent(new Event('blur')));
        act(() => jest.advanceTimersByTime(350));
        expect(cover()).toBeNull();

        act(() => root.render(<EmbedPlayer src="https://nhdapi.com/tv/30984/1/1" title="Test episode" />));
        const iframe = container.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
        act(() => iframe.dispatchEvent(new Event('load')));
        focusFrame(iframe);
        act(() => jest.advanceTimersByTime(11000));
        expect(cover()).toBeNull();
    });

    it('cancels a pending cover when the episode changes', () => {
        const iframe = mount('https://nxsha.space/embed/tv/30984/1/1?server=GbruHindi');
        focusFrame(iframe);
        act(() => root.render(
            <EmbedPlayer src="https://nxsha.space/embed/tv/30984/1/2?server=GbruHindi" title="Test episode" />,
        ));
        act(() => jest.advanceTimersByTime(11000));
        expect(cover()).toBeNull();
    });
});
