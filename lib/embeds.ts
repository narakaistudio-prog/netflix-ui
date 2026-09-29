/**
 * Embed URL builder for third-party streaming providers (Nxsha, AutoEmbed,
 * VidSync & NHD).
 *
 * All endpoints here are verified against the provider docs:
 *   - Nxsha    : https://nxsha.space/embed
 *   - AutoEmbed: https://autoembed.cc/ (player.autoembed.cc)
 *   - VidSync  : https://vidsync.pro/
 *   - NHD      : https://nhdapi.com/docs
 *
 * Do NOT invent new endpoints or query params — only the ones documented
 * below are supported by the providers. The defaults match section (2) of
 * the project brief.
 */

export type MediaType = 'movie' | 'tv';
export type ProviderId = 'nxsha' | 'autoembed' | 'vidsync' | 'nhd' | 'custom';

export interface Provider {
    id: ProviderId;
    name: string;
    /**
     * Template for movie embeds. Placeholders:
     *   {id}  → provider-specific id (VidSync prefers tmdbId; others prefer IMDb)
     *   {tmdb} → always tmdbId (useful when you specifically need the numeric id)
     */
    movieTemplate: string;
    /**
     * Template for tv embeds. Adds {s} (season) and {e} (episode) — both 1-based.
     */
    tvTemplate: string;
}

export interface BuildEmbedParams {
    tmdbId?: string | number;
    imdbId?: string;
    season?: number;
    episode?: number;
    /** When true and provider is nxsha, append `one_server=true` (strict Hindi). */
    strictHindi?: boolean;
}

export interface CustomTemplateOverrides {
    movieTemplate?: string;
    tvTemplate?: string;
}

/* -------------------------------------------------------------------------- */
/*  Default templates (section 2 of the brief).                              */
/* -------------------------------------------------------------------------- */

export const DEFAULT_NXSHA_MOVIE =
    'https://nxsha.space/embed/movie/{id}?server=GbruHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true';

export const DEFAULT_NXSHA_TV =
    'https://nxsha.space/embed/tv/{id}/{s}/{e}?server=GbruHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true';

export const DEFAULT_AUTOEMBED_MOVIE = 'https://player.autoembed.cc/embed/movie/{id}';
export const DEFAULT_AUTOEMBED_TV = 'https://player.autoembed.cc/embed/tv/{id}/{s}/{e}';

export const DEFAULT_VIDSYNC_MOVIE = 'https://vidsync.pro/embed/movie/{id}';
export const DEFAULT_VIDSYNC_TV = 'https://vidsync.pro/embed/tv/{id}/{s}/{e}';

export const DEFAULT_NHD_MOVIE = 'https://nhdapi.com/movie/{id}';
export const DEFAULT_NHD_TV = 'https://nhdapi.com/tv/{id}/{s}/{e}';

/* -------------------------------------------------------------------------- */
/*  Known providers                                                          */
/* -------------------------------------------------------------------------- */

export const PROVIDERS: Provider[] = [
    {
        id: 'nxsha',
        name: 'Nxsha',
        movieTemplate: DEFAULT_NXSHA_MOVIE,
        tvTemplate: DEFAULT_NXSHA_TV,
    },
    {
        id: 'autoembed',
        name: 'AutoEmbed',
        movieTemplate: DEFAULT_AUTOEMBED_MOVIE,
        tvTemplate: DEFAULT_AUTOEMBED_TV,
    },
    {
        id: 'vidsync',
        name: 'VidSync',
        movieTemplate: DEFAULT_VIDSYNC_MOVIE,
        tvTemplate: DEFAULT_VIDSYNC_TV,
    },
    {
        id: 'nhd',
        name: 'NHD',
        movieTemplate: DEFAULT_NHD_MOVIE,
        tvTemplate: DEFAULT_NHD_TV,
    },
];

export function getProvider(id: ProviderId): Provider | undefined {
    if (id === 'custom') return undefined;
    return PROVIDERS.find(p => p.id === id);
}

export interface PlaybackTitleMetadata {
    title?: string;
    /** OMDb/TMDB language value, for example "Hindi, English" or "hi". */
    language?: string;
    catalogSource?: string;
}

const normalizeTitle = (value: string | undefined) =>
    String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// The bundled Netflix-India refresh does not have a language field for every
