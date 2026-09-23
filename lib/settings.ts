/**
 * Global embed settings (editable in the admin screen without a redeploy).
 * Persisted in localStorage on web and AsyncStorage on native.
 */

import {
    DEFAULT_NHD_MOVIE,
    DEFAULT_NHD_TV,
    DEFAULT_NXSHA_MOVIE,
    DEFAULT_NXSHA_TV,
    ProviderId,
} from './embeds';

export interface EmbedSettings {
    /** Bumped when a new playback default needs a one-time local migration. */
    settingsVersion: number;
    defaultProvider: ProviderId;
    strictHindi: boolean;
    nxshaMovieTemplate: string;
    nxshaTvTemplate: string;
    nhdMovieTemplate: string;
    nhdTvTemplate: string;
    customMovieTemplate: string;
    customTvTemplate: string;
    /** Optional; only needed for paid/JSON endpoints. Embeds don't require it. */
    nhdApiKey: string;
}

// v3 briefly changed Nxsha's default server. Bump once more so browsers
// that saved that default return to the original template too.
const SETTINGS_VERSION = 4;

const V3_NXSHA_MOVIE =
    'https://nxsha.space/embed/movie/{id}?server=VidHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true&one_server=true';
const V3_NXSHA_TV =
    'https://nxsha.space/embed/tv/{id}/{s}/{e}?server=VidHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true&one_server=true';

export const DEFAULT_SETTINGS: EmbedSettings = {
    settingsVersion: SETTINGS_VERSION,
    defaultProvider: 'nxsha',
    strictHindi: true,
    nxshaMovieTemplate: DEFAULT_NXSHA_MOVIE,
    nxshaTvTemplate: DEFAULT_NXSHA_TV,
    nhdMovieTemplate: DEFAULT_NHD_MOVIE,
    nhdTvTemplate: DEFAULT_NHD_TV,
    customMovieTemplate: 'https://example.com/embed/{id}',
    customTvTemplate: 'https://example.com/embed/{id}/{s}/{e}',
    nhdApiKey: process.env.EXPO_PUBLIC_NHD_API_KEY ?? '',
};

const STORAGE_KEY = 'netflix-embed-settings-v1';

function safeParse(raw: string | null): EmbedSettings | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const merged = { ...DEFAULT_SETTINGS, ...parsed } as EmbedSettings;
        // Preserve the original Hindi-first migration for pre-v2 settings,
        // without overriding later explicit choices of the strict-mode toggle.
        if (parsed.settingsVersion !== SETTINGS_VERSION) {
            merged.settingsVersion = SETTINGS_VERSION;
            if (typeof parsed.settingsVersion !== 'number' || parsed.settingsVersion < 2) {
                merged.strictHindi = true;
            }
            // Only undo the exact Nxsha defaults installed by v3. Do not
            // replace templates someone deliberately customized in Admin.
            if (parsed.settingsVersion === 3) {
                if (merged.nxshaMovieTemplate === V3_NXSHA_MOVIE) {
                    merged.nxshaMovieTemplate = DEFAULT_NXSHA_MOVIE;
                }
                if (merged.nxshaTvTemplate === V3_NXSHA_TV) {
                    merged.nxshaTvTemplate = DEFAULT_NXSHA_TV;
                }
            }
        }
        return merged;
    } catch {
        return null;
    }
}

function readRaw(): string | null {
    try {
        if (typeof localStorage !== 'undefined') return localStorage.getItem(STORAGE_KEY);
    } catch {}
    return null;
}

function writeRaw(value: string) {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
    } catch {}
}

export function loadSettings(): EmbedSettings {
    const raw = readRaw();
    const settings = safeParse(raw);
    if (!settings) return { ...DEFAULT_SETTINGS };
    // Persist the one-time template rollback so the same browser keeps using
    // the original server after reloading or saving Admin settings.
    try {
        if (JSON.parse(raw!)?.settingsVersion !== SETTINGS_VERSION) {
            writeRaw(JSON.stringify(settings));
        }
    } catch {}
    return settings;
}

export function saveSettings(next: EmbedSettings) {
    writeRaw(JSON.stringify(next));
}

export function resetSettings(): EmbedSettings {
    try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    } catch {}
    return { ...DEFAULT_SETTINGS };
}

/**
 * Returns the template overrides object expected by buildEmbedUrl() for a
 * given provider — pulls from saved settings.
 */
export function templateOverridesFor(
    settings: EmbedSettings,
    provider: ProviderId,
): { movieTemplate?: string; tvTemplate?: string } {
    switch (provider) {
        case 'nxsha':
            return {
                movieTemplate: settings.nxshaMovieTemplate,
                tvTemplate: settings.nxshaTvTemplate,
            };
        case 'nhd':
            return {
                movieTemplate: settings.nhdMovieTemplate,
                tvTemplate: settings.nhdTvTemplate,
            };
        case 'custom':
            return {
                movieTemplate: settings.customMovieTemplate,
                tvTemplate: settings.customTvTemplate,
            };
    }
}
