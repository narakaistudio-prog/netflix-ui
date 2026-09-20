/**
 * React bindings for the "My Series" library (seriesStore).
 *
 * `useMySeries` — the whole library (home row, admin screen).
 * `useSeries(id)` — one series by its id (the lower-cased IMDb id).
 */

import { useSyncExternalStore } from 'react';
import * as store from '@/services/seriesStore';
import { SavedSeries } from '@/types/series';

export function useMySeries(): {
    series: SavedSeries[];
    addSeries: (s: SavedSeries) => void;
    removeSeries: (id: string) => void;
} {
    const series = useSyncExternalStore(
        store.subscribeMySeries,
        store.getMySeries,
        store.getMySeries,
    );
    return {
        series,
        addSeries: s => {
            store.addSeries(s);
        },
        removeSeries: id => {
            store.removeSeries(id);
        },
    };
}

export function useSeries(id?: string): SavedSeries | undefined {
    const all = useSyncExternalStore(
        store.subscribeMySeries,
        store.getMySeries,
        store.getMySeries,
    );
    if (!id) return undefined;
    return all.find(s => s.id === id);
}
