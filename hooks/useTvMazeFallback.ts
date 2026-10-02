import { useEffect, useState } from 'react';
import type { Movie, Season } from '@/types/movie';
import { resolveTvMazeShow, TvMazeMatch } from '@/services/tvmaze';

export interface TvMazeFallback {
    /** True while a live TVMaze lookup is in flight for this title. */
    loading: boolean;
    /** Real season/episode list (with per-episode stills) when resolved. */
    seasons?: Season[];
    /** IMDb id resolved from TVMaze — lets Nxsha/NHD embeds work even when
     *  the bundled catalog entry has no tmdb_id/imdb_id of its own. */
    imdbId?: string;
    /** Show poster from TVMaze, used as a secondary banner source when the
     *  bundled local/http poster is missing or fails to load. */
    posterUrl?: string;
}

function hasUsableEpisodes(movie: Pick<Movie, 'seasons'>): boolean {
    return Boolean(movie.seasons?.some(s => s.episodes && s.episodes.length > 0));
}

function toSeasons(match: TvMazeMatch): Season[] {
    const bySeason = new Map<number, Season>();
    for (const ep of match.episodes) {
        let season = bySeason.get(ep.season);
        if (!season) {
            season = { season_number: ep.season, name: `Season ${ep.season}`, episode_count: 0, episodes: [] };
            bySeason.set(ep.season, season);
        }
        season.episodes!.push({
            season: ep.season,
            episode: ep.episode,
            name: ep.name,
            still_path: ep.still_path,
        });
    }
    const seasons = Array.from(bySeason.values()).sort((a, b) => a.season_number - b.season_number);
    for (const s of seasons) {
        s.episode_count = s.episodes!.length;
        s.episodes!.sort((a, b) => a.episode - b.episode);
    }
    return seasons;
}

/**
 * Lazily resolves real season/episode/poster/IMDb data from TVMaze for a TV
 * title whose bundled catalog entry is missing it. No-ops (and costs
 * nothing) for movies, or for shows that already carry usable data.
 */
export function useTvMazeFallback(
    movie: Pick<Movie, 'id' | 'title' | 'year' | 'mediaType' | 'type' | 'tmdb_id' | 'imdb_id' | 'seasons'>,
    isSeries: boolean,
): TvMazeFallback {
    const [state, setState] = useState<TvMazeFallback>({ loading: false });

    const needsEpisodes = isSeries && !hasUsableEpisodes(movie);
    const needsId = isSeries && !movie.tmdb_id && !movie.imdb_id;
    const shouldFetch = Boolean((needsEpisodes || needsId) && movie.title);

    useEffect(() => {
        if (!shouldFetch) {
            setState({ loading: false });
            return;
        }
        let alive = true;
        setState({ loading: true });
        resolveTvMazeShow(String(movie.title), movie.year).then(match => {
            if (!alive) return;
            if (!match) {
                setState({ loading: false });
                return;
            }
            setState({
                loading: false,
                seasons: match.episodes.length ? toSeasons(match) : undefined,
                imdbId: match.imdbId,
                posterUrl: match.poster,
            });
        });
        return () => {
            alive = false;
        };
        // movie.id scopes the lookup to the currently open title; title/year
        // are its stable inputs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [movie.id, movie.title, movie.year, shouldFetch]);

    return state;
}
