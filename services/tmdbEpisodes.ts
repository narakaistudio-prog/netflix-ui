/**
 * Episode list generator for TV titles — talks directly to TMDB.
 *
 * Requires EXPO_PUBLIC_TMDB_API_KEY to be set (same key used by services/tmdb.ts).
 *
 * Usage:
 *   const seasons = await fetchTmdbSeasons(tmdbId);
 *   const episodes = await fetchTmdbSeasonEpisodes(tmdbId, 2);
 */

const API_KEY = (process.env as any).EXPO_PUBLIC_TMDB_API_KEY ?? '';
const BASE = 'https://api.themoviedb.org/3';

export interface TmdbSeason {
    season_number: number;
    name: string;
    episode_count: number;
    air_date?: string;
    overview?: string;
    poster_path?: string;
}

export interface TmdbEpisode {
    episode_number: number;
    name: string;
    air_date?: string;
    overview?: string;
    still_path?: string;
    runtime?: number;
}

function img(path: string | undefined, size = 'w500'): string {
    return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

async function tmdbGet(path: string): Promise<any> {
    if (!API_KEY) throw new Error('TMDB API key not configured (EXPO_PUBLIC_TMDB_API_KEY)');
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(
        API_KEY,
    )}&language=hi-IN`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`TMDB ${res.status} for ${path}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchTmdbSeasons(tmdbId: string | number): Promise<TmdbSeason[]> {
    const data = await tmdbGet(`/tv/${tmdbId}`);
    const seasons: TmdbSeason[] = Array.isArray(data.seasons) ? data.seasons : [];
    return seasons
        .filter((s: any) => typeof s.season_number === 'number' && s.season_number > 0)
        .map((s: any) => ({
            season_number: s.season_number,
            name: s.name ?? `Season ${s.season_number}`,
            episode_count: s.episode_count ?? 0,
            air_date: s.air_date,
            overview: s.overview,
            poster_path: s.poster_path,
        }));
}

export async function fetchTmdbSeasonEpisodes(
    tmdbId: string | number,
    seasonNumber: number,
): Promise<TmdbEpisode[]> {
    const data = await tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}`);
    const eps: any[] = Array.isArray(data.episodes) ? data.episodes : [];
    return eps
        .filter(e => typeof e.episode_number === 'number' && e.episode_number > 0)
        .map((e: any) => ({
            episode_number: e.episode_number,
            name: e.name ?? `Episode ${e.episode_number}`,
            air_date: e.air_date,
            overview: e.overview,
            still_path: img(e.still_path),
            runtime: e.runtime,
        }));
}

export async function fetchTmdbExternalIds(
    kind: 'movie' | 'tv',
    tmdbId: string | number,
): Promise<{ imdb_id?: string }> {
    try {
        return await tmdbGet(`/${kind}/${tmdbId}/external_ids`);
    } catch {
        return {};
    }
}

export interface GeneratedEpisode {
    season: number;
    episode: number;
    name: string;
    still_path: string;
}

/**
 * Generate a complete episode list for a show, either from TMDB or from a
 * manual "S=N, E=1..M" shorthand (used as a fallback when TMDB is unreachable).
 */
export async function generateEpisodes(
    tmdbId?: string | number,
    manual?: { season: number; episodeCount: number } | null,
): Promise<GeneratedEpisode[]> {
    if (manual && manual.season > 0 && manual.episodeCount > 0) {
        const out: GeneratedEpisode[] = [];
        for (let e = 1; e <= manual.episodeCount; e++) {
            out.push({
                season: manual.season,
                episode: e,
                name: `Episode ${e}`,
                still_path: '',
            });
        }
        return out;
    }
    if (!tmdbId) return [];
    const seasons = await fetchTmdbSeasons(tmdbId);
    const out: GeneratedEpisode[] = [];
    for (const s of seasons) {
        try {
            const eps = await fetchTmdbSeasonEpisodes(tmdbId, s.season_number);
            for (const e of eps) {
                out.push({
                    season: s.season_number,
                    episode: e.episode_number,
                    name: e.name,
                    still_path: e.still_path ?? '',
                });
            }
        } catch {
            // fall back to enumerated placeholders for that season
            for (let i = 1; i <= s.episode_count; i++) {
                out.push({
                    season: s.season_number,
                    episode: i,
                    name: `Episode ${i}`,
                    still_path: '',
                });
            }
        }
    }
    return out;
}
