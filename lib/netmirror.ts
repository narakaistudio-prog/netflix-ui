/**
 * NetMirror — "net77.cc jaisa" server (client side)
 * =================================================
 * Owner (24 Oct): *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale ya
 * best sidhe ek cloudflare se hi connect kar de"*.
 *
 * NetMirror (net77.cc / net27.cc / net79.cc — Cloudflare par rehta hai) apne
 * REST route se **seedhe MP4 links** deta hai, 360p se 1080p tak:
 *
 *   GET https://net27.cc/api/embed-tmdb/1465943                    (movie)
 *   GET https://net27.cc/api/embed-tmdb/1396?type=tv&s=1&e=1       (tv)
 *
 * Uske JSON par CORS header nahi hota, isliye wo call hamara chhota function
 * karta hai (`api/netmirror.mjs`, same origin) — **video ka koi proxy nahi**:
 * stream CDN se seedha browser tak jaata hai, apne `<video>` me. Isliye koi
 * iframe nahi = koi ad/popup nahi.
 *
 * Ye file pure helpers + client fetch/cache rakhti hai.
 */

import type { DirectStream } from './movieboxDirect';

/** Server ka naam (chip / pill par). */
export const NETMIRROR_LABEL = 'NetMirror';

/** Hamara same-origin resolver (upstream mirrors wahan try hote hain). */
export const NETMIRROR_API_PATH = '/api/netmirror';

/** Jitni der stream URLs theek hain (signed `t=` ~1 ghanta). */
const STREAM_TTL_MS = 12 * 60 * 1000;
/** "Nahi mila" ko itni der yaad rakho — har baar network call na ho. */
const MISS_TTL_MS = 30 * 60 * 1000;
/**
 * v2 — purane cache me `subjectId` nahi tha, isliye **audio (dub) list** kabhi
 * maangi hi nahi jaati thi (owner: "audio dusra nahi aa raha"). Key badalne se
 * purana cache apne aap invalid ho jata hai.
 */
const CACHE_KEY = 'netflix-netmirror-v3';
/** Subtitle SRT → VTT bridge (same-origin). */
export const NETMIRROR_SUBTITLE_PATH = '/api/netmirror-subtitle';
/** Upstream caption URL aksar relative hota hai — isi host par resolve. */
const SUBTITLE_BASE = 'https://net27.cc';
const TIMEOUT_MS = 20000;

export type NetmirrorMediaType = 'movie' | 'tv';

export interface NetmirrorRequest {
    /** Catalog id — `tmdb:1465943`, `1465943`, `movie.tmdb_id`. */
    tmdbId?: string | number | null;
    mediaType: NetmirrorMediaType;
    /** Series par chalu episode. */
    season?: number | null;
    episode?: number | null;
}

export interface NetmirrorResult {
    ok: boolean;
    title?: string;
    streams: DirectStream[];
    captions: Array<{ lang: string; name: string; url: string }>;
    /** MovieBox ke ids (NetMirror usi backend ka front hai) — dub isse milta hai. */
    subjectId?: string;
    detailPath?: string;
    reason?: 'bad-id' | 'not-added' | 'network' | 'rate';
    error?: string;
}

/**
 * `tmdb:1465943` / `1465943` → 1465943; IMDb id (`tt0903747`) reject.
 * Warna NetMirror par bilkul doosri film khul jati.
 */
export function netmirrorTmdbNumber(tmdbId?: string | number | null): number | null {
    if (tmdbId === null || tmdbId === undefined) return null;
    const raw = String(tmdbId).trim();
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    if (/^tt\d+$/.test(lowered) || lowered.startsWith('imdb')) return null;
    const matches = raw.match(/\d+/g);
    if (!matches || matches.length === 0) return null;
    const value = Number(matches[matches.length - 1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.trunc(value);
}

/** Hamare function ka URL (probe=1 → sirf "hai ya nahi", URLs ke bina). */
export function buildNetmirrorQuery(
    { tmdbId, mediaType, season, episode }: NetmirrorRequest,
    options: { probe?: boolean } = {},
): string | null {
    const id = netmirrorTmdbNumber(tmdbId);
    if (!id) return null;
    const params = new URLSearchParams({ tmdb: String(id), type: mediaType === 'tv' ? 'tv' : 'movie' });
    if (mediaType === 'tv') {
        params.set('s', String(Math.max(1, Math.trunc(Number(season) || 1))));
        params.set('e', String(Math.max(1, Math.trunc(Number(episode) || 1))));
    }
    if (options.probe) params.set('probe', '1');
    return `${NETMIRROR_API_PATH}?${params.toString()}`;
}

/** Upstream/hamare function ka jawab → app ka shape (provider-agnostic). */
export function normalizeNetmirrorResult(payload: unknown): NetmirrorResult {
    if (!payload || typeof payload !== 'object') {
        return { ok: false, streams: [], captions: [], reason: 'network', error: 'empty payload' };
    }
    const json = payload as Record<string, any>;
    if (!json.ok) {
        const reason = json.reason === 'not-added' || json.reason === 'bad-id' || json.reason === 'rate'
            ? json.reason
            : 'network';
        return {
            ok: false,
            streams: [],
            captions: [],
            reason,
            error: typeof json.error === 'string' ? json.error : undefined,
        };
    }
    const streams: DirectStream[] = [];
    const seen = new Set<string>();
    const add = (url: unknown, quality: unknown) => {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) return;
        seen.add(url);
        streams.push({ url, quality: String(quality || 'auto'), kind: 'mp4' });
    };
    if (Array.isArray(json.streams)) {
        for (const item of json.streams) add(item?.url, item?.quality ?? item?.resolution);
    }
    streams.sort((a, b) => (Number(b.quality) || 0) - (Number(a.quality) || 0));
    const captions = Array.isArray(json.captions)
        ? json.captions
              .filter((item: any) => item && typeof item.url === 'string')
              .map((item: any) => ({ lang: String(item.lang || ''), name: String(item.name || ''), url: item.url }))
        : [];
    return {
        ok: streams.length > 0,
        streams,
        captions,
        title: typeof json.title === 'string' ? json.title : undefined,
        subjectId: typeof json.subjectId === 'string' ? json.subjectId : undefined,
        detailPath: typeof json.detailPath === 'string' ? json.detailPath : undefined,
        reason: streams.length ? undefined : 'not-added',
    };
}

interface CacheEntry {
    at: number;
    ok: boolean;
    streams: DirectStream[];
    captions: NetmirrorResult['captions'];
    title?: string;
    subjectId?: string;
    detailPath?: string;
    reason?: NetmirrorResult['reason'];
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

function writeCache(next: Cache) {
    memory = next;
    try {
        globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
        // private mode / quota — memory cache hi kaafi hai
    }
}

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
        // bina signal bhi chalega
    }
    return undefined;
}

