import { selectRelatedTitles } from './relatedTitles';
import catalog from '@/data/movies.json';
import type { Movie, MovieRow } from '@/types/movie';

const title = (id: string, mediaType: 'movie' | 'tv' = 'movie', name = id): Movie => ({
    id, imageUrl: '', title: name, year: '2024', mediaType,
});

it('prefers the opened title’s shelf, excludes itself and duplicate titles, and only suggests matching media', () => {
    const current = title('opened');
    const rows: MovieRow[] = [
        { rowTitle: 'Other films', movies: [title('fallback')] },
        { rowTitle: 'My shelf', movies: [current, title('first'), title('show', 'tv'), title('second')] },
        { rowTitle: 'Repeated films', movies: [title('duplicate', 'movie', 'first'), title('last')] },
        { rowTitle: 'Games', type: 'games', movies: [title('game')] },
    ];

    expect(selectRelatedTitles(rows, current).map(item => item.id))
        .toEqual(['first', 'second', 'fallback', 'last']);
    expect(selectRelatedTitles(rows, current, 2).map(item => item.id))
        .toEqual(['first', 'second']);
});

it('builds distinct, clickable catalog choices for both a film and a show', () => {
    const rows = (catalog as unknown as { movies: MovieRow[] }).movies;
    for (const current of [rows[0].movies[0], rows[1].movies[0]]) {
        const related = selectRelatedTitles(rows, current);
        expect(related).toHaveLength(10);
        expect(new Set(related.map(item => item.id)).size).toBe(10);
        expect(related.every(item => item.id && item.id !== current.id && item.mediaType === current.mediaType)).toBe(true);
    }
});
