import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import { Movie, MovieRow } from '@/types/movie';
import { fetchLiveCatalog, ComingSoonEvent } from '@/services/tmdb';
import { LOCAL_POSTERS } from '@/assets/posters';
import trailerMap from '@/data/trailers.json';
import staticMovies from '@/data/movies.json';
import staticNew from '@/data/new.json';

const TRAILERS = trailerMap as Record<string, string>;

const CACHE_KEY = 'netflix-in-catalog-v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CatalogCache {
    ts: number;
    rows: MovieRow[];
    events: ComingSoonEvent[];
}

const staticRows = (staticMovies as unknown as { movies: MovieRow[] }).movies;
const staticEvents = (staticNew as unknown as { events: ComingSoonEvent[] }).events;

/**
 * `local:<id>` imageUrl values point at poster art bundled in
 * `assets/posters`; resolve them to real asset URIs here so every
 * consumer can keep using plain `{ uri }` sources.
 */
function resolveLocal(rows: MovieRow[]): MovieRow[] {
    return rows.map(row => ({
        ...row,
        movies: row.movies.map(m => {
            const next: Movie = { ...m };
            const url = (next as any).imageUrl;
            if (typeof url === 'string' && url.startsWith('local:')) {
                const asset = LOCAL_POSTERS[url.slice('local:'.length)];
                let uri: string | undefined;
                if (asset) {
                    try {
                        uri = Asset.fromModule(asset).uri ?? undefined;
                    } catch {
                        uri = undefined;
                    }
                }
                // Metro dev serves bundled assets from a root-relative path;
                // make sure it stays absolute on nested routes (/movie/...).
                if (uri && !uri.startsWith('http') && !uri.startsWith('/')) uri = `/${uri}`;
                next.imageUrl = uri ?? '';
            }
            // Attach the official YouTube trailer for known titles
            if (!next.youtubeId && next.id.startsWith('fp-')) {
                next.youtubeId = TRAILERS[next.id.slice('fp-'.length)];
            }
            return next;
        }),
    }));
}

function readCache(): CatalogCache | null {
    try {
        const raw = (globalThis as any).localStorage?.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CatalogCache;
        if (!parsed?.rows?.length || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeCache(cache: CatalogCache) {
    try {
        (globalThis as any).localStorage?.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
        // storage unavailable — ignore
    }
}

/**
 * Catalog that always stays fresh:
 *  - renders instantly from the bundled (or cached) data
 *  - then upgrades to the live Netflix-India catalog from TMDB in the
 *    background and caches it for 6 hours
 */
export function useCatalog() {
    const [rows, setRows] = useState<MovieRow[]>(() => resolveLocal(readCache()?.rows ?? staticRows));
    const [events, setEvents] = useState<ComingSoonEvent[]>(() => readCache()?.events ?? staticEvents);
    const [isLive, setIsLive] = useState(false);

    useEffect(() => {
        let alive = true;

        (async () => {
            const live = await fetchLiveCatalog();
            if (!alive || !live) return;
            setRows(resolveLocal(live.rows));
            setEvents(live.events);
            setIsLive(true);
            writeCache({ ts: Date.now(), rows: live.rows, events: live.events });
        })();

        return () => {
            alive = false;
        };
    }, []);

    return { rows, events, isLive };
}
