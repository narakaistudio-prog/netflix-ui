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
 * Map each ToonStream season onto Nxsha: the same season number when Nxsha
 * carries it with a matching count, otherwise a slice of the flat Nxsha
 * episode list at the cumulative ToonStream offset.
 *
 * Returns the flat list and, per ToonStream season:
 *   {season, base, direct, start, count}
 * `base + episode` is the Nxsha episode inside `season`; `start` is the index
 * into `flat` for the non-direct case.
 */
export function buildSeasonMap(tsSeasons, nxSeasons) {
    const byNumber = new Map();
    const flat = [];
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
    for (const ts of tsSeasons || []) {
        const count = Number(ts?.count) || 0;
        if (!count) continue;
        const sameEps = byNumber.get(Number(ts.n)) || [];
        // A merged 36-episode Nxsha season must never swallow a 12-episode batch.
        const direct = sameEps.length > 0 && Math.abs(sameEps.length - count) <= 2;
        if (direct) {
            map[Number(ts.n)] = { season: Number(ts.n), base: 0, direct: true, start: 0, count };
        } else if (flat[offset]) {
            map[Number(ts.n)] = {
                season: flat[offset].season,
                base: Math.max(0, flat[offset].ep - 1),
                direct: false,
                start: offset,
                count,
            };
        }
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
    return {
        count: sorted.length ? sorted[sorted.length - 1] : 0,
        missing: sorted.filter((n, i) => n !== i + 1).slice(0, 5),
    };
}
