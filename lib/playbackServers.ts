/**
 * Playback server cycle (Server 1 = Nxsha/NHD/custom, NetMirror = `lib/netmirror.ts`
 * ka apna `<video>` wala server, Server 2 = M2Box)
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

export type PlaybackServerId = ProviderId | 'moviebox' | 'netmirror';

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
    /**
     * NetMirror par ye title hai (chhota probe, `hooks/useNetmirrorAvailable`).
     * Nahi hai to chip/cycle me dikhta hi nahi — dead button nahi.
     */
    netmirrorAvailable?: boolean;
    /** Override (tests ke liye). */
    providers?: readonly ProviderId[];
}

/** Server switcher ka poora order. */
export function buildServerCycle({
    defaultProvider,
    movieboxAvailable,
    rowIsMoviebox = false,
    customAvailable = false,
    netmirrorAvailable = false,
    providers = BUILTIN_SERVERS,
}: ServerCycleInput): PlaybackServerId[] {
    const wanted: PlaybackServerId =
        defaultProvider === 'moviebox' && !movieboxAvailable ? 'nxsha' : defaultProvider;
    const list: PlaybackServerId[] = [];

    if (rowIsMoviebox && movieboxAvailable) list.push('moviebox');
    list.push(wanted);

    // M2Box na ho to bas Server 1 (+ NetMirror, agar us title par hai).
    if (!movieboxAvailable) {
        if (netmirrorAvailable) list.push('netmirror');
        return Array.from(new Set(list));
    }

    for (const provider of providers) {
        if (provider !== wanted) list.push(provider);
    }
    if (customAvailable) list.push('custom');
    // NetMirror — apna `<video>`, seedha MP4 (1080p), koi iframe/ad nahi.
    if (netmirrorAvailable) list.push('netmirror');
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
