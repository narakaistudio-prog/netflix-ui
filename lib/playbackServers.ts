/**
 * Playback server cycle (Server 1 = Nxsha/NHD/custom, Server 2 = M2Box)
 * ======================================================================
 * Rule (owner): jis title ka MovieBox link nahi hai, us par **sirf Server 1**
 * chalega aur koi server badalne ka option nahi dikhega — warna user ek aisa
 * "M2Box" button dabata hai jiske peeche kuch nahi hota.
 *
 * Isliye cycle do tarah ka banta hai:
 *   - MovieBox available → default provider → baaki providers → custom →
 *     M2Box (pill se switch).
 *   - MovieBox nahi     → bas default provider (cycle length 1 = koi pill nahi).
 *
 * `defaultProvider` khud 'moviebox' ho (settings me) par link na ho to Nxsha par
 * gir jate hain.
 */

import type { ProviderId } from './embeds';

export type PlaybackServerId = ProviderId | 'moviebox';

export const BUILTIN_SERVERS: readonly ProviderId[] = ['nxsha', 'nhd'];

export interface ServerCycleInput {
    /** Settings/row ka chuna hua default provider (ho sakta hai 'moviebox'). */
    defaultProvider: PlaybackServerId;
    /** Is title ka MovieBox link mila (row / baked / saved / live resolve). */
    movieboxAvailable: boolean;
    /** Row me hi m2box link tha — tab M2Box pehla server banta hai. */
    rowIsMoviebox?: boolean;
    /** Row ka apna (m2box ke alawa) embed URL. */
    customAvailable?: boolean;
    /** Override (tests ke liye). */
    providers?: readonly ProviderId[];
}

/** Server switcher ka poora order. */
export function buildServerCycle({
    defaultProvider,
    movieboxAvailable,
    rowIsMoviebox = false,
    customAvailable = false,
    providers = BUILTIN_SERVERS,
}: ServerCycleInput): PlaybackServerId[] {
    const wanted: PlaybackServerId =
        defaultProvider === 'moviebox' && !movieboxAvailable ? 'nxsha' : defaultProvider;
    const list: PlaybackServerId[] = [];

    if (rowIsMoviebox && movieboxAvailable) list.push('moviebox');
    list.push(wanted);

    // MovieBox na ho to bas Server 1 — koi switch option nahi.
    if (!movieboxAvailable) return Array.from(new Set(list));

    for (const provider of providers) {
        if (provider !== wanted) list.push(provider);
    }
    if (customAvailable) list.push('custom');
    list.push('moviebox');
    return Array.from(new Set(list));
}

/** Pill dikhani hai? (cycle 1 se lamba = haan) */
export function hasServerSwitcher(cycle: readonly PlaybackServerId[]): boolean {
    return cycle.length > 1;
}

/** Agla server (pill ka label). */
export function nextServerIn(cycle: readonly PlaybackServerId[], index: number): PlaybackServerId | null {
    if (cycle.length <= 1) return null;
    return cycle[(index + 1) % cycle.length] ?? null;
}
