import catalog from '../data/movies.json';
import type { MoviesData } from '../types/movie';
import { buildEmbedUrl } from './embeds';
import { DEFAULT_SETTINGS, templateOverridesFor } from './settings';

it('opens the correct Nxsha title for every Vishwanath & Sons catalog card', () => {
    const entries = (catalog as MoviesData).movies
        .flatMap(row => row.movies)
        .filter(movie => movie.id === 'jw-catalog-movie-vishwanath-and-sons');

    expect(entries).toHaveLength(2);
    for (const movie of entries) {
        expect(movie.tmdb_id).toBe('1408162');
        expect(movie.embed_provider).toBe('nxsha');
        expect(movie.netflixUrl).toBe('https://www.netflix.com/in/title/82034837');

        const src = buildEmbedUrl(
            'nxsha', 'movie',
            { tmdbId: movie.tmdb_id, strictHindi: DEFAULT_SETTINGS.strictHindi },
            templateOverridesFor(DEFAULT_SETTINGS, 'nxsha'),
        );
        const url = new URL(src);
        expect(url.pathname).toBe('/embed/movie/1408162');
        expect(url.searchParams.get('server')).toBe('GbruHindi');
    }
});
