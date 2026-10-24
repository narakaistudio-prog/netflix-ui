// @ts-nocheck — NetMirror server: REST route, normalize, cache, player, chip.
/**
 * Owner (24 Oct): *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale"*.
 *
 * NetMirror (net77.cc / net27.cc / net79.cc) ka `GET /api/embed-tmdb/{id}`
 * seedhe MP4 links deta hai (360–1080). Us JSON par CORS nahi hota, isliye app
 * apne same-origin `api/netmirror` se poochhti hai — video ka proxy nahi.
 *
 * Jo test hota hai:
 *   1. Upstream URL shape (movie vs tv — `type=tv&s=&e=` lazmi).
 *   2. Asli jawab ka normalize (1080 pehle) + "abhi add nahi hua" case.
 *   3. Client cache — dobara network call nahi.
 *   4. Player: streams aaye to `<video>` ka src, na aaye to Nxsha fallback.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});
jest.mock('../components/MovieboxDirectPlayer', () => {
    const ReactLocal = require('react');
    return {
        MovieboxDirectPlayer: ({ streams }: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'direct-video',
                'data-src': streams?.[0]?.url || '',
                'data-quality': streams?.[0]?.quality || '',
            }),
    };
});

import {
    buildNetmirrorQuery,
    fetchNetmirrorStreams,
    netmirrorTmdbNumber,
    normalizeNetmirrorResult,
} from '../lib/netmirror';
import { NetmirrorPlayer } from '../components/NetmirrorPlayer';
import { buildServerCycle } from '../lib/playbackServers';
// eslint-disable-next-line import/extensions
import { buildUpstreamUrl, normalizeNetmirror, tmdbNumber } from '../api/netmirror.mjs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Runner-probe (24 Oct) se asli jawab ka chhota hissa. */
const MANDAADI = {
    ok: true,
    tmdbId: 1465943,
    title: 'Mandaadi',
    year: '2026',
    type: 'movie',
    mode: 'proxy',
    mp4: 'https://bcdnxw.hakunaymatata.com/bt/8a30.mp4?sign=aa&t=1',
    resolution: '480',
    streams: [
        { url: 'https://bcdnxw.hakunaymatata.com/convert-h264/8e5.mp4?sign=b&t=2', resolution: 360, size: 1 },
        { url: 'https://bcdnxw.hakunaymatata.com/bt/8a30.mp4?sign=aa&t=1', resolution: 480, size: 2 },
        { url: 'https://bcdnxw.hakunaymatata.com/cms/47c9.mp4?sign=c&t=3', resolution: 1080, size: 3 },
    ],
    captions: [{ lang: 'en', name: 'English', url: '/api/proxy/video?url=x' }],
};

const NOT_ADDED = {
    ok: true,
    tmdbId: 1441228,
    title: 'Irumudi',
    mode: 'none',
    noSource: true,
    error: 'This title is still being added to NetMirror. Please check back in a bit.',
};

describe('NetMirror — id + URL shape', () => {
    it('TMDB id nikalta hai, IMDb id reject karta hai', () => {
        expect(netmirrorTmdbNumber('tmdb:1465943')).toBe(1465943);
        expect(netmirrorTmdbNumber(1396)).toBe(1396);
        expect(netmirrorTmdbNumber('tt0903747')).toBeNull();
        expect(netmirrorTmdbNumber('')).toBeNull();
        expect(tmdbNumber('tmdb:1465943')).toBe(1465943);
        expect(tmdbNumber('tt0903747')).toBeNull();
    });

    it('movie par simple route, tv par type/s/e lazmi', () => {
        expect(buildUpstreamUrl('https://net27.cc', { tmdb: 1465943, type: 'movie' })).toBe(
            'https://net27.cc/api/embed-tmdb/1465943',
        );
        expect(buildUpstreamUrl('https://net27.cc', { tmdb: 1396, type: 'tv', season: 2, episode: 5 })).toBe(
            'https://net27.cc/api/embed-tmdb/1396?type=tv&s=2&e=5',
        );
    });

    it('app ka query: same-origin function, probe alag', () => {
        expect(buildNetmirrorQuery({ tmdbId: 'tmdb:1465943', mediaType: 'movie' })).toBe(
            '/api/netmirror?tmdb=1465943&type=movie',
        );
        expect(buildNetmirrorQuery({ tmdbId: 1396, mediaType: 'tv', season: 1, episode: 2 })).toBe(
            '/api/netmirror?tmdb=1396&type=tv&s=1&e=2',
        );
        expect(buildNetmirrorQuery({ tmdbId: 1396, mediaType: 'tv' }, { probe: true })).toContain('probe=1');
        expect(buildNetmirrorQuery({ tmdbId: 'tt0903747', mediaType: 'movie' })).toBeNull();
    });
});

