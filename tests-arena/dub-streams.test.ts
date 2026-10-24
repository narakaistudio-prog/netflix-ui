// @ts-nocheck — dub streams: server route pehle, phir browser; jhootha switch nahi.
/**
 * Owner (24 Oct, chautha round): *"netmirror par bas option aata hai par koi
 * audio milta hi nahi … sab me likhda hai audio nahi mila"*.
 *
 * Test:
 *   1. `normalizeDubPayload` — sirf asli streams.
 *   2. `resolveDubStreams` — server pehle; fail par browser rasta; dono fail → false.
 *   3. `api/moviebox-play` — `pickPlayStreams` (vip/khali URL drop),
 *      `playAttempts` (1/1 + 0/0 dono), handler (token na mile → no-token,
 *      probe me URLs nahi).
 */
import { normalizeDubPayload, resolveDubStreams } from '../lib/dubStreams';
import handler, {
    canonicalString,
    canonicalUrl,
    clientToken,
    collectMediaUrls,
    pickPlayStreams,
    playAttempts,
    streamsFromSignCookie,
    trSignature,
} from '../api/moviebox-play.mjs';

const SERVER_STREAMS = [{ url: 'https://macdn.hakunaymatata.com/bt/1080.mp4', quality: '1080', kind: 'mp4' }];

describe('normalizeDubPayload (server → DirectStream)', () => {
    it('asli streams leta hai aur duplicate/kharaab hata deta hai', () => {
        const answer = normalizeDubPayload({
            ok: true,
            streams: [
                ...SERVER_STREAMS,
                ...SERVER_STREAMS,
                { url: 'not-a-url', quality: '720' },
                { url: 'https://x.test/a.m3u8', quality: '720' },
            ],
        });
        expect(answer.ok).toBe(true);
        expect(answer.streams).toHaveLength(2);
        expect(answer.streams[1].kind).toBe('hls');
    });

    it('khaali jawab par ok false', () => {
        expect(normalizeDubPayload({ ok: true, streams: [] }).ok).toBe(false);
        expect(normalizeDubPayload(null).ok).toBe(false);
        expect(normalizeDubPayload({ ok: false, reason: 'no-streams' }).reason).toBe('no-streams');
    });
});

describe('resolveDubStreams (server pehle)', () => {
    it('server se streams mile to browser rasta chhua bhi nahi jaata', async () => {
        const calls: string[] = [];
        let clientCalled = 0;
        const answer = await resolveDubStreams(
            { subjectId: '4151920426815471968', detailPath: 'b', se: 1, ep: 1 },
            {
                fetchImpl: (async (url: string) => {
                    calls.push(String(url));
                    return { json: async () => ({ ok: true, streams: SERVER_STREAMS }) };
                }) as any,
                client: (async () => {
                    clientCalled += 1;
                    return { ok: false, streams: [] };
                }) as any,
            },
        );
        expect(answer.ok).toBe(true);
        expect(answer.via).toBe('server');
        expect(answer.streams).toHaveLength(1);
        expect(clientCalled).toBe(0);
        expect(calls[0]).toContain('/api/moviebox-play?');
        expect(calls[0]).toContain('subjectId=4151920426815471968');
        expect(calls[0]).toContain('detailPath=b');
    });

    it('server fail → browser rasta chalta hai (dono jagah asli URL)', async () => {
        const answer = await resolveDubStreams(
            { subjectId: '4151920426815471968', se: 1, ep: 1 },
            {
                fetchImpl: (async () => ({
                    json: async () => ({ ok: false, reason: 'no-streams' }),
                })) as any,
                client: (async () => ({ ok: true, streams: SERVER_STREAMS })) as any,
            },
        );
        expect(answer.ok).toBe(true);
        expect(answer.via).toBe('client');
        expect(answer.trace?.[0]).toContain('server: no-streams');
    });

    it('dono fail → ok false (UI sach bole, jhootha switch nahi)', async () => {
        const answer = await resolveDubStreams(
            { subjectId: '4151920426815471968', se: 1, ep: 1 },
            {
                fetchImpl: (async () => {
                    throw new Error('offline');
                }) as any,
                client: (async () => ({ ok: false, streams: [], reason: 'no-streams' })) as any,
            },
        );
        expect(answer.ok).toBe(false);
        expect(answer.streams).toHaveLength(0);
        expect(answer.trace?.[0]).toContain('offline');
    });

    it('subjectId na ho to koi call nahi', async () => {
        let called = 0;
        const answer = await resolveDubStreams(
            { subjectId: '' },
            {
                fetchImpl: (async () => {
                    called += 1;
                    return { json: async () => ({}) };
                }) as any,
            },
        );
        expect(answer.ok).toBe(false);
        expect(answer.reason).toBe('no-ref');
        expect(called).toBe(0);
    });
});

