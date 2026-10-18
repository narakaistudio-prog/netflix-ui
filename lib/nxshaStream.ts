/**
 * Resolve the DIRECT nxsha stream (m3u8 / mp4) for a title.
 *
 * The nxsha embed player always boots at "Auto" (240p) and offers no quality
 * control to the embedding page. The fix is to not use their player at all:
 * the direct stream is resolved and played in OUR player, which pins 1080p
 * in code.
 *
 * The resolve itself runs server-side (see api/resolve.js) — the browser
 * cannot read web.nxsha.app at all (no CORS headers). This module just calls
 * the same-origin endpoint, with an optional second endpoint as a fallback.
 */

export type MediaType = 'movie' | 'tv';

/** How long one resolve attempt may take before we fall back to the embed. */
export const RESOLVE_TIMEOUT_MS = 15000;

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
    let best1080Index = -1;
    heights.forEach((height, index) => {
        const h = Math.floor(height || 0);
        if (h <= 0) return;
        if (h === targetHeight) {
            // Several 1080p levels? The last one tends to be the highest
            // bandwidth variant in nxsha manifests.
            best1080Index = index;
        }
        if (h >= bestHeight) {
            bestHeight = h;
            best = index;
        }
    });
    return best1080Index >= 0 ? best1080Index : best;
}

function resolveUrl(params: {
    type: MediaType;
    tmdbId?: string | number | null;
    imdbId?: string | null;
    season?: number;
    episode?: number;
    base?: string;
}): string {
    const query = new URLSearchParams({
        type: params.type,
        tmdb: params.tmdbId != null ? String(params.tmdbId) : '',
        imdb: params.imdbId ?? '',
        s: String(Math.max(1, Math.floor(params.season || 1))),
        e: String(Math.max(1, Math.floor(params.episode || 1))),
    });
    const base = params.base ? params.base.replace(/\/+$/, '') : '';
    return `${base}/api/resolve?${query.toString()}`;
}

/**
 * Resolve the direct stream for a title: same-origin /api/resolve first,
 * an explicitly deployed proxy second. Null means "embed player as before".
 */
export async function resolveNxshaStream(params: {
    type: MediaType;
    tmdbId?: string | number | null;
    imdbId?: string | null;
    season?: number;
    episode?: number;
    proxyBase?: string;
    timeoutMs?: number;
}): Promise<ResolvedStream | null> {
    if ((params.tmdbId == null || params.tmdbId === '') && !params.imdbId) return null;

    const attempts: string[] = [resolveUrl({ ...params })];
    if (params.proxyBase) {
        attempts.push(resolveUrl({ ...params, base: params.proxyBase }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? RESOLVE_TIMEOUT_MS);
    try {
        for (const attempt of attempts) {
            try {
                const res = await fetch(attempt, {
                    signal: controller.signal,
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) continue;
                const body = await res.json();
                if (body && body.ok && body.source && body.source.url) {
                    return {
                        source: body.source as NxshaSource,
                        alternates: Array.isArray(body.alternates) ? (body.alternates as NxshaSource[]) : [],
                    };
                }
            } catch (error) {
                if (controller.signal.aborted) return null;
            }
        }
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