describe('NetMirror — jawab normalize', () => {
    it('server side: 1080 pehle, duplicate URL ek hi baar', () => {
        const result = normalizeNetmirror(MANDAADI);
        expect(result.ok).toBe(true);
        expect(result.streams.map((s) => s.quality)).toEqual(['1080', '480', '360']);
        expect(result.streams.every((s) => s.kind === 'mp4')).toBe(true);
        expect(result.captions[0]).toMatchObject({ lang: 'en', name: 'English' });
    });

    it('server side: "abhi add nahi hua" → not-added (dead button nahi)', () => {
        const result = normalizeNetmirror(NOT_ADDED);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('not-added');
    });

    it('client side bhi wahi shape samajhta hai', () => {
        const normalized = normalizeNetmirrorResult(MANDAADI);
        expect(normalized.ok).toBe(true);
        expect(normalized.streams[0].quality).toBe('1080');
        expect(normalizeNetmirrorResult(NOT_ADDED).reason).toBe('not-added');
        expect(normalizeNetmirrorResult(null).ok).toBe(false);
    });

    it('streams khaali par `mp4` field se kaam chalta hai', () => {
        const result = normalizeNetmirror({ ok: true, streams: [], mp4: 'https://x/y.mp4', resolution: '720' });
        expect(result.ok).toBe(true);
        expect(result.streams[0].quality).toBe('720');
    });
});

describe('NetMirror — server cycle', () => {
    it('title NetMirror par ho to cycle me aata hai (MovieBox se pehle)', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: true,
            netmirrorAvailable: true,
        });
        expect(cycle).toContain('netmirror');
        expect(cycle.indexOf('netmirror')).toBeLessThan(cycle.indexOf('moviebox'));
    });

    it('MovieBox link na ho par NetMirror ho to [Server 1 → NetMirror]', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: false,
            netmirrorAvailable: true,
        });
        expect(cycle).toEqual(['nxsha', 'netmirror']);
    });

    it('NetMirror par na ho to cycle me jagah hi nahi (dead button nahi)', () => {
        const cycle = buildServerCycle({ defaultProvider: 'nxsha', movieboxAvailable: true });
        expect(cycle).not.toContain('netmirror');
    });
});

describe('NetMirror — client cache', () => {
    it('doosri baar network call nahi', async () => {
        window.localStorage.clear();
        let calls = 0;
        const fetchImpl: any = async () => {
            calls += 1;
            return { json: async () => MANDAADI };
        };
        const first = await fetchNetmirrorStreams({ tmdbId: 1465943, mediaType: 'movie' }, { fetchImpl });
        const second = await fetchNetmirrorStreams({ tmdbId: 1465943, mediaType: 'movie' }, { fetchImpl });
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(calls).toBe(1);
    });

    it('id na ho to network hi nahi', async () => {
        let calls = 0;
        const fetchImpl: any = async () => {
            calls += 1;
            return { json: async () => MANDAADI };
        };
        const result = await fetchNetmirrorStreams({ tmdbId: 'tt0903747', mediaType: 'movie' }, { fetchImpl });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('bad-id');
        expect(calls).toBe(0);
    });
});

describe('NetmirrorPlayer', () => {
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

    it('streams milte hain to apna <video> (koi iframe nahi)', () => {
        act(() =>
            root.render(
                <NetmirrorPlayer
                    tmdbId={1465943}
                    mediaType="movie"
                    title="Mandaadi"
                    initialStreams={[
                        { url: 'https://cdn.example/1080.mp4', quality: '1080', kind: 'mp4' },
                    ]}
                />,
            ),
        );
        const video = container.querySelector('[data-testid="direct-video"]') as HTMLElement;
        expect(video).toBeTruthy();
        expect(video.getAttribute('src') ?? video.getAttribute('data-src')).toBe('https://cdn.example/1080.mp4');
        expect(container.querySelector('iframe')).toBeNull();
    });

    it('kuch na mile to Nxsha fallback button (dead screen nahi)', () => {
        const onUnavailable = jest.fn();
        act(() =>
            root.render(
                <NetmirrorPlayer
                    tmdbId={'tt0903747'}
                    mediaType="movie"
                    title="Breaking Bad"
                    onUnavailable={onUnavailable}
                />,
            ),
        );
        const button = container.querySelector('[data-testid="netmirror-fallback"]') as HTMLElement;
        expect(button).toBeTruthy();
        act(() => button.click());
        expect(onUnavailable).toHaveBeenCalled();
    });
});
