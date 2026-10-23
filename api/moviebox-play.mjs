/**
 * /api/moviebox-play — MovieBox (M2Box) ka **asli stream** nikaalo.
 * ==================================================================
 * Kyun: server 2 ka player abhi MovieBox ke poore watch page ka cropped
 * iframe hai (cross-origin), isliye uske andar ke `<video>` tak hamara koi
 * rasta nahi — phone par 10 second aage/peeche karne ka koi tareeka nahi tha.
 * Uske liye frame ko proxy karna pada tha, aur us raste par site ka video
 * chalta hi nahi tha (owner: "rollback karo, video play nahi hota").
 *
 * Ab plan ulta hai: page ko chhedo hi na. MovieBox ki apni H5 API se **stream
 * URL** lo aur usko hamare apne `<video>` (hls.js) me chalao. Tab video hamare
 * paas hai — ±10s, resume, progress, sab kuch bina proxy ke.
 *
 *   GET /api/moviebox-play?subjectId=<numeric>&detailPath=<slug>&se=0&ep=0
 *   -> 200 { ok: true, streams: [{ url, quality, format }], subjectId, ... }
 *   -> 200 { ok: false, reason: 'no-play-api' | 'upstream-error' | 'not-found', tried: [...] }
 *   -> 429 rate limit
 *
 * `probe=1` par har candidate endpoint ka raw jawab (chhota) laut kar aata hai —
 * endpoint badalte rehte hain, tab isi se dobara naap lete hain.
 *
 * Ye sirf URL deta hai; bytes seedhe MovieBox ke CDN se jaate hain (koi proxy
 * nahi). Cache: s-maxage 30 min — stream URL itni der me badal jate hain.
 */

import { H5_API, createMovieboxClient } from '../scripts/lib/moviebox-api.mjs';

const CACHE_SECONDS = 60 * 30;
const RATE_LIMIT = 40;
const RATE = new Map();
const BODY_LIMIT = 1500;

function rateOk(ip) {
    const now = Date.now();
    const entry = RATE.get(ip);
    if (!entry || now >= entry.reset) {
        RATE.set(ip, { count: 1, reset: now + 60_000 });
        return true;
    }
    entry.count += 1;
    if (RATE.size > 5000) RATE.clear();
    return entry.count <= RATE_LIMIT;
}

function json(res, status, body, extra = {}) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
        'Cache-Control',
        status === 200 && body && body.ok ? `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600` : 'no-store',
    );
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
    res.end(JSON.stringify(body));
}

function q(req, name) {
    const value = req.query && typeof req.query === 'object' ? req.query[name] : undefined;
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw !== undefined && raw !== null && raw !== '') return String(raw);
    try {
        return new URL(String(req.url || ''), 'http://x').searchParams.get(name) || '';
    } catch {
        return '';
    }
}

/**
 * Candidate endpoints. MovieBox apna API badalta rehta hai, isliye ye list
 * order me try hoti hai aur jo pehla jawab de (streams ke saath) wahi jeetta
 * hai. `probe=1` par sab try hote hain, taaki asli shape dekh sakein.
 */
export function candidatePaths({ subjectId, detailPath, se, ep }) {
    const common = `subjectId=${encodeURIComponent(subjectId)}`;
    const place = `&se=${encodeURIComponent(se)}&ep=${encodeURIComponent(ep)}`;
    const path = detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : '';
    return [
        `/subject/play?${common}${place}${path}`,
        `/subject/play?${common}${place}`,
        `/subject/play?${common}${path}`,
        `/subject/play?${common}`,
        `/media/play?${common}${place}${path}`,
        `/play?${common}${place}${path}`,
        `/subject/play-info?${common}${place}`,
        `/subject/resource?${common}${place}`,
        `/detail?${common}${path}`,
    ];
}

