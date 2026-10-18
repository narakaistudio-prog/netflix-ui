// @ts-nocheck — the direct nxsha stream resolver (1080p player foundation).
// Uses the real crypto-js so the sealed-payload roundtrip is exercised exactly
// the way the nxsha API needs it.
import {
    buildApiUrl,
    decryptResponse,
    encryptPayload,
    isHindiServer,
    pickLevelIndex,
    pickSources,
    resolveNxshaStream,
} from '../lib/nxshaStream';

describe('payload encryption (real AES roundtrip)', () => {
    test('encrypt → decrypt preserves the payload', () => {
        const payload = { tmdbId: '550', type: 'movie', method: 'stream' };
        const sealed = encryptPayload(payload);
        // URL-safe alphabet, no padding — it travels inside a URL query.
        expect(sealed).not.toMatch(/[+/=]/);
        expect(decryptResponse(sealed)).toEqual(payload);
    });

    test('a changed payload does not survive tampering', () => {
        const sealed = encryptPayload({ tmdbId: '550' });
        const tampered = sealed.slice(0, -4) + 'AAAA';
        expect(decryptResponse(tampered)).toBeNull();
        expect(decryptResponse(null)).toBeNull();
        expect(decryptResponse('')).toBeNull();
    });
});

describe('api url', () => {
    test('targets web.nxsha.app with the sealed query', () => {
        const url = buildApiUrl('/api/sources', { tmdbId: '550' });
        expect(url.startsWith('https://web.nxsha.app/api/sources?q=')).toBe(true);
    });
});

describe('pickSources', () => {
    test('keeps direct m3u8/mp4, drops embeds and unknown types', () => {
        const sources = pickSources({
            sources: [
                { type: 'm3u8', url: 'https://cdn/master.m3u8', headers: { Referer: 'https://web.nxsha.app/' } },
                { type: 'mp4', url: 'https://cdn/file.mp4' },
                { type: 'mp4', url: 'https://cdn/embed.mp4', isEmbed: true },
                { type: 'dash', url: 'https://cdn/file.mpd' },
                { type: 'm3u8', url: '' },
                null,
            ],
        });
        expect(sources).toHaveLength(2);
        expect(sources[0]).toMatchObject({ kind: 'm3u8', url: 'https://cdn/master.m3u8', referer: 'https://web.nxsha.app/' });
        expect(sources[1]).toMatchObject({ kind: 'mp4', url: 'https://cdn/file.mp4' });
    });

    test('no sources array -> empty', () => {
        expect(pickSources(null)).toEqual([]);
        expect(pickSources({})).toEqual([]);
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

describe('resolveNxshaStream', () => {
    // The real API returns only an encrypted `_hash` field — mirror that.
    const serversBody = {
        _hash: encryptPayload({
            servers: [
                { id: 'gbru', scraper: 'gbru', name: 'GbruHindi' },
                { id: 'mb', scraper: 'mb', name: 'MbPly' },
            ],
        }),
    };
    const sourcesBody = {
        _hash: encryptPayload({
            sources: [{ type: 'm3u8', url: 'https://cdn/hindi.m3u8', headers: { Referer: 'https://web.nxsha.app/' } }],
        }),
    };

    function mockFetch(handler: (url: string) => { status?: number; body?: any }) {
        return jest.fn(async (url: string) => {
            const hit = handler(url);
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

    test('resolves the Hindi m3u8 and keeps the other server as an alternate', async () => {
        const fetchMock = mockFetch((url) => (url.includes('/api/servers') ? { body: serversBody } : { body: sourcesBody }));
        global.fetch = fetchMock as any;

        const resolved = await resolveNxshaStream({ type: 'tv', tmdbId: '1399', season: 1, episode: 3 });
        expect(resolved).not.toBeNull();
        expect(resolved!.source).toMatchObject({ kind: 'm3u8', url: 'https://cdn/hindi.m3u8', name: 'GbruHindi' });
        // The resolver returns as soon as a direct m3u8 is found (fast Play);
        // the extra server never costs an extra API call.
        expect(resolved!.alternates).toHaveLength(1);
        // Both API calls went to the sealed web.nxsha.app endpoints.
        const called = fetchMock.mock.calls.map((c: any[]) => c[0]);
        expect(called.some((u: string) => u.startsWith('https://web.nxsha.app/api/servers?q='))).toBe(true);
        expect(called.some((u: string) => u.startsWith('https://web.nxsha.app/api/sources?q='))).toBe(true);
    });

    test('a dead API resolves to null (embed player takes over)', async () => {
        global.fetch = mockFetch(() => ({ status: 503 })) as any;
        const resolved = await resolveNxshaStream({ type: 'movie', tmdbId: '550', timeoutMs: 500 });
        expect(resolved).toBeNull();
    });

    test('no playable source anywhere -> null', async () => {
        global.fetch = mockFetch((url) => (
            url.includes('/api/servers')
                ? { body: { servers: [{ id: 'gbru', scraper: 'gbru', name: 'GbruHindi' }] } }
                : { body: { sources: [] } }
        )) as any;
        const resolved = await resolveNxshaStream({ type: 'movie', tmdbId: '550' });
        expect(resolved).toBeNull();
    });

    test('a CORS-blocked API still resolves through the configured proxy', async () => {
        const fetchMock = jest.fn(async (url: string) => {
            if (url.startsWith('https://web.nxsha.app/')) throw new TypeError('Failed to fetch');
            if (url.includes('/api/nxsha-api?p=%2Fapi%2Fservers')) return { ok: true, status: 200, json: async () => serversBody } as any;
            if (url.includes('/api/nxsha-api?p=%2Fapi%2Fsources')) return { ok: true, status: 200, json: async () => sourcesBody } as any;
            throw new TypeError('unexpected ' + url);
        });
        global.fetch = fetchMock as any;

        const resolved = await resolveNxshaStream({
            type: 'movie',
            tmdbId: '550',
            proxyBase: 'https://proxy.example',
            timeoutMs: 2000,
        });
        expect(resolved).not.toBeNull();
        expect(resolved!.source.url).toBe('https://cdn/hindi.m3u8');
        expect(fetchMock.mock.calls.some((c: any[]) => String(c[0]).startsWith('https://proxy.example/api/nxsha-api'))).toBe(true);
    });
});
