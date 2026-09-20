/**
 * Keyless Jikan v4 episode data (https://api.jikan.moe).
 *
 * Given a season's MAL id, returns the episode list with titles and
 * thumbnails for the episode grid. No API key.
 *
 * Jikan rate-limits (~60 req/min), so callers should fetch one season at a
 * time and never retry aggressively — failures simply mean "no thumbnails".
 */

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const REQUEST_TIMEOUT_MS = 12000;

export interface JikanEpisode {
    number: number;
    title: string;
    thumbnail: string;
}

/**
 * Fetches the episodes of one anime/season from Jikan.
 * `limit` trims the list (admin-defined episodes-per-season).
 * Throws on network/HTTP errors — callers catch and fall back.
 */
export async function fetchJikanEpisodes(
    malId: number,
    limit?: number,
): Promise<JikanEpisode[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(
            `${JIKAN_BASE}/anime/${malId}/episodes`,
            { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`Jikan HTTP ${res.status}`);
        const json = await res.json();

        const raw = Array.isArray(json?.data) ? json.data : [];
        const episodes: JikanEpisode[] = raw
            .map((ep: any) => ({
                number: Number(ep?.mal_id),
                title:
                    ep?.title_english ||
                    ep?.title_romanji ||
                    ep?.title ||
                    `Episode ${ep?.mal_id}`,
                thumbnail: String(ep?.image ?? ''),
            }))
            .filter((ep: JikanEpisode) => Number.isInteger(ep.number) && ep.number > 0);

        if (limit && episodes.length > limit) episodes.splice(limit);
        return episodes;
    } finally {
        clearTimeout(timer);
    }
}
