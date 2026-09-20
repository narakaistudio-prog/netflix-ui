/**
 * TV-episode embed providers.
 *
 * A provider is a URL template with three placeholders:
 *   {id} = IMDb ID (tt1234567)
 *   {s}  = season number
 *   {e}  = episode number
 *
 * Admins can also paste a "custom template" (Nxsha domains change
 * sometimes, e.g. nxsha.space -> web.nxsha.app). A custom template is only
 * accepted when it contains ALL THREE placeholders — validated before the
 * series is saved.
 *
 * The iframe that renders these URLs is cross-origin: playback state can
 * never be read from it (no postMessage tracking). The player just renders
 * the URL and renders nothing more.
 */

export interface EmbedProvider {
    id: string;
    name: string;
    template: string;
}

export const CUSTOM_PROVIDER_ID = 'custom';

export const PROVIDERS: EmbedProvider[] = [
    {
        id: 'nxsha',
        name: 'Nxsha (Hindi)',
        // one_server=true & disable_app_ad=true keep the ad surface small.
        template:
            'https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true',
    },
    {
        id: 'nhd',
        name: 'NHD',
        template: 'https://nhdapi.com/tv/{id}/{s}/{e}',
    },
];

const NXSHA = getProviderOrThrow('nxsha');
const NHD = getProviderOrThrow('nhd');

function getProviderOrThrow(id: string): EmbedProvider {
    const provider = PROVIDERS.find(p => p.id === id);
    if (!provider) throw new Error(`Unknown provider: ${id}`);
    return provider;
}

export function getProvider(id: string): EmbedProvider | undefined {
    return PROVIDERS.find(p => p.id === id);
}

/** Loose IMDb id check — tt + 4..10 digits. */
export function isValidImdbId(value: string): boolean {
    return /^tt\d{4,10}$/.test((value ?? '').trim().toLowerCase());
}

/** The placeholders every template must contain. */
export const TEMPLATE_PLACEHOLDERS = ['id', 's', 'e'] as const;

/** Placeholder tokens, e.g. '{id}'. */
export const placeholderToken = (name: string): string => `{${name}}`;

/**
 * Returns the placeholders missing from `template` (empty array = valid).
 * Matching is exact: templates must use lowercase {id} {s} {e}.
 */
export function missingPlaceholders(template: string): string[] {
    const t = (template ?? '').trim();
    return TEMPLATE_PLACEHOLDERS.filter(p => !t.includes(placeholderToken(p)));
}

/** A template must be an http(s) URL that contains all three placeholders. */
export function isValidTemplate(template: string): boolean {
    const t = (template ?? '').trim();
    if (!/^https?:\/\//i.test(t)) return false;
    return missingPlaceholders(t).length === 0;
}

/** Human-readable reason a template was rejected ('' = accepted). */
export function templateError(template: string): string {
    const t = (template ?? '').trim();
    if (!t) return 'Template is required.';
    if (!/^https?:\/\//i.test(t)) {
        return 'Template must be a full URL starting with http:// or https://.';
    }
    const missing = missingPlaceholders(t);
    if (missing.length) {
        const tokens = missing.map(placeholderToken).join(', ');
        return `Template is missing placeholder${missing.length > 1 ? 's' : ''}: ${tokens}. Every template needs {id}, {s} and {e}.`;
    }
    return '';
}

/**
 * Builds the embed URL for one episode by string-replacing the template.
 * Replacements are global so {s} etc. could even appear twice.
 */
export function buildEmbedUrl(
    template: string,
    coords: { id: string; s: number; e: number },
): string {
    const t = (template ?? '').trim();
    return t
        .replace(/\{id\}/g, (coords.id ?? '').trim())
        .replace(/\{s\}/g, String(coords.s))
        .replace(/\{e\}/g, String(coords.e));
}

/** The template a saved series actually uses (custom template wins). */
export function resolveTemplate(series: {
    providerId: string;
    template?: string;
}): string {
    if (series.providerId === CUSTOM_PROVIDER_ID) {
        return (series.template ?? '').trim();
    }
    return getProvider(series.providerId)?.template ?? NXSHA.template;
}

/** Display name of the provider a saved series was added with. */
export function providerLabel(series: {
    providerId: string;
    template?: string;
}): string {
    if (series.providerId === CUSTOM_PROVIDER_ID) return 'Custom template';
    return getProvider(series.providerId)?.name ?? 'Unknown provider';
}

/**
 * "Switch player" fallback: always the *other* proven preset, so the same
 * {id}/{s}/{e} can be retried on a different host when one is down.
 *   nxsha   -> NHD
 *   nhd     -> Nxsha (Hindi)
 *   custom  -> Nxsha (Hindi)
 */
export function fallbackProvider(series: { providerId: string }): EmbedProvider {
    if (series.providerId === 'nxsha') return NHD;
    return NXSHA;
}