describe('api/moviebox-play — app signature aur signCookie', () => {
    it('canonicalUrl — path + sorted query', () => {
        expect(canonicalUrl('https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/play-info/v2?se=1&subjectId=42')).toBe(
            '/wefeed-mobile-bff/subject-api/play-info/v2?se=1&subjectId=42',
        );
        expect(canonicalUrl('https://api6.aoneroom.com/x')).toBe('/x');
    });

    it('canonicalString — app ka format (content-type bina charset)', () => {
        const canonical = canonicalString({
            method: 'post',
            url: 'https://api6.aoneroom.com/wefeed-mobile-bff/user-api/visitor-login',
            body: '{}',
            timestampMs: 1700000000000,
        });
        expect(canonical.split('\n')).toEqual([
            'POST',
            'application/json',
            'application/json',
            '2',
            '1700000000000',
            require('node:crypto').createHash('md5').update('{}').digest('hex'),
            '/wefeed-mobile-bff/user-api/visitor-login',
        ]);
    });

    it('trSignature format `ts|2|base64` aur deterministic (body par badalta)', () => {
        const args = {
            method: 'GET',
            url: 'https://api6.aoneroom.com/x?a=1&b=2',
            timestampMs: 1700000000000,
        };
        const one = trSignature(args);
        expect(trSignature(args)).toBe(one);
        expect(one.startsWith('1700000000000|2|')).toBe(true);
        expect(one.split('|')).toHaveLength(3);
        expect(trSignature({ ...args, body: '{}' })).not.toBe(one);
    });

    it('HMAC key 30-byte base64 secret se banti hai (extra byte se nahi)', () => {
        // Asli app key: base64 `76iRl07…` decode = 30 byte. Ek extra byte
        // (`0x12`) jodne par gateway 440 deta tha — isliye ye guard.
        const secret = Buffer.from('76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O', 'base64');
        expect(secret).toHaveLength(30);
        const args = {
            method: 'POST',
            url: 'https://api6.aoneroom.com/wefeed-mobile-bff/user-api/visitor-login',
            body: '{}',
            timestampMs: 1700000000000,
        };
        const expected =
            '1700000000000|2|' +
            require('node:crypto')
                .createHmac('md5', secret)
                .update(canonicalString(args))
                .digest('base64');
        expect(trSignature(args)).toBe(expected);
        expect(trSignature({ ...args, secret: Buffer.concat([secret, Buffer.from([0x12])]) })).not.toBe(expected);
    });

    it('clientToken `<ms>,md5(reverse(ms))`', () => {
        const token = clientToken(1700000000000);
        const [stamp, hash] = token.split(',');
        expect(stamp).toBe('1700000000000');
        expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });

    it('signCookie ka `urlprefix` base64 → asli CDN manifest', () => {
        const base = 'https://sbcdn2.hakunaymatata.com/dash/abc/';
        const cookie = `x=y;urlprefix=${Buffer.from(base).toString('base64')};z=1`;
        const streams = streamsFromSignCookie(cookie);
        expect(streams.map((item) => item.url)).toContain('https://sbcdn2.hakunaymatata.com/dash/abc/index.mpd');
        expect(streamsFromSignCookie('').length).toBe(0);
        expect(streamsFromSignCookie('urlprefix=%%%').length).toBe(0);
    });

    it('collectMediaUrls — nested JSON se sirf asli media URL', () => {
        const streams = collectMediaUrls({
            data: {
                streams: [{ url: 'https://cdn.test/a.mp4' }],
                deeper: { list: ['https://cdn.test/b.m3u8', 'not-a-url', { x: 'https://cdn.test/c.mp4' }] },
                fake: 'https://cdn.test/page.html',
            },
        });
        expect(streams.map((item) => item.url).sort()).toEqual([
            'https://cdn.test/a.mp4',
            'https://cdn.test/b.m3u8',
            'https://cdn.test/c.mp4',
        ]);
    });
});

describe('api/moviebox-play helpers', () => {
    it('pickPlayStreams — vipLocked aur non-media URL drop, MP4 pehle', () => {
        const streams = pickPlayStreams({
            data: {
                streams: [
                    { url: 'https://cdn.test/a.m3u8', resolutions: '720' },
                    { url: 'https://cdn.test/b.mp4', resolution: '1080' },
                    { url: 'https://cdn.test/locked.mp4', vipLocked: true },
                    { url: '/relative.mp4' },
                ],
            },
        });
        expect(streams.map((item) => item.url)).toEqual(['https://cdn.test/b.mp4', 'https://cdn.test/a.m3u8']);
        expect(streams[0].quality).toBe(1080);
        expect(streams[1].kind).toBe('hls');
    });

    it('playAttempts — 1/1 aur 0/0 dono bases par', () => {
        const attempts = playAttempts(['https://p.test/wefeed-h5api-bff', 'https://h5.test/wefeed-h5api-bff'], {
            subjectId: '42',
            detailPath: 'slug',
            se: 1,
            ep: 1,
        });
        const seEp = attempts.map((item) => item.query.match(/se=(-?\d+)&ep=(-?\d+)/)?.slice(1).join(':'));
        expect(seEp).toContain('1:1');
        expect(seEp).toContain('0:0');
        expect(attempts.some((item) => item.query.includes('detailPath=slug'))).toBe(true);
        expect(attempts.some((item) => item.query.includes('streamSignType=1'))).toBe(true);
        expect(attempts.some((item) => item.playMode)).toBe(true);
    });

    it('handler — token na mile to saaf `no-token` (aur probe me URL nahi)', async () => {
        const original = globalThis.fetch;
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({}),
        })) as any;

        const send = (query) => {
            const out = { status: 0, body: null, headers: {}, setHeader() {}, status_(code) { this.status = code; } };
            const res = {
                statusCode: 0,
                body: null,
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                json(payload) {
                    this.body = payload;
                },
            };
            return handler({ query }, res).then(() => res.body || res.body === 0 ? res.body : out.body);
        };

        const body = await send({ subjectId: '4151920426815471968', se: '1', ep: '1' });
        expect(body.ok).toBe(false);
        expect(body.reason).toBe('no-token');

        const probe = await send({ subjectId: '4151920426815471968', probe: '1' });
        expect(probe.ok).toBe(false);
        expect(JSON.stringify(probe)).not.toContain('.mp4');

        const bad = await send({ subjectId: '' });
        expect(bad.reason).toBe('no-ref');

        globalThis.fetch = original;
    });
});
