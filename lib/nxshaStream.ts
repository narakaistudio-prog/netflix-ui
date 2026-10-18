/**
 * Resolve the DIRECT nxsha stream (m3u8 / mp4) for a title.
 *
 * The nxsha embed player always boots at "Auto" (240p) and offers no quality
 * control to the embedding page. The fix is to not use their player at all:
 * nxsha's own internal API (the same one their player calls) hands out the
 * direct stream URLs, and OUR player can then pin 1080p in code.
 *
 * The protocol below is the publicly documented one from the open-source
 * nxsha extractors:
 *   - POST-less JSON API at https://web.nxsha.app
 *   - payloads are AES-encrypted with an embedded key and sent as ?q=
 *   - responses come back encrypted in a `_hash` field
 *
 * Every step degrades: if the API is unreachable, changed, or blocked by
 * CORS, the caller falls back to the classic embed player.
 */

import AES from 'crypto-js/aes';
import Utf8 from 'crypto-js/enc-utf8';
import { base64ToB64url, b64urlToBase64 } from './b64url';

/** Key shipped inside the open-source nxsha extractors. */
const API_BASE = 'https://web.nxsha.app';
const API_KEY = 'S8x!Jk4ZP1uG8$my';

/** How long the whole resolve may take before we fall back to the embed. */
export const RESOLVE_TIMEOUT_MS = 8000;

export type MediaType = 'movie' | 'tv';

export interface NxshaSource {
    name: string;
    /** 'm3u8' (HLS, quality levels) or 'mp4'. */
    kind: 'm3u8' | 'mp4';
    url: string;
    /** Referer the CDN expects — needs a proxy to send from a browser. */
    referer?: string;
    quality?: string;
}

export interface ResolvedStream {
    /** The source to play (preferred server). */
    source: NxshaSource;
    /** Every server that resolved, best first — lets the player retry. */
    alternates: NxshaSource[];
}

/* -------------------------------------------------------------------------- */
/*  Payload encryption (same shape as the nxsha player's own calls)           */
/* -------------------------------------------------------------------------- */

interface ApiPayload {
    tmdbId: string;
    type: MediaType;
    imdb_id: string;
    season: string;
    episode: string;
    method: 'stream';
    _req_ts: number;
    _req_salt: string;
}

function buildPayload(base: Omit<ApiPayload, '_req_ts' | '_req_salt'>): ApiPayload {
    return {
        ...base,
        _req_ts: Date.now(),
        _req_salt: Math.random().toString(36).slice(2, 12),
    };
}

/** AES-encrypt a request payload into the `q` query value (base64url). */
export function encryptPayload(payload: unknown): string {
    const sealed = AES.encrypt(JSON.stringify(payload), API_KEY).toString();
    return base64ToB64url(sealed);
}

