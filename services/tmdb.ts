import { Movie, MovieRow } from '@/types/movie';

/**
 * Live "Netflix India" catalog powered by TMDB.
 *
 * Netflix has no public API, but TMDB tracks which titles are available on
 * Netflix per country (watch provider 8 = Netflix, watch_region = IN) and is
 * updated daily. With `language=hi-IN` titles/posters come back in Hindi
 * wherever available — so the interface stays close to netflix.com/in.
 *
 * Set EXPO_PUBLIC_TMDB_API_KEY (free at themoviedb.org) in `.env` to enable.
 * Without a key the app gracefully falls back to the bundled catalog.
 */

const API_KEY = (process.env as any).EXPO_PUBLIC_TMDB_API_KEY ?? '';
const BASE = 'https://api.themoviedb.org/3';

export const isTmdbConfigured = () => Boolean(API_KEY);

const SAMPLE_VIDEOS = [
    'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
];

const img = (path: string | undefined, size = 'w342') =>
    path ? `https://image.tmdb.org/t/p/${size}${path}` : '';

async function tmdbGet(path: string, params: Record<string, string> = {}) {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set('api_key', API_KEY);
    url.searchParams.set('language', 'hi-IN');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) throw new Error(`TMDB ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const netflixDiscover = (kind: 'movie' | 'tv', extra: Record<string, string> = {}) =>
    tmdbGet(`/discover/${kind}`, {
        with_watch_providers: '8', // 8 = Netflix
        watch_region: 'IN',
        region: 'IN',
        sort_by: 'popularity.desc',
        'vote_count.gte': '50',
        ...extra,
    });

function toMovie(raw: any, kind: 'movie' | 'tv', index = 0): Movie {
    const title = raw.title ?? raw.name ?? '';
    const date: string = raw.release_date ?? raw.first_air_date ?? '';
    return {
        id: `${kind}-${raw.id}`,
        imageUrl: img(raw.poster_path) || img(raw.backdrop_path, 'w500'),
        title,
        type: kind === 'tv' ? 'SERIES' : 'FILM',
        mediaType: kind,
        tmdb_id: String(raw.id),
        description: raw.overview || undefined,
        year: date.slice(0, 4) || undefined,
        rating: raw.vote_average ? raw.vote_average.toFixed(1) : undefined,
        duration: kind === 'tv' ? `${(raw.number_of_seasons ?? 1)} Season${(raw.number_of_seasons ?? 1) > 1 ? 's' : ''}` : undefined,
        videoUrl: SAMPLE_VIDEOS[raw.id % SAMPLE_VIDEOS.length],
        ranking_text: index >= 0 ? `#${index + 1} in India Today` : undefined,
    };
}

const toRow = (title: string, results: any[], kind: 'movie' | 'tv', type: MovieRow['type'] = 'normal', limit = 12): MovieRow => ({
    rowTitle: title,
    type,
    movies: results.slice(0, limit).map((m, i) => toMovie(m, kind, i)),
});

export interface ComingSoonEvent {
    id: string;
    imageUrl: string;
    logo?: string;
    logoWidth: number;
    logoHeight: number;
    subText: string;
    type?: string;
    title?: string;
    description: string;
    rated: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (iso?: string) => {
    if (!iso) return 'Coming Soon';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Coming Soon';
    return `Coming ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

function toEvent(raw: any, kind: 'movie' | 'tv'): ComingSoonEvent {
    return {
        id: `cs-${kind}-${raw.id}`,
        imageUrl: img(raw.backdrop_path ?? raw.poster_path, 'w780'),
        logoWidth: 220,
        logoHeight: 90,
        subText: prettyDate(raw.release_date ?? raw.first_air_date),
        type: kind === 'tv' ? 'SERIES' : 'FILM',
        title: raw.title ?? raw.name ?? '',
        description: raw.overview || 'Description coming soon.',
        rated: 'U/A 16+',
    };
}

/**
 * Fetches the live Netflix-India style catalog. Returns null when TMDB is
 * not configured or the network fails so callers can fall back to static.
 */
export async function fetchLiveCatalog(): Promise<{ rows: MovieRow[]; events: ComingSoonEvent[] } | null> {
    if (!isTmdbConfigured()) return null;

    try {
        const [topMovies, topTv, trending, indianTv, indianMovies, upcomingMovies, upcomingTv] =
            await Promise.all([
                netflixDiscover('movie'),
                netflixDiscover('tv'),
                tmdbGet('/trending/all/week'),
                netflixDiscover('tv', { with_original_language: 'hi' }),
                netflixDiscover('movie', { with_original_language: 'hi' }),
                tmdbGet('/discover/movie', {
                    'release_date.gte': new Date().toISOString().slice(0, 10),
                    with_watch_providers: '8',
                    watch_region: 'IN',
                    sort_by: 'popularity.desc',
                }),
                tmdbGet('/discover/tv', {
                    'first_air_date.gte': new Date().toISOString().slice(0, 10),
                    with_watch_providers: '8',
                    watch_region: 'IN',
                    sort_by: 'popularity.desc',
                }),
            ]);

        const movies: any[] = topMovies.results ?? [];
        const tv: any[] = topTv.results ?? [];

        const popular = [...movies.slice(10, 16).map((m: any) => toMovie(m, 'movie')), ...tv.slice(10, 16).map((m: any) => toMovie(m, 'tv'))];
        const trendingRow = (trending.results ?? []).slice(0, 12).map((m: any, i: number) => toMovie(m, m.media_type === 'tv' ? 'tv' : 'movie', i));
        const indian = [...(indianTv.results ?? []).slice(0, 6).map((m: any) => toMovie(m, 'tv')), ...(indianMovies.results ?? []).slice(0, 6).map((m: any) => toMovie(m, 'movie'))];

        const rows: MovieRow[] = [
            toRow('Top 10 Movies in India Today', movies, 'movie', 'top_10', 10),
            toRow('Top 10 Series in India Today', tv, 'tv', 'top_10', 10),
            { rowTitle: 'Popular on Netflix', type: 'normal' as const, movies: popular },
            { rowTitle: 'Trending Now', type: 'normal' as const, movies: trendingRow },
            { rowTitle: 'Indian Originals', type: 'normal' as const, movies: indian },
        ].filter(r => r.movies.length > 0);

        const events: ComingSoonEvent[] = [
            ...(upcomingMovies.results ?? []).slice(0, 5).map((m: any) => toEvent(m, 'movie')),
            ...(upcomingTv.results ?? []).slice(0, 5).map((m: any) => toEvent(m, 'tv')),
        ];

        if (!rows.length) return null;
        return { rows, events };
    } catch {
        return null;
    }
}