/** Kisi bhi shape se `{url, quality}` ki list nikaalo — sirf jo sach me hai. */
export function extractStreams(payload) {
    const out = [];
    const seen = new Set();
    const push = (url, quality, format) => {
        const clean = String(url || '').trim();
        if (!clean || seen.has(clean)) return;
        // Sirf asli media URLs — page/API links nahi.
        if (!/^https?:\/\//i.test(clean)) return;
        if (!/\.(m3u8|mp4|mpd|m4v)(\?|$)/i.test(clean) && !/\/hls\//i.test(clean)) return;
        seen.add(clean);
        out.push({
            url: clean,
            quality: Number(quality) || quality || '',
            format: format || (/\.m3u8(\?|$)/i.test(clean) ? 'HLS' : /\.mpd(\?|$)/i.test(clean) ? 'DASH' : 'MP4'),
        });
    };

    /** Har object me `url` + `resolution`/`format` wale dabbe dhoodho. */
    const walk = (node, depth = 0) => {
        if (!node || depth > 6) return;
        if (Array.isArray(node)) {
            node.forEach((item) => walk(item, depth + 1));
            return;
        }
        if (typeof node !== 'object') return;
        const url = node.url || node.playUrl || node.streamUrl || node.src || node.hls || node.m3u8;
        if (typeof url === 'string') push(url, node.resolution || node.quality || node.height, node.format);
        if (typeof node.streams === 'string' && /^https?:/i.test(node.streams)) push(node.streams, node.resolutions, 'HLS');
        Object.values(node).forEach((value) => walk(value, depth + 1));
    };

    walk(payload);
    return out;
}

function truncate(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return String(text || '').slice(0, BODY_LIMIT);
}

export default async function handler(req, res) {
    const subjectId = q(req, 'subjectId');
    const detailPath = q(req, 'detailPath');
    const se = q(req, 'se') || '0';
    const ep = q(req, 'ep') || '0';
    const probe = q(req, 'probe') === '1';

    if (!subjectId || !/^\d{5,25}$/.test(subjectId)) {
        json(res, 400, { ok: false, reason: 'bad-subject-id' });
        return;
    }

    const ip = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '') || 'unknown';
    if (!rateOk(ip.split(',')[0].trim())) {
        json(res, 429, { ok: false, reason: 'rate-limited' });
        return;
    }

    try {
        const client = createMovieboxClient({ retries: 1, timeoutMs: 12000 });
        const token = await client.getToken();
        const auth = token ? { Authorization: `Bearer ${token}` } : {};

        const tried = [];
        for (const path of candidatePaths({ subjectId, detailPath, se, ep })) {
            const result = await client.fetchJson(`${H5_API}${path}`, {
                headers: client.headers(auth),
            });
            const streams = extractStreams(result?.data);
            tried.push({
                path,
                status: result?.status,
                found: streams.length,
                ...(probe ? { body: truncate(result?.text) } : {}),
            });
            if (streams.length) {
                json(res, 200, {
                    ok: true,
                    subjectId,
                    se,
                    ep,
                    streams,
                    via: path,
                    ...(probe ? { tried } : {}),
                });
                return;
            }
            if (probe) continue;
            // Bina probe: 401/403 par token phir se mint karke ek baar aur.
            if (result?.status === 401 || result?.status === 403) {
                const fresh = await client.getToken(true);
                if (fresh) {
                    const again = await client.fetchJson(`${H5_API}${path}`, {
                        headers: client.headers({ Authorization: `Bearer ${fresh}` }),
                    });
                    const retried = extractStreams(again?.data);
                    tried.push({ path: `${path} (fresh token)`, status: again?.status, found: retried.length });
                    if (retried.length) {
                        json(res, 200, { ok: true, subjectId, se, ep, streams: retried, via: path });
                        return;
                    }
                }
            }
        }

        json(res, 200, { ok: false, reason: 'no-play-api', subjectId, tried });
    } catch (error) {
        json(res, 200, {
            ok: false,
            reason: 'upstream-error',
            message: String((error && error.message) || error).slice(0, 160),
        });
    }
}

export const config = { maxDuration: 30 };

export const _internal = { candidatePaths, extractStreams };
