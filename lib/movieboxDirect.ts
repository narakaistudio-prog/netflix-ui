/**
 * MovieBox ka stream **seedha browser me** — koi proxy nahi.
 * ===========================================================
 * Owner: "koi safe tarika dekho bina koi proxy lagaye" (page proxy ne video
 * tod diya tha — PR #91 revert).
 *
 * Ye file poori tarah **client-side** hai. Kuch bhi hamare server se nahi guzarta:
 *
 *   1. guest token   GET  h5-api.aoneroom.com/wefeed-h5api-bff/home
 *                    → token `x-user` response header me (API origin reflect
 *                      karti hai + `access-control-expose-headers: *`, CI probe
 *                      se verify — docs/m2box-direct-player.md)
 *   2. player host   GET  .../media-player/get-domain        (rotates)
 *   3. streams       GET  {player}/wefeed-h5api-bff/subject/play?subjectId&se&ep&detailPath
 *                    → `streams[] {url, resolutions, size}` / `hls[]` / `dash[]`
 *   4. playback      `<video src=…>` — CDN par ACAO nahi hota, par media element
 *                    playback ko CORS chahiye hi nahi (Range/206 chal jaata hai).
 *
 * Isi liye video **hamare paas** aa jata hai: ±10s double-tap, resume, progress —
 * sab bina iframe ke. Kuch bhi na mile to player seedha purane cropped iframe
 * par gir jata hai (`MovieboxPagePlayer`), yaani koi regression nahi.
 *
 * Sab kuch injectable hai (`fetchImpl`, `storage`) — tests bina network chalte
 * hain.
 */

import { parseMovieboxInput, type MovieboxRef } from './moviebox';

export const MOVIEBOX_H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
/** Player domain kabhi-kabhi `get-domain` se aata hai; ye fallback hai. */
export const MOVIEBOX_PLAYER_FALLBACK = 'https://mzfi.me/wefeed-h5api-bff';
export const MOVIEBOX_HOST = 'moviebox.ph';

/** Token itni der tak theek (site khud ~45 min maanti hai). */
const TOKEN_TTL_MS = 30 * 60 * 1000;
/** Signed stream URLs ghante bhar chalte hain — thoda kam par refresh. */
const STREAM_TTL_MS = 20 * 60 * 1000;
const TOKEN_KEY = 'netflix-moviebox-token-v1';
const STREAM_KEY = 'netflix-moviebox-stream-v1';

export interface DirectStream {
    url: string;
    /** 1080 / 720 / 480 — jaisa API ne diya. */
    quality: number | string;
    kind: 'mp4' | 'hls' | 'dash';
}

