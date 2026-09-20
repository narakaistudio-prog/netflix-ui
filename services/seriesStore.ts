/**
 * "My Series" library — persisted to localStorage on web so admin-added
 * series (and every generated embed URL) survive reloads. On native
 * platforms (no localStorage) it degrades to an in-memory library.
 */

import { SavedSeries } from '@/types/series';

const STORAGE_KEY = 'netflix-ui.my-series.v1';

let cache: SavedSeries[] | null = null;
const listeners = new Set<() => void>();

const localStorageLike = (globalThis as any)?.localStorage;

function readStorage(): SavedSeries[] | null {
    if (!localStorageLike) return null;
    try {
        const raw = localStorageLike.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as SavedSeries[]) : null;
    } catch {
        return null;
    }
}

function writeStorage(series: SavedSeries[]): void {
    if (!localStorageLike) return;
    try {
        localStorageLike.setItem(STORAGE_KEY, JSON.stringify(series));
    } catch {
        // Storage full/blocked — keep the in-memory copy alive.
    }
}

function emit(): void {
    listeners.forEach(listener => {
        try {
            listener();
        } catch {
            // ignore listener errors
        }
    });
}

export function getMySeries(): SavedSeries[] {
    if (!cache) cache = readStorage() ?? [];
    return cache;
}

export function getSeries(id: string): SavedSeries | undefined {
    if (!id) return undefined;
    return getMySeries().find(s => s.id === id);
}

/**
 * Upserts by series id (= lower-cased IMDb id). Re-adding a series with the
 * same IMDb id refreshes its metadata/embed URLs instead of duplicating it.
 */
export function addSeries(series: SavedSeries): SavedSeries[] {
    cache = getMySeries()
        .filter(s => s.id !== series.id)
        .concat(series);
    writeStorage(cache);
    emit();
    return cache;
}

export function removeSeries(id: string): SavedSeries[] {
    cache = getMySeries().filter(s => s.id !== id);
    writeStorage(cache);
    emit();
    return cache;
}

export function subscribeMySeries(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

// Cross-tab sync (web): another tab adding/removing a series updates us.
if (typeof (globalThis as any).addEventListener === 'function') {
    (globalThis as any).addEventListener('storage', (e: any) => {
        if (e && e.key === STORAGE_KEY) {
            cache = null;
            emit();
        }
    });
}
