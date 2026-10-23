/**
 * M2Box player me ±10 second — phone ka invisible double-tap
 * =========================================================
 * Owner: "bahut bada problem hai moviebox ke player mae 10 sec aage ya peeche
 * karne ka koi tarika nhi hai … lekin invisible chiyea koi button nhi mainly
 * ye phone ke liyea karna".
 *
 * MovieBox apna player **cross-origin iframe** me chalata hai, isliye hamare
 * page se uske `<video>` tak pahunchne ka koi rasta nahi (na DOM, na
 * `postMessage` — site hamari baat sunti hi nahi). Ek hi rasta bacha tha:
 * page ko **apne hi origin** se serve karo aur uske andar chhota script bhejo.
 * Wahi `/api/moviebox-frame` proxy karta hai (`seek=1`, dekho
 * `api/moviebox-frame.mjs` → `movieboxSeekEnhancer`).
 *
 * Ye file us bridge ka **client side** hai:
 *
 *   1. `buildSeekFrameUrl` — proxy URL, `seek=1` ke saath.
 *   2. `isMovieboxSeekMessage` — iframe se aayi khabar par bharosa karna.
 *   3. `no-media` (video hi nahi mila) ya `stalled` (video mila par stream nahi
 *      chali) par yaad rakhna ki is session me proxy se player nahi bana →
 *      aage se seedha (bina proxy) frame, taaki phone par player kabhi band na
 *      ho. Ye yaad sirf **session** ki hai (`sessionStorage`) — agla din phir
 *      se try hota hai, warna ek transient fail hamesha ke liye feature band
 *      kar deta.
 *
 * Sab kuch pure + injectable hai, taaki test me storage/window chhedne ki
 * zaroorat na pade.
 */

import { buildMovieboxFrameProxyUrl } from './moviebox';

/** Iframe → parent messages ka `source` tag. */
export const MOVIEBOX_SEEK_SOURCE = 'moviebox-seek';
/** Ek double-tap me kitne second (iframe ke script me bhi yahi number hai). */
export const MOVIEBOX_SEEK_STEP_SECONDS = 10;
/** Session me ek baar yaad — "proxy se video nahi mila". */
export const MOVIEBOX_SEEK_OFF_KEY = 'm2box-seek-off-v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

function storage(): StorageLike {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
        return null;
    }
}

/** Is session me proxy ka rasta already fail ho chuka (video nahi mila)? */
export function isMovieboxSeekOff(store: StorageLike = storage()): boolean {
    try {
        return store?.getItem(MOVIEBOX_SEEK_OFF_KEY) === '1';
    } catch {
        return false;
    }
}

/** Aage ke liye proxy+seek band (sirf is browser session ke liye). */
export function markMovieboxSeekOff(store: StorageLike = storage()): void {
    try {
        store?.setItem(MOVIEBOX_SEEK_OFF_KEY, '1');
    } catch {
        // private mode / quota — feature bas phir try karega
    }
}

/** `{ source: 'moviebox-seek', type: 'media' | 'no-media' }` jaisa message? */
export function isMovieboxSeekMessage(
    data: unknown,
): data is { source: string; type: 'media' | 'no-media' | 'stalled' | string } {
    if (!data || typeof data !== 'object') return false;
    const value = data as { source?: unknown; type?: unknown };
    return value.source === MOVIEBOX_SEEK_SOURCE && typeof value.type === 'string';
}

/**
 * Proxy URL jisme seek script bhi jaata hai (`seek=1`).
 * `base` test me badla ja sakta hai; app me default `/api/moviebox-frame`.
 * Link saaf karna / encode karna `lib/moviebox.ts` ka hi kaam hai — yahan
 * duplicate nahi karte.
 */
export function buildSeekFrameUrl(
    pageUrl: string,
    base: string = '/api/moviebox-frame',
): string {
    return buildMovieboxFrameProxyUrl(pageUrl, base, { seek: true });
}
