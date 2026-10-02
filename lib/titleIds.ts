/**
 * Runtime title → IMDb/TMDB id resolution.
 *
 * The bundled catalog is scraped from JustWatch/Netflix pages, so a large part
 * of it only carries a Netflix id. Nxsha/NHD embeds need an IMDb (tt…) or TMDB
 * id, and without one the UI used to bail out to "Play on Netflix" — which
 * sent people off the site instead of opening our own player.
 *
 * This module resolves the missing id in the client, on demand:
 *   1. TMDB search (only when EXPO_PUBLIC_TMDB_API_KEY is configured).
 *   2. IMDb's public suggestion endpoint (keyless, CORS-enabled) as the
 *      default path.
 *
 * Results are memoised in memory and in localStorage so a title is looked up
 * at most once per device.
 */

export type LookupMediaType = 'movie' | 'tv';

export interface ResolvedTitleIds {
    imdbId?: string;
    tmdbId?: string;
}

export interface ResolveTitleParams {
    title?: string;
    year?: string | number;
    mediaType?: LookupMediaType;
}

const CACHE_PREFIX = 'nxsha:title-ids:v1:';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TIMEOUT_MS = 7000;

const memoryCache = new Map<string, ResolvedTitleIds | null>();
const inflight = new Map<string, Promise<ResolvedTitleIds | null>>();

const TMDB_KEY = (process.env as any)?.EXPO_PUBLIC_TMDB_API_KEY ?? '';

