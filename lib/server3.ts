/**
 * Server 3 — "mast aur fast" third player (pure helpers)
 * ======================================================================
 * Owner (24 Oct): *"vidsync hta de aur third server ke liyea aur mast server
 * dhund player bilkul aacha aur fast"*.
 *
 * VidSync hataya (upstream line 1 par ruk ruk kar chalta tha, aur unke 3 lines
 * me se koi bhi phone/laptop par smooth nahi nikli). Uski jagah ye file ek
 * **provider registry** rakhti hai, taaki provider badalna ek line ka kaam ho —
 * poora feature dobara nahi likhna pade.
 *
 * Har candidate TMDB numeric id par chalta hai (hamare catalog ke ids
 * `tmdb:1465943` jaise hain, isliye seedha ban jata hai):
 *
 *   videasy    player.videasy.net/movie/{id}  ·  /tv/{id}/{s}/{e}
 *   vidfast    vidfast.pro/movie/{id}         ·  /tv/{id}/{s}/{e}
 *   vidlink    vidlink.pro/movie/{id}         ·  /tv/{id}/{s}/{e}
 *   mycineby   mycineby.cc/embed/movie/{id}   ·  /embed/tv/{id}/{s}/{e}
 *   vaplayer   vaplayer.ru/embed/movie/{id}   ·  /embed/tv/{id}/{s}/{e}
 *
 * Kaunsa chuna gaya aur kyun — `docs/server3.md` me probe table ke saath.
 */

export type Server3ProviderId = 'videasy' | 'vidfast' | 'vidlink' | 'mycineby' | 'vaplayer';

interface ProviderSpec {
    /** Player ka base (sirf documentation/README ke liye). */
    base: string;
    /** Pill par dikhne wala naam (server switcher ke liye). */
    label: string;
    /** Movie ka path. */
    movie: (id: number, server?: number | null) => string;
    /** Series ka path — chalu episode. */
    tv: (id: number, season: number, episode: number, server?: number | null) => string;
    /**
     * Kya provider `server=N` (apni upstream line) support karta hai?
     * Sirf wahan `true` jahan docs me param ho — warna jhootha UI nahi banate.
     */
    lineParam?: boolean;
}

/** Netflix laal — VidSync jaisa accent param har provider me same nahi hota. */
export const SERVER3_NETFLIX_ACCENT = 'E50914';

/**
 * Registry. Order = preference (pehla wala default hai).
 *
 * `lineParam` sirf un providers par jahan param documented hai.
 */
export const SERVER3_PROVIDERS: Record<Server3ProviderId, ProviderSpec> = {
    videasy: {
        base: 'https://player.videasy.net',
        label: 'Videasy',
        movie: (id) => `https://player.videasy.net/movie/${id}?color=${SERVER3_NETFLIX_ACCENT}`,
        tv: (id, season, episode) =>
            `https://player.videasy.net/tv/${id}/${season}/${episode}?color=${SERVER3_NETFLIX_ACCENT}`,
    },
    vidfast: {
        base: 'https://vidfast.pro',
        label: 'VidFast',
        movie: (id) => `https://vidfast.pro/movie/${id}?color=${SERVER3_NETFLIX_ACCENT}`,
        tv: (id, season, episode) =>
            `https://vidfast.pro/tv/${id}/${season}/${episode}?color=${SERVER3_NETFLIX_ACCENT}`,
    },
    vidlink: {
        base: 'https://vidlink.pro',
        label: 'VidLink',
        movie: (id) => `https://vidlink.pro/movie/${id}`,
        tv: (id, season, episode) => `https://vidlink.pro/tv/${id}/${season}/${episode}`,
    },
    mycineby: {
        base: 'https://mycineby.cc/embed',
        label: 'MyCineBy',
        movie: (id) => `https://mycineby.cc/embed/movie/${id}?color=${SERVER3_NETFLIX_ACCENT}`,
        tv: (id, season, episode) =>
            `https://mycineby.cc/embed/tv/${id}/${season}/${episode}?color=${SERVER3_NETFLIX_ACCENT}`,
    },
    vaplayer: {
        base: 'https://vaplayer.ru/embed',
        label: 'VidAPI',
        movie: (id) => `https://vaplayer.ru/embed/movie/${id}`,
        tv: (id, season, episode) => `https://vaplayer.ru/embed/tv/${id}/${season}/${episode}`,
    },
};

/**
 * Default provider.
 *
 * Kyun Videasy: sabse zyada sites isi par chalti hain (uptime/reputation),
 * TTFB sabse tez bucket me (205–514 ms), koi `X-Frame-Options`/CSP block nahi,
 * aur player ke andar hi 10+ source + quality switch hota hai. Detail:
 * `docs/server3.md` ka probe table.
 *
 * ⚠️ Sach: "video sach me chalta hai" main CI se prove nahi kar paya — runner
 * ka IP datacenter hai aur ye players human/VPN check karte hain. Isliye ek
 * provider par bet nahi lagaya: neeche `SERVER3_ORDER` se user ek tap me
 * agla provider chun sakta hai (Videasy → VidFast → VidLink → MyCineBy).
 */
