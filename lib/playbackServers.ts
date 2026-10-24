/**
 * Playback server cycle (Server 1 = Nxsha/NHD/custom, Server 2 = M2Box,
 * Server 3 = VidSync)
 * ======================================================================
 * Rules:
 *   - Jis title ka MovieBox link nahi hai, us par **M2Box ka button nahi**
 *     dikhta (owner ka rule) — warna user ek aisa button dabata hai jiske peeche
 *     kuch nahi hota.
 *   - VidSync (Server 3) **sirf TMDB numeric id** par chalta hai, MovieBox par
 *     depend nahi karta. Isliye wo apne dum par cycle me aata hai — M2Box na ho
 *     to bhi [Server 1 → VidSync] ban sakta hai.
 *   - VidSync kabhi default nahi banta: Server 1 (Nxsha) hi pehla server rehta
 *     hai, VidSync pill se switch hota hai (agar unka player kisi title par
 *     kuch na dikhaye to ek tap me wapas).
 *
 * `defaultProvider` khud 'moviebox' ho (settings me) par link na ho to Nxsha par
 * gir jate hain.
 */

import type { ProviderId } from './embeds';

export type PlaybackServerId = ProviderId | 'moviebox' | 'vidsync';

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
    /** Title ka TMDB numeric id mila — VidSync (Server 3) chalta hai. */
    vidsyncAvailable?: boolean;
    /** Override (tests ke liye). */
    providers?: readonly ProviderId[];
}

/** Server switcher ka poora order. */
export function buildServerCycle({
    defaultProvider,
    movieboxAvailable,
    rowIsMoviebox = false,
    customAvailable = false,
    vidsyncAvailable = false,
    providers = BUILTIN_SERVERS,
}: ServerCycleInput): PlaybackServerId[] {
    const wanted: PlaybackServerId =
        defaultProvider === 'moviebox' && !movieboxAvailable ? 'nxsha' : defaultProvider;
    const list: PlaybackServerId[] = [];

    if (rowIsMoviebox && movieboxAvailable) list.push('moviebox');
    list.push(wanted);

    // M2Box na ho to bas Server 1 (+ Server 3, agar chalta hai) — koi aur switch
    // option nahi. Ye purana rule hi hai, sirf VidSync ka rasta khula hai.
    if (!movieboxAvailable) {
        if (vidsyncAvailable) list.push('vidsync');
        return Array.from(new Set(list));
    }

    for (const provider of providers) {
        if (provider !== wanted) list.push(provider);
    }
    if (customAvailable) list.push('custom');
    list.push('moviebox');
    // Server 3 sabse aakhir me — Server 1/2 ke baad hi try hota hai.
    if (vidsyncAvailable) list.push('vidsync');
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
