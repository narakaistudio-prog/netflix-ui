/**
 * Best-effort, keyless metadata pipeline for the "Add Series" flow:
 *
 *   1. AniList  -> search by name, prefer the hit whose IMDb ID matches,
 *                  then walk the SEQUEL/PREQUEL relation chain so every
 *                  season of a multi-season series is a ChainNode with its
 *                  own MAL id (poster/banner/genres come from the match).
 *   2. Jikan    -> episode titles + thumbnails per season MAL id.
 *
 * Nothing here throws: any lookup failure simply yields less metadata and
 * the series is still saved with synthesized episodes.
 */

import {
    fetchSeasonChain,
    pickAniListMatch,
    searchAniListMedia,
} from './anilist';
import { fetchJikanEpisodes } from './jikan';
import { SeriesMetadata, SeasonMetadata } from './seriesBuilder';
import { SeriesDraft } from '@/types/series';

const JIKAN_DELAY_MS = 350; // stay well under Jikan's 3 req/s limit

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function fetchSeriesMetadata(
    draft: SeriesDraft,
): Promise<SeriesMetadata | null> {
    try {
        const candidates = await searchAniListMedia(draft.name);
        const match = pickAniListMatch(candidates, draft.imdbId);
        if (!match) return null;

        const seasonCount = Math.max(1, Math.min(20, Math.floor(draft.seasons) || 1));
        const episodeCount = Math.max(1, Math.min(500, Math.floor(draft.episodesPerSeason) || 1));

        const chain = await fetchSeasonChain({
            id: match.id,
            idMal: match.idMal,
            name: match.name,
        });

        const seasons: SeasonMetadata[] = [];
        const usable = chain.slice(0, seasonCount);

        for (let i = 0; i < usable.length; i += 1) {
            const node = usable[i];
            let episodes: SeasonMetadata['episodes'];
            if (node.idMal) {
                try {
                    episodes = await fetchJikanEpisodes(node.idMal, episodeCount);
                } catch {
                    episodes = undefined; // Jikan down / no MAL coverage
                }
                // Small pause between seasons to respect the rate limit.
                if (i < usable.length - 1) await delay(JIKAN_DELAY_MS);
            }
            seasons.push({
                name: node.name,
                malId: node.idMal,
                episodes,
            });
        }

        return {
            poster: match.poster,
            banner: match.banner,
            description: match.description,
            genres: match.genres,
            year: match.year ? String(match.year) : undefined,
            seasons,
        };
    } catch {
        return null;
    }
}
