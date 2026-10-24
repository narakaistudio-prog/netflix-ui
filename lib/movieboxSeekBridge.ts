/**
 * ±10s ke **dikhne wale buttons** ka pul (bridge).
 * ===============================================
 * Owner (phone screenshot, title ke bagal me do jagah mark karke): "jaha par
 * mark kiya hai waha par 10 sec piche aur right mae 10 sec aage ka button de
 * do".
 *
 * Buttons `MovieDetailModal` ke phone screen me hote hain, par video
 * `MovieboxDirectPlayer` ke andar banti hai (imperative `<video>`, kyunki
 * MovieBox ka content cross-origin nahi hai — hum apna element chalate hain).
 * React ke prop-tree se ye do jagah judi nahi hain, isliye ek chhota sa module
 * level pul:
 *
 *   - player mount hote hi apna handler register karta hai
 *   - buttons `seekMovieboxBy(-10)` / `seekMovieboxBy(10)` bulate hain
 *   - `useMovieboxSeekReady()` se buttons ko pata rehta hai ki seek possible
 *     hai ya nahi (iframe wala fallback chal raha ho to button dikhana hi
 *     nahi chahiye — warna dead button hoga).
 *
 * Handler ek waqt me ek hi (ek player). Unregister identity check ke saath hota
 * hai, warna purana player naye ka handler uda deta.
 */

import { useEffect, useState } from 'react';

/** Ek double-tap ya button ek baar me itne second. */
export const MOVIEBOX_SKIP_SECONDS = 10;

export type MovieboxSeekHandler = (delta: number) => boolean;

let handler: MovieboxSeekHandler | null = null;
const listeners = new Set<(ready: boolean) => void>();

function notify(): void {
    const ready = Boolean(handler);
    listeners.forEach((listener) => listener(ready));
}

/** Player mount hone par apna seek handler de; cleanup par wapas de. */
export function registerMovieboxSeek(next: MovieboxSeekHandler): () => void {
    handler = next;
    notify();
    return () => {
        if (handler === next) {
            handler = null;
            notify();
        }
    };
}

/** ±10s — jo player abhi chal raha hai usme. `false` = koi player nahi. */
export function seekMovieboxBy(delta: number): boolean {
    if (!handler) return false;
    return handler(delta);
}

/** Abhi seek karne layak player hai? (hook — buttons iske hisaab se dikhte hain.) */
export function useMovieboxSeekReady(): boolean {
    const [ready, setReady] = useState(() => Boolean(handler));
    useEffect(() => {
        // Mount ke baad dobara padho — player pehle mount ho chuka ho sakta hai.
        setReady(Boolean(handler));
        listeners.add(setReady);
        return () => {
            listeners.delete(setReady);
        };
    }, []);
    return ready;
}
