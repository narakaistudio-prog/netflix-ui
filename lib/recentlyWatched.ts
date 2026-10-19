/**
 * "Continue Watching" row helper.
 *
 * The row works exactly like the one on the Crunchyroll page: a title the
 * viewer started is remembered together with the position they stopped at,
 * so the next visit can pick the story up where it was left.
 *
 * The position comes from the player frame itself (postMessage time events)
 * with a wall-clock estimator as a fallback — see lib/continueWatching.ts.
 */

export interface WatchedEntry {
    id: string;          // playback id ("movie-555" or "tv-1399-s2-e5")
    titleId: string;     // stable title id without episode
    title?: string;
    type: 'movie' | 'tv';
    tmdbId?: string | number;
    imdbId?: string;
    season?: number;
    episode?: number;
    provider: string;
    startedAt: number;   // epoch ms — when the title was first played
    updatedAt?: number;  // epoch ms — last time the playhead moved
    /** 0..100 progress — derived from the position when one is known. */
    progress: number;
    /** Playback position in seconds (0 when the player never reported one). */
    positionSec?: number;
    /** Media duration in seconds (0 when the player never reported one). */
    durationSec?: number;
    /** Artwork saved at Play time so the row does not need the catalog to draw. */
    imageUrl?: string;
    backdropUrl?: string;
    year?: string;
}

/** Fired on every write so mounted rows refresh without a reload. */
export const RECENTLY_WATCHED_EVENT = 'recently-watched-change';

function notify() {
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new Event(RECENTLY_WATCHED_EVENT));
        }
    } catch {}
}

const STORAGE_KEY = 'netflix-recently-watched-v1';
const MAX_ITEMS = 24;

/**
 * Id of one playback: a movie is identified by its title, a series by the
 * title AND the episode — so resuming never lands on the wrong episode.
 */
export function watchEntryId(
    titleId: string,
    type: 'movie' | 'tv',
    season?: number,
    episode?: number,
): string {
    if (type !== 'tv') return titleId;
    const s = Math.max(1, Math.floor(season || 1));
    const e = Math.max(1, Math.floor(episode || 1));
    return `${titleId}-s${s}-e${e}`;
}

function readAll(): WatchedEntry[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as WatchedEntry[];
    } catch {
        return [];
    }
}

function writeAll(items: WatchedEntry[]) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
    notify();
}

export function markWatched(entry: Omit<WatchedEntry, 'startedAt' | 'progress'> & { progress?: number }): WatchedEntry {
    const full: WatchedEntry = {
        progress: 0,
        startedAt: Date.now(),
        ...entry,
    };
    const list = readAll().filter(w => w.id !== full.id);
    list.unshift(full);
    writeAll(list.slice(0, MAX_ITEMS));
    return full;
}

export function updateProgress(id: string, progress: number) {
    const list = readAll();
    const hit = list.find(w => w.id === id);
    if (!hit) return;
    hit.progress = Math.max(0, Math.min(100, progress));
    writeAll(list);
}

/**
 * Store where the viewer stopped.
 *
 * The position is what turns the row into a real Continue Watching row: the
 * card shows the playhead, the progress bar and the time left, and resuming
 * starts from the very same second.
 */
export function updateWatchPosition(id: string, positionSec: number, durationSec = 0) {
    const list = readAll();
    const hit = list.find(w => w.id === id);
    if (!hit) return;
    const position = Math.max(0, Math.floor(positionSec || 0));
    const duration = Math.max(0, Math.floor(durationSec || 0));
    hit.positionSec = position;
    if (duration > 0) hit.durationSec = duration;
    hit.progress =
        hit.durationSec && hit.durationSec > 0
            ? Math.max(0, Math.min(100, Math.round((position / hit.durationSec) * 100)))
            : hit.progress;
    hit.updatedAt = Date.now();
    writeAll(list);
}

/** Last time the playhead of this entry moved (falls back to the first play). */
export function lastActivity(entry: WatchedEntry): number {
    return entry.updatedAt ?? entry.startedAt;
}

export function getRecentlyWatched(): WatchedEntry[] {
    return readAll();
}

/** Remove one title from the Continue Watching row. */
export function removeWatched(id: string) {
    writeAll(readAll().filter(w => w.id !== id));
}

export function clearRecentlyWatched() {
    writeAll([]);
}
