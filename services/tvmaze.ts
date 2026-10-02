/**
 * Keyless live fallback for TV metadata (seasons, episode stills, posters,
 * IMDb id) sourced from TVMaze — https://www.tvmaze.com/api.
 *
 * Why TVMaze and not TMDB here: TMDB requires a server-issued API key that
 * this client bundle does not carry (see services/tmdbEpisodes.ts, used only
 * by the admin tool). TVMaze's public API is free, keyless, rate-limited to
 * a generous 20 req/10s per IP, and explicitly CORS-enabled for direct
 * browser use — so it can safely run from the user's device at runtime for
 * any catalog title whose bundled `data/movies.json` entry is missing
 * season/episode detail (most of the "JustWatch Current TV Shows" shelf).
 *
 * This never replaces baked-in catalog data — it only fills the gap when a
 * title has no usable `seasons`/`tmdb_id`/`imdb_id`, so playback (Nxsha)
 * and the episode list can still resolve to the *correct* show.
 */

const BASE = 'https://api.tvmaze.com';
const REQUEST_TIMEOUT_MS = 10000;

export interface TvMazeEpisode {
    season: number;
    episode: number;
    name: string;
    still_path?: string;
    airdate?: string;
    summary?: string;
}

export interface TvMazeMatch {
    tvMazeId: number;
    name: string;
    premiered?: string;
    poster?: string;
    imdbId?: string;
    episodes: TvMazeEpisode[];
    seasonEpisodeCounts: number[];
}

/** Strip punctuation/casing so "Shaque: Trust No One" ~= "shaque trust no one". */
function normalize(title: string): string {
    return title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function getJson(path: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`TVMaze ${res.status} for ${path}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

function stripHtml(html?: string): string | undefined {
    if (!html) return undefined;
    return html.replace(/<[^>]+>/g, '').trim() || undefined;
}

/**
 * Search TVMaze for the best-matching show for a catalog title.
 * Prefers an exact normalized-name match, then falls back to TVMaze's own
 * relevance ranking (first result), optionally cross-checked against a
 * known release year when several shows share a name.
 */
async function findBestShow(title: string, year?: string): Promise<any | null> {
    if (!title.trim()) return null;
    const results = await getJson(`/search/shows?q=${encodeURIComponent(title)}`);
    if (!Array.isArray(results) || results.length === 0) return null;

    const target = normalize(title);
    const exact = results.filter((r: any) => normalize(r.show?.name ?? '') === target);
    const pool = exact.length ? exact : results;

    if (year) {
        const y = parseInt(year, 10);
        const withYear = pool.find((r: any) => {
            const premiered = r.show?.premiered ? parseInt(r.show.premiered.slice(0, 4), 10) : null;
            return premiered != null && Math.abs(premiered - y) <= 1;
        });
        if (withYear) return withYear.show;
    }
    return pool[0]?.show ?? null;
}

// In-memory per-session cache — avoids refetching the same show when the
// user re-opens a title or taps through "More Like This" repeatedly.
const cache = new Map<string, Promise<TvMazeMatch | null>>();

/**
 * Resolve a show's real seasons/episodes/poster/IMDb id from TVMaze by
 * title (and optional release year for disambiguation). Safe to call
 * speculatively — resolves to `null` on any network/match failure so
 * callers can keep their existing placeholder behaviour.
 */
export function resolveTvMazeShow(title: string, year?: string): Promise<TvMazeMatch | null> {
    const key = `${normalize(title)}|${year ?? ''}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const promise = (async (): Promise<TvMazeMatch | null> => {
        try {
            const show = await findBestShow(title, year);
            if (!show?.id) return null;

            const full = await getJson(`/shows/${show.id}?embed=episodes`);
            const rawEpisodes: any[] = full?._embedded?.episodes ?? [];
            const episodes: TvMazeEpisode[] = rawEpisodes
                .filter(e => typeof e.season === 'number' && typeof e.number === 'number' && e.season > 0)
                .map(e => ({
                    season: e.season,
                    episode: e.number,
                    name: e.name || `Episode ${e.number}`,
                    still_path: e.image?.original || e.image?.medium || undefined,
                    airdate: e.airdate || undefined,
                    summary: stripHtml(e.summary),
                }));

            const seasonEpisodeCounts: number[] = [];
            for (const e of episodes) {
                seasonEpisodeCounts[e.season - 1] = (seasonEpisodeCounts[e.season - 1] ?? 0) + 1;
            }

            return {
                tvMazeId: show.id,
                name: show.name,
                premiered: show.premiered || undefined,
                poster: show.image?.original || show.image?.medium || undefined,
                imdbId: show.externals?.imdb || undefined,
                episodes,
                seasonEpisodeCounts: seasonEpisodeCounts.map(c => c || 0),
            };
        } catch {
            return null;
        }
    })();

    cache.set(key, promise);
    return promise;
}
