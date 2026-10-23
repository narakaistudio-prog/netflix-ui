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
 *   {season, base, start, count, segments}
 * `base + episode` is the Nxsha episode inside `season`; `start` is the index
 * into `flat`. `segments` lists every Nxsha season a ToonStream season covers:
 * ToonStream batches do not always end where Nxsha's seasons do (Demon Slayer's
 * S2 is Nxsha's S2 + S3), so one `season`/`base` pair is not always enough.
 *
 * ToonStream seasons may carry an absolute `start` (One Piece's first season
 * begins at episode 6, Naruto's second at 33). That absolute number — not the
 * count of earlier seasons — decides the Nxsha position, otherwise the guide
 * and the embed would point at the wrong episode.
 *
 * Example: One Piece S1 has 56 episodes numbered 6..61 and Nxsha's S1 has
 * 61 episodes numbered 1..61, so its first card maps to Nxsha episode 6
 * (`base: 5`), while S2 (site numbering 62..77) lands on Nxsha S2 episode 62.
 */
export function buildSeasonMap(tsSeasons, nxSeasons) {
    const flat = [];
    const byNumber = new Map();
    const firstIndex = new Map();
    for (const body of (nxSeasons || []).slice().sort((a, b) => nxSeasonNumber(a) - nxSeasonNumber(b))) {
        const number = nxSeasonNumber(body);
        const episodes = nxEpisodes(body);
        byNumber.set(number, episodes);
        firstIndex.set(number, flat.length);
        // `ep` is the position inside the season, which is what Nxsha's embed
        // address uses and what the baked guide is keyed by (the API numbers
        // long shows absolutely: Naruto S2 is 33..53, but the embed is 1..21).
        episodes.forEach((episode, index) => {
            flat.push({ season: number, ep: index + 1, number: Number(episode.episode_number), data: episode });
        });
    }

    const map = {};
    const consumed = new Set();
    let absolute = 0;
    for (const ts of (tsSeasons || []).slice().sort((a, b) => Number(a?.n) - Number(b?.n))) {
        const count = Number(ts?.count) || 0;
        if (!count) continue;
        const number = Number(ts.n);
        const same = byNumber.get(number);
        // Most sites split a show the same way Nxsha does. When the counts are
        // within an episode or two, trust the season number instead of the
        // running total: Trigun's ToonStream S1 carries one extra card, and a
        // cumulative mapping would shift all 12 episodes of S2 by one.
        const anchor = same && !consumed.has(number) && Math.abs(same.length - count) <= 2;
        let startIndex;
        let budget;
        if (anchor) {
            startIndex = firstIndex.get(number);
            budget = Math.min(count, same.length);
        } else {
            // ToonStream restarts numbering inside most seasons (1..N), so
            // `start` is only an absolute position when it leaps past the
            // running count — One Piece S1 begins at 6, Naruto S2 at 33.
            const first = Number(ts?.start) || 0;
            const startAbs = first > absolute + 1 ? first : absolute + 1;
            startIndex = startAbs - 1;
            budget = Math.min(count, Math.max(0, flat.length - startIndex));
        }
        const segments = [];
        let at = startIndex;
        let left = budget;
        while (left > 0 && at < flat.length) {
            const season = flat[at].season;
            const from = flat[at].ep;
            let run = 0;
            while (left > 0 && at < flat.length && flat[at].season === season) {
                run += 1;
                left -= 1;
                at += 1;
            }
            segments.push({ season, from, count: run });
            consumed.add(season);
        }
        if (segments.length) {
            map[number] = {
                season: segments[0].season,
                base: Math.max(0, segments[0].from - 1),
                start: startIndex,
                count,
                segments,
            };
        }
        absolute = startIndex + count;
    }
    return { flat, map, byNumber };
}

/**
 * The page-sized form of a map entry: a single Nxsha season is `{season, base}`,
 * a season that crosses a boundary keeps one `[season, firstLocalEp, count]`
 * row per Nxsha season in `seg`.
 */
export function compactPlan(plan) {
    if (!plan) return null;
    if (Array.isArray(plan.segments) && plan.segments.length > 1) {
        return { seg: plan.segments.map((s) => [s.season, s.from, s.count]) };
    }
    return { season: plan.season, base: plan.base };
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

/** Episode stills on a season page: {episode -> image URL}. */
export function parseSeasonCards(html) {
    const out = new Map();
    const blocks = String(html || '').match(/<article\b[\s\S]*?<\/article>/gi) || [];
    for (const block of blocks) {
        const link = /\/episode\/[^"']*?-(\d+)x(\d+)\/?/i.exec(block);
        if (!link) continue;
        const img = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(block);
        if (!img) continue;
        const url = img[1].replace(/&amp;/gi, '&').trim();
        if (!/^https?:\/\//i.test(url)) continue;
        out.set(Number(link[2]), url);
    }
    return out;
}

/** Episode numbers a season page links to: count + any gaps. */
export function parseSeasonEpisodes(html) {
    const nums = new Set();
    // Slug me HTML entity aa sakta hai: ToonStream JoJo ke season 3/4/6 par
    // `/episode/jojo&#39;s-bizarre-adventure-3x1/` likhta hai. Pehle regex `#`
    // ko bhi block karta tha, isliye un seasons ka count 0 aata tha aur JoJo ka
    // poora layout (S3 39, S4 12, S6 5) gayab ho jata tha. Ab `#`, `&` aur
    // semicolon slug ke andar allowed hain — link phir bhi `-NxM/` par hi match
    // hota hai, isliye fragment wali links galti se nahi ginti.
    for (const m of String(html || '').matchAll(/\/episode\/[^"'\s<>]*?-(\d+)x(\d+)\/?(?=["'#\s<>]|$)/g)) {
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

/**
 * Manual pins for seasons the automatic mapping gets wrong.
 *
 * `buildSeasonMap` anchors a ToonStream season to the Nxsha season with the
 * same number only when the counts are within an episode or two. JoJo breaks
 * that rule: ToonStream's S6 has 5 episodes (the rest is not uploaded yet)
 * while Nxsha's S6 has 12, so the cumulative fallback dropped JoJo's newest
 * season into Nxsha's S4 (Golden Wind) and every card showed the wrong episode
 * name. Loosening the anchor globally did fix JoJo but re-mapped DBZ and Fairy
 * Tail (whose Nxsha seasons are genuinely merged), so the exception lives in
 * data/toonstream-season-overrides.json, per show and per season.
 */
export function applySeasonOverrides(nxMap, overrides) {
    let applied = 0;
    for (const [season, plan] of Object.entries(overrides || {})) {
        if (!plan || typeof plan !== 'object' || !plan.season) continue;
        nxMap[season] = { season: Number(plan.season), base: Number(plan.base) || 0 };
        applied += 1;
    }
    return applied;
}
