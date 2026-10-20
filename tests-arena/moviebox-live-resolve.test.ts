// @ts-nocheck — client-side live resolver (`lib/movieboxResolve.ts`).
/**
 * Server 2 ka aakhri rasta: catalog me baked link na ho to app
 * `/api/moviebox-resolve` se poochta hai. Ye test wahi behaviour pin karta hai —
 * resolve, 7 din tak cache, miss ka chhota cache, aur galat jawab ka reject.
 */
import { __resetMovieboxResolveCache, resolveMovieboxLive } from '../lib/movieboxResolve';
import { resolveMovieboxLink } from '../lib/movieboxLinks';

const URL_OK =
    'https://m2box.org/movies/vishwanath-and-sons-hindi-AbC123?id=4151920426815471968&type=/movie/detail&detailSe=&detailEp=&lang=en';

const TITLE = { id: 'netflix-genre-1', tmdb_id: '1408162', title: 'Vishwanath & Sons', year: '2026', mediaType: 'movie' };

function mockFetch(payload: any, ok = true) {
    const fn = jest.fn(async () => ({
        ok,
        status: ok ? 200 : 500,
        json: async () => payload,
    }));
    (globalThis as any).fetch = fn;
    return fn;
}

beforeEach(() => {
    __resetMovieboxResolveCache();
    localStorage.clear();
    jest.restoreAllMocks();
});

describe('resolveMovieboxLive', () => {
    it('asks the API for a title the catalog does not have', async () => {
        const fetchMock = mockFetch({
            found: true,
            url: URL_OK,
            subjectId: '4151920426815471968',
            detailPath: 'vishwanath-and-sons-hindi-AbC123',
            title: 'Vishwanath & Sons [Hindi]',
            year: 2026,
            dub: 'hindi',
            score: 0.93,
        });

        const result = await resolveMovieboxLive(TITLE);
        expect(result?.source).toBe('live');
        expect(result?.entry.url).toBe(URL_OK);
        expect(result?.entry.dub).toBe('hindi');

        const called = String(fetchMock.mock.calls[0][0]);
        expect(called).toContain('/api/moviebox-resolve?');
        expect(called).toContain('title=Vishwanath+%26+Sons');
        expect(called).toContain('year=2026');
        expect(called).toContain('type=movie');

        // save ho gaya — sync resolver ko bhi pata hai
        const sync = resolveMovieboxLink(TITLE);
        expect(sync?.link).toBe(URL_OK);
    });

    it('serves the second call from cache (no second network hit)', async () => {
        const fetchMock = mockFetch({ found: true, url: URL_OK, subjectId: '4151920426815471968', detailPath: 'x' });
        await resolveMovieboxLive(TITLE);
        const again = await resolveMovieboxLive(TITLE);
        expect(again?.source).toBe('cache');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('remembers a miss for a while instead of hammering the API', async () => {
        const fetchMock = mockFetch({ found: false, reason: 'no-match' });
        expect(await resolveMovieboxLive(TITLE)).toBeNull();
        expect(await resolveMovieboxLive(TITLE)).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a response that is not a real m2box watch page', async () => {
        mockFetch({ found: true, url: 'https://example.com/watch' });
        expect(await resolveMovieboxLive(TITLE)).toBeNull();
    });

    it('survives a network/API failure', async () => {
        (globalThis as any).fetch = jest.fn(async () => {
            throw new Error('offline');
        });
        expect(await resolveMovieboxLive(TITLE)).toBeNull();
        mockFetch({ found: false }, false);
        expect(await resolveMovieboxLive({ ...TITLE, tmdb_id: '9999' })).toBeNull();
    });

    it('does not mix up two titles that have no catalog ids', async () => {
        const fetchMock = mockFetch({ found: false });
        // Bina id/tmdb_id par `movieboxKeyForTitle` sabke liye `id:` deta hai —
        // cache key title ke slug se banti hai, warna doosri film ka link mil jata.
        await resolveMovieboxLive({ title: 'Koi Anjaan Film', year: '2026' });
        await resolveMovieboxLive({ title: 'Doosri Anjaan Film', year: '2026' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1][0])).toContain('title=Doosri+Anjaan+Film');
    });

    it('does nothing without a title', async () => {
        const fetchMock = mockFetch({ found: true, url: URL_OK });
        expect(await resolveMovieboxLive({ tmdb_id: '1408162' })).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
