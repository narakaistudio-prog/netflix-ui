/**
 * ToonStream's own season layout, and how it lines up with Nxsha's seasons.
 *
 * ToonStream splits a show into release batches (Ranma: 12 + 12 + 3, JJK:
 * 24 + 23), while Nxsha regularly merges batches into one season (JJK's 47
 * episodes sit in a single 59-episode "Season 1"). Every consumer therefore
 * takes the season numbers from ToonStream and uses `nxMap` only to find the
 * matching Nxsha metadata/embed coordinates.
 */

/** Season number Nxsha uses for this season payload. */
export const nxSeasonNumber = (body) => Number(body?.season?.season_number) || 0;

/**
 * Nxsha episodes of one season, in order, numbered from 1. A count-only entry
 * (`{count: 24}`) expands to the same shape so the mapping works without the
 * full episode payload.
 */
export const nxEpisodes = (body) => {
    if (!Array.isArray(body?.episodes)) {
        const count = Number(body?.count) || 0;
        return Array.from({ length: count }, (_, i) => ({ episode_number: i + 1 }));
    }
    return [...body.episodes]
        .filter((ep) => Number.isInteger(Number(ep?.episode_number)) && Number(ep.episode_number) > 0)
        .sort((a, b) => Number(a.episode_number) - Number(b.episode_number));
};

/**
 * Map each ToonStream season onto Nxsha by cumulative position: the first
 * episode of a ToonStream season is the (sum of previous season lengths + 1)th
 * episode of the show, which lands on exactly one Nxsha season/episode. That
 * works whether Nxsha kept the seasons split or merged them (JJK/Ranma).
 *
 * Returns the flat Nxsha list and, per ToonStream season:
 *   {season, base, start, count}
 * `base + episode` is the Nxsha episode inside `season`; `start` is the index
 * into `flat`.
 *
 * ToonStream seasons may carry an absolute `start` (One Piece's first season
 * begins at episode 6, Naruto's second at 33). That absolute number — not the
 * count of earlier seasons — decides the Nxsha position, otherwise the guide
 * and the embed would point at the wrong episode.
 */
export function buildSeasonMap(tsSeasons, nxSeasons) {
    const flat = [];
    const byNumber = new Map();
    for (const body of (nxSeasons || []).slice().sort((a, b) => nxSeasonNumber(a) - nxSeasonNumber(b))) {
        const number = nxSeasonNumber(body);
        const episodes = nxEpisodes(body);
        byNumber.set(number, episodes);
        for (const episode of episodes) {
            flat.push({ season: number, ep: Number(episode.episode_number), data: episode });
        }
    }

    const map = {};
    let offset = 0;
    let absolute = 0;
    for (const ts of (tsSeasons || []).slice().sort((a, b) => Number(a?.n) - Number(b?.n))) {
        const count = Number(ts?.count) || 0;
        if (!count) continue;
        const first = Number(ts?.start) || 0;
        const startAbs = first > 0 ? first : absolute + 1;
        const at = flat[startAbs - 1];
        if (at) {
            map[Number(ts.n)] = {
                season: at.season,
                base: Math.max(0, at.ep - 1),
                start: startAbs - 1,
                count,
            };
        }
        absolute = startAbs + count - 1;
        offset += count;
    }
    return { flat, map, byNumber };
}

/** Series slug from an episode URL: /episode/<slug>-<s>x<e>/ -> <slug>. */
export function seriesSlugFromEpisode(url) {
    const m = String(url || '').match(/\/episode\/(.+?)-(\d+)x(\d+)\/?$/i);
    return m ? m[1] : '';
}

/** The season buttons on a ToonStream series page, in order. */
export function parseToonSeasons(html) {
    const out = new Map();
    for (const tag of String(html || '').matchAll(/<a\b[^>]*>/g)) {
        const hit = /data-url="([^"]*\/season\/(\d+))"/.exec(tag[0]);
        if (!hit) continue;
        out.set(Number(hit[2]), hit[1]);
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([n, url]) => ({ n, url }));
}

/** Episode numbers a season page links to: count + any gaps. */
export function parseSeasonEpisodes(html) {
    const nums = new Set();
    for (const m of String(html || '').matchAll(/\/episode\/[^"'#]*?-(\d+)x(\d+)\/?(?=["'#])/g)) {
        nums.add(Number(m[2]));
    }
    const sorted = [...nums].filter((n) => n > 0).sort((a, b) => a - b);
    if (!sorted.length) return { count: 0, first: 0, last: 0, missing: [] };
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return {
        // Hindi-dub pages number episodes absolutely (season 2 starts at 33),
        // so the season length is the span, not the largest number.
        count: last - first + 1,
        first,
        last,
        missing: sorted.filter((n, i) => n !== first + i).slice(0, 5),
    };
}
