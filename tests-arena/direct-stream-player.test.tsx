// @ts-nocheck — jsdom test: our own player pins 1080p in code and falls back
// to the embed player when every direct source fails.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});
jest.mock('@/hooks/useTvNavigation', () => ({ useTvBackHandler: () => {} }));

type HlsInstance = {
    config: any;
    currentLevel: number;
    startLevel: number;
    loadSource: jest.Mock;
    attachMedia: jest.Mock;
    destroy: jest.Mock;
    on: jest.Mock;
};

const hlsInstances: HlsInstance[] = [];
let mockManifestLevels: any[] = [];
let mockEmitManifest: ((hls: HlsInstance) => void) | null = null;
let mockEmitError: ((hls: HlsInstance, data: any) => void) | null = null;

jest.mock('hls.js', () => {
    class FakeHls {
        config: any;
        currentLevel = -1;
        startLevel = -1;
        loadSource = jest.fn();
        attachMedia = jest.fn();
        destroy = jest.fn();
        on = jest.fn((event: string, handler: any) => {
            if (event === 'MANIFEST_PARSED') {
                mockEmitManifest = (hls: HlsInstance) => handler({}, { levels: mockManifestLevels });
            }
            if (event === 'ERROR') {
                mockEmitError = (hls: HlsInstance, data: any) => handler({}, data);
            }
        });
        static isSupported = () => true;
        static Events = { MANIFEST_PARSED: 'MANIFEST_PARSED', ERROR: 'ERROR' };
        static ErrorTypes = { NETWORK_ERROR: 'networkError' };
        constructor(config: any) {
            this.config = config;
            hlsInstances.push(this as unknown as HlsInstance);
        }
    }
    return { __esModule: true, default: FakeHls };
});

import { DirectStreamPlayer, TARGET_HEIGHT } from '../components/DirectStreamPlayer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no media pipeline — the player only wires the elements up.
beforeAll(() => {
    window.HTMLMediaElement.prototype.load = () => {};
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.HTMLMediaElement.prototype.pause = () => {};
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    hlsInstances.length = 0;
    mockEmitManifest = null;
    mockEmitError = null;
    mockManifestLevels = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const source = { name: 'GbruHindi', kind: 'm3u8' as const, url: 'https://cdn/hindi.m3u8', referer: 'https://web.nxsha.app/' };

test('the hls level is pinned to 1080p as soon as the manifest is parsed', () => {
    mockManifestLevels = [{ height: 240 }, { height: 360 }, { height: 480 }, { height: 720 }, { height: 1080 }];
    act(() => root.render(<DirectStreamPlayer source={source} title="Test" />));
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();

    const hls = hlsInstances[hlsInstances.length - 1];
    expect(hls).toBeTruthy();
    act(() => mockEmitManifest!(hls));
    // 1080p is level 4 — and it is pinned, not just a starting hint.
    expect(hls.currentLevel).toBe(4);
});

test('without a 1080p level the highest one is pinned', () => {
    mockManifestLevels = [{ height: 240 }, { height: 720 }];
    act(() => root.render(<DirectStreamPlayer source={source} title="Test" />));
    const hls = hlsInstances[hlsInstances.length - 1];
    act(() => mockEmitManifest!(hls));
    expect(hls.currentLevel).toBe(1);
});

test('a fatal network error retries through the same-origin proxy, then falls back', () => {
    const onFallbackMock = jest.fn();
    act(() => root.render(
        <DirectStreamPlayer
            source={source}
            title="Test"
            onFallback={onFallbackMock}
        />,
    ));

    // First fatal network error: one retry wave through /api/stream.
    let hls = hlsInstances[hlsInstances.length - 1];
    act(() => mockEmitError!(hls, { fatal: true, type: 'networkError' }));
    expect(onFallbackMock).not.toHaveBeenCalled();
    expect(hlsInstances.length).toBe(2);
    hls = hlsInstances[hlsInstances.length - 1];
    expect(hls.loadSource).toHaveBeenCalledWith(
        expect.stringContaining('/api/stream?u='),
    );

    // A failure on the proxied source too: the embed takes over.
    act(() => mockEmitError!(hls, { fatal: true, type: 'networkError' }));
    expect(onFallbackMock).toHaveBeenCalled();
});

test('an mp4 source plays directly without hls.js', () => {
    act(() => root.render(
        <DirectStreamPlayer source={{ name: 'GbruHindi', kind: 'mp4', url: 'https://cdn/film.mp4' }} title="Test" />,
    ));
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://cdn/film.mp4');
    expect(hlsInstances).toHaveLength(0);
});

test('the player surfaces the close button and the pinned quality badge', () => {
    mockManifestLevels = [{ height: 240 }, { height: 1080 }];
    const onClose = jest.fn();
    act(() => root.render(<DirectStreamPlayer source={source} title="Test" onClose={onClose} />));
    const hls = hlsInstances[hlsInstances.length - 1];
    act(() => {
        mockEmitManifest!(hls);
        (container.querySelector('video') as HTMLVideoElement).dispatchEvent(new Event('playing'));
    });
    const close = container.querySelector('[aria-label="Close player"]') as HTMLElement;
    expect(close).toBeTruthy();
    expect(container.textContent).toContain('1080p');
    act(() => { close.click(); });
    expect(onClose).toHaveBeenCalled();
});

test('target height is 1080', () => {
    expect(TARGET_HEIGHT).toBe(1080);
});
