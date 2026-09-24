import catalog from '@/data/movies.json';
import { isRemovedCatalogTitle, withoutRemovedCatalogTitles } from '@/lib/catalogExclusions';
import { Movie, MovieRow } from '@/types/movie';

const unwanted = [
    { id: 'jw-catalog-movie-madrid-1987', title: 'Madrid, 1987' },
    { id: 'jw-catalog-movie-chatterbox', title: 'Chatterbox!' },
];

it('removes both titles from the bundled rows used by Home, search and categories', () => {
    const rows = (catalog as unknown as { movies: MovieRow[] }).movies;
    const items = rows.flatMap(row => row.movies);
    for (const { id, title } of unwanted) {
        expect(items.some(item => item.id === id || item.title === title)).toBe(false);
    }
});

it('filters old catalog rows by both ID and title, without removing neighbouring movies', () => {
    const original: MovieRow[] = [{
        rowTitle: 'JustWatch Current Movies in India', type: 'normal',
        movies: [
            { id: 'other-id', title: 'Madrid 1987' },
            { id: unwanted[1].id, title: 'Wrong name from source' },
            { id: 'safe-film', title: 'A Different Film' },
        ] as Movie[],
    }];
    const filtered = withoutRemovedCatalogTitles(original);
    expect(filtered[0].movies.map(item => item.id)).toEqual(['safe-film']);
    expect(original[0].movies).toHaveLength(3); // preserve source data
    expect(isRemovedCatalogTitle(unwanted[0])).toBe(true);
    expect(isRemovedCatalogTitle(unwanted[1])).toBe(true);
    expect(isRemovedCatalogTitle({ id: 'safe-film', title: 'A Different Film' })).toBe(false);
});
