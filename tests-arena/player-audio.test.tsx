// @ts-nocheck — audio (dub) list: provider ke `dubs[]` se, jhoothe options nahi.
/**
 * Owner: *"mujhe multilanguage dub chahiye tha"*.
 *
 * Provider par har dub apna subject hota hai (runner probe, 24 Oct):
 *   dubs = [{ subjectId, detailPath, lanName: "Hindi dub", lanCode: "hi",
 *             original: false }, …]
 *
 * Test:
 *   1. `normalizeDubs` — label saaf, duplicate hata, original pehle.
 *   2. `normalizeAudioPayload` / `fetchAudioLanguages` — client shape + fail.
 *   3. Handler — subjectId na ho to `not-found`, aur detail se list.
 */
import handler, { normalizeDubs, audioLabel } from '../api/moviebox-audio.mjs';
import { buildDubWatchLink, fetchAudioLanguages, normalizeAudioPayload } from '../lib/movieboxAudio';

const DUBS = [
    { subjectId: '2237794012843369344', detailPath: 'a', lanName: 'Original Audio', lanCode: 'ta', original: true },
    { subjectId: '4151920426815471968', detailPath: 'b', lanName: 'Hindi dub', lanCode: 'hi', original: false },
    { subjectId: '5228019281622882336', detailPath: 'c', lanName: 'Telugu dub', lanCode: 'te', original: false },
    { subjectId: '4151920426815471968', detailPath: 'b', lanName: 'Hindi dub', lanCode: 'hi', original: false },
];

describe('normalizeDubs (provider → app)', () => {
    it('label saaf karta hai aur duplicate subject hata deta hai', () => {
        const list = normalizeDubs(DUBS);
        expect(list).toHaveLength(3);
        expect(list.map((item) => item.name)).toEqual(['Original', 'Hindi', 'Telugu']);
        expect(list.map((item) => item.lang)).toEqual(['ta', 'hi', 'te']);
        expect(list[0].original).toBe(true);
    });

    it('khaali/kharaab entries ignore', () => {
        expect(normalizeDubs(null)).toEqual([]);
        expect(normalizeDubs([{ lanName: 'Hindi dub' }])).toEqual([]);
        expect(audioLabel({ lanName: 'Tamil dub' })).toBe('Tamil');
        expect(audioLabel({ lanName: '' })).toBe('Audio');
        expect(audioLabel({ lanName: '', lanCode: 'kn' })).toBe('KN');
    });
});

describe('client shape (lib/movieboxAudio)', () => {
    it('payload → AudioTrack list; ok sirf jab list ho', () => {
        const result = normalizeAudioPayload({ ok: true, languages: DUBS });
        expect(result.ok).toBe(true);
        expect(result.languages.map((item) => item.subjectId)).toEqual([
            '2237794012843369344',
            '4151920426815471968',
            '5228019281622882336',
        ]);
        expect(normalizeAudioPayload({ ok: true, languages: [] }).ok).toBe(false);
        expect(normalizeAudioPayload(null).ok).toBe(false);
    });

    it('fetchAudioLanguages — same-origin endpoint, fail par khaali list', async () => {
        const calls: string[] = [];
        const answer = await fetchAudioLanguages(
            { subjectId: '4151920426815471968', detailPath: 'b' },
            {
                fetchImpl: async (url: string) => {
                    calls.push(String(url));
                    return { json: async () => ({ ok: true, languages: DUBS }) } as any;
                },
            },
        );
        expect(calls[0]).toContain('/api/moviebox-audio?subjectId=4151920426815471968');
        expect(answer.ok).toBe(true);
        expect(answer.languages).toHaveLength(3);

        const bad = await fetchAudioLanguages(
            { subjectId: '4151920426815471968' },
            {
                fetchImpl: async () => {
                    throw new Error('network');
                },
            },
        );
        expect(bad.ok).toBe(false);
        expect(bad.languages).toEqual([]);
        // subjectId hi nahi → call hi nahi.
        expect((await fetchAudioLanguages({ subjectId: '' })).reason).toBe('not-found');
    });
});

describe('api/moviebox-audio handler', () => {
    function call(query: Record<string, string>) {
        return new Promise((resolve) => {
            const req = { query, headers: {} };
            const res = {
                statusCode: 200,
                headers: {},
                setHeader(name: string, value: string) {
                    this.headers[name] = value;
                },
                status(code: number) {
                    this.statusCode = code;
                    return this;
                },
                json(payload: unknown) {
                    resolve({ status: this.statusCode, body: payload });
                },
            };
            handler(req, res).catch((error) => resolve({ status: 500, body: String(error) }));
        });
    }

    it('subjectId na ho to not-found (dead request nahi)', async () => {
        const result: any = await call({});
        expect(result.body.ok).toBe(false);
        expect(result.body.reason).toBe('not-found');
    });

    it('detail se dubs nikaal kar deta hai (upstream mocked)', async () => {
        const originalFetch = globalThis.fetch;
        const seen: string[] = [];
        globalThis.fetch = (async (url: string) => {
            seen.push(String(url));
            if (String(url).includes('/home')) {
                return {
                    headers: { get: (name: string) => (name === 'x-user' ? JSON.stringify({ token: 't' }) : null) },
                } as any;
            }
            return {
                ok: true,
                json: async () => ({ data: { data: { subject: { dubs: DUBS } } } }),
            } as any;
        }) as any;
        try {
            const result: any = await call({ subjectId: '4151920426815471968', detailPath: 'b' });
            expect(result.body.ok).toBe(true);
            expect(result.body.languages.map((item: any) => item.name)).toEqual(['Original', 'Hindi', 'Telugu']);
            expect(seen.some((url) => url.includes('/detail?subjectId=4151920426815471968'))).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('dub ka watch page (iframe wala rasta)', () => {
    it('subject ke hisaab se MovieBox page — site ke wahi query params', () => {
        const link = buildDubWatchLink({
            lang: 'hi',
            name: 'Hindi',
            subjectId: '4151920426815471968',
            detailPath: 'mandaadi-hindi-qxUx1r3QHW4',
            original: false,
        });
        expect(link).toContain('https://m2box.org/movies/mandaadi-hindi-qxUx1r3QHW4');
        expect(link).toContain('id=4151920426815471968');
        expect(link).toContain('type=/movie/detail');
        expect(buildDubWatchLink(null)).toBeNull();
        expect(buildDubWatchLink({ lang: 'x', name: 'X', subjectId: '', detailPath: 'a', original: false })).toBeNull();
    });
});
