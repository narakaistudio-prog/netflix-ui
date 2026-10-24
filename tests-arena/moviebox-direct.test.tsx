// @ts-nocheck — jest harness (jsdom): asli player ke gestures yahan chalte hain.
/**
 * MovieBox ±10s bina proxy — do hisse:
 *   1. `lib/movieboxDirect.ts` ke pure helpers (stream chunna, cache, token)
 *   2. `MovieboxDirectPlayer` ke gestures asli jsdom me (double-tap ±10s)
 *
 * Sab fetch/headers stub hain — koi network nahi.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});

import { createHash } from 'node:crypto';

import {
    MOVIEBOX_H5,
    clientToken,
    getGuestToken,
    pickStreams,
    playAttempts,
    resolveDirectStreams,
} from '../lib/movieboxDirect';
import { MovieboxDirectPlayer, pickPlayableStream } from '../components/MovieboxDirectPlayer';
import { MOVIEBOX_SKIP_SECONDS, seekMovieboxBy } from '../lib/movieboxSeekBridge';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------- stubs ------------------------------- */

function res(body: any, headers: Record<string, string> = {}) {
    return {
        ok: true,
        status: 200,
        headers: { get: (key: string) => headers[key.toLowerCase()] ?? headers[key] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

const PLAY_BODY = {
    code: 0,
    data: {
        streams: [
            { url: 'https://cdn.example.com/a/1080.mp4?sign=1', resolutions: '1080' },
            { url: 'https://cdn.example.com/a/720.mp4?sign=1', resolutions: '720' },
            { url: '', resolutions: '480' },
            { url: 'https://example.com/not-media', resolutions: '480' },
            { url: 'https://cdn.example.com/vip.mp4', resolutions: '2160', vipLocked: true },
        ],
        hls: ['https://cdn.example.com/a/master.m3u8'],
    },
};

const store = () => {
    const map = new Map<string, string>();
    return {
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        setItem: (key: string, value: string) => void map.set(key, value),
        map,
    };
};

/* ------------------------------ helpers ------------------------------ */

describe('pickStreams', () => {
    it('sirf asli media URLs, MP4 pehle, VIP-locked aur khaali drop', () => {
        const streams = pickStreams(PLAY_BODY);
        expect(streams.map((s) => s.url)).toEqual([
            'https://cdn.example.com/a/1080.mp4?sign=1',
            'https://cdn.example.com/a/720.mp4?sign=1',
            'https://cdn.example.com/a/master.m3u8',
        ]);
        expect(streams[0].kind).toBe('mp4');
        expect(streams[0].quality).toBe(1080);
        expect(streams[2].kind).toBe('hls');
        // koi banana nahi — vipLocked aur non-media URL nahi aaye
        expect(streams.some((s) => /vip/.test(s.url))).toBe(false);
    });

    it('khaali / kharab payload par kuch nahi', () => {
        expect(pickStreams(null)).toEqual([]);
        expect(pickStreams({})).toEqual([]);
        expect(pickStreams({ data: { streams: [] } })).toEqual([]);
    });
});

describe('pickPlayableStream', () => {
    const mp4 = { url: 'https://c/a.mp4', quality: 1080, kind: 'mp4' as const };
    const hls = { url: 'https://c/a.m3u8', quality: 1080, kind: 'hls' as const };

    it('MP4 hamesha', () => {
        expect(pickPlayableStream([mp4, hls], () => '')).toBe(mp4);
    });

    it('HLS sirf jab browser natively de (Chrome me nahi → iframe fallback)', () => {
        expect(pickPlayableStream([hls], () => '')).toBeNull();
        expect(pickPlayableStream([hls], (type) => (type.includes('mpegurl') ? 'maybe' : ''))).toBe(hls);
    });
});

describe('resolveDirectStreams (bina proxy, seedha API)', () => {
    it('token `x-user` header se, phir play se streams', async () => {
        const calls: string[] = [];
        const fetchImpl = async (url: string) => {
            calls.push(String(url));
            if (String(url).includes('/home?')) {
                return res({}, { 'x-user': JSON.stringify({ token: 'guest-1' }) });
            }
            if (String(url).includes('get-domain')) return res({ code: 0, data: 'mzfi.me' });
            if (String(url).includes('/subject/play')) return res(PLAY_BODY);
            return res({});
        };

        const result = await resolveDirectStreams(
            { subjectId: '123456789', se: 1, ep: 2 },
            { fetchImpl, store: store() },
        );

        expect(result.ok).toBe(true);
        expect(result.streams.length).toBe(3);
        expect(result.playerHost).toBe('mzfi.me');
        expect(calls[0]).toContain(MOVIEBOX_H5);
        // play player-domain (get-domain) par gaya, h5 par nahi
        expect(calls.some((u) => u.startsWith('https://mzfi.me/wefeed-h5api-bff/subject/play'))).toBe(true);
    });

    it('link se hi subjectId/season/episode nikalta hai (paste kiya hua link)', async () => {
        const urls: string[] = [];
        const fetchImpl = async (url: string) => {
            urls.push(String(url));
            if (String(url).includes('/home?')) return res({}, { 'x-user': '{"token":"t"}' });
            if (String(url).includes('get-domain')) return res({ data: 'mzfi.me' });
            return res(PLAY_BODY);
        };
        await resolveDirectStreams(
            {
                link: 'https://m2box.org/movies/demo-hindi-AbC123?id=8598850449111924848&detailSe=2&detailEp=7',
            },
            { fetchImpl, store: store() },
        );
        const play = urls.find((u) => u.includes('/subject/play'))!;
        expect(play).toContain('subjectId=8598850449111924848');
        expect(play).toContain('se=2');
        expect(play).toContain('ep=7');
        expect(play).toContain('detailPath=demo-hindi-AbC123');
    });

    it('streams khaali → ok:false (parent iframe par chala jayega)', async () => {
        const fetchImpl = async (url: string) => {
            if (String(url).includes('/home?')) return res({}, { 'x-user': '{"token":"t"}' });
            if (String(url).includes('get-domain')) return res({ data: 'mzfi.me' });
            return res({ code: 0, data: { streams: [], hls: [], hasResource: false } });
        };
        const result = await resolveDirectStreams({ subjectId: '1' }, { fetchImpl, store: store() });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('no-streams');
        expect(result.streams).toEqual([]);
    });

    it('token na mile to network call aage nahi badhta', async () => {
        const fetchImpl = async (url: string) => {
            if (String(url).includes('/home?')) return res({}, {});
            throw new Error('aage nahi jana chahiye');
        };
        const result = await resolveDirectStreams({ subjectId: '1' }, { fetchImpl, store: store() });
        expect(result).toEqual({ ok: false, streams: [], reason: 'no-token' });
    });

    it('dusri baar cache se — koi network call nahi', async () => {
        const local = store();
        let calls = 0;
        const fetchImpl = async (url: string) => {
            calls += 1;
            if (String(url).includes('/home?')) return res({}, { 'x-user': '{"token":"t"}' });
            if (String(url).includes('get-domain')) return res({ data: 'mzfi.me' });
            return res(PLAY_BODY);
        };
        await resolveDirectStreams({ subjectId: '42' }, { fetchImpl, store: local });
        const before = calls;
        const again = await resolveDirectStreams({ subjectId: '42' }, { fetchImpl, store: local });
        expect(again.ok).toBe(true);
        expect(calls).toBe(before);
    });

    it('reference na ho to turant no-ref', async () => {
        const result = await resolveDirectStreams({ link: 'kuch bhi nahi' }, { fetchImpl: async () => res({}) });
        expect(result.reason).toBe('no-ref');
    });
});

/* ------------------------------ player ------------------------------ */

describe('MovieboxDirectPlayer (jsdom)', () => {
    let container: HTMLDivElement;
    let root: Root;

    const VIDEO_STREAM = [{ url: 'https://cdn.example.com/a/1080.mp4', quality: 1080, kind: 'mp4' as const }];

    function bootVideo() {
        const video = document.querySelector('video[data-m2box="direct-video"]') as HTMLVideoElement;
        let time = 100;
        Object.defineProperty(video, 'currentTime', {
            configurable: true,
            get: () => time,
            set: (value: number) => {
                time = value;
            },
        });
        Object.defineProperty(video, 'duration', { configurable: true, get: () => 3600 });
        Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
        video.play = () => Promise.resolve();
        video.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        return { video, time: () => time };
    }

    const tap = (target: Element, x: number, y: number) =>
        target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('koi button nahi — sirf video', () => {
        act(() => {
            root.render(<MovieboxDirectPlayer streams={VIDEO_STREAM} onUnavailable={() => {}} />);
        });
        expect(document.querySelectorAll('button').length).toBe(0);
        expect(document.querySelector('video[data-m2box="direct-video"]')).toBeTruthy();
    });

    it('double-tap left = −10s, right = +10s', () => {
        act(() => {
            root.render(<MovieboxDirectPlayer streams={VIDEO_STREAM} onUnavailable={() => {}} />);
        });
        const { time } = bootVideo();
        const host = document.querySelector('[data-testid="moviebox-direct-video"]')!;

        tap(host, 20, 110);
        expect(time()).toBe(100); // ek tap sirf ginti hai
        tap(host, 22, 112);
        expect(time()).toBe(90);

        tap(host, 380, 110);
        tap(host, 382, 110);
        expect(time()).toBe(100);
    });

    it('HLS-only (Chrome) par turant iframe fallback', () => {
        const onUnavailable = jest.fn();
        act(() => {
            root.render(
                <MovieboxDirectPlayer
                    streams={[{ url: 'https://cdn.example.com/a/master.m3u8', quality: 1080, kind: 'hls' }]}
                    onUnavailable={onUnavailable}
                />,
            );
        });
        expect(onUnavailable).toHaveBeenCalledWith('unsupported-format');
    });

    it('video error par parent ko batao (iframe par wapas)', () => {
        const onUnavailable = jest.fn();
        act(() => {
            root.render(<MovieboxDirectPlayer streams={VIDEO_STREAM} onUnavailable={onUnavailable} />);
        });
        act(() => {
            document
                .querySelector('video[data-m2box="direct-video"]')!
                .dispatchEvent(new Event('error'));
        });
        expect(onUnavailable).toHaveBeenCalledWith('media-error');
    });
});

describe('X-Client-Token (site ka formula, browser me)', () => {
    it('md5(reverse(sec)) — site ke formula se bilkul match', () => {
        for (const now of [1792784187927, 1792780000000, 1700000000123]) {
            const sec = String(Math.floor(now / 1000));
            const expected = `${sec},${createHash('md5').update(sec.split('').reverse().join('')).digest('hex')}`;
            expect(clientToken(now)).toBe(expected);
        }
    });
});

describe('playAttempts (movie bhi se=1/ep=1 — 0/0 par API hasResource:false deti hai)', () => {
    it('pehla attempt wahi jo maanga, phir 1/1 aur 0/0 — dono bases par', () => {
        const attempts = playAttempts(['https://player/wefeed-h5api-bff', 'https://h5/wefeed-h5api-bff'], {
            subjectId: '123',
            detailPath: 'demo-AbC',
            se: 0,
            ep: 0,
        });
        const queries = attempts.map((a) => a.query);
        expect(queries[0]).toContain('se=0&ep=0');
        expect(queries.some((q) => q.includes('se=1&ep=1'))).toBe(true);
        expect(attempts.filter((a) => a.base.includes('player')).length).toBeGreaterThan(0);
        expect(attempts.filter((a) => a.base.includes('h5')).length).toBeGreaterThan(0);
        // streamSignType wale pehle
        expect(queries[0]).toContain('streamSignType=1');
    });

    it('series ke asli se/ep 1/1 dobara try nahi hote (duplicate nahi)', () => {
        const attempts = playAttempts(['https://p'], { subjectId: '9', se: 2, ep: 5 });
        const coords = attempts.map((a) => a.query.match(/se=\d+&ep=\d+/)[0]);
        expect(new Set(coords)).toEqual(new Set(['se=2&ep=5', 'se=0&ep=0']));
    });
});

describe('resolveDirectStreams ke extra raste', () => {
    it('0/0 par khaali, 1/1 par streams — movie bhi chal jaye', async () => {
        const seen: string[] = [];
        const fetchImpl = async (url: string) => {
            seen.push(String(url));
            if (String(url).includes('/home?')) return res({}, { 'x-user': '{"token":"t"}' });
            if (String(url).includes('get-domain')) return res({ data: 'mzfi.me' });
            // Sirf se=1&ep=1 par asli jawab (jaise site ka watch page bhejta hai)
            if (/se=1&ep=1/.test(String(url))) return res(PLAY_BODY);
            return res({ code: 0, data: { streams: [], hls: [], hasResource: false } });
        };
        const trace: string[] = [];
        const result = await resolveDirectStreams(
            { subjectId: '555', se: 0, ep: 0 },
            { fetchImpl, store: store(), trace },
        );
        expect(result.ok).toBe(true);
        expect(result.streams.length).toBe(3);
        expect(seen.some((u) => u.includes('se=1&ep=1'))).toBe(true);
        expect(trace.some((line) => line.includes('streams'))).toBe(true);
    });

    it('sab attempts fail → no-streams + trace me reason', async () => {
        const fetchImpl = async (url: string) => {
            if (String(url).includes('/home?')) return res({}, { 'x-user': '{"token":"t"}' });
            if (String(url).includes('get-domain')) return res({ data: 'mzfi.me' });
            return res({ code: 0, data: { streams: [], hls: [], hasResource: false, limitedCode: '' } });
        };
        const trace: string[] = [];
        const result = await resolveDirectStreams({ subjectId: '7' }, { fetchImpl, store: store(), trace });
        expect(result.reason).toBe('no-streams');
        expect(trace.length).toBeGreaterThan(3);
        expect(trace.join(' | ')).toContain('hasResource false');
    });
});

describe('−10s / +10s buttons (owner ke screenshot wali jagah)', () => {
    let container: HTMLDivElement;
    let root: Root;

    function bootVideo() {
        const video = document.querySelector('video[data-m2box="direct-video"]') as HTMLVideoElement;
        let time = 100;
        Object.defineProperty(video, 'currentTime', {
            configurable: true,
            get: () => time,
            set: (value: number) => {
                time = value;
            },
        });
        Object.defineProperty(video, 'duration', { configurable: true, get: () => 3600 });
        Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
        video.play = () => Promise.resolve();
        return { video, time: () => time };
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('player bridge register karta hai — buttons se ±10s hota hai', () => {
        act(() => {
            root.render(
                <MovieboxDirectPlayer
                    streams={[{ url: 'https://cdn.example.com/a/1080.mp4', quality: 1080, kind: 'mp4' }]}
                    onUnavailable={() => {}}
                />,
            );
        });
        const { time } = bootVideo();

        let back = false;
        let forward = false;
        act(() => {
            back = seekMovieboxBy(-MOVIEBOX_SKIP_SECONDS);
        });
        expect(back).toBe(true);
        expect(time()).toBe(90);
        act(() => {
            forward = seekMovieboxBy(MOVIEBOX_SKIP_SECONDS);
        });
        expect(forward).toBe(true);
        expect(time()).toBe(100);
        // Wahi toast jo double-tap par aata hai — button par bhi feedback.
        expect(document.body.textContent).toContain('+10s');
    });

    it('unmount ke baad button kuch nahi karta (dead button nahi)', () => {
        act(() => {
            root.render(
                <MovieboxDirectPlayer
                    streams={[{ url: 'https://cdn.example.com/a/1080.mp4', quality: 1080, kind: 'mp4' }]}
                    onUnavailable={() => {}}
                />,
            );
        });
        act(() => root.unmount());
        expect(seekMovieboxBy(-10)).toBe(false);
        // Dobara mount karne ke liye naya root
        root = createRoot(container);
    });
});

describe('phone screen (source)', () => {
    const read = (path: string) => require('node:fs').readFileSync(require('node:path').join(process.cwd(), path), 'utf8');

    it('dead ±10s buttons hata diye — wo kabhi chal hi nahi sakte the', () => {
        // Owner: "agar button chalta hi nhi hai usme to konsa kaam ka hta de
        // usse". MovieBox ki API guest ko stream deti hi nahi (probe se
        // verify), aur cross-origin iframe ka `currentTime` chhua nahi ja
        // sakta — isliye do dhundhle bekaar button rakhne ka koi matlab nahi.
        const modal = read('components/MovieList/MovieDetailModal.tsx');
        expect(modal).not.toContain('phone-skip-back');
        expect(modal).not.toContain('phone-skip-forward');
        expect(modal).not.toContain('seekMovieboxBy');
        expect(modal).not.toContain('phoneSkip');
        // Player ke andar wala invisible double-tap bana hua hai (jab stream
        // asli me mile to wahi ±10s karta hai).
        const player = read('components/MovieboxDirectPlayer.tsx');
        expect(player).toContain('registerMovieboxSeek');
        expect(player).toContain('seekBy(');
    });
});
