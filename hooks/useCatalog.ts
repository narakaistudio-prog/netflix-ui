import { useState } from 'react';
import { Movie, MovieRow } from '@/types/movie';
import trailerMap from '@/data/trailers.json';
import staticMovies from '@/data/movies.json';
import { withoutRemovedCatalogTitles } from '@/lib/catalogExclusions';

const TRAILERS = trailerMap as Record<string, string>;

const staticRows = withoutRemovedCatalogTitles((staticMovies as unknown as { movies: MovieRow[] }).movies);

/**
 * `local:<id>` imageUrl values point at `assets/posters`; preserve the marker
 * so SafeImage can resolve the bundled asset on web and native alike.
 */
function resolveLocal(rows: MovieRow[]): MovieRow[] {
    return rows.map(row => ({
        ...row,
        movies: row.movies.map(m => {
            const next: Movie = { ...m };
            const url = (next as any).imageUrl;
            if (!url || typeof url !== 'string' || !url.startsWith('http')) {
                next.imageUrl = url || `local:${next.id}`;
            }

            // Attach the official YouTube trailer for known FlixPatrol titles.
            if (!next.youtubeId && typeof next.id === 'string' && next.id.startsWith('fp-')) {
                next.youtubeId = TRAILERS[next.id.slice('fp-'.length)];
            }
            return next;
        }),
    }));
}

/**
 * The app renders the catalog bundled by the daily GitHub refresh. Discovery
 * is intentionally not performed in the Expo client: OMDb is server-side
 * only, and it cannot enumerate Netflix India availability. This keeps the
 * client keyless and prevents an old live-cache from masking a refreshed
 * bundle.
 */
export function useCatalog() {
    const [rows] = useState<MovieRow[]>(() => resolveLocal(staticRows));

    return { rows, isLive: false };
}
