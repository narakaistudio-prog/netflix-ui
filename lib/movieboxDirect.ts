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
        /** Site har call par ye bhejti hai (`<sec>,md5(reverse(sec))`). */
        'X-Client-Token': clientToken(),
        Referer: referer,
        ...extra,
    };
}

/**
 * MovieBox ka guest token formula — `"<unix-sec>,<md5(reverse(sec))>"`.
 * Browser me `crypto.subtle` async hai, isliye chhota MD5 yahan hi (RFC 1321):
 * sirf 3-4 chhote strings ke liye, performance ka masla nahi.
 */
export function clientToken(nowMs: number = Date.now()): string {
    const sec = String(Math.floor(nowMs / 1000));
    return `${sec},${md5(sec.split('').reverse().join(''))}`;
}

/** Minimal MD5 (hex). Sirf `X-Client-Token` ke liye. */
function md5(input: string): string {
    const bytes = new TextEncoder().encode(input);
    const len = bytes.length;
    const paddedLength = (((len + 8) >> 6) + 1) << 6;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(bytes);
    buffer[len] = 0x80;
    const bitLen = len * 8;
    const view = new DataView(buffer.buffer);
    view.setUint32(paddedLength - 8, bitLen >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLen / 0x100000000), true);

    const s = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < paddedLength; offset += 64) {
        const M = new Uint32Array(16);
        for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(offset + i * 4, true);
        let A = a0;
        let B = b0;
        let C = c0;
        let D = d0;
        for (let i = 0; i < 64; i += 1) {
            let F = 0;
            let g = 0;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
            }
            F = (F + A + K[i] + M[g]) >>> 0;
            A = D;
            D = C;
            C = B;
            B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    return [a0, b0, c0, d0]
        .map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join(''))
        .join('');
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

    /**
     * Token ke liye **simple** request (sirf safelisted headers) — warna browser
     * pehle OPTIONS preflight bhejta hai aur koi bhi header allow na hone par
     * poora rasta band ho jata hai.
     */
    const readToken = (res: Response) => {
        let token = '';
        try {
            const raw = res.headers.get('x-user');
            token = raw ? String(JSON.parse(raw)?.token || '') : '';
        } catch {
            token = '';
        }
        if (!token) {
            try {
                token = (res.headers.get('set-cookie') || '').match(/token=([^;]+)/)?.[1] || '';
            } catch {
                token = '';
            }
        }
        return token;
    };

    for (const url of [
        `${MOVIEBOX_H5}/home?host=${encodeURIComponent(MOVIEBOX_HOST)}`,
        `${MOVIEBOX_H5}/country-code`,
    ]) {
        try {
            const res = await fetchImpl(url, {
                headers: { Accept: 'application/json' },
                signal: timeoutSignal(12000),
            });
            const token = readToken(res);
            if (token) {
                writeJson(store, TOKEN_KEY, { token, at: Date.now() });
                return token;
            }
        } catch {
            // agla rasta
        }
    }
    try {
        // Aakhri rasta: suggest — custom headers ke bina (wahi wajah).
        const res = await fetchImpl(`${MOVIEBOX_H5}/subject/search-suggest`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify({ keyword: 'a', perPage: 10 }),
            signal: timeoutSignal(12000),
        });
        const token = readToken(res);
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

/**
 * Ek attempt ka poora URL set.
 *
 * MovieBox par `se`/`ep` **1-based** hote hain (movie bhi `se=1&ep=1`), site ka
 * watch page `detailSe=`/`detailEp=` khaali chhodta hai — isliye 0/0 par API
 * `hasResource:false` lautati hai. Isliye jab season/episode pata na ho to
 * 1/1 bhi try hota hai (aur 0/0 bhi), dono bases par, `streamSignType` ke saath
 * aur bina, `X-Play-Mode` ke saath aur bina.
 */
