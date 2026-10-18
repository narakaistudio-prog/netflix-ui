// @ts-nocheck — jsdom test: the nxsha player is asked to lock 1080p on every boot.
//
// The provider documents no quality parameter, so — like the resume seek —
// every known command spelling is sprayed into the frame on the nudge
// schedule, and the frame ignores the shapes it does not understand.
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

function mountAndCapture(src: string) {
    act(() => root.render(<EmbedPlayer src={src} title="Test title" />));
    const frame = container.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    const seen: unknown[] = [];
    const target = frame.contentWindow as any;
    target.postMessage = (data: any) => { seen.push(data); };
    return seen;
}

test('every embed boot sprays a 1080p ask into the frame', () => {
    const seen = mountAndCapture('https://nxsha.space/embed/movie/550?server=GbruHindi');

    act(() => { jest.advanceTimersByTime(400); });
    expect(seen.length).toBeGreaterThan(0);
    // Every spelling carries the same resolution: 1080.
    for (const message of seen) {
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        expect(text).toContain('1080');
    }
    // The ask repeats on the nudge schedule — the player engine may only be
    // ready to honour it after it has booted.
    const afterFirstWave = seen.length;
    act(() => { jest.advanceTimersByTime(1100); });
    expect(seen.length).toBeGreaterThan(afterFirstWave);
});

test('the 1080p ask also goes out when the frame finishes loading', () => {
    const seen = mountAndCapture('https://nxsha.space/embed/tv/30984/1/1?server=GbruHindi');
    const frame = container.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;

    act(() => { jest.advanceTimersByTime(400); });
    const afterFirstWave = seen.length;
    act(() => { frame.dispatchEvent(new Event('load')); });
    act(() => { jest.advanceTimersByTime(400); });
    expect(seen.length).toBeGreaterThan(afterFirstWave);
});

test('a direct video file gets no quality commands (the file is the quality)', () => {
    act(() => root.render(<EmbedPlayer src="https://example.com/clip.mp4" title="Test title" />));
    // Direct files render a <video>, no provider frame to command.
    expect(container.querySelector('iframe[data-arena-embed="1"]')).toBeNull();
    expect(container.querySelector('video')).not.toBeNull();
});