function cacheKey(request: NetmirrorRequest): string | null {
    const query = buildNetmirrorQuery(request);
    return query;
}

/**
 * Streams lo (cache ke saath).
 *
 * `fetchImpl` injectable hai — tests bina network chalte hain.
 */
export async function fetchNetmirrorStreams(
    request: NetmirrorRequest,
    options: { fetchImpl?: typeof fetch; now?: number; fresh?: boolean } = {},
): Promise<NetmirrorResult> {
    const key = cacheKey(request);
    if (!key) {
        return { ok: false, streams: [], captions: [], reason: 'bad-id', error: 'TMDB id nahi mila' };
    }
    const now = options.now ?? Date.now();
    const cache = readCache();
    const hit = options.fresh ? undefined : cache[key];
    if (hit) {
        const ttl = hit.ok ? STREAM_TTL_MS : MISS_TTL_MS;
        if (now - hit.at < ttl) {
            return {
                ok: hit.ok,
                streams: hit.streams,
                captions: hit.captions,
                title: hit.title,
                subjectId: hit.subjectId,
                detailPath: hit.detailPath,
                reason: hit.reason,
            };
        }
    }

    const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) {
        return { ok: false, streams: [], captions: [], reason: 'network', error: 'fetch nahi hai' };
    }

    let result: NetmirrorResult;
    try {
        const res = await doFetch(key, {
            headers: { Accept: 'application/json' },
            signal: timeoutSignal(TIMEOUT_MS),
        });
        const payload = await res.json();
        result = normalizeNetmirrorResult(payload);
    } catch (error) {
        result = {
            ok: false,
            streams: [],
            captions: [],
            reason: 'network',
            error: String((error as any)?.message || error),
        };
    }

    cache[key] = {
        at: now,
        ok: result.ok,
        streams: result.streams,
        captions: result.captions,
        title: result.title,
        subjectId: result.subjectId,
        detailPath: result.detailPath,
        reason: result.reason,
    };
    writeCache(cache);
    return result;
}

/**
 * Provider ka caption URL → hamara `<track>` URL.
 *
 * Browser ko VTT chahiye, upstream SRT deta hai, aur us host par CORS nahi
 * hota — isliye `api/netmirror-subtitle` (same origin) se guzarte hain. Ye
 * sirf subtitle file ka chhota rasta hai, video ka proxy nahi.
 */
export function buildSubtitleUrl(captionUrl: string): string | null {
    if (!captionUrl) return null;
    let absolute: string;
    try {
        absolute = new URL(captionUrl, SUBTITLE_BASE).toString();
    } catch {
        return null;
    }
    if (!/^https:\/\//i.test(absolute)) return null;
    return `${NETMIRROR_SUBTITLE_PATH}?url=${encodeURIComponent(absolute)}`;
}

export interface NetmirrorSubtitle {
    lang: string;
    name: string;
    url: string;
}

/**
 * `captions[]` → `<track>` list (multi-language), duplicate bhasha ek hi baar.
 * URL resolve na ho to us entry ko chhod dete hain — jhoota option nahi.
 */
export function toSubtitleTracks(
    captions: Array<{ lang?: string; name?: string; url?: string }> | undefined,
): NetmirrorSubtitle[] {
    const seen = new Set<string>();
    const tracks: NetmirrorSubtitle[] = [];
    for (const item of captions || []) {
        const lang = String(item?.lang || '').trim().toLowerCase();
        if (!lang || seen.has(lang)) continue;
        const url = buildSubtitleUrl(String(item?.url || ''));
        if (!url) continue;
        seen.add(lang);
        tracks.push({ lang, name: String(item?.name || lang).trim() || lang, url });
    }
    // English pehle, phir Hindi, phir baaki — jo sabse zyada kaam aate hain.
    const rank = (lang: string) => (lang === 'en' ? 0 : lang === 'hi' ? 1 : 2);
    return tracks.sort((a, b) => rank(a.lang) - rank(b.lang));
}

/** Title is waqt NetMirror par hai ya nahi (halka probe — URLs nahi aate). */
export async function probeNetmirror(
    request: NetmirrorRequest,
    options: { fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
    const query = buildNetmirrorQuery(request, { probe: true });
    if (!query) return false;
    const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return false;
    try {
        const res = await doFetch(query, {
            headers: { Accept: 'application/json' },
            signal: timeoutSignal(12000),
        });
        const payload = await res.json();
        return Boolean(payload?.ok);
    } catch {
        return false;
    }
}
