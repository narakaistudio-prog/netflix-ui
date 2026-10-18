/**
 * Browser-side direct resolve of the sealed nxsha API.
 *
 * Why this exists: web.nxsha.app's Cloudflare edge challenges datacenter
 * clients — every serverless egress we tried (Vercel functions, public
 * relays) gets the "Just a moment..." 403, while the nxsha embed plays fine
 * in the user's own browser on a residential IP. So the sealed
 * servers/sources calls are retried FROM THE BROWSER first; if that fails
 * (CORS, challenge, offline) the chain in lib/nxshaStream.ts silently falls
 * back to the server tiers.
 *
 * The fetches are deliberately header-free: a CORS "simple request" with no
 * preflight, exactly one query param. This tier is opportunistic — it either
 * reads the sealed JSON or fails fast into the fallback chain.
 */

import CryptoJS from 'crypto-js';

const NXSHA_WEB_BASE = 'https://web.nxsha.app';
const PASSPHRASE = 'S8x!Jk4ZP1uG8$my';
const PROFILE_TIMEOUT_MS = 6000;
const MAX_SERVERS = 3;

/** AES-256-CBC + OpenSSL "Salted__" container, base64url — matches the API. */
export function nxshaSeal(payload: object): string {
    const sealed = CryptoJS.AES.encrypt(JSON.stringify(payload), PASSPHRASE).toString();
    return sealed.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inverse of nxshaSeal for the API's `{ _hash }` answers. */
export function nxshaOpen(b64url?: string): any | null {
    if (typeof b64url !== 'string' || !b64url) return null;
    let text = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (text.length % 4) text += '=';
    try {
        const json = CryptoJS.AES.decrypt(text, PASSPHRASE).toString(CryptoJS.enc.Utf8);
        return json ? JSON.parse(json) : null;
    } catch {
        return null;
    }
}

function timeoutSignal(ms: number): AbortSignal | undefined {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(ms)
        : undefined;
}

const isHindi = (name: unknown) => /hindi/i.test(String(name || ''));

async function fetchSealed(path: string, payload: object): Promise<any | null> {
    const q = nxshaSeal({
        ...payload,
        _req_ts: Date.now(),
        _req_salt: Math.random().toString(36).slice(2, 12),
    });
    const url = `${NXSHA_WEB_BASE}${path}?q=${encodeURIComponent(q)}`;
    // omit first (works when the API answers Access-Control-Allow-Origin:*),
    // include second (works for an origin-echoing API + per-user cookies).
    for (const credentials of ['omit', 'include'] as const) {
        try {
            const res = await fetch(url, { credentials, signal: timeoutSignal(PROFILE_TIMEOUT_MS) });
            const text = await res.text();
            if (!res.ok) continue;
            const body = JSON.parse(text);
            const data = nxshaOpen(body && typeof body === 'object' ? body._hash : undefined);
            if (data) return data;
        } catch {
            // blocked / CORS / challenge page — try the next credential mode
        }
    }
    return null;
}

export interface DirectResolved {
    source: {
        name: string;
        kind: 'm3u8' | 'mp4';
        url: string;
        referer?: string;
        quality?: string;
    };
    alternates: Array<{
        name: string;
        kind: 'm3u8' | 'mp4';
        url: string;
        referer?: string;
        quality?: string;
    }>;
}

/**
 * Resolve servers -> sources entirely in the browser. Null means "this tier
 * could not read the API" — never a throw; the caller falls back.
 */
export async function nxshaDirectResolve(params: {
    type: 'movie' | 'tv';
    tmdbId?: string | number | null;
    imdbId?: string | null;
    season?: number;
    episode?: number;
}): Promise<DirectResolved | null> {
    try {
        const season = String(Math.max(1, Math.floor(params.season || 1)));
        const episode = String(Math.max(1, Math.floor(params.episode || 1)));
        const tmdbId = params.tmdbId != null ? String(params.tmdbId) : '';
        const imdbId = params.imdbId ?? '';

        const serversData = await fetchSealed('/api/servers', {
            tmdbId,
            type: params.type,
            imdb_id: imdbId,
            season,
            episode,
            method: 'stream',
        });
        const servers = Array.isArray(serversData && serversData.servers) ? serversData.servers : [];
        if (!servers.length) return null;

        // Hindi first (the catalog's default audio), list order otherwise.
        const ordered = [...servers]
            .sort((a, b) => Number(isHindi(b && (b.name || b.scraper))) - Number(isHindi(a && (a.name || a.scraper))))
            .slice(0, MAX_SERVERS);

        const alternates: DirectResolved['alternates'] = [];
        for (const server of ordered) {
            const provider = String((server && (server.scraper || server.id)) || '').trim();
            if (!provider) continue;
            const sourcesData = await fetchSealed('/api/sources', {
                provider,
                tmdbId,
                imdb_id: imdbId,
                type: params.type,
                season,
                episode,
                method: 'stream',
            });
            const list = Array.isArray(sourcesData && sourcesData.sources) ? sourcesData.sources : [];
            for (const item of list) {
                if (!item || typeof item !== 'object') continue;
                const url = String(item.url || '');
                const kind = String(item.type || '').toLowerCase();
                if (!url || item.isEmbed) continue;
                if (kind !== 'm3u8' && kind !== 'mp4') continue;
                const headers = item.headers && typeof item.headers === 'object' ? item.headers : {};
                alternates.push({
                    name: String(server.name || provider),
                    kind: kind === 'm3u8' ? 'm3u8' : 'mp4',
                    url,
                    referer: String(headers.Referer || headers.referer || '') || undefined,
                    quality: String(item.quality || item.label || '') || undefined,
                });
            }
            const first = alternates.find((s) => s.kind === 'm3u8') || alternates[0];
            if (first) return { source: first, alternates };
        }
        return null;
    } catch {
        return null;
    }
}
