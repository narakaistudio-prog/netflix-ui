/**
 * "Continue Watching" row helper.
 *
 * Because neither Nxsha nor NHD embeds emit postMessage events (per the
 * provider docs — playback progress CANNOT be read from the iframe),
 * we record a watch entry the moment the user taps Play and optionally
 * let them set a manual resume percentage.
 */

export interface WatchedEntry {
    id: string;          // title id (e.g. "movie-555" or "tv-1399-s2-e5")
    titleId: string;     // stable title id without episode
    title?: string;
    type: 'movie' | 'tv';
    tmdbId?: string | number;
    imdbId?: string;
    season?: number;
    episode?: number;
    provider: string;
    startedAt: number;   // epoch ms
    /** 0..100 manual progress — default 0 because we can't read it from iframe. */
    progress: number;
}

const STORAGE_KEY = 'netflix-recently-watched-v1';
const MAX_ITEMS = 24;

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

export function getRecentlyWatched(): WatchedEntry[] {
    return readAll();
}

export function clearRecentlyWatched() {
    writeAll([]);
}