// JustWatch row. Keep a small audited fallback for well-known Hindi titles;
// new rows should use the language metadata written by refresh-catalog.mjs.
const KNOWN_INDIAN_HINDI_MOVIES = new Set([
    'alpha', 'animal', 'bajrangi bhaijaan', 'billu', 'border 2', 'bhooth bangla',
    'chak de india', 'chhaava', 'chennai express', 'dear zindagi', 'dangal',
    'dhamaal 4', 'dhamaal', 'dhoom 2', 'dhoom 3', 'dil chahta hai',
    'dil dhadakne do', 'dilwale', 'dilwale dulhania le jayenge', 'don',
    'fighter', 'fukrey', 'gangubai kathiawadi', 'gunjan saxena the kargil girl',
    'happy patel khatarnak jasoos', 'jawan', 'jaat', 'jogi', 'karthik calling karthik',
    'main vaapas aaunga', 'mirzapur the movie', 'vishwanath sons', 'saiyaara', 'gandhari',
    'dhurandhar', 'dhurandhar the revenge', 'sikandar', 'laila majnu', 'luck by chance', 'main hoon na', 'mimi', 'mohabbatein', 'oh darling yeh hai india',
    'patiala house', 'pati patni aur woh do', 'pk', 'rab ne bana di jodi', 'sui dhaaga made in india',
    'sultan', 'talaash', 'tere ishk mein', 'veer zaara', 'war 2', 'zindagi na milegi dobara',
].map(normalizeTitle));

export function isIndianHindiMovie(metadata: PlaybackTitleMetadata = {}): boolean {
    const language = String(metadata.language ?? '').toLowerCase();
    if (language) {
        return /(^|[\\s,/_-])(hi|hin|hindi)(?=$|[\\s,/_-])/i.test(language);
    }
    return KNOWN_INDIAN_HINDI_MOVIES.has(normalizeTitle(metadata.title));
}

/**
 * Playback policy for the catalog. Series stay on Nxsha. Only Indian Hindi
 * movies use AutoEmbed; other movies remain on VidSync. An explicit per-title
 * provider or manual embed URL can still override this policy in the screen
 * that owns the title.
 */
export function preferredProviderForMedia(
    type: MediaType,
    metadata: PlaybackTitleMetadata = {},
): ProviderId {
    if (type === 'tv') return 'nxsha';
    return isIndianHindiMovie(metadata) ? 'autoembed' : 'vidsync';
}

/* -------------------------------------------------------------------------- */
/*  IMDb id extraction                                                       */
/* -------------------------------------------------------------------------- */

const IMDB_RE = /\btt\d{6,10}\b/i;

export function extractImdbId(text: string | null | undefined): string | null {
    if (!text) return null;
    const m = text.match(IMDB_RE);
    return m ? m[0].toLowerCase() : null;
}

/* -------------------------------------------------------------------------- */
/*  Provider detection from URL                                              */
/* -------------------------------------------------------------------------- */

