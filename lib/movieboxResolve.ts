/**
 * Live MovieBox resolver (client side)
 * ====================================
 * `data/moviebox-links.json` me ~87% catalog pehle se baked hai. Jo title
 * wahan nahi (naya release, ya search me na mila), uske liye app
 * `/api/moviebox-resolve` se poochta hai — server MovieBox ki API par wahi
 * matching chalata hai jo roz ka harvester chalata hai.
 *
 * Isliye "Server 2" har title par chalta hai aur user ko link paste nahi karna
 * padta. Jawab browser me yaad rakha jata hai (`netflix-moviebox-live-v1`),
 * taaki dobara wahi title kholne par network call na ho.
 */

import { isMovieboxUrl } from './moviebox';
import type { MovieboxCatalogEntry } from './movieboxCatalog';
import { movieboxKeyForTitle, saveMovieboxLink } from './movieboxLinks';

const CACHE_KEY = 'netflix-moviebox-live-v1';
/** Mil gaya to itne din tak dobara mat poochho. */
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Nahi mila to itni der baad dobara try karo (MovieBox par aa sakta hai). */
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

/** Purane Safari par `AbortSignal.timeout` nahi hota — fallback controller. */
function timeoutSignal(ms: number): AbortSignal | undefined {
    try {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(ms);
        }
        if (typeof AbortController === 'function') {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), ms);
            return controller.signal;
        }
    } catch {
        // ignore — bina signal bhi chalega
    }
    return undefined;
}

interface CacheEntry {
    at: number;
    entry: MovieboxCatalogEntry | null;
}

type Cache = Record<string, CacheEntry>;

let memory: Cache | null = null;

function readCache(): Cache {
    if (memory) return memory;
    try {
        const raw = globalThis.localStorage?.getItem(CACHE_KEY);
        memory = raw ? (JSON.parse(raw) as Cache) : {};
    } catch {
        memory = {};
    }
    return memory ?? {};
}

function writeCache(cache: Cache) {
    memory = cache;
    try {
        globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
        // private mode / quota — memory cache hi kaafi hai
    }
}

function slugFor(value: unknown) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Cache key. Pehle title ka apna catalog key (`tmdb:<id>:movie`, ya player ka
 * `linkKey`), warna naam ka slug — kyunki bina id ke `movieboxKeyForTitle`
 * har title ke liye same `id:` deta hai, aur do filmon ka link mil jata.
 */
function cacheKeyFor(
    title: { id?: string | number; tmdb_id?: string | number; title?: string },
    year?: number,
    providedKey?: string,
) {
    const hasId = title.tmdb_id != null ? String(title.tmdb_id).trim() : String(title.id ?? '').trim();
    const base = providedKey || (hasId ? movieboxKeyForTitle(title as any) : `t:${slugFor(title.title)}`);
    return year ? `${base}:${year}` : base;
}

/** Resolve ke dauraan ek hi title ke liye do call na jayein. */
const inFlight = new Map<string, Promise<MovieboxCatalogEntry | null>>();

export function __resetMovieboxResolveCache() {
    memory = {};
    inFlight.clear();
    try {
        globalThis.localStorage?.removeItem(CACHE_KEY);
    } catch {
        // ignore
    }
}

/**
 * Title ka MovieBox link live dhoondho.
 *
 * `source` batata hai link kahan se aaya — `cache` (pehle dhoondha tha) ya
 * `live` (abhi server se). Milne par link `saveMovieboxLink` se bhi save hota
 * hai, isliye `resolveMovieboxLink` (sync) agli baar khud de dega.
 */
export async function resolveMovieboxLive(
    title: {
        id?: string | number;
        tmdb_id?: string | number;
        title?: string;
        year?: string | number;
        mediaType?: string;
    } | null
    | undefined,
    options: { key?: string; storeKey?: string } = {},
): Promise<{ entry: MovieboxCatalogEntry; source: 'cache' | 'live' } | null> {
    if (!title?.title) return null;
    const year = Number(String(title.year ?? '').slice(0, 4)) || undefined;
    const key = cacheKeyFor(title, year, options.key);
    /** `saveMovieboxLink` ki key — player ka `linkKey` (sync resolver isi se padhta hai). */
    const storeKey = options.storeKey || (title.tmdb_id != null || title.id ? movieboxKeyForTitle(title as any) : '');

    const cache = readCache();
    const cached = cache[key];
    if (cached) {
        const ttl = cached.entry ? HIT_TTL_MS : MISS_TTL_MS;
        if (Date.now() - cached.at < ttl) {
            return cached.entry ? { entry: cached.entry, source: 'cache' } : null;
        }
    }

    const existing = inFlight.get(key);
    if (existing) {
        const entry = await existing;
        return entry ? { entry, source: 'live' } : null;
    }

    const task = (async (): Promise<MovieboxCatalogEntry | null> => {
        try {
            const params = new URLSearchParams({
                title: String(title.title),
                ...(year ? { year: String(year) } : {}),
                ...(title.mediaType === 'tv' || title.mediaType === 'movie' ? { type: title.mediaType } : {}),
            });
            const res = await fetch(`/api/moviebox-resolve?${params.toString()}`, {
                headers: { Accept: 'application/json' },
                signal: timeoutSignal(TIMEOUT_MS),
            });
            if (!res.ok) return null;
            const data = (await res.json()) as {
                found?: boolean;
                url?: string;
                subjectId?: string;
                detailPath?: string;
                title?: string;
                year?: number;
                dub?: string;
                hindiAudio?: boolean;
                score?: number;
                tier?: string;
            };
            if (!data?.found || !data.url || !isMovieboxUrl(data.url)) return null;
            const entry: MovieboxCatalogEntry = {
                url: data.url,
                subjectId: String(data.subjectId ?? ''),
                detailPath: String(data.detailPath ?? ''),
                title: data.title,
                year: data.year,
                dub: data.dub,
                hindiAudio: data.hindiAudio,
                score: data.score,
            };
            return entry;
        } catch {
            return null;
        }
    })();

    inFlight.set(key, task);
    try {
        const entry = await task;
        const next = { ...readCache(), [key]: { at: Date.now(), entry } };
        writeCache(next);
        if (entry) {
            // Sync resolver agli baar isi se chale (page reload ke baad bhi).
            if (storeKey) saveMovieboxLink(storeKey, entry.url);
        }
        return entry ? { entry, source: 'live' } : null;
    } finally {
        inFlight.delete(key);
    }
}
