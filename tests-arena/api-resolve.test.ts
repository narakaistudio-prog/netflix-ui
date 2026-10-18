// @ts-nocheck — the server-side resolve handler, driven with mocked upstreams.
// Fixtures are sealed with the REAL CryptoJS so the node crypto implementation
// is validated against the exact format nxsha answers with.
import CryptoJS from 'crypto-js';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../api/resolve.js').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('../api/nxsha-crypto.cjs');

const PASS = 'S8x!Jk4ZP1uG8$my';
const sealJson = (payload: unknown) =>
    CryptoJS.AES.encrypt(JSON.stringify(payload), PASS).toString();

function makeRes() {
    const headers = new Map();
    return {
        statusCode: 0,
        body: null as any,
        setHeader: (k: string, v: any) => headers.set(k, v),
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(body: any) {
            this.body = body;
            return this;
        },
    };
}

function call(query: Record<string, string>) {
    const res = makeRes();
    return Promise.resolve(
        handler(
            {
                method: 'GET',
                headers: { origin: 'https://app.example' },
                socket: { remoteAddress: '1.2.3.4' },
                query,
            },
            res,
        ),
    ).then(() => res);
}

const SERVERS_BODY = {
    _hash: sealJson({
        servers: [
            { id: 'mb', scraper: 'mb', name: 'MbPly' },
            { id: 'gbru', scraper: 'gbru', name: 'GbruHindi' },
        ],
    }),
};
const SOURCES_GBRU = {
    _hash: sealJson({
        sources: [
            { type: 'm3u8', url: 'https://cdn/hindi.m3u8', headers: { Referer: 'https://web.nxsha.app/' }, quality: '1080p' },
            { type: 'mp4', url: 'https://cdn/embed.mp4', isEmbed: true },
        ],
    }),
};

function mockUpstream(map: Record<string, any>) {
    return jest.fn(async (url: string) => {
        for (const [needle, body] of Object.entries(map)) {
            if (url.includes(needle)) {
                return { ok: true, status: 200, json: async () => body } as any;
            }
        }
        return { ok: false, status: 503, json: async () => ({}) } as any;
    });
}

afterEach(() => {
    try { delete (global as any).fetch; } catch {}
});

test('resolves the Hindi m3u8: servers + sources over the sealed protocol', async () => {
    const upstream = mockUpstream({
        '/api/servers?q=': SERVERS_BODY,
        '/api/sources?q=': SOURCES_GBRU,
    });
    global.fetch = upstream as any;

    const res = await call({ type: 'tv', tmdb: '1399', s: '1', e: '3' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toMatchObject({
        name: 'GbruHindi',
        kind: 'm3u8',
        url: 'https://cdn/hindi.m3u8',
        referer: 'https://web.nxsha.app/',
        quality: '1080p',
    });
    // The embed-ish mp4 never becomes an alternate.
    expect(res.body.alternates).toHaveLength(1);

    // The sources call went to the HINDI server first, and carried the
    // provider id — without it the API has nothing to answer with.
    const calls = upstream.mock.calls.map((c: any[]) => c[0]);
    const sourcesUrl = calls.find((u: string) => u.includes('/api/sources'));
    const sealed = decodeURIComponent(sourcesUrl.split('q=')[1]);
    const payload = open(sealed);
    expect(payload.provider).toBe('gbru');
    expect(payload.tmdbId).toBe('1399');
    expect(payload.type).toBe('tv');
    // GbruHindi was asked before MbPly despite being second in the list.
    expect(sourcesUrl.length).toBeGreaterThan(0);
    expect(calls.indexOf(sourcesUrl)).toBe(1);
});

test('no direct source anywhere -> ok:false (embed takes over)', async () => {
    global.fetch = mockUpstream({
        '/api/servers?q=': SERVERS_BODY,
        '/api/sources?q=': { _hash: sealJson({ sources: [{ type: 'mp4', url: 'https://cdn/x.mp4', isEmbed: true }] }) },
    }) as any;

    const res = await call({ type: 'movie', tmdb: '550' });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('no-stream');
});

test('an unreachable API stays a 200 with ok:false, never a 5xx to the app', async () => {
    global.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
    }) as any;

    const res = await call({ type: 'movie', tmdb: '550' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
});

test('debug=1 exposes the steps (live diagnostics for the deploy)', async () => {
    global.fetch = mockUpstream({
        '/api/servers?q=': SERVERS_BODY,
        '/api/sources?q=': SOURCES_GBRU,
    }) as any;

    const res = await call({ type: 'tv', tmdb: '1399', debug: '1' });
    expect(res.body.ok).toBe(true);
    const stepNames = res.body.steps.map((s: any) => String(s.step).split(':')[0]);
    expect(stepNames).toContain('servers');
    expect(stepNames).toContain('sources');
    expect(res.body.steps.some((s: any) => s.step === 'servers-list')).toBe(true);
});

test('missing id -> 400', async () => {
    const res = await call({ type: 'movie' });
    expect(res.statusCode).toBe(400);
});

test('WAF 403 on the direct hops -> the profile ladder falls through to a relay and still resolves', async () => {
    // web.nxsha.app behind its WAF answers 403 to the datacenter client; the
    // allorigins relay (different egress, plain client) passes.
    const fetchMock = jest.fn(async (url: string) => {
        if (url.includes('allorigins')) {
            if (url.includes(encodeURIComponent('/api/servers'))) {
                return { ok: true, status: 200, json: async () => SERVERS_BODY } as any;
            }
            if (url.includes(encodeURIComponent('/api/sources'))) {
                return { ok: true, status: 200, json: async () => SOURCES_GBRU } as any;
            }
        }
        if (String(url).startsWith('https://web.nxsha.app/')) {
            return { ok: false, status: 403, json: async () => ({}) } as any;
        }
        return { ok: false, status: 503, json: async () => ({}) } as any;
    });
    global.fetch = fetchMock as any;

    const res = await call({ type: 'movie', tmdb: '550', debug: '1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source.url).toBe('https://cdn/hindi.m3u8');
    // The failing direct attempts are on record for ?debug=1, and the winning
    // hop is labelled with the relay profile.
    const failedAttempts = res.body.steps.filter((s: any) => String(s.step).endsWith('-attempt'));
    expect(failedAttempts.length).toBeGreaterThanOrEqual(3);
    expect(res.body.steps.some((s: any) => s.step === 'servers' && s.profile === 'allorigins')).toBe(true);
});