export const SERVER3_DEFAULT_PROVIDER: Server3ProviderId = 'videasy';

/** Ek tap me agla source — order = preference. */
export const SERVER3_ORDER: readonly Server3ProviderId[] = [
    'videasy',
    'vidfast',
    'vidlink',
    'mycineby',
    'vaplayer',
];

/** Agla provider (pill ka label + tap). */
export function nextServer3Provider(current: Server3ProviderId): Server3ProviderId {
    const index = SERVER3_ORDER.indexOf(current);
    if (index < 0) return SERVER3_DEFAULT_PROVIDER;
    return SERVER3_ORDER[(index + 1) % SERVER3_ORDER.length];
}

/** Browser me chuna hua source yaad rehta hai (agli baar wahi khulta hai). */
export const SERVER3_PROVIDER_STORAGE_KEY = 'server3_provider_v1';

function isProviderId(value: unknown): value is Server3ProviderId {
    return typeof value === 'string' && value in SERVER3_PROVIDERS;
}

export function loadServer3Provider(): Server3ProviderId {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return SERVER3_DEFAULT_PROVIDER;
        const raw = window.localStorage.getItem(SERVER3_PROVIDER_STORAGE_KEY);
        return isProviderId(raw) ? raw : SERVER3_DEFAULT_PROVIDER;
    } catch {
        return SERVER3_DEFAULT_PROVIDER;
    }
}

export function saveServer3Provider(provider: Server3ProviderId): void {
    if (!isProviderId(provider)) return;
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem(SERVER3_PROVIDER_STORAGE_KEY, provider);
    } catch {
        // Private mode / storage band — chupchaap ignore.
    }
}

/** Server switcher ke liye chhota naam. */
export const SERVER3_SERVER_LABEL = SERVER3_PROVIDERS[SERVER3_DEFAULT_PROVIDER].label;

/** Registry ke saare hosts (iframe sandbox chhodne ka faisla isi par hota hai). */
export const SERVER3_HOSTS: readonly string[] = [
    'player.videasy.net',
    'videasy.net',
    'vidfast.pro',
    'vidfast.vc',
    'vidlink.pro',
    'mycineby.cc',
    'vaplayer.ru',
];

/**
 * URL Server 3 ka hai ya nahi.
 *
 * Owner (24 Oct, follow-up): *"server 3 ke liyea sandbox bas disable karoo"* —
 * in players ko sandbox wale frame me playback/decoder gate par rukna padta
 * hai, isliye EmbedPlayer sirf Server 3 par `sandbox` attribute nahi lagata.
 * Server 1/NHD/MovieBox ka sandbox waisa hi rehta hai.
 */
export function isServer3Url(url?: string | null): boolean {
    if (!url) return false;
    try {
        const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        return SERVER3_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
    } catch {
        return false;
    }
}

export interface Server3Params {
    /** Catalog ka id — `tmdb:…`, plain number, ya `movie.tmdb_id`. */
    tmdbId?: string | number | null;
    mediaType: 'movie' | 'tv';
    /** Series par chalu episode (1-based). Movie par ignore. */
    season?: number | null;
    episode?: number | null;
    provider?: Server3ProviderId;
}

/**
 * `tmdb:1465943` / `1465943` / `tv-66732` / `1465943-slug` → 1465943.
 * IMDb id (`tt0903747`) reject — uske digits TMDB id nahi hote, warna bilkul
 * doosri film khul jati. Id na mile to `null` (server dikhana hi galat hai).
 */
export function server3TmdbNumber(tmdbId?: string | number | null): number | null {
    if (tmdbId === null || tmdbId === undefined) return null;
    const raw = String(tmdbId).trim();
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    if (/^tt\d+$/.test(lowered) || lowered.startsWith('imdb')) return null;
    if (/^-\d+$/.test(lowered)) return null;
    const matches = raw.match(/\d+/g);
    if (!matches || matches.length === 0) return null;
    const value = Number(matches[matches.length - 1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.trunc(value);
}

function positive(value: number | null | undefined): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.trunc(n);
}

/** Embed URL banao. TMDB id na ho to `null` (caller server hi na dikhaye). */
export function buildServer3Url({
    tmdbId,
    mediaType,
    season,
    episode,
    provider = SERVER3_DEFAULT_PROVIDER,
}: Server3Params): string | null {
    const id = server3TmdbNumber(tmdbId);
    if (!id) return null;
    const spec = SERVER3_PROVIDERS[provider] ?? SERVER3_PROVIDERS[SERVER3_DEFAULT_PROVIDER];
    return mediaType === 'tv'
        ? spec.tv(id, positive(season), positive(episode))
        : spec.movie(id);
}

/** Provider ka chhota naam (player pill: "Nxsha → Videasy"). */
export function server3Label(provider: Server3ProviderId = SERVER3_DEFAULT_PROVIDER): string {
    return SERVER3_PROVIDERS[provider]?.label ?? SERVER3_SERVER_LABEL;
}
