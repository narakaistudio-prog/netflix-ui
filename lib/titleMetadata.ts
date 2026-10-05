/**
 * Client access to the artwork + episode metadata our Nxsha embed is based on.
 *
 * Nxsha plays by TMDb/IMDb id and draws its own banner from TMDB, so the app
 * asks `/api/title-meta` (see api/title-meta.mjs) for exactly that chain:
 * the resolved id, the backdrop Nxsha itself shows, and the real episode list
 * with stills — so the S/E we hand to the embed always matches what is listed.
 *
 * When the serverless route is unavailable (Expo dev server, native build),
 * we degrade to the keyless browser-side lookups: IMDb suggestion for the id
 * and TVmaze for episode art.
 */

import { resolveTitleIds } from '@/lib/titleIds';

export interface TitleEpisode {
    season: number;
    episode: number;
    name: string;
    overview?: string;
    still_path?: string;
    runtime?: string;
    air_date?: string;
}

export interface TitleSeason {
    season_number: number;
    name: string;
    episode_count: number;
    episodes: TitleEpisode[];
}

export interface TitleMetadata {
    imdbId?: string;
    tmdbId?: string;
    banner?: string;
    poster?: string;
    description?: string;
    year?: string;
    seasons?: TitleSeason[];
    seasonEpisodeCounts?: number[];
    episodeCount?: number;
}

export interface TitleMetadataQuery {
    title?: string;
    year?: string | number;
    mediaType?: 'movie' | 'tv';
    imdbId?: string;
    tmdbId?: string;
}

const CACHE_PREFIX = 'nxsha:title-meta:v1:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 9000;

const memoryCache = new Map<string, TitleMetadata | null>();
const inflight = new Map<string, Promise<TitleMetadata | null>>();

const IS_BROWSER = typeof window !== 'undefined' && typeof window.location !== 'undefined';

function normalize(value?: string | null) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function stripHtml(value?: string) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchJson(url: string): Promise<any | null> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    try {
        const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function readCache(key: string): TitleMetadata | null | undefined {
    try {
        const raw = globalThis?.localStorage?.getItem(key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as { at?: number; meta?: TitleMetadata | null };
        if (!parsed || typeof parsed.at !== 'number') return undefined;
        if (Date.now() - parsed.at > CACHE_TTL_MS) return undefined;
        return parsed.meta ?? null;
    } catch {
        return undefined;
    }
}

function writeCache(key: string, meta: TitleMetadata | null) {
    try {
        globalThis?.localStorage?.setItem(key, JSON.stringify({ at: Date.now(), meta }));
    } catch {
        /* quota or no storage — memory cache still applies */
    }
}

function buildSeasons(episodes: TitleEpisode[]): Pick<TitleMetadata, 'seasons' | 'seasonEpisodeCounts' | 'episodeCount'> {
    const grouped = new Map<number, TitleEpisode[]>();
    for (const episode of episodes) {
        if (!grouped.has(episode.season)) grouped.set(episode.season, []);
        grouped.get(episode.season)!.push(episode);
    }
    const seasons = [...grouped.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([season_number, list]) => ({
            season_number,
            name: `Season ${season_number}`,
            episode_count: list.length,
            episodes: list.sort((a, b) => a.episode - b.episode),
        }));
    const seasonEpisodeCounts = seasons.map(season => season.episode_count);
    return {
        seasons,
        seasonEpisodeCounts,
        episodeCount: seasonEpisodeCounts.reduce((total, count) => total + count, 0),
    };
}

/** Keyless browser fallback: TVmaze episode art (CORS enabled). */
async function tvmazeFallback(title: string, imdbId?: string): Promise<TitleMetadata | null> {
    let show = imdbId ? await fetchJson(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`) : null;
    if (!show?.id) {
        show = await fetchJson(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`);
        if (!show?.name || normalize(show.name) !== normalize(title)) return null;
    }
    const list = await fetchJson(`https://api.tvmaze.com/shows/${show.id}/episodes`);
    if (!Array.isArray(list) || !list.length) return null;

    const episodes: TitleEpisode[] = list
        .filter((episode: any) => episode?.season > 0 && episode?.number > 0)
        .map((episode: any) => ({
            season: episode.season,
            episode: episode.number,
            name: episode.name || `Episode ${episode.number}`,
            overview: stripHtml(episode.summary),
            still_path: episode.image?.original || episode.image?.medium || undefined,
            runtime: episode.runtime ? `${episode.runtime}m` : undefined,
            air_date: episode.airdate || undefined,
        }));
    if (!episodes.length) return null;

    const grouped = buildSeasons(episodes);
    return {
        imdbId: show.externals?.imdb || imdbId,
        poster: show.image?.original || undefined,
        banner: episodes[0]?.still_path,
        description: stripHtml(show.summary) || undefined,
        ...grouped,
    };
}

/**
 * Resolve banner + episode metadata for a catalog title. Returns `null` when
 * nothing could be resolved; callers keep their bundled values in that case.
 */
export async function resolveTitleMetadata(query: TitleMetadataQuery): Promise<TitleMetadata | null> {
    const title = String(query.title || '').trim();
    const mediaType = query.mediaType === 'tv' ? 'tv' : 'movie';
    const identity = query.imdbId || query.tmdbId || normalize(title);
    if (!identity) return null;

    const key = `${CACHE_PREFIX}${mediaType}:${identity}`;
    if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

    const stored = readCache(key);
    if (stored !== undefined) {
        memoryCache.set(key, stored);
        return stored;
    }

    const existing = inflight.get(key);
    if (existing) return existing;

    const task = (async (): Promise<TitleMetadata | null> => {
        let meta: TitleMetadata | null = null;

        if (IS_BROWSER) {
            const params = new URLSearchParams({ type: mediaType });
            if (title) params.set('title', title);
            if (query.year) params.set('year', String(query.year));
            if (query.imdbId) params.set('imdb', query.imdbId);
            if (query.tmdbId) params.set('tmdb', query.tmdbId);
            const data = await fetchJson(`/api/title-meta?${params.toString()}`);
            if (data && !data.error && (data.imdbId || data.tmdbId || data.banner || data.seasons)) {
                meta = data as TitleMetadata;
            }
        }

        if (!meta) {
            // No serverless route (dev server / native): resolve what we can
            // from keyless endpoints the browser may call directly.
            const ids = query.imdbId || query.tmdbId
                ? { imdbId: query.imdbId, tmdbId: query.tmdbId }
                : await resolveTitleIds({ title, year: query.year, mediaType }).catch(() => null);
            const fallback = mediaType === 'tv' && title
                ? await tvmazeFallback(title, ids?.imdbId)
                : null;
            if (ids || fallback) meta = { ...(fallback || {}), ...(ids || {}) , ...(fallback ? {
                seasons: fallback.seasons,
                seasonEpisodeCounts: fallback.seasonEpisodeCounts,
                episodeCount: fallback.episodeCount,
                banner: fallback.banner,
                poster: fallback.poster,
                description: fallback.description,
            } : {}) };
        }

        memoryCache.set(key, meta);
        writeCache(key, meta);
        return meta;
    })().finally(() => inflight.delete(key));

    inflight.set(key, task);
    return task;
}

/** Testing helper. */
export function __clearTitleMetaCache() {
    memoryCache.clear();
    inflight.clear();
}
