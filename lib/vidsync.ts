/**
 * VidSync (vidsync.pro) — **Server 3** ka dimaag (pure helpers)
 * ======================================================================
 * Owner (24 Oct): "vidsync.pro mae server 3 isse website se soch raha hu lagne
 * ke liyea netflix par ye thik hai".
 *
 * Ye provider baaki dono se alag tarah ka hai:
 *   - Nxsha/NHD: `{id}` me IMDb id ya TMDB id, template-based.
 *   - M2Box: koi embed nahi — unki site ka page crop karke dikhaya jata hai.
 *   - VidSync: seedha **designed embed iframe** hai, aur route **sirf TMDB
 *     numeric id** leta hai (`/embed/movie/155`, `/embed/tv/66732/1/1`).
 *     Hamare catalog ke ids `tmdb:1465943` jaise hote hain, isliye id nikalna
 *     hi kaafi hai — koi link paste karne ki zarurat nahi, koi proxy nahi.
 *
 * Probe (GitHub runner, mobile UA) se verify hua:
 *   - `GET /embed/movie/<id>` → 200, `text/html`
 *   - **`X-Frame-Options` nahi, CSP `frame-ancestors` bhi nahi** → hamare origin
 *     se iframe me khulta hai (warna ye server bilkul bekaar hota, aur maine
 *     add bhi nahi kiya hota).
 *   - Same HTML shell har route par (SPA) — asli playback JavaScript se hota
 *     hai, isliye "video chal raha hai" sirf user ke browser/IP par hi confirm
 *     hota hai (unka VPN-detection datacenter IP par modal dikha sakta hai;
 *     normal phone/desktop par nahi).
 *
 * Isliye VidSync kabhi **default server nahi** hai — Server 1 (Nxsha) hi
 * default rehta hai, VidSync pill se chuna jata hai. Agar unka player kisi
 * title par kuch na dikhaye to user ek tap me Server 1 par wapas aata hai
 * (zero regression).
 */

/** VidSync ka base. Route shape unke docs se hi liya gaya hai. */
export const VIDSYNC_BASE_URL = 'https://vidsync.pro';

/** Netflix laal — VidSync `primarycolor` leta hai (`#` ke bina). */
export const VIDSYNC_NETFLIX_ACCENT = 'E50914';

/**
 * Hindi pehle. VidSync ka apna rule: jo language na mile to original audio par
 * chupchaap fallback — isliye galat title par bhi kuch tootta nahi.
 */
export const VIDSYNC_DUB_LANG = 'hindi';

/**
 * `tmdb:1465943` / `1465943` / `tv-1465943` / `1465943-something` → 1465943.
 * Number hi nahi mila (ya 0/negative) to `null` — us waqt VidSync ka pill
 * dikhta hi nahi (dead button se behtar hai na dikhna).
 */
