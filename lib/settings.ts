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

const SETTINGS_VERSION = 2;

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
        // Existing browsers may have saved strictHindi=false before Hindi-first
        // mode became the default. Migrate once, while preserving any explicit
        // choice made after this version.
        if (parsed.settingsVersion !== SETTINGS_VERSION) {
            merged.settingsVersion = SETTINGS_VERSION;
            merged.strictHindi = true;
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
    return safeParse(readRaw()) ?? { ...DEFAULT_SETTINGS };
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
