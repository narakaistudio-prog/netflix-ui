/**
 * Pure builder: admin draft + optional metadata -> SavedSeries.
 *
 * Loops seasons (s) x episodes (e) and string-replaces the provider
 * template into an embed URL for EVERY episode. Metadata (AniList/Jikan)
 * only enriches names, posters and thumbnails — the URL generation itself
 * never depends on it, so adding a series always works offline of both.
 */

import { buildEmbedUrl, CUSTOM_PROVIDER_ID, resolveTemplate } from './embedProviders';
import { SavedSeason, SavedSeries, SeriesDraft } from '@/types/series';

/** Optional, best-effort metadata enrichment for one admin season. */
export interface SeasonMetadata {
    name?: string;
    malId?: number;
    episodes?: { number: number; title: string; thumbnail: string }[];
}

export interface SeriesMetadata {
    poster?: string;
    banner?: string;
    description?: string;
    genres?: string[];
    year?: string;
    /** Aligned to admin season numbers 1..N (missing entries are synthesized). */
    seasons: SeasonMetadata[];
}

/** Integer in [1, max]; non-positive/NaN falls back to `fallback`. */
const clampInt = (value: number, max: number, fallback: number): number => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(max, n);
};

export function normalizeImdbId(value: string): string {
    return (value ?? '').trim().toLowerCase();
}

export function buildSeries(
    draft: SeriesDraft,
    metadata?: SeriesMetadata | null,
): SavedSeries {
    const imdbId = normalizeImdbId(draft.imdbId);
    const seasonCount = clampInt(draft.seasons, 20, 1);
    const episodeCount = clampInt(draft.episodesPerSeason, 500, 12);
    const template = resolveTemplate(draft);

    const seasons: SavedSeason[] = [];

    for (let s = 1; s <= seasonCount; s += 1) {
        const seasonMeta = metadata?.seasons?.[s - 1];
        const jikan = seasonMeta?.episodes;
        const episodes: SavedSeries['seasons'][number]['episodes'] = [];

        if (jikan && jikan.length) {
            // Jikan titles + thumbnails exist — use them, still one embed
            // URL per episode (S{s}E{mal_id}).
            for (const ep of jikan) {
                episodes.push({
                    number: ep.number,
                    title: ep.title,
                    thumbnail: ep.thumbnail || undefined,
                    embedUrl: buildEmbedUrl(template, { id: imdbId, s, e: ep.number }),
                });
            }
        } else {
            // No episode metadata — synthesize 1..N with the admin's count.
            for (let e = 1; e <= episodeCount; e += 1) {
                episodes.push({
                    number: e,
                    title: `Episode ${e}`,
                    embedUrl: buildEmbedUrl(template, { id: imdbId, s, e }),
                });
            }
        }

        seasons.push({
            number: s,
            name: seasonMeta?.name,
            malId: seasonMeta?.malId,
            episodes,
        });
    }

    return {
        id: imdbId,
        name: (draft.name ?? '').trim(),
        imdbId,
        providerId: draft.providerId,
        template:
            draft.providerId === CUSTOM_PROVIDER_ID
                ? (draft.template ?? '').trim()
                : undefined,
        poster: metadata?.poster,
        banner: metadata?.banner,
        description: metadata?.description,
        genres: metadata?.genres,
        year: metadata?.year,
        seasons,
        addedAt: Date.now(),
    };
}

/** Total episode count across all seasons (nice for the admin list). */
export function totalEpisodeCount(series: SavedSeries): number {
    return series.seasons.reduce((sum, s) => sum + s.episodes.length, 0);
}
