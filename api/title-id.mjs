/**
 * Server-side title → IMDb id resolver (Vercel serverless function).
 *
 * The bundled catalog only has a Netflix id for most titles, while the Nxsha
 * embed needs an IMDb/TMDB id. Doing the lookup here keeps it free of CORS
 * surprises and lets Vercel's edge cache serve repeat lookups instantly.
 *
 * GET /api/title-id?title=Saiyaara&type=movie&year=2025
 *   -> { "imdbId": "tt28037987" }  |  { "imdbId": null }
 */

const MOVIE_KINDS = new Set(['movie', 'video', 'tvMovie', 'short', 'tvSpecial']);
const TV_KINDS = new Set(['tvSeries', 'tvMiniSeries', 'tvShort']);

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d]/g, '')
        .replace(/\b(season|part)\s+\d+\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function pick(suggestions, title, mediaType, year) {
    if (!Array.isArray(suggestions)) return null;
    const wanted = normalize(title);
    const kinds = mediaType === 'tv' ? TV_KINDS : MOVIE_KINDS;

    const scored = suggestions
        .filter(item => typeof item?.id === 'string' && /^tt\d+$/.test(item.id))
        .map(item => {
            const name = normalize(item.l);
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

            if (typeof item.rank === 'number') score += Math.max(0, 10 - item.rank / 2000);
            return { id: item.id, score };
        })
        .sort((a, b) => b.score - a.score);

    const best = scored[0];
    return best && best.score >= 40 ? best.id.toLowerCase() : null;
}

export default async function handler(req, res) {
    const { title = '', type = 'movie', year = '' } = req.query || {};
    const clean = String(title).trim();

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!clean) {
        res.status(400).json({ error: 'title query param required' });
        return;
    }

    const mediaType = String(type) === 'tv' ? 'tv' : 'movie';
    const parsedYear = Number.parseInt(String(year).slice(0, 4), 10);
    const safeYear = Number.isFinite(parsedYear) && parsedYear > 1900 ? parsedYear : undefined;

    try {
        const query = clean.toLowerCase().replace(/\s+/g, '%20');
        const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURI(query)}.json?includeVideos=0`;
        const upstream = await fetch(url, { headers: { 'user-agent': 'netflix-ui/1.0' } });
        if (!upstream.ok) throw new Error(`imdb ${upstream.status}`);
        const data = await upstream.json();
        const imdbId = pick(data?.d, clean, mediaType, safeYear);
        // Cache resolved ids hard, misses briefly (a title may get an id later).
        res.setHeader(
            'Cache-Control',
            imdbId
                ? 'public, s-maxage=2592000, stale-while-revalidate=86400'
                : 'public, s-maxage=3600',
        );
        res.status(200).json({ imdbId });
    } catch (error) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ imdbId: null, error: String(error?.message || error) });
    }
}