export function playAttempts(
    bases: string[],
    params: { subjectId: string; detailPath?: string; se: number; ep: number },
): Array<{ base: string; query: string; playMode: boolean }> {
    const { subjectId, detailPath, se, ep } = params;
    const seen = new Set<string>();
    const coords: Array<[number, number]> = [];
    const addCoords = (a: number, b: number) => {
        const key = `${a}:${b}`;
        if (seen.has(key)) return;
        seen.add(key);
        coords.push([a, b]);
    };
    addCoords(se, ep);
    if (!se || !ep) addCoords(1, 1);
    addCoords(0, 0);

    const out: Array<{ base: string; query: string; playMode: boolean }> = [];
    for (const base of bases) {
        for (const [a, b] of coords) {
            for (const sign of [true, false]) {
                // Pehle bina `X-Play-Mode` — kam custom headers, kam preflight risk.
                for (const playMode of [false, true]) {
                    const query =
                        `subjectId=${encodeURIComponent(subjectId)}` +
                        `&se=${a}&ep=${b}` +
                        (detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : '') +
                        (sign ? '&streamSignType=1' : '');
                    out.push({ base, query, playMode });
                }
            }
        }
    }
    return out;
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
        /** Debug: har attempt ka status (kaunsa rasta kyun fail hua). */
        trace?: string[];
    } = {},
): Promise<DirectResult> {
    const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) return { ok: false, streams: [], reason: 'network' };
    const trace = options.trace;

    const parsed: MovieboxRef | null =
        params.subjectId || params.detailPath ? null : parseMovieboxInput(params.link || '');
    const subjectId = params.subjectId || parsed?.subjectId || '';
    const detailPath = params.detailPath || parsed?.detailPath || '';
    const se = params.se ?? parsed?.se ?? 0;
    const ep = params.ep ?? parsed?.ep ?? 0;
    if (!subjectId) {
        trace?.push('no-ref: subjectId nahi mila');
        return { ok: false, streams: [], reason: 'no-ref' };
    }

    const store = options.store ?? defaultStorage();
    const cacheKey = `${subjectId}:${se}:${ep}`;
    if (!options.fresh) {
        const cache = readJson<Record<string, { at: number; streams: DirectStream[]; playerHost?: string }>>(
            store,
            STREAM_KEY,
        );
        const hit = cache?.[cacheKey];
        if (hit && Date.now() - hit.at < STREAM_TTL_MS && hit.streams.length) {
            trace?.push(`cache hit (${hit.streams.length} streams)`);
            return { ok: true, streams: hit.streams, playerHost: hit.playerHost };
        }
    }

    const token = await getGuestToken(fetchImpl, store);
    if (!token) {
        trace?.push('token nahi mila (/home ka x-user header khaali)');
        return { ok: false, streams: [], reason: 'no-token' };
    }
    trace?.push(`token ok (${token.slice(0, 6)}…)`);

    const playerBase = await getPlayerBase(fetchImpl, token);
    const playerHost = playerBase.replace(/^https:\/\//, '').split('/')[0];
    trace?.push(`player: ${playerHost}`);

    const bases = playerBase === MOVIEBOX_H5 ? [playerBase] : [playerBase, MOVIEBOX_H5];
    for (const attempt of playAttempts(bases, { subjectId, detailPath, se, ep })) {
        try {
            const extra: Record<string, string> = { Authorization: `Bearer ${token}` };
            if (attempt.playMode) extra['X-Play-Mode'] = '2';
            const res = await fetchImpl(`${attempt.base}/subject/play?${attempt.query}`, {
                headers: headers(`https://${playerHost}/`, extra),
                signal: timeoutSignal(12000),
            });
            const text = await res.text();
            let json: unknown = null;
            try {
                json = JSON.parse(text);
            } catch {
                json = null;
            }
            const streams = pickStreams(json);
            const data = (json as { data?: Record<string, unknown> } | null)?.data;
            trace?.push(
                `${attempt.base === playerBase ? 'player' : 'h5'} [${attempt.query.split('&').slice(1, 3).join('&')}${
                    attempt.playMode ? ' +playmode' : ''
                }] → ${res.status} · ${streams.length} streams · hasResource ${String(data?.hasResource)}`,
            );
            if (streams.length) {
                const cache = readJson<Record<string, unknown>>(store, STREAM_KEY) || {};
                cache[cacheKey] = { at: Date.now(), streams, playerHost };
                writeJson(store, STREAM_KEY, cache);
                return { ok: true, streams, playerHost };
            }
            if (/region/i.test(String(data?.limitedCode || ''))) {
                trace?.push('region block (limitedCode)');
                return { ok: false, streams: [], reason: 'region', playerHost };
            }
        } catch (error) {
            trace?.push(`attempt error: ${String((error as Error)?.message || error).slice(0, 80)}`);
        }
    }
    return { ok: false, streams: [], reason: 'no-streams', playerHost };
}
