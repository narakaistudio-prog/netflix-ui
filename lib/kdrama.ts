import type { MovieRow } from '@/types/movie';

/** catalogCollection written by scripts/build-netflix-genre-rows.mjs --preset=kdramas (Netflix genre 2638104). */
export const KDAMA_COLLECTION = 'netflix-genre-2638104';
/** Row title prefix from the same preset; keeps K-Drama rows apart from genre rows of the same name. */
export const KDAMA_ROW_PREFIX = 'K-Drama: ';

/** True for the rows of the Netflix K-Dramas genre page. They live only in the K-Dramas section, not on Home, Movies or TV. */
export function isKdramaRow(row: MovieRow): boolean {
    return row.movies.some(item => item.catalogCollection === KDAMA_COLLECTION);
}

/** Row name as shown on the K-Dramas page ("K-Drama: Trending K-Dramas" -> "Trending K-Dramas"). */
export function kdramaRowLabel(rowTitle: string): string {
    return rowTitle.startsWith(KDAMA_ROW_PREFIX)
        ? rowTitle.slice(KDAMA_ROW_PREFIX.length)
        : rowTitle;
}