export interface DirectResult {
    ok: boolean;
    streams: DirectStream[];
    /** Kyun nahi mila — UI me sirf debug ke liye. */
    reason?: 'no-ref' | 'no-token' | 'no-streams' | 'region' | 'network';
    playerHost?: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

function defaultStorage(): StorageLike {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
}

function readJson<T>(store: StorageLike, key: string): T | null {
    try {
        const raw = store?.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function writeJson(store: StorageLike, key: string, value: unknown): void {
    try {
        store?.setItem(key, JSON.stringify(value));
    } catch {
        // private mode / quota — memory cache hi kaafi hai
    }
}

/** `javascript:` / `blob:` jaisa kuch bhi nahi — sirf asli media URL. */
export function isMediaUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (!/^https?:\/\//i.test(value)) return false;
    return /\.(mp4|m3u8|mpd)(\?|#|$)/i.test(value) || /\/(hls|dash)\//i.test(value);
}

function kindOf(url: string): DirectStream['kind'] {
    if (/\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url)) return 'hls';
    if (/\.mpd(\?|#|$)/i.test(url) || /\/dash\//i.test(url)) return 'dash';
    return 'mp4';
}

/**
 * `/subject/play` ke jawab se streams. Sirf jo sach me hai — koi URL banaya
 * nahi jata. `vipLocked`/khaali url wale drop.
 */
export function pickStreams(payload: unknown): DirectStream[] {
    const out: DirectStream[] = [];
    const seen = new Set<string>();
    const push = (url: unknown, quality: unknown) => {
        if (!isMediaUrl(url) || seen.has(url)) return;
        seen.add(url);
        out.push({
            url,
            quality: Number(quality) || (quality as string) || '',
            kind: kindOf(url),
        });
    };

    const data = (payload as { data?: Record<string, unknown> } | null)?.data ?? (payload as any);
    if (!data || typeof data !== 'object') return out;

    const lists = [data.streams, data.hls, data.dash, data.playUrls, data.playList];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            // `hls`/`dash` lists kabhi seedha string array hoti hain.
            if (typeof entry === 'string') {
                push(entry, '');
                continue;
            }
            if (!entry || typeof entry !== 'object') continue;
            const item = entry as Record<string, unknown>;
            if (item.vipLocked === true) continue;
            push(item.url || item.playUrl || item.streamUrl, item.resolutions || item.resolution || item.quality);
        }
    }
    // MP4 pehle (media element ko CORS nahi chahiye), phir HLS/DASH.
    return out.sort((a, b) => (a.kind === 'mp4' ? 0 : 1) - (b.kind === 'mp4' ? 0 : 1));
}

function headers(referer: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
        'X-Request-Lang': 'en',
        Referer: referer,
        ...extra,
    };
}

function timeoutSignal(ms: number): AbortSignal | undefined {
    try {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(ms);
        }
    } catch {
        // purane browsers
    }
    return undefined;
}

/** Guest token (browser se seedha — API origin reflect karti hai). */
export async function getGuestToken(
    fetchImpl: typeof fetch,
    store: StorageLike = defaultStorage(),
): Promise<string | null> {
    const cached = readJson<{ token: string; at: number }>(store, TOKEN_KEY);
    if (cached?.token && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;

    try {
        const res = await fetchImpl(`${MOVIEBOX_H5}/home?host=${encodeURIComponent(MOVIEBOX_HOST)}`, {
            headers: headers(`https://${MOVIEBOX_HOST}/`),
            signal: timeoutSignal(12000),
        });
        const raw = res.headers.get('x-user');
        let token = '';
        try {
            token = raw ? String(JSON.parse(raw)?.token || '') : '';
        } catch {
            token = '';
        }
        if (!token) {
            const cookie = res.headers.get('set-cookie') || '';
            token = cookie.match(/token=([^;]+)/)?.[1] || '';
        }
        if (token) writeJson(store, TOKEN_KEY, { token, at: Date.now() });
        return token || null;
    } catch {
        return null;
    }
}

/** Player domain (rotate hota rehta hai). */
export async function getPlayerBase(fetchImpl: typeof fetch, token: string): Promise<string> {
    try {
        const res = await fetchImpl(`${MOVIEBOX_H5}/media-player/get-domain`, {
            headers: headers(`https://${MOVIEBOX_HOST}/`, token ? { Authorization: `Bearer ${token}` } : {}),
            signal: timeoutSignal(10000),
        });
        const json = (await res.json()) as { data?: unknown };
        const value = typeof json?.data === 'string' ? json.data : '';
        const host = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
        if (host) return `https://${host}/wefeed-h5api-bff`;
    } catch {
        // fallback neeche
    }
    return MOVIEBOX_PLAYER_FALLBACK;
}

/** Link (ya movie/episode props) se stream list. */
export async function resolveDirectStreams(
    params: {
        subjectId?: string;
        detailPath?: string;
        se?: number;
        ep?: number;
        link?: string | null;
    },
    options: {
        fetchImpl?: typeof fetch;
        store?: StorageLike;
        /** Cache bypass (retry button). */
        fresh?: boolean;
    } = {},
): Promise<DirectResult> {
    const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) return { ok: false, streams: [], reason: 'network' };

    const parsed: MovieboxRef | null =
        params.subjectId || params.detailPath ? null : parseMovieboxInput(params.link || '');
    const subjectId = params.subjectId || parsed?.subjectId || '';
    const detailPath = params.detailPath || parsed?.detailPath || '';
    const se = params.se ?? parsed?.se ?? 0;
    const ep = params.ep ?? parsed?.ep ?? 0;
    if (!subjectId) return { ok: false, streams: [], reason: 'no-ref' };

    const store = options.store ?? defaultStorage();
    const cacheKey = `${subjectId}:${se}:${ep}`;
    if (!options.fresh) {
        const cache = readJson<Record<string, { at: number; streams: DirectStream[]; playerHost?: string }>>(
            store,
            STREAM_KEY,
        );
        const hit = cache?.[cacheKey];
        if (hit && Date.now() - hit.at < STREAM_TTL_MS && hit.streams.length) {
            return { ok: true, streams: hit.streams, playerHost: hit.playerHost };
        }
    }

    const token = await getGuestToken(fetchImpl, store);
    if (!token) return { ok: false, streams: [], reason: 'no-token' };

    const playerBase = await getPlayerBase(fetchImpl, token);
    const query =
        `subjectId=${encodeURIComponent(subjectId)}` +
        `&se=${encodeURIComponent(se)}&ep=${encodeURIComponent(ep)}` +
        (detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : '') +
        '&streamSignType=1';

    const playerHost = playerBase.replace(/^https:\/\//, '').split('/')[0];
    for (const base of [playerBase, MOVIEBOX_H5]) {
        try {
            const res = await fetchImpl(`${base}/subject/play?${query}`, {
                headers: headers(`https://${playerHost}/`, {
                    Authorization: `Bearer ${token}`,
                    'X-Play-Mode': '2',
                }),
                signal: timeoutSignal(15000),
            });
            const json = await res.json();
            const streams = pickStreams(json);
            if (streams.length) {
                const cache = readJson<Record<string, unknown>>(store, STREAM_KEY) || {};
                cache[cacheKey] = { at: Date.now(), streams, playerHost };
                writeJson(store, STREAM_KEY, cache);
                return { ok: true, streams, playerHost };
            }
            const limited = String((json as any)?.data?.limitedCode || '');
            if (/region/i.test(limited)) return { ok: false, streams: [], reason: 'region', playerHost };
        } catch {
            // agla base try karo
        }
    }
    return { ok: false, streams: [], reason: 'no-streams', playerHost };
}
