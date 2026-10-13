import type { MovieRow } from '@/types/movie';

/** catalogCollection written by scripts/build-netflix-genre-rows.mjs --preset=anime (Netflix genre 7424). */
export const ANIME_COLLECTION = 'netflix-anime-7424';
/** catalogCollection written by --preset=anime-movies (Netflix genre 3063, Anime Movies). */
export const ANIME_MOVIES_COLLECTION = 'netflix-anime-3063';
/** Row title prefixes from the same presets; keep anime rows apart from genre rows of the same name. */
export const ANIME_ROW_PREFIX = 'Anime: ';
export const ANIME_MOVIE_ROW_PREFIX = 'Anime Movies: ';

const ANIME_COLLECTIONS = [ANIME_COLLECTION, ANIME_MOVIES_COLLECTION];

/** True for the rows of the Netflix Anime and Anime Movies pages. They live only in the Anime section, not on Home, Movies or TV. */
export function isAnimeRow(row: MovieRow): boolean {
    return row.movies.some(item => ANIME_COLLECTIONS.includes(item.catalogCollection ?? ''));
}

/** True for the rows from the Netflix Anime Movies page, which the Anime section shows as its own group. */
export function isAnimeMovieRow(row: MovieRow): boolean {
    return row.movies.some(item => item.catalogCollection === ANIME_MOVIES_COLLECTION);
}

/** Row name as shown on the Anime page ("Anime: Your Next Watch" -> "Your Next Watch"). */
export function animeRowLabel(rowTitle: string): string {
    for (const prefix of [ANIME_ROW_PREFIX, ANIME_MOVIE_ROW_PREFIX]) {
        if (rowTitle.startsWith(prefix)) return rowTitle.slice(prefix.length);
    }
    return rowTitle;
}
