/**
 * "NetMirror par ye title hai?" — chip/cycle me dead button na aaye.
 *
 * Probe halka hai (`/api/netmirror?probe=1`, URLs ke bina) aur session me yaad
 * rehta hai, taaki har detail-screen khulne par network call na ho.
 */
import { useEffect, useRef, useState } from 'react';
import { netmirrorTmdbNumber, probeNetmirror } from '@/lib/netmirror';

export interface NetmirrorAvailability {
    available: boolean;
    checking: boolean;
}

const MEMORY_TTL_MS = 20 * 60 * 1000;
const store = new Map<string, { ok: boolean; at: number }>();

function keyFor(tmdbId?: string | number | null, mediaType?: 'movie' | 'tv', season?: number, episode?: number) {
    const id = netmirrorTmdbNumber(tmdbId);
    if (!id) return null;
    return `${id}|${mediaType === 'tv' ? `tv-${season ?? 1}-${episode ?? 1}` : 'movie'}`;
}

export function useNetmirrorAvailable(
    tmdbId?: string | number | null,
    mediaType: 'movie' | 'tv' = 'movie',
    season?: number,
    episode?: number,
): NetmirrorAvailability {
    const key = keyFor(tmdbId, mediaType, season, episode);
    const [state, setState] = useState<NetmirrorAvailability>({ available: false, checking: Boolean(key) });
    const seen = useRef<string | null>(null);

    useEffect(() => {
        if (!key) {
            setState({ available: false, checking: false });
            return;
        }
        const cached = store.get(key);
        if (cached && Date.now() - cached.at < MEMORY_TTL_MS) {
            setState({ available: cached.ok, checking: false });
            return;
        }
        if (seen.current === key) return;
        seen.current = key;
        let cancelled = false;
        setState({ available: false, checking: true });
        probeNetmirror({
            tmdbId,
            mediaType,
            season: season ?? 1,
            episode: episode ?? 1,
        }).then((ok) => {
            store.set(key, { ok, at: Date.now() });
            if (!cancelled) setState({ available: ok, checking: false });
        });
        return () => {
            cancelled = true;
        };
    }, [key, tmdbId, mediaType, season, episode]);

    return state;
}

/** Tests/hot-reload ke liye. */
export function __clearNetmirrorAvailability() {
    store.clear();
}
