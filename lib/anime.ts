import type { MovieRow } from '@/types/movie';

/** catalogCollection written by scripts/build-netflix-genre-rows.mjs --preset=anime. */
export const ANIME_COLLECTION = 'netflix-anime-7424';
/** Row title prefix from the same preset; keeps anime rows apart from genre rows of the same name. */
export const ANIME_ROW_PREFIX = 'Anime: ';

/** True for the rows of the Netflix Anime page. They live only in the Anime section, not on Home, Movies or TV. */
export function isAnimeRow(row: MovieRow): boolean {
    return row.movies.some(item => item.catalogCollection === ANIME_COLLECTION);
}

/** Row name as shown on the Anime page ("Anime: Your Next Watch" -> "Your Next Watch"). */
export function animeRowLabel(rowTitle: string): string {
    return rowTitle.startsWith(ANIME_ROW_PREFIX) ? rowTitle.slice(ANIME_ROW_PREFIX.length) : rowTitle;
}
