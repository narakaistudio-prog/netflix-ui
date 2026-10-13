import episodeData from '@/data/tv-episodes.json';

/** One episode from nxsha's season API (data/tv-episodes.json, built by scripts/build-tv-episodes-nxsha.mjs). */
export interface TvEpisode {
    season: number;
    episode: number;
    name: string;
    overview: string;
    /** Minutes. */
    runtime?: number;
    /** Still image URL (TMDB w500). */
    still?: string;
    air_date?: string;
}

export interface TvSeason {
    season_number: number;
    name: string;
    overview: string;
    episode_count: number;
    episodes: TvEpisode[];
}

const DATA = episodeData as unknown as Record<string, { seasons: TvSeason[] }>;

/** Seasons for a TV title (keyed by its nxsha/TMDB id); empty when none were built. */
export function getTvSeasons(tmdbId?: string | number | null): TvSeason[] {
    if (tmdbId === undefined || tmdbId === null || tmdbId === '') return [];
    return DATA[String(tmdbId)]?.seasons ?? [];
}

/** "56m", or "1h 6m" from minutes. */
export function formatRuntime(minutes?: number): string {
    if (!minutes || minutes <= 0) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