/** Decrypt a `_hash` response body. Returns null when the key changed. */
export function decryptResponse<T = any>(hash: unknown): T | null {
    if (typeof hash !== 'string' || !hash) return null;
    try {
        const text = AES.decrypt(b64urlToBase64(hash), API_KEY).toString(Utf8);
        if (!text) return null;
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

export function buildApiUrl(path: '/api/servers' | '/api/sources', payload: unknown): string {
    return `${API_BASE}${path}?q=${encodeURIComponent(encryptPayload(payload))}`;
}

/* -------------------------------------------------------------------------- */
/*  Response shaping                                                          */
/* -------------------------------------------------------------------------- */

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * Normalise a `sources` array into playable candidates (direct m3u8 / mp4
 * only — the embed-ish entries are what we are trying to replace).
 */
export function pickSources(sourcesBody: any): NxshaSource[] {
    const raw = Array.isArray(sourcesBody?.sources) ? sourcesBody.sources : [];
    const out: NxshaSource[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const url = asString(item.url);
        const type = asString(item.type).toLowerCase();
        if (!url || item.isEmbed) continue;
        if (type !== 'm3u8' && type !== 'mp4') continue;
        const headers = item.headers && typeof item.headers === 'object' ? item.headers : {};
        out.push({
            name: '',
            kind: type === 'm3u8' ? 'm3u8' : 'mp4',
            url,
            referer: asString(headers.Referer) || asString(headers.referer) || undefined,
            quality: asString(item.quality) || asString(item.label) || undefined,
        });
    }
    return out;
}

/** True for the Hindi-audio servers the catalog defaults to. */
export function isHindiServer(name: string): boolean {
    return /hindi/i.test(String(name || ''));
}

/**
 * Which HLS level to pin. `targetHeight` (1080) wins; otherwise the highest
 * level available. Returns -1 when there are no levels (auto stays).
 */
export function pickLevelIndex(heights: number[], targetHeight = 1080): number {
    let best = -1;
    let bestHeight = 0;
    let best1080 = -1;
    let best1080Index = -1;
    heights.forEach((height, index) => {
        const h = Math.floor(height || 0);
        if (h <= 0) return;
        if (h === targetHeight) {
            // Several 1080p levels? The last one tends to be the highest
            // bandwidth variant in nxsha manifests.
            best1080 = h;
            best1080Index = index;
        }
        if (h >= bestHeight) {
            bestHeight = h;
            best = index;
        }
    });
    return best1080Index >= 0 ? best1080Index : best;
}

/* -------------------------------------------------------------------------- */
/*  The resolve chain                                                         */
/* -------------------------------------------------------------------------- */

async function fetchJson(apiPath: '/api/servers' | '/api/sources', payload: unknown, proxyBase: string, signal: AbortSignal): Promise<any> {
    const url = buildApiUrl(apiPath, payload);
    const sealed = encryptPayload(payload);

    /** Unwrap the direct body ({_hash}) or the proxy body ({ok, data}). */
    const unwrap = async (res: Response) => {
        if (!res.ok) throw new Error(`nxsha api ${apiPath} -> ${res.status}`);
        const body = await res.json();
        const data =
            body && typeof body === 'object' && '_hash' in body
                ? decryptResponse((body as any)._hash)
                : body && typeof body === 'object' && (body as any).ok && 'data' in body
                    ? (body as any).data
                    : body;
        if (!data) throw new Error(`nxsha api ${apiPath} -> undecryptable`);
        return data;
    };

    const attempts: string[] = [
        url, // 1. Straight from the browser (works when the API allows any origin).
        `/api/nxsha-api?p=${encodeURIComponent(apiPath)}&q=${encodeURIComponent(sealed)}`, // 2. Same-origin (the Vercel function that ships with the app).
    ];
    if (proxyBase) {
        attempts.push(`${proxyBase.replace(/\/+$/, '')}/api/nxsha-api?p=${encodeURIComponent(apiPath)}&q=${encodeURIComponent(sealed)}`); // 3. An explicitly deployed proxy.
    }

    let lastError: unknown = null;
    for (const attempt of attempts) {
        try {
            return await unwrap(await fetch(attempt, { signal, headers: { Accept: 'application/json' } }));
        } catch (error) {
            lastError = error;
            if (signal.aborted) throw error;
        }
    }
    throw lastError ?? new Error(`nxsha api ${apiPath} unreachable`);
}

/**
 * Resolve the direct stream for a title. Hindi servers are preferred when
 * `strictHindi` is set (the catalog's default). Tries every server the API
 * lists until one yields a direct m3u8/mp4.
 */
export async function resolveNxshaStream(params: {
    type: MediaType;
    tmdbId?: string | number | null;
    imdbId?: string | null;
    season?: number;
    episode?: number;
    strictHindi?: boolean;
    proxyBase?: string;
    timeoutMs?: number;
}): Promise<ResolvedStream | null> {
    const tmdbId = params.tmdbId != null ? String(params.tmdbId) : '';
    if (!tmdbId && !params.imdbId) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? RESOLVE_TIMEOUT_MS);
    try {
        const idPart = params.imdbId ? { imdb_id: params.imdbId } : {};
        const serversBody = await fetchJson(
            '/api/servers',
            buildPayload({
                tmdbId,
                type: params.type,
                imdb_id: params.imdbId ?? '',
                season: String(Math.max(1, Math.floor(params.season || 1))),
                episode: String(Math.max(1, Math.floor(params.episode || 1))),
                method: 'stream',
            }),
            params.proxyBase ?? '',
            controller.signal,
        );
        const servers: any[] = Array.isArray(serversBody?.servers) ? serversBody.servers : [];

        const alternates: NxshaSource[] = [];
        for (const server of servers) {
            if (controller.signal.aborted) break;
            const provider = asString(server.scraper) || asString(server.id);
            if (!provider) continue;
            let sourcesBody: any = null;
            try {
                sourcesBody = await fetchJson(
                    '/api/sources',
                    buildPayload({
                        tmdbId,
                        type: params.type,
                        imdb_id: params.imdbId ?? '',
                        season: String(Math.max(1, Math.floor(params.season || 1))),
                        episode: String(Math.max(1, Math.floor(params.episode || 1))),
                        method: 'stream',
                        ...idPart,
                    }),
                    params.proxyBase ?? '',
                    controller.signal,
                );
            } catch {
                continue;
            }
            for (const source of pickSources(sourcesBody)) {
                alternates.push({
                    ...source,
                    name: asString(server.name) || provider,
                });
            }
            // Enough to work with: prefer the first m3u8 (quality levels!)
            // from a matching server and keep the rest as alternates.
            if (alternates.some((s) => s.kind === 'm3u8')) {
                const wanted = params.strictHindi !== false;
                const match = alternates.find((s) => s.kind === 'm3u8' && (!wanted || isHindiServer(s.name)));
                const chosen = match ?? alternates.find((s) => s.kind === 'm3u8') ?? alternates[0];
                return { source: chosen, alternates };
            }
        }
        if (alternates.length) {
            return { source: alternates[0], alternates };
        }
        return null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
