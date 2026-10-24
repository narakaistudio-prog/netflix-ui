/**
 * Playback server cycle (Server 1 = Nxsha/NHD/custom, Server 2 = M2Box,
 * M2Box 2 = usi MovieBox backend ka doosra domain — `MOVIEBOX_COPY_SITE`)
 * ======================================================================
 * Rules:
 *   - Jis title ka MovieBox link nahi hai, us par **M2Box ka button nahi**
 *     dikhta (owner ka rule) — warna user ek aisa button dabata hai jiske peeche
 *     kuch nahi hota.
 *   - Third-party embed servers hata diye gaye: owner ne kaha *"koi sahi se
 *     nhi chalta … jo pop up na deta ho"*. Sirf wahi servers jo sach me chalte
 *     hain — Nxsha / NHD / custom / MovieBox. Cycle me koi dead slot nahi.
 *
 * `defaultProvider` khud 'moviebox' ho (settings me) par link na ho to Nxsha par
 * gir jate hain.
 */

import type { ProviderId } from './embeds';

export type PlaybackServerId = ProviderId | 'moviebox' | 'moviebox2';

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

    if (rowIsMoviebox && movieboxAvailable) list.push('moviebox', 'moviebox2');
    list.push(wanted);

    // M2Box na ho to bas Server 1 — koi switch option nahi.
    if (!movieboxAvailable) {
        return Array.from(new Set(list));
    }

    for (const provider of providers) {
        if (provider !== wanted) list.push(provider);
    }
    if (customAvailable) list.push('custom');
    list.push('moviebox');
    // M2Box ka copy — same backend, doosra domain. MovieBox ke turant baad,
    // taaki ek na chale to ek tap me doosra (owner: "moviebox ka copy dhundo").
    if (movieboxAvailable) list.push('moviebox2');
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
