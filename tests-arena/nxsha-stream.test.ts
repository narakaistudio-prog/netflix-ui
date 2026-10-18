// @ts-nocheck — client-side resolve: one same-origin call, proxy fallback,
// null -> embed player.
import {
    isHindiServer,
    pickLevelIndex,
    resolveNxshaStream,
} from '../lib/nxshaStream';

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
        expect(fetchMock.mock.calls[0][0]).toBe('/api/resolve?type=tv&tmdb=1399&imdb=&s=1&e=3');
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
        const second = fetchMock.mock.calls[1][0];
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
