import type { Movie, MovieRow } from '@/types/movie';

/** Prefer titles from the same shelf, then fill from other shelves of the same media type. */
export function selectRelatedTitles(
    rows: MovieRow[],
    current: Pick<Movie, 'id' | 'title' | 'year' | 'mediaType'>,
    limit = 10,
): Movie[] {
    if (limit <= 0) return [];
    const preferredRow = rows.find(row =>
        row.type !== 'games' && row.movies.some(item => item.id === current.id),
    );
    const orderedRows = preferredRow
        ? [preferredRow, ...rows.filter(row => row !== preferredRow)]
        : rows;
    const seenIds = new Set([current.id]);
    const titleKey = (item: Pick<Movie, 'title' | 'year'>) =>
        `${item.title?.trim().toLowerCase() || ''}|${item.year || ''}`;
    const seenTitles = new Set([titleKey(current)]);
    const related: Movie[] = [];

    for (const row of orderedRows) {
        if (row.type === 'games') continue;
        for (const item of row.movies) {
            if (!item.id || item.mediaType !== current.mediaType || seenIds.has(item.id)) continue;
            const key = titleKey(item);
            if (seenTitles.has(key)) continue;
            seenIds.add(item.id);
            seenTitles.add(key);
            related.push(item);
            if (related.length >= limit) return related;
        }
    }
    return related;
}
