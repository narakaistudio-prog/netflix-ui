import { __clearTitleMetaCache, resolveTitleMetadata } from '../lib/titleMetadata';
import { __clearTitleIdCache } from '../lib/titleIds';
import { readNxshaPage } from '../api/title-meta.mjs';

const NXSHA_HTML = `
<html><body>
  <a href="https://nxsha.space/dl/tv/215720/1/1">Download</a>
  <img alt="Backdrop" src="https://image.tmdb.org/t/p/w300https://image.tmdb.org/t/p/w1280/wcP3FsRLog4GNEs9PFrDKKQdcof.jpg" />
</body></html>`;

describe('Nxsha-sourced artwork and episodes', () => {
    beforeEach(() => {
        __clearTitleMetaCache();
        __clearTitleIdCache();
        try {
            globalThis.localStorage?.clear();
        } catch {}
    });

    it('reads the TMDb id and backdrop Nxsha resolved for a title', async () => {
        (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => NXSHA_HTML });
        const meta = await readNxshaPage('tv', 'tt27668559');
        expect(meta.tmdbId).toBe('215720');
        expect(meta.banner).toBe('https://image.tmdb.org/t/p/w1280/wcP3FsRLog4GNEs9PFrDKKQdcof.jpg');
        expect(String((globalThis as any).fetch.mock.calls[0][0])).toBe(
            'https://nxsha.space/embed/tv/tt27668559/1/1',
        );
    });

    it('serves banner + episode stills from the title-meta route', async () => {
        const payload = {
            imdbId: 'tt27668559',
            tmdbId: '215720',
            banner: 'https://image.tmdb.org/t/p/w1280/wcP3FsRLog4GNEs9PFrDKKQdcof.jpg',
            seasons: [
                {
                    season_number: 1,
                    name: 'Season 1',
                    episode_count: 2,
                    episodes: [
                        { season: 1, episode: 1, name: 'Episode 1', overview: 'A', still_path: 'https://img/1.jpg', runtime: '77m' },
                        { season: 1, episode: 2, name: 'Episode 2', overview: 'B', still_path: 'https://img/2.jpg', runtime: '89m' },
                    ],
                },
            ],
            seasonEpisodeCounts: [2],
            episodeCount: 2,
        };
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
        (globalThis as any).fetch = fetchMock;

        const meta = await resolveTitleMetadata({ title: 'Queen of Tears', year: '2024', mediaType: 'tv' });
        expect(meta?.banner).toContain('image.tmdb.org');
        expect(meta?.episodeCount).toBe(2);
        expect(meta?.seasons?.[0].episodes[1].still_path).toBe('https://img/2.jpg');
        expect(String(fetchMock.mock.calls[0][0])).toContain('/api/title-meta?type=tv&title=Queen+of+Tears');

        // Cached: a second call must not hit the network again.
        await resolveTitleMetadata({ title: 'Queen of Tears', year: '2024', mediaType: 'tv' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to keyless TVmaze episode art when the route is missing', async () => {
        const fetchMock = jest.fn().mockImplementation((url: string) => {
            const href = String(url);
            if (href.startsWith('/api/title-meta')) {
                return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
            }
            if (href.includes('media-imdb.com')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ d: [{ id: 'tt27668559', l: 'Queen of Tears', qid: 'tvSeries', y: 2024 }] }),
                });
            }
            if (href.includes('tvmaze.com/lookup/shows')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ id: 67633, name: 'Queen of Tears', externals: { imdb: 'tt27668559' }, image: { original: 'https://p.jpg' }, summary: '<p>Hi</p>' }),
                });
            }
            if (href.includes('tvmaze.com/shows/67633/episodes')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ([
                        { season: 1, number: 1, name: 'Episode 1', summary: '<p>One</p>', runtime: 77, image: { original: 'https://still1.jpg' }, airdate: '2024-03-09' },
                        { season: 1, number: 2, name: 'Episode 2', summary: '<p>Two</p>', runtime: 89, image: { original: 'https://still2.jpg' }, airdate: '2024-03-10' },
                    ]),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (globalThis as any).fetch = fetchMock;

        const meta = await resolveTitleMetadata({ title: 'Queen of Tears', year: '2024', mediaType: 'tv' });
        expect(meta?.imdbId).toBe('tt27668559');
        expect(meta?.episodeCount).toBe(2);
        expect(meta?.seasons?.[0].episodes[0].overview).toBe('One');
        expect(meta?.banner).toBe('https://still1.jpg');
    });
});
