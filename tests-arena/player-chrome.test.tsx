// @ts-nocheck — Netflix-jaisa player chrome + multi-language subtitles.
/**
 * Owner: *"player ke controls aisa bnao aur multilanguage hai to wo bhi do"*
 * (Netflix screenshot ke saath).
 *
 * Test:
 *   1. Top bar — back arrow, "You're Watching", Title (Year), server pill.
 *   2. Bottom bar — seek + time, play/pause, ±10s, volume | CC, settings,
 *      fullscreen.
 *   3. CC menu me saari bhashayein (multi-language) + Off; chunne par bridge se
 *      VTT aata hai aur **apne overlay** me cue dikhta hai (native `<track>` ka
 *      style control me nahi tha — isliye hata diya).
 *   4. Audio (dub) section provider ki list se; `onAudioSelect` bulaya jata hai,
 *      na mile to saaf message.
 *   5. Settings me quality + speed; quality badalne par naya stream src.
 *   6. SRT → VTT bridge (api/netmirror-subtitle.mjs) — proxy ke andar se CDN.
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
import { parseVtt, cueAt } from '../lib/subtitles';
import {
    isAllowedSubtitleHost,
    resolveSubtitleTarget,
    srtToVtt,
    srtTimestamp,
} from '../api/netmirror-subtitle.mjs';

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

const VTT = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:05.000 align:start',
    '<c>Hello duniya</c>',
    '',
    '00:02:00.000 --> 00:02:05.000',
    'Doosri line',
    '',
].join('\n');

function mockSubtitleFetch(impl?: () => Promise<any>) {
    const fetchMock = jest.fn(
        impl ?? (async () => ({ ok: true, text: async () => VTT })),
    );
    (globalThis as any).fetch = fetchMock;
    return fetchMock;
}

/** Video ka waqt badal kar `timeupdate` chalao (overlay isi se banta hai). */
function seekVideoTo(video: HTMLVideoElement, seconds: number) {
    Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => seconds,
        set: () => {},
    });
    act(() => {
        video.dispatchEvent(new Event('timeupdate'));
    });
}

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

    it('bhasha chunne par bridge se VTT laata hai aur cue overlay me dikhta hai', async () => {
        const fetchMock = mockSubtitleFetch();
        const video = mount({ captions: toSubtitleTracks(CAPTIONS) });
        act(() => (q('direct-subtitles') as HTMLElement).click());
        await act(async () => {
            (q('subtitle-hi') as HTMLElement).click();
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain('/api/netmirror-subtitle?url=');
        expect(decodeURIComponent(url)).toContain('cacdn.hakunaymatata.com');

        // Video 100s par hai — pehla cue (1–5s) abhi nahi.
        expect(q('direct-subtitle-overlay')).toBeNull();
        // 2s par le jao → cue dikhna chahiye (apne overlay me).
        seekVideoTo(video, 2);
        expect((q('direct-subtitle-overlay') as HTMLElement).textContent).toContain('Hello duniya');
    });

    it('Off chunne par overlay hat jata hai', async () => {
        mockSubtitleFetch();
        const video = mount({ captions: toSubtitleTracks(CAPTIONS) });
        act(() => (q('direct-subtitles') as HTMLElement).click());
        await act(async () => {
            (q('subtitle-en') as HTMLElement).click();
        });
        seekVideoTo(video, 2);
        expect(q('direct-subtitle-overlay')).toBeTruthy();
        act(() => (q('direct-subtitles') as HTMLElement).click());
        act(() => (q('subtitle-off') as HTMLElement).click());
        expect(q('direct-subtitle-overlay')).toBeNull();
    });

    it('subtitle load na ho to saaf batata hai (chup-chaap fail nahi)', async () => {
        mockSubtitleFetch(async () => {
            throw new Error('boom');
        });
        mount({ captions: toSubtitleTracks(CAPTIONS) });
        act(() => (q('direct-subtitles') as HTMLElement).click());
        await act(async () => {
            (q('subtitle-en') as HTMLElement).click();
        });
        expect(container.textContent).toContain('Subtitles load nahi hue');
    });

    it('subtitles na ho to menu saaf-saaf batata hai (jhoothe options nahi)', () => {
        mount();
        act(() => (q('direct-subtitles') as HTMLElement).click());
        expect(container.textContent).toContain('subtitles nahi mile');
        expect(q('subtitle-en')).toBeNull();
    });
});