export function normalizeTitle(value?: string | null) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d]/g, '')
        .replace(/\b(season|part)\s+\d+\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function cacheKey(title: string, mediaType: LookupMediaType) {
    return `${CACHE_PREFIX}${mediaType}:${normalizeTitle(title)}`;
}

function readStoredCache(key: string): ResolvedTitleIds | null | undefined {
    try {
        const raw = globalThis?.localStorage?.getItem(key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as { at?: number; ids?: ResolvedTitleIds | null };
        if (!parsed || typeof parsed.at !== 'number') return undefined;
        if (Date.now() - parsed.at > CACHE_TTL_MS) return undefined;
        return parsed.ids ?? null;
    } catch {
        return undefined;
    }
}

function writeStoredCache(key: string, ids: ResolvedTitleIds | null) {
    try {
        globalThis?.localStorage?.setItem(key, JSON.stringify({ at: Date.now(), ids }));
    } catch {
        /* storage unavailable (private mode / native) — memory cache still applies */
    }
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

/* -------------------------------------------------------------------------- */
/*  Same-origin serverless proxy (api/title-id.js on Vercel)                 */
/* -------------------------------------------------------------------------- */

const IS_BROWSER = typeof window !== 'undefined' && typeof window.location !== 'undefined';

async function resolveViaOwnApi(
    title: string,
    mediaType: LookupMediaType,
    year?: number,
): Promise<ResolvedTitleIds | null> {
    if (!IS_BROWSER) return null;
    const params = new URLSearchParams({ title, type: mediaType });
    if (year) params.set('year', String(year));
    const data = await fetchJson(`/api/title-id?${params.toString()}`);
    const imdbId = typeof data?.imdbId === 'string' ? data.imdbId : null;
    return imdbId ? { imdbId } : null;
}

/* -------------------------------------------------------------------------- */
/*  IMDb suggestion API (keyless)                                            */
/* -------------------------------------------------------------------------- */

const IMDB_MOVIE_KINDS = new Set(['movie', 'video', 'tvMovie', 'short', 'tvSpecial']);
const IMDB_TV_KINDS = new Set(['tvSeries', 'tvMiniSeries', 'tvShort']);

export interface ImdbSuggestion {
    id?: string;
    l?: string;
    y?: number;
    q?: string;
    qid?: string;
    rank?: number;
}

/** Pick the suggestion that best matches title + year + media type. */
export function pickImdbSuggestion(
    suggestions: ImdbSuggestion[] | undefined,
    title: string,
    mediaType: LookupMediaType,
    year?: number,
): string | null {
    if (!Array.isArray(suggestions)) return null;
    const wanted = normalizeTitle(title);
    const kinds = mediaType === 'tv' ? IMDB_TV_KINDS : IMDB_MOVIE_KINDS;

    const scored = suggestions
        .filter(item => typeof item?.id === 'string' && /^tt\d+$/.test(item.id as string))
        .map(item => {
            const name = normalizeTitle(item.l);
            let score = 0;
            if (name === wanted) score += 100;
            else if (name.startsWith(wanted) || wanted.startsWith(name)) score += 55;
            else if (name.includes(wanted)) score += 25;

            const kind = item.qid || '';
            if (kinds.has(kind)) score += 30;
            else if (kind) score -= 25;

            if (year && item.y) {
                const diff = Math.abs(item.y - year);
                if (diff === 0) score += 25;
                else if (diff === 1) score += 12;
                else if (diff > 3) score -= 10;
            }

            // Popularity tiebreaker (lower rank = more popular).
            if (typeof item.rank === 'number') score += Math.max(0, 10 - item.rank / 2000);
            return { id: item.id as string, score };
        })
        .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 40) return null;
    return best.id.toLowerCase();
}

async function resolveViaImdb(
    title: string,
    mediaType: LookupMediaType,
    year?: number,
): Promise<ResolvedTitleIds | null> {
    const query = title.trim().toLowerCase().replace(/\s+/g, '%20');
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURI(query)}.json?includeVideos=0`;
    const data = await fetchJson(url);
    const imdbId = pickImdbSuggestion(data?.d, title, mediaType, year);
    return imdbId ? { imdbId } : null;
}

/* -------------------------------------------------------------------------- */
/*  TMDB search (optional, needs a key)                                      */
/* -------------------------------------------------------------------------- */

async function resolveViaTmdb(
    title: string,
    mediaType: LookupMediaType,
    year?: number,
): Promise<ResolvedTitleIds | null> {
    if (!TMDB_KEY) return null;
    const url = new URL(`https://api.themoviedb.org/3/search/${mediaType}`);
    url.searchParams.set('api_key', TMDB_KEY);
    url.searchParams.set('query', title);
    url.searchParams.set('include_adult', 'false');
    if (year) url.searchParams.set(mediaType === 'movie' ? 'year' : 'first_air_date_year', String(year));
    const data = await fetchJson(url.toString());
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) return null;
    const wanted = normalizeTitle(title);
    const exact = results.find(r => normalizeTitle(r.title || r.name) === wanted);
    const best = exact ?? results[0];
    return best?.id ? { tmdbId: String(best.id) } : null;
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolve an embeddable id for a catalog title. Returns `null` when nothing
 * trustworthy is found (callers should then keep their own fallback).
 */
export async function resolveTitleIds({
    title,
    year,
    mediaType = 'movie',
}: ResolveTitleParams): Promise<ResolvedTitleIds | null> {
    const clean = String(title || '').trim();
    if (!clean) return null;

    const key = cacheKey(clean, mediaType);
    if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

    const stored = readStoredCache(key);
    if (stored !== undefined) {
        memoryCache.set(key, stored);
        return stored;
    }

    const existing = inflight.get(key);
    if (existing) return existing;

    const parsedYear = Number.parseInt(String(year ?? '').slice(0, 4), 10);
    const safeYear = Number.isFinite(parsedYear) && parsedYear > 1900 ? parsedYear : undefined;

    const task = (async () => {
        // 1) our own serverless proxy (no CORS risk, edge cached on Vercel)
        let ids = await resolveViaOwnApi(clean, mediaType, safeYear);
        // 2) IMDb's public suggestion endpoint straight from the client
        if (!ids) ids = await resolveViaImdb(clean, mediaType, safeYear);
        // 3) TMDB, when a key is configured
        if (!ids) ids = await resolveViaTmdb(clean, mediaType, safeYear);
        memoryCache.set(key, ids);
        writeStoredCache(key, ids);
        return ids;
    })().finally(() => {
        inflight.delete(key);
    });

    inflight.set(key, task);
    return task;
}

/** Testing helper. */
export function __clearTitleIdCache() {
    memoryCache.clear();
    inflight.clear();
}
