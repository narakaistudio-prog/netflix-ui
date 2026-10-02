// @ts-nocheck
/**
 * Verifies the keyless TVMaze fallback used by app/movie/[id].tsx:
 *  - resolves real season/episode data + poster + imdb id for a title that
 *    the bundled catalog has no tmdb_id/seasons for
 *  - never calls the network for a title that already has usable data
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { resolveTvMazeShow } from '../services/tvmaze';
import { useTvMazeFallback } from '../hooks/useTvMazeFallback';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SEARCH_RESPONSE = [
    {
        score: 10,
        show: {
            id: 94641,
            name: 'Shaque: Trust No One',
            premiered: '2026-09-24',
            image: { medium: 'https://static.tvmaze.com/m.jpg', original: 'https://static.tvmaze.com/o.jpg' },
            externals: { imdb: 'tt35929525' },
        },
    },
];

const SHOW_WITH_EPISODES = {
    id: 94641,
    name: 'Shaque: Trust No One',
    image: { medium: 'https://static.tvmaze.com/m.jpg', original: 'https://static.tvmaze.com/o.jpg' },
    externals: { imdb: 'tt35929525' },
    _embedded: {
        episodes: [
            { season: 1, number: 1, name: 'Episode 1', image: { original: 'https://static.tvmaze.com/e1.jpg' } },
            { season: 1, number: 2, name: 'Episode 2', image: { original: 'https://static.tvmaze.com/e2.jpg' } },
        ],
    },
};

function mockFetchOnce(data: any) {
    return jest.fn().mockResolvedValue({
        ok: true,
        json: async () => data,
    });
}

describe('resolveTvMazeShow', () => {
    const originalFetch = (globalThis as any).fetch;
    afterEach(() => {
        (globalThis as any).fetch = originalFetch;
        jest.clearAllMocks();
    });

    it('resolves seasons/episodes/poster/imdb id for a title with no catalog metadata', async () => {
        const calls: string[] = [];
        (globalThis as any).fetch = jest.fn((url: string) => {
            calls.push(url);
            if (url.includes('/search/shows')) {
                return Promise.resolve({ ok: true, json: async () => SEARCH_RESPONSE });
            }
            return Promise.resolve({ ok: true, json: async () => SHOW_WITH_EPISODES });
        });

        const match = await resolveTvMazeShow('Shaque: Trust No One — Season 1', '2026');
        expect(match).not.toBeNull();
        expect(match!.imdbId).toBe('tt35929525');
        expect(match!.poster).toBe('https://static.tvmaze.com/o.jpg');
        expect(match!.episodes).toHaveLength(2);
        expect(match!.episodes[0].still_path).toBe('https://static.tvmaze.com/e1.jpg');
        expect(calls[0]).toContain('/search/shows');
        expect(calls[1]).toContain('/shows/94641');
    });

    it('returns null without throwing when TVMaze has no match', async () => {
        (globalThis as any).fetch = mockFetchOnce([]);
        const match = await resolveTvMazeShow('Some Totally Unknown Show Title 12345');
        expect(match).toBeNull();
    });
});

describe('useTvMazeFallback', () => {
    const originalFetch = (globalThis as any).fetch;
    afterEach(() => {
        (globalThis as any).fetch = originalFetch;
        jest.clearAllMocks();
    });

    function Harness({ movie, isSeries, onResult }: any) {
        const result = useTvMazeFallback(movie, isSeries);
        onResult(result);
        return null;
    }

    it('skips the network entirely for a movie (non-series)', async () => {
        (globalThis as any).fetch = jest.fn();
        const container = document.createElement('div');
        const root = createRoot(container);
        let last: any;
        await act(async () => {
            root.render(
                <Harness
                    movie={{ id: 'm1', title: 'Some Movie', mediaType: 'movie' }}
                    isSeries={false}
                    onResult={(r: any) => { last = r; }}
                />,
            );
        });
        expect((globalThis as any).fetch).not.toHaveBeenCalled();
        expect(last.loading).toBe(false);
        act(() => root.unmount());
    });

    it('skips the network for a series that already has usable season/episode data', async () => {
        (globalThis as any).fetch = jest.fn();
        const container = document.createElement('div');
        const root = createRoot(container);
        let last: any;
        await act(async () => {
            root.render(
                <Harness
                    movie={{
                        id: 'tv1',
                        title: 'Chumbak',
                        mediaType: 'tv',
                        tmdb_id: '313172',
                        seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1, episodes: [{ season: 1, episode: 1, name: 'Ep 1' }] }],
                    }}
                    isSeries
                    onResult={(r: any) => { last = r; }}
                />,
            );
        });
        expect((globalThis as any).fetch).not.toHaveBeenCalled();
        act(() => root.unmount());
    });
});