export function vidsyncTmdbNumber(tmdbId?: string | number | null): number | null {
    if (tmdbId === null || tmdbId === undefined) return null;
    const raw = String(tmdbId).trim();
    if (!raw) return null;
    // IMDb id (`tt0903747`) ka "0903747" TMDB id nahi hota — us se VidSync par
    // bilkul doosri film khul jati (ya kuch bhi nahi). Aise id par server
    // dikhana hi galat hai, isliye saaf reject.
    const lowered = raw.toLowerCase();
    if (/^tt\d+$/.test(lowered) || lowered.startsWith('imdb')) return null;
    // Negative/zero id kabhi valid nahi (`-5` ka "5" uthana galat hoga).
    if (/^-\d+$/.test(lowered)) return null;
    // Sabse aakhri digit-run lo — ids me aage `tmdb:` ya `tv-` jaisa prefix ho
    // sakta hai, par asli id hamesha digits me khatam hoti hai.
    const matches = raw.match(/\d+/g);
    if (!matches || matches.length === 0) return null;
    const value = Number(matches[matches.length - 1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.trunc(value);
}

export interface VidSyncUrlParams {
    /** Catalog ka id — `tmdb:…`, plain number, ya `movie.tmdb_id`. */
    tmdbId?: string | number | null;
    mediaType: 'movie' | 'tv';
    /** Series par chalu episode (1-based). Movie par ignore hota hai. */
    season?: number | null;
    episode?: number | null;
    /** `hindi`, `hindi,english`, ya `null` (koi dub preference nahi). */
    dubLang?: string | null;
    /** Accent colour, `#` optional. Default Netflix laal. */
    accent?: string | null;
    /**
     * Unka **upstream line** (`server=1|2|3`). Ek line slow/stuttering ho to
     * doosri line kaafi tez hoti hai — owner: "bahut ruk ruk kar chalta hai".
     * `null`/undefined = unka default (1).
     */
    server?: number | null;
}

/** Positive integer, warna 1 (episode 0 nahi hota). */
function positive(value: number | null | undefined): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.trunc(n);
}

/**
 * Embed URL banao. TMDB id na ho to `null` (caller ko server hi nahi dikhana
 * chahiye) — galat URL se iframe kholna bekaar hai.
 */
export function buildVidSyncUrl({
    tmdbId,
    mediaType,
    season,
    episode,
    dubLang = VIDSYNC_DUB_LANG,
    accent = VIDSYNC_NETFLIX_ACCENT,
    server,
}: VidSyncUrlParams): string | null {
    const id = vidsyncTmdbNumber(tmdbId);
    if (!id) return null;

    const path =
        mediaType === 'tv'
            ? `/embed/tv/${id}/${positive(season)}/${positive(episode)}`
            : `/embed/movie/${id}`;

    const query: string[] = [];
    const color = String(accent ?? '').replace(/^#/, '').trim();
    if (color) query.push(`primarycolor=${encodeURIComponent(color)}`);
    const dub = (dubLang ?? '').trim();
    if (dub) query.push(`dubLang=${encodeURIComponent(dub)}`);
    const line = vidsyncServerNumber(server);
    if (line) query.push(`server=${line}`);

    return `${VIDSYNC_BASE_URL}${path}${query.length ? `?${query.join('&')}` : ''}`;
}

/** Pill par dikhne wala naam. */
export const VIDSYNC_SERVER_LABEL = 'VidSync';

/* -------------------------------------------------------------------------- */
/*  Upstream line (server=1|2|3) — "ruk ruk kar chalta hai" ka ilaaj          */
/* -------------------------------------------------------------------------- */

/**
 * VidSync ke apne provider index. Unke docs: `server=number · 1` — "Forces a
 * specific upstream provider index on load".
 *
 * Kyun zaroori: unka player ek hi upstream se stream kholta hai, aur har
 * upstream ki speed alag hoti hai. Owner ne laptop par dekha ki video ruk ruk
 * kar chalta hai — us waqt doosri line ek tap me badalni chahiye, warna user
 * apne aap gear menu dhoondta rehta hai (ya chhod deta hai).
 */
export const VIDSYNC_SERVERS = [1, 2, 3] as const;

export type VidSyncServer = (typeof VIDSYNC_SERVERS)[number];

/** 1/2/3 ke bahar kuch bhi ho to `null` (URL me kachra nahi). */
export function vidsyncServerNumber(value?: number | string | null): number | null {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const whole = Math.trunc(n);
    return (VIDSYNC_SERVERS as readonly number[]).includes(whole) ? whole : null;
}

/** Browser me chuni hui line yaad rehti hai (agli baar wahi khulti hai). */
export const VIDSYNC_SERVER_STORAGE_KEY = 'vidsync_server_v1';

export function loadVidSyncServer(): VidSyncServer {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return 1;
        const raw = window.localStorage.getItem(VIDSYNC_SERVER_STORAGE_KEY);
        const parsed = vidsyncServerNumber(raw);
        return (parsed ?? 1) as VidSyncServer;
    } catch {
        return 1;
    }
}

export function saveVidSyncServer(server: number): void {
    const line = vidsyncServerNumber(server);
    if (!line) return;
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem(VIDSYNC_SERVER_STORAGE_KEY, String(line));
    } catch {
        // Private mode / storage band — chupchaap ignore, player phir bhi chalega.
    }
}