export function detectProviderFromUrl(url: string): ProviderId | null {
    if (!url) return null;
    try {
        const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        if (host === 'nxsha.space' || host === 'web.nxsha.app') return 'nxsha';
        if (host === 'autoembed.cc' || host === 'player.autoembed.cc' || host === 'watch.autoembed.cc') return 'autoembed';
        if (host === 'vidsync.pro' || host === 'www.vidsync.pro') return 'vidsync';
        if (host === 'nhdapi.com' || host === 'nhdapi.st') return 'nhd';
        return 'custom';
    } catch {
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/*  Custom template validation                                               */
/* -------------------------------------------------------------------------- */

export function validateCustomTemplate(
    template: string,
    type: MediaType,
): { ok: true } | { ok: false; error: string } {
    if (typeof template !== 'string' || !template.trim()) {
        return { ok: false, error: 'Template khali hai' };
    }
    let url: URL;
    try {
        url = new URL(template.replace(/\{(?:id|tmdb|s|e)\}/g, '1'));
    } catch {
        return { ok: false, error: 'Valid URL nahi hai (http/https chahiye)' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { ok: false, error: 'Sirf http/https URLs allowed hain' };
    }
    if (!template.includes('{id}')) {
        return { ok: false, error: 'Template me {id} placeholder hona zaroori hai' };
    }
    if (type === 'tv') {
        if (!template.includes('{s}')) {
            return { ok: false, error: 'TV template me {s} (season) placeholder hona zaroori hai' };
        }
        if (!template.includes('{e}')) {
            return { ok: false, error: 'TV template me {e} (episode) placeholder hona zaroori hai' };
        }
    }
    return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  URL building                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Build a full embed URL for the given provider + media.
 *
 * Resolution order:
 *   1. If a fully qualified `embed_url` override is given, use it verbatim
 *      (for titles that have a manual custom embed).
 *   2. Pick template by (provider, type) — preferring overrides over defaults.
 *   3. Substitute placeholders. Numeric season/episode are 1-based.
 *   4. If provider === 'nxsha' and strictHindi is true, append `one_server=true`
 *      (idempotent — won't add twice).
 */
export function buildEmbedUrl(
    provider: ProviderId,
    type: MediaType,
    params: BuildEmbedParams & { embed_url?: string },
    overrides: CustomTemplateOverrides = {},
): string {
    // Manual override wins — use verbatim.
    if (params.embed_url && params.embed_url.trim()) {
        return params.embed_url.trim();
    }

    let template: string;
    if (provider === 'custom') {
        const t = type === 'movie' ? overrides.movieTemplate : overrides.tvTemplate;
        if (!t) {
            throw new Error(`custom provider ke liye ${type} template set karo`);
        }
        template = t;
    } else {
        const base = getProvider(provider);
        if (!base) throw new Error(`Unknown provider: ${provider}`);
        template =
            (type === 'movie' ? overrides.movieTemplate : overrides.tvTemplate) ??
            (type === 'movie' ? base.movieTemplate : base.tvTemplate);
    }

    // Validate that the mandatory placeholders are present.
    const v = validateCustomTemplate(template, type);
    if (!v.ok) throw new Error(v.error);

    // Nxsha/NHD/AutoEmbed accept either identifier and prefer IMDb. VidSync's
    // documented path is TMDB-first, so use the numeric id whenever available
    // and only fall back to IMDb for older catalog entries.
    const imdbId = params.imdbId ? extractImdbId(params.imdbId) : null;
    const tmdbId = params.tmdbId != null ? String(params.tmdbId) : '';
    const id = (provider === 'vidsync'
        ? (tmdbId || imdbId)
        : (imdbId || tmdbId)) || '';
    if (!id) {
        throw new Error('Embed URL banane ke liye ya to tmdbId ya imdbId chahiye');
    }

    const s = params.season ?? 1;
    const e = params.episode ?? 1;
    if (type === 'tv' && (!Number.isInteger(s) || s < 1 || !Number.isInteger(e) || e < 1)) {
        throw new Error('Season/Episode 1-based positive integer hona chahiye');
    }

    let url = template
        .replace(/\{id\}/g, encodeURIComponent(id))
        .replace(/\{tmdb\}/g, encodeURIComponent(tmdbId || id))
        .replace(/\{s\}/g, String(s))
        .replace(/\{e\}/g, String(e));

    // Nxsha strict-Hindi toggle: append one_server=true idempotently.
    if (provider === 'nxsha' && params.strictHindi) {
        try {
            const u = new URL(url);
            if (u.searchParams.get('one_server') !== 'true') {
                u.searchParams.set('one_server', 'true');
            }
            url = u.toString();
        } catch {
            // Template had {placeholders} which aren't actually substituted?
            // Fallback: append naively.
            url += (url.includes('?') ? '&' : '?') + 'one_server=true';
        }
    }

    return url;
}

/* -------------------------------------------------------------------------- */
/*  Download page URL helpers                                                */
/* -------------------------------------------------------------------------- */

export function buildDownloadUrl(
    provider: 'nxsha' | 'vidsync' | 'nhd',
    type: MediaType,
    params: { tmdbId?: string | number; imdbId?: string; season?: number; episode?: number },
): string {
    const imdbId = params.imdbId ? extractImdbId(params.imdbId) : null;
    const tmdbId = params.tmdbId != null ? String(params.tmdbId) : '';
    const id = (provider === 'vidsync'
        ? (tmdbId || imdbId)
        : (imdbId || tmdbId)) || '';
    const base = provider === 'nxsha'
        ? 'https://nxsha.space'
        : provider === 'vidsync'
            ? 'https://vidsync.pro'
            : 'https://nhdapi.com';
    const path = provider === 'vidsync' ? '/embed/download' : '/dl';
    if (type === 'movie') return `${base}${path}/movie/${encodeURIComponent(id)}`;
    const s = params.season ?? 1;
    const e = params.episode ?? 1;
    return `${base}${path}/tv/${encodeURIComponent(id)}/${s}/${e}`;
}

/* -------------------------------------------------------------------------- */
/*  NHD subtitles JSON endpoint (no key required)                            */
/* -------------------------------------------------------------------------- */

export function buildNhdSubtitlesUrl(
    type: MediaType,
    tmdbId: string | number,
    season?: number,
    episode?: number,
): string {
    const base = 'https://nhdapi.com/api/subtitles';
    const url = new URL(base);
    url.searchParams.set('mediaType', type);
    url.searchParams.set('tmdbId', String(tmdbId));
    if (type === 'tv') {
        url.searchParams.set('season', String(season ?? 1));
        url.searchParams.set('episode', String(episode ?? 1));
    }
    return url.toString();
}

export interface NhdSubtitle {
    language: string;
    display: string;
    url: string;
    format: string;
}

export async function fetchNhdSubtitles(
    type: MediaType,
    tmdbId: string | number,
    season?: number,
    episode?: number,
): Promise<NhdSubtitle[]> {
    try {
        const res = await fetch(buildNhdSubtitlesUrl(type, tmdbId, season, episode));
        if (!res.ok) return [];
        const data = (await res.json()) as { success?: boolean; subtitles?: NhdSubtitle[] };
        if (!data.success || !Array.isArray(data.subtitles)) return [];
        return data.subtitles;
    } catch {
        return [];
    }
}