const AUDIO = [
    { lang: 'ta', name: 'Original', subjectId: '2237794012843369344', detailPath: 'mandaadi-gWLfEvs7jF2', original: true },
    { lang: 'hi', name: 'Hindi', subjectId: '4151920426815471968', detailPath: 'mandaadi-hindi-qxUx1r3QHW4', original: false },
    { lang: 'te', name: 'Telugu', subjectId: '5228019281622882336', detailPath: 'mandaadi-hindi-mNLYleNnce6', original: false },
];

describe('Multi-language audio (dub)', () => {
    it('audio section provider ki list se banti hai aur chunne par callback', async () => {
        const onAudioSelect = jest.fn(async () => true);
        mockSubtitleFetch();
        mount({ audioTracks: AUDIO, activeAudio: AUDIO[0].subjectId, onAudioSelect });
        act(() => (q('direct-audio-subs') as HTMLElement).click());
        expect(q('audio-ta')).toBeTruthy();
        expect(q('audio-hi')).toBeTruthy();
        expect(q('audio-te')).toBeTruthy();
        await act(async () => {
            (q('audio-hi') as HTMLElement).click();
        });
        expect(onAudioSelect).toHaveBeenCalledWith(AUDIO[1]);
        expect(container.textContent).toContain('Audio: Hindi');
    });

    it('us bhasha ka stream na mile to saaf message (jhoothi success nahi)', async () => {
        const onAudioSelect = jest.fn(async () => false);
        mockSubtitleFetch();
        mount({ audioTracks: AUDIO, activeAudio: AUDIO[0].subjectId, onAudioSelect });
        act(() => (q('direct-audio-subs') as HTMLElement).click());
        await act(async () => {
            (q('audio-te') as HTMLElement).click();
        });
        expect(container.textContent).toContain('Telugu audio nahi mila');
    });

    it('audio list na ho to Audio section hi nahi', () => {
        mount();
        act(() => (q('direct-audio-subs') as HTMLElement).click());
        expect(container.textContent).not.toContain('Audio\n');
        expect(q('audio-hi')).toBeNull();
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

    it('proxy URL ke andar se asli CDN nikaalta hai (429 ka ilaaj)', () => {
        const target = resolveSubtitleTarget(
            'https://net27.cc/api/proxy/video?url=' +
                encodeURIComponent('https://cacdn.hakunaymatata.com/subtitle/a.srt?Policy=x&Signature=y'),
        );
        expect(target?.hostname).toBe('cacdn.hakunaymatata.com');
        expect(target?.searchParams.get('Policy')).toBe('x');
        expect(isAllowedSubtitleHost(target)).toBe(true);
        expect(isAllowedSubtitleHost(new URL('https://evil.example/a.srt'))).toBe(false);
        expect(resolveSubtitleTarget('')).toBeNull();
    });

    it('VTT parse: cue id/align ignore, tags saaf, cueAt sahi waqt par', () => {
        const cues = parseVtt(VTT);
        expect(cues).toHaveLength(2);
        expect(cues[0].text).toBe('Hello duniya');
        expect(cues[0].start).toBe(1);
        expect(cues[0].end).toBe(5);
        expect(cueAt(cues, 2)).toBe('Hello duniya');
        expect(cueAt(cues, 100)).toBeNull();
        expect(cueAt(cues, 121)).toBe('Doosri line');
        expect(cueAt([], 2)).toBeNull();
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
