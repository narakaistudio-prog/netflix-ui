import type { ProviderId } from '@/lib/embeds';

export interface Episode {
    season: number;
    episode: number;
    name: string;
    still_path?: string;
}

export interface Season {
    season_number: number;
    name: string;
    episode_count: number;
    episodes?: Episode[];
}

export interface Movie {
    id: string;
    imageUrl: string;
    title?: string;
    /** 'FILM' or 'SERIES' for legacy display; use `mediaType` for embed logic. */
    type?: string;
    /** Canonical media type for embed building. */
    mediaType?: 'movie' | 'tv';
    /** Discovery source marker for current/editorial shelves. */
    catalogSource?: 'justwatch' | 'isitinmycountry' | 'netflix-original';
    /** Editorial Netflix collection/shelf name. */
    catalogCollection?: string;
    /** Stable Netflix title id and canonical title URL when known. */
    netflixId?: string;
    netflixUrl?: string;
    /** TMDB numeric id (string or number). */
    tmdb_id?: string | number;
    /** IMDb id (tt…). */
    imdb_id?: string;
    /** Which provider to embed by default. If unset, global default is used. */
    embed_provider?: ProviderId;
    /** Manual embed URL override (admin-editable). Blank => auto-built from ids. */
    embed_url?: string;
    videoUrl?: string;
    year?: string;
    duration?: string;
    /** Episode runtime for series when the catalog source provides it. */
    runtime?: string;
    /** Total number of available episodes for TV/series entries. */
    episodeCount?: number;
    /** Episode totals by season, in season order. */
    seasonEpisodeCounts?: number[];
    rating?: string;
    description?: string;
    cast?: string[];
    director?: string;
    ranking_text?: string;
    /** YouTube video id of the official trailer (embedded on web). */
    youtubeId?: string;
    logo?: string;
    logoWidth?: number;
    logoHeight?: number;
    subText?: string;
    rated?: string;
    /** For TV shows; filled by the episode generator. */
    seasons?: Season[];
}

export interface MovieRow {
    rowTitle: string;
    movies: Movie[];
    type?: 'normal' | 'top_10' | 'games';
}

export interface MoviesData {
    movies: MovieRow[];
}

export interface FeaturedMovie {
    id: string;
    title: string;
    thumbnail: string;
    categories: string[];
    logo?: string;
}

export type DeviceMotionData = {
    rotation: {
        alpha: number;
        beta: number;
        gamma: number;
    };
};
