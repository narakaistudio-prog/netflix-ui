// @ts-nocheck — Netflix-jaisa player chrome + multi-language subtitles.
/**
 * Owner: *"player ke controls aisa bnao aur multilanguage hai to wo bhi do"*
 * (Netflix screenshot ke saath).
 *
 * Test:
 *   1. Top bar — back arrow, "You're Watching", Title (Year), server pill.
 *   2. Bottom bar — seek + time, play/pause, ±10s, volume | CC, settings,
 *      fullscreen.
 *   3. CC menu me saari bhashayein (multi-language) + Off; chunne par iframe ke
 *      `<video>` par `<track>` lag jata hai.
 *   4. Settings me quality + speed; quality badalne par naya stream src.
 *   5. SRT → VTT bridge (api/netmirror-subtitle.mjs) — timestamp sahi.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});

import { MovieboxDirectPlayer } from '../components/MovieboxDirectPlayer';
import { buildSubtitleUrl, toSubtitleTracks } from '../lib/netmirror';
import { srtToVtt, srtTimestamp } from '../api/netmirror-subtitle.mjs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const STREAMS = [
    { url: 'https://cdn.example/1080.mp4', quality: '1080', kind: 'mp4' },
    { url: 'https://cdn.example/480.mp4', quality: '480', kind: 'mp4' },
];

const CAPTIONS = [
    { lang: 'hi', name: 'हिन्दी', url: '/api/proxy/video?url=https%3A%2F%2Fcacdn.hakunaymatata.com%2Fsubtitle%2Fhi.srt' },
    { lang: 'en', name: 'English', url: '/api/proxy/video?url=https%3A%2F%2Fcacdn.hakunaymatata.com%2Fsubtitle%2Fen.srt' },
    { lang: 'ta', name: 'தமிழ்', url: '/api/proxy/video?url=https%3A%2F%2Fcacdn.hakunaymatata.com%2Fsubtitle%2Fta.srt' },
];

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

function mount(extra: Record<string, unknown> = {}) {
    act(() =>
        root.render(
            <MovieboxDirectPlayer
                streams={STREAMS}
                title="Vishwanath & Sons"
                year={2026}
                onUnavailable={() => {}}
                {...extra}
            />,
        ),
    );
    const video = document.querySelector('video[data-m2box="direct-video"]') as HTMLVideoElement;
    if (video) {
        Object.defineProperty(video, 'duration', { configurable: true, get: () => 7200 });
        Object.defineProperty(video, 'currentTime', { configurable: true, value: 100, writable: true });
        Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
        video.play = () => Promise.resolve();
    }
    return video;
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('Netflix-jaisa chrome', () => {
    it('top bar: back, "You\'re Watching", Title (Year)', () => {
        mount({ onBack: () => {} });
        const text = container.textContent || '';
        expect(q('direct-back')).toBeTruthy();
        expect(text).toContain("You're Watching");
        expect(text).toContain('Vishwanath & Sons (2026)');
        expect(q('direct-audio-subs')).toBeTruthy();
        expect(q('direct-fullscreen-top')).toBeTruthy();
    });

    it('bottom bar: seek, time, play/pause, ±10s, volume, CC, settings, fullscreen', () => {
        mount();
        ['direct-seek', 'direct-time', 'direct-play-pause', 'direct-back-10', 'direct-forward-10',
         'direct-mute', 'direct-subtitles', 'direct-settings', 'direct-fullscreen'].forEach((id) => {
            expect(q(id)).toBeTruthy();
        });
        // Duration metadata aane se pehle `--:--` — format hamesha wahi rehta hai.
        expect((q('direct-time') as HTMLElement).textContent).toMatch(/^\d+:\d{2} \/ /);
    });

    it('server pill sirf tab jab agla server ho', () => {
        mount();
        expect(q('direct-switch-server')).toBeNull();
        act(() => root.unmount());
        root = createRoot(container);
        mount({ nextServerName: 'Nxsha', onSwitchServer: () => {} });
        expect(q('direct-switch-server')).toBeTruthy();
    });
});

describe('Multi-language subtitles (CC)', () => {
    it('CC menu me saari bhashayein + Off dikhti hain', () => {
        mount({ captions: toSubtitleTracks(CAPTIONS) });
        act(() => (q('direct-subtitles') as HTMLElement).click());
        expect(q('direct-menu-subtitles')).toBeTruthy();
        expect(q('subtitle-off')).toBeTruthy();
        expect(q('subtitle-en')).toBeTruthy();
        expect(q('subtitle-hi')).toBeTruthy();
        expect(q('subtitle-ta')).toBeTruthy();
    });

    it('bhasha chunne par video par <track> lag jata hai (VTT bridge URL)', () => {
        mount({ captions: toSubtitleTracks(CAPTIONS) });
        act(() => (q('direct-subtitles') as HTMLElement).click());
        act(() => (q('subtitle-hi') as HTMLElement).click());
        const track = document.querySelector('video track') as HTMLTrackElement;
        expect(track).toBeTruthy();
        expect(track.getAttribute('srclang')).toBe('hi');
        const src = track.getAttribute('src') || '';
        expect(src).toContain('/api/netmirror-subtitle?url=');
        expect(decodeURIComponent(src)).toContain('cacdn.hakunaymatata.com');
    });

    it('Off chunne par koi track nahi rehta', () => {
        mount({ captions: toSubtitleTracks(CAPTIONS) });
        act(() => (q('direct-subtitles') as HTMLElement).click());
        act(() => (q('subtitle-en') as HTMLElement).click());
        expect(document.querySelector('video track')).toBeTruthy();
        act(() => (q('direct-subtitles') as HTMLElement).click());
        act(() => (q('subtitle-off') as HTMLElement).click());
        expect(document.querySelector('video track')).toBeNull();
    });

    it('subtitles na ho to menu saaf-saaf batata hai (jhoothe options nahi)', () => {
        mount();
        act(() => (q('direct-subtitles') as HTMLElement).click());
        expect(container.textContent).toContain('subtitles nahi mile');
        expect(q('subtitle-en')).toBeNull();
    });
});

describe('Settings — quality aur speed', () => {
    it('quality list streams se banti hai; chunne par src badal jata hai', () => {
        mount();
        expect(q('quality-auto')).toBeNull();
        act(() => (q('direct-settings') as HTMLElement).click());
        expect(q('quality-auto')).toBeTruthy();
        expect(q('quality-1080')).toBeTruthy();
        expect(q('quality-480')).toBeTruthy();

        act(() => (q('quality-480') as HTMLElement).click());
        const video = document.querySelector('video[data-m2box="direct-video"]') as HTMLVideoElement;
        expect(video.getAttribute('src') || video.src).toContain('480.mp4');
    });

    it('speed list hai aur chunne par playbackRate set hota hai', () => {
        mount();
        const video = document.querySelector('video[data-m2box="direct-video"]') as HTMLVideoElement;
        act(() => (q('direct-settings') as HTMLElement).click());
        expect(q('speed-1.5')).toBeTruthy();
        act(() => (q('speed-1.5') as HTMLElement).click());
        expect(video.playbackRate).toBe(1.5);
    });
});

describe('Subtitle helpers', () => {
    it('NetMirror captions → tracks (English pehle, duplicate bhasha ek hi)', () => {
        const tracks = toSubtitleTracks([...CAPTIONS, CAPTIONS[1]]);
        expect(tracks.map((t) => t.lang)).toEqual(['en', 'hi', 'ta']);
        expect(tracks.every((t) => t.url.startsWith('/api/netmirror-subtitle?url='))).toBe(true);
    });

    it('relative caption URL bhi absolute ban jata hai', () => {
        const url = buildSubtitleUrl('/api/proxy/video?url=x');
        expect(url).toContain(encodeURIComponent('https://net27.cc/api/proxy/video?url=x'));
        expect(buildSubtitleUrl('')).toBeNull();
    });

    it('SRT timestamps → VTT (comma → dot, hours 2-digit)', () => {
        expect(srtTimestamp('00:01:02,500')).toBe('00:01:02.500');
        expect(srtTimestamp('01:02,5')).toBe('00:01:02.500');
        expect(srtTimestamp('kuch bhi')).toBeNull();
    });

    it('poori file: index hata, WEBVTT header, cues wahi', () => {
        const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nDuniya\r\n';
        const vtt = srtToVtt(srt);
        expect(vtt.startsWith('WEBVTT')).toBe(true);
        expect(vtt).toContain('00:00:01.000 --> 00:00:02.500');
        expect(vtt).toContain('Duniya');
        expect(vtt).not.toContain('\r');
        // Pehle se VTT ho to chhed-chhaad nahi.
        expect(srtToVtt('WEBVTT\n\n00:0.000 --> 00:1.000\nx')).toContain('WEBVTT');
    });
});
