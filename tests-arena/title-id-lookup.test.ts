import {
    __clearTitleIdCache,
    pickImdbSuggestion,
    resolveTitleIds,
} from '../lib/titleIds';

describe('title → embed id lookup', () => {
    beforeEach(() => {
        __clearTitleIdCache();
        try {
            globalThis.localStorage?.clear();
        } catch {}
    });

    it('picks the matching IMDb suggestion for a movie', () => {
        const id = pickImdbSuggestion(
            [
                { id: 'tt99999999', l: 'Saiyaara Returns', qid: 'movie', y: 2011 },
                { id: 'tt31806037', l: 'Saiyaara', qid: 'movie', y: 2025 },
                { id: 'tt12345678', l: 'Saiyaara', qid: 'podcastSeries', y: 2025 },
            ],
            'Saiyaara',
            'movie',
            2025,
        );
        expect(id).toBe('tt31806037');
    });

    it('prefers series entries when a tv title is requested', () => {
        const id = pickImdbSuggestion(
            [
                { id: 'tt1111111', l: 'Mirzapur', qid: 'movie', y: 2018 },
                { id: 'tt6473300', l: 'Mirzapur', qid: 'tvSeries', y: 2018 },
            ],
            'Mirzapur',
            'tv',
            2018,
        );
        expect(id).toBe('tt6473300');
    });

    it('returns null instead of a wrong title', () => {
        expect(
            pickImdbSuggestion(
                [{ id: 'tt0000001', l: 'Something Completely Different', qid: 'movie', y: 1999 }],
                'Saiyaara',
                'movie',
                2025,
            ),
        ).toBeNull();
    });

    it('uses the same-origin proxy first and caches the result', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ imdbId: 'tt28037987' }),
        });
        (globalThis as any).fetch = fetchMock;

        const first = await resolveTitleIds({ title: 'Saiyaara', year: '2025', mediaType: 'movie' });
        expect(first).toEqual({ imdbId: 'tt28037987' });
        expect(String(fetchMock.mock.calls[0][0])).toContain('/api/title-id?title=Saiyaara');

        const second = await resolveTitleIds({ title: 'Saiyaara', year: '2025', mediaType: 'movie' });
        expect(second).toEqual({ imdbId: 'tt28037987' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to the public IMDb endpoint when the proxy is unavailable', async () => {
        const fetchMock = jest.fn().mockImplementation((url: string) => {
            if (String(url).startsWith('/api/title-id')) {
                return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({ d: [{ id: 'tt28037987', l: 'Saiyaara', qid: 'movie', y: 2025 }] }),
            });
        });
        (globalThis as any).fetch = fetchMock;

        const ids = await resolveTitleIds({ title: 'Saiyaara', year: '2024', mediaType: 'movie' });
        expect(ids).toEqual({ imdbId: 'tt28037987' });
        expect(String(fetchMock.mock.calls[1][0])).toContain('v3.sg.media-imdb.com/suggestion/x/saiyaara');
    });

    it('never throws when the lookup endpoint is unreachable', async () => {
        (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
        await expect(
            resolveTitleIds({ title: 'Some Unknown Title', mediaType: 'tv' }),
        ).resolves.toBeNull();
    });
});
