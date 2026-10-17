import type { MovieRow } from '@/types/movie';

/** catalogCollection written by scripts/build-netflix-genre-rows.mjs --preset=kdrama (Netflix genre 2638104). */
export const KDRAMA_COLLECTION = 'netflix-genre-2638104';
/** Row title prefix from the same preset; keeps K-Drama rows apart from genre rows of the same name. */
export const KDRAMA_ROW_PREFIX = 'K-Dramas: ';

/** True for the rows of the Netflix K-Dramas page. They live only in the K-Dramas section, not on Home, Movies or TV. */
export function isKdramaRow(row: MovieRow): boolean {
    return row.movies.some(item => (item.catalogCollection ?? '') === KDRAMA_COLLECTION);
}

/** Row name as shown on the K-Dramas page ("K-Dramas: TV Dramas" -> "TV Dramas"). */
export function kdramaRowLabel(rowTitle: string): string {
    if (rowTitle.startsWith(KDRAMA_ROW_PREFIX)) return rowTitle.slice(KDRAMA_ROW_PREFIX.length);
    return rowTitle;
}
