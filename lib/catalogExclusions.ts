import exclusions from '@/data/catalog-exclusions.json';
import { Movie, MovieRow } from '@/types/movie';

const removedIds = new Set(exclusions.ids);
const removedTitleKeys = new Set(exclusions.titleKeys);

/** The same denylist is consumed by the daily refresh and the bundled client. */
export function isRemovedCatalogTitle(item: Pick<Movie, 'id' | 'title'>): boolean {
    return removedIds.has(String(item.id)) ||
        removedTitleKeys.has(String(item.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
}

/** Keep search, Home, Movies, TV, and Explore All consistent if a stale refresh lands. */
export function withoutRemovedCatalogTitles(rows: MovieRow[]): MovieRow[] {
    return rows.map(row => ({
        ...row,
        movies: row.movies.filter(item => !isRemovedCatalogTitle(item)),
    })).filter(row => row.movies.length > 0);
}
