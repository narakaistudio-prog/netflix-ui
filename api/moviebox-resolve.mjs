/**
 * /api/moviebox-resolve — jo title baked catalog me nahi, uska MovieBox link
 * play time par dhoondho.
 * ======================================================================
 * `data/moviebox-links.json` roz bake hota hai (`scripts/harvest-moviebox-links.mjs`),
 * par catalog naye titles se badhta rehta hai aur MovieBox par sab kuch pehle
 * din se nahi hota. Pehle aise title par app seedha "link paste karo" panel
 * dikha deta tha — user ko manually m2box.org par ja kar link dhoondhna padta
 * tha. Ab app yahan aata hai:
 *
 *   GET /api/moviebox-resolve?title=Vishwanath%20%26%20Sons&year=2026&type=movie
 *
 * Server MovieBox ki H5 API se wahi search ladder chalata hai jo harvester
 * chalata hai (`scripts/lib/moviebox-api.mjs` + `scripts/lib/moviebox-match.mjs`),
 * aur watch page ka URL laut deta hai. Client use browser me yaad rakhta hai
 * (`lib/movieboxResolve.ts`), isliye dobara call nahi hota.
 *
 * Jawab:
 *   200 { found: true,  url, subjectId, detailPath, title, dub, score, tier }
 *   200 { found: false, reason: 'no-match' | 'no-title', searched: [...] }
 *   429 rate limit, 502 upstream ne jawab nahi diya
 *
 * Cache: `s-maxage=86400` (ek din) — MovieBox par naye release ke liye ek din
 * ka intezaar theek hai, aur upstream par load bhi kam padta hai.
 */

import { createMovieboxClient, movieboxWatchUrl } from '../scripts/lib/moviebox-api.mjs';
import {
    MATCH_ACCEPT,
    languageOfRef,
    pickPlayRef,
    rankCandidates,
} from '../scripts/lib/moviebox-match.mjs';

const CACHE_SECONDS = 60 * 60 * 24;
/** Ek IP se itne resolve per minute — personal-use app, isse zyada nahi chahiye. */
const RATE_LIMIT = 30;
const RATE = new Map();

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

function json(res, status, body, extraHeaders = {}) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', status === 200 ? `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400` : 'no-store');
    for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
    res.end(JSON.stringify(body));
}

function queryValue(req, name) {
    try {
        const url = new URL(req.url, 'https://local');
        return url.searchParams.get(name) ?? '';
    } catch {
        return '';
    }
}

/**
 * Ek title ke liye MovieBox watch page dhoondho.
 * Test se seedha bhi bulaya ja sakta hai (client inject karke).
 */
export async function resolveMovieboxLink(
    { title, year, mediaType },
    { client = createMovieboxClient(), accept = MATCH_ACCEPT } = {},
) {
    const target = {
        title: String(title ?? '').trim(),
        year: Number(year) || undefined,
        mediaType: mediaType === 'tv' || mediaType === 'movie' ? mediaType : undefined,
    };
    if (!target.title) return { found: false, reason: 'no-title' };

    const queries = [
        target.title,
        target.year ? `${target.title} ${target.year}` : '',
        // Poore title par MovieBox ka search kamzor padta hai — distinctive
        // shabd ("Vishwanath") par sahi subject mil jata hai.
        [...target.title.replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/)]
            .filter((word) => word.length >= 5)
            .sort((a, b) => b.length - a.length)[0] || '',
    ].filter(Boolean);

    const searched = [];
    let best = null;
    for (const query of Array.from(new Set(queries))) {
        searched.push(query);
        const result = await client.search(query);
        if (!result.items?.length) continue;
        const ranked = rankCandidates(target, result.items);
        if (ranked.best && (!best || ranked.best.score > best.score)) {
            best = { ...ranked.best, query };
        }
        if (best && best.score >= accept) break;
    }

    if (!best || best.score < accept) {
        return {
            found: false,
            reason: 'no-match',
            searched,
            best: best
                ? {
                      title: best.item.title,
                      year: best.item.year,
                      score: Number(best.score.toFixed(3)),
                  }
                : null,
        };
    }

    const detail = await client.detail({
        detailPath: best.item.detailPath,
        subjectId: best.item.subjectId,
    });
    const play = pickPlayRef(detail, best.item);
    const url = movieboxWatchUrl(play.ref);
    if (!url) return { found: false, reason: 'no-match', searched };

    return {
        found: true,
        url,
        subjectId: play.ref.subjectId,
        detailPath: play.ref.detailPath,
        title: play.title || best.item.title,
        year: detail?.year ?? best.item.year,
        dub: play.dub || languageOfRef(play.ref),
        hindiAudio: play.hindiAudio,
        score: Number(best.score.toFixed(3)),
        tier: best.score >= 0.9 ? 'exact' : 'match',
        query: best.query,
    };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const ip =
        (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        'unknown';
    if (!rateOk(ip)) return json(res, 429, { found: false, reason: 'rate-limited' });

    const title = queryValue(req, 'title').slice(0, 200);
    const year = Number(queryValue(req, 'year')) || undefined;
    const mediaType = queryValue(req, 'type') || undefined;

    if (!title.trim()) return json(res, 200, { found: false, reason: 'no-title' });

    try {
        const result = await resolveMovieboxLink(
            { title, year, mediaType },
            { client: createMovieboxClient({ timeoutMs: 12_000, retries: 1 }) },
        );
        return json(res, 200, result);
    } catch (error) {
        return json(res, 502, {
            found: false,
            reason: 'upstream-error',
            message: String(error?.message || error).slice(0, 200),
        });
    }
}
