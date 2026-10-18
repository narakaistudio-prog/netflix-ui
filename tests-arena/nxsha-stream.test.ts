// @ts-nocheck — client-side resolve: browser tier 0, same-origin call,
// proxy fallback, null -> embed player.
import CryptoJS from 'crypto-js';
import {
    isHindiServer,
    pickLevelIndex,
    resolveNxshaStream,
} from '../lib/nxshaStream';
import { nxshaOpen } from '../lib/nxshaClient';

const PASS = 'S8x!Jk4ZP1uG8$my';
const sealJson = (payload: unknown) =>
    CryptoJS.AES.encrypt(JSON.stringify(payload), PASS)
        .toString()
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

const resolved = {
    ok: true,
    source: { name: 'GbruHindi', kind: 'm3u8', url: 'https://cdn/hindi.m3u8', referer: 'https://web.nxsha.app/' },
    alternates: [{ name: 'MbPly', kind: 'mp4', url: 'https://cdn/fallback.mp4' }],
};

function mockFetch(handler: (url: string) => { status?: number; body?: any } | 'throw') {
    return jest.fn(async (url: string) => {
        const hit = handler(url);
        if (hit === 'throw') throw new TypeError('Failed to fetch');
        return {
            ok: (hit.status ?? 200) === 200,
            status: hit.status ?? 200,
            json: async () => hit.body,
        } as any;
    });
}

afterEach(() => {
    try { delete (global as any).fetch; } catch {}
    jest.restoreAllMocks();
});

describe('resolveNxshaStream', () => {
    test('uses the same-origin /api/resolve endpoint and normalises the result', async () => {
        const fetchMock = mockFetch(() => ({ body: resolved }));
        global.fetch = fetchMock as any;

        const stream = await resolveNxshaStream({ type: 'tv', tmdbId: '1399', season: 1, episode: 3 });
        expect(stream).not.toBeNull();
        expect(stream!.source).toMatchObject({ kind: 'm3u8', url: 'https://cdn/hindi.m3u8' });
        expect(stream!.alternates).toHaveLength(1);
        const resolveCall = fetchMock.mock.calls
            .map((c: any[]) => String(c[0]))
            .find((u: string) => u.startsWith('/api/resolve'));
        expect(resolveCall).toBe('/api/resolve?type=tv&tmdb=1399&imdb=&s=1&e=3');
    });

    test('falls back to the explicit proxy endpoint when same-origin fails', async () => {
        const fetchMock = mockFetch((url) =>
            url.startsWith('/api/resolve') ? { status: 500 } : { body: resolved });
        global.fetch = fetchMock as any;

        const stream = await resolveNxshaStream({
            type: 'movie',
            tmdbId: '550',
            proxyBase: 'https://proxy.example',
        });
        expect(stream).not.toBeNull();
        const second = fetchMock.mock.calls.map((c: any[]) => String(c[0]))
            .find((u: string) => u.startsWith('https://proxy.example/api/resolve'));
        expect(second).toBe('https://proxy.example/api/resolve?type=movie&tmdb=550&imdb=&s=1&e=1');
    });

    test('ok:false answers resolve to null (embed player takes over)', async () => {
        global.fetch = mockFetch(() => ({ body: { ok: false, error: 'no-stream' } })) as any;
        expect(await resolveNxshaStream({ type: 'movie', tmdbId: '550' })).toBeNull();
    });

    test('network failure resolves to null, not a throw', async () => {
        global.fetch = mockFetch(() => 'throw') as any;
        expect(await resolveNxshaStream({ type: 'movie', tmdbId: '550' })).toBeNull();
    });

    test('no ids at all -> null without a network call', async () => {
        const fetchMock = mockFetch(() => ({ body: resolved }));
        global.fetch = fetchMock as any;
        expect(await resolveNxshaStream({ type: 'movie' })).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('pickLevelIndex', () => {
    test('pins the 1080p level', () => {
        expect(pickLevelIndex([240, 360, 480, 720, 1080], 1080)).toBe(4);
    });

    test('falls back to the highest level when 1080p is missing', () => {
        expect(pickLevelIndex([240, 360, 720], 1080)).toBe(2);
    });

    test('no levels at all -> -1', () => {
        expect(pickLevelIndex([], 1080)).toBe(-1);
    });
});

describe('isHindiServer', () => {
    test('matches the Hindi server names', () => {
        expect(isHindiServer('GbruHindi')).toBe(true);
        expect(isHindiServer('VidHindi')).toBe(true);
        expect(isHindiServer('MbPly')).toBe(false);
    });
});


describe('resolveNxshaStream tier 0 — the browser itself', () => {
    test('reads the sealed API cross-origin and resolves without any server hop', async () => {
        const SERVERS = {
            _hash: sealJson({
                servers: [
                    { id: 'mb', scraper: 'mb', name: 'MbPly' },
                    { id: 'gbru', scraper: 'gbru', name: 'GbruHindi' },
                ],
            }),
        };
        const SOURCES = {
            _hash: sealJson({
                sources: [
                    { type: 'm3u8', url: 'https://cdn/hindi.m3u8', headers: { Referer: 'https://web.nxsha.app/' }, quality: '1080p' },
                    { type: 'mp4', url: 'https://cdn/embed.mp4', isEmbed: true },
                ],
            }),
        };
        const fetchMock = jest.fn(async (url: string) => {
            const u = String(url);
            if (u.startsWith('https://web.nxsha.app/api/servers')) {
                return { ok: true, status: 200, text: async () => JSON.stringify(SERVERS) } as any;
            }
            if (u.startsWith('https://web.nxsha.app/api/sources')) {
                return { ok: true, status: 200, text: async () => JSON.stringify(SOURCES) } as any;
            }
            throw new TypeError('unexpected ' + u);
        });
        global.fetch = fetchMock as any;

        const stream = await resolveNxshaStream({ type: 'movie', tmdbId: '550' });
        expect(stream).not.toBeNull();
        expect(stream!.source).toMatchObject({ kind: 'm3u8', url: 'https://cdn/hindi.m3u8', quality: '1080p' });
        // The Hindi server is asked first, and the sealed payload carries the
        // mandatory provider field.
        const sourcesUrl = String(
            fetchMock.mock.calls.map((c: any[]) => String(c[0]))
                .find((u: string) => u.includes('/api/sources')),
        );
        expect(payload_provider(sourcesUrl)).toBe('gbru');
        // No server-side hop happened at all.
        expect(
            fetchMock.mock.calls.some((c: any[]) => String(c[0]).startsWith('/api/resolve')),
        ).toBe(false);
    });

    test('browser tier blocked -> falls through to the same-origin /api/resolve', async () => {
        const fetchMock = jest.fn(async (url: string) => {
            if (String(url).startsWith('https://web.nxsha.app/')) throw new TypeError('Failed to fetch');
            return { ok: true, status: 200, json: async () => resolved } as any;
        });
        global.fetch = fetchMock as any;

        const stream = await resolveNxshaStream({ type: 'movie', tmdbId: '550' });
        expect(stream).not.toBeNull();
        expect(stream!.source.url).toBe('https://cdn/hindi.m3u8');
    });
});

// Seals the provider payload the way the client does so the test can decrypt
// it back out of the `q=` parameter.
function payload_provider(sourcesUrl: string): string {
    const q = sourcesUrl.split('q=')[1];
    const payload = nxshaOpen(decodeURIComponent(q));
    return String(payload.provider);
}
