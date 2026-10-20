/**
 * M2Box links, per title, remembered in the browser.
 *
 * MovieBox ka koi per-ID embed nahi hota — har title/dub ka apna watch-page
 * link hota hai (`…/movies/<slug>?id=<subjectId>`). Isliye "Server 2" ko
 * chalane ke liye ek link chahiye. Wo link yahan title ke hisaab se yaad
 * rakha jata hai:
 *
 *   - title row me pehle se `embed_url` / `videoUrl` me m2box link ho to
 *     wahi use hota hai (kuch jodna nahi padta),
 *   - warna viewer/owner ek baar link paste karta hai aur wahi browser me
 *     save ho jata hai (dobara paste karne ki zaroorat nahi).
 *
 * Sirf link store hota hai — signed MP4 nahi (wo ghanton me expire hota hai
 * aur DB me kabhi nahi rakha jata).
 */

import { cleanMovieboxInput, isMovieboxUrl, MOVIEBOX_SITE, parseMovieboxInput } from './moviebox';
import { movieboxCatalogEntry } from './movieboxCatalog';

const STORAGE_KEY = 'netflix-moviebox-links-v1';
/** Standalone /moviebox page apna link is key par rakhta hai. */
export const MOVIEBOX_PAGE_KEY = '@page';

/**
 * Link kahan se aaya:
 *   row     — title ki row me hi m2box link tha (tab M2Box pehla server banta hai)
 *   catalog — harvester ne bake kiya hai (`data/moviebox-links.json`), sab titles par
 *   saved   — viewer ne ek baar paste kiya tha
 */
export type MovieboxLinkSource = 'row' | 'catalog' | 'saved';

export interface MovieboxSavedLink {
    /** Jaisa paste hua tha (trimmed). */
    url: string;
    /** `true` = frame server-proxy se kholo (jab seedha frame blank aaye). */
    proxy: boolean;
    /** Epoch ms — list ko naye-pehle order me dikhane ke liye. */
    savedAt: number;
}

export type MovieboxLinkStore = Record<string, MovieboxSavedLink>;

function storage(): Storage | null {
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
        // private mode / SSR — koi baat nahi, bas yaad nahi rahega
    }
    return null;
}

export function loadMovieboxLinks(): MovieboxLinkStore {
    const store = storage();
    if (!store) return {};
    try {
        const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: MovieboxLinkStore = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            const entry = value as Partial<MovieboxSavedLink> | undefined;
            if (!entry || typeof entry.url !== 'string' || !entry.url.trim()) continue;
            out[key] = {
                url: entry.url.trim(),
                proxy: Boolean(entry.proxy),
                savedAt: Number(entry.savedAt) || 0,
            };
        }
        return out;
    } catch {
        return {};
    }
}

function writeStore(next: MovieboxLinkStore) {
    const store = storage();
    if (!store) return;
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // quota / private mode — chup-chaap ignore
    }
}

/** Ek title ka link yaad karo. `url` valid m2box link hona chahiye. */
export function saveMovieboxLink(
    key: string,
    url: string,
    opts: { proxy?: boolean } = {},
): MovieboxSavedLink | null {
    const trimmed = cleanMovieboxInput(url);
    if (!key || !isMovieboxUrl(trimmed)) return null;
    const next = loadMovieboxLinks();
    const entry: MovieboxSavedLink = {
        url: trimmed,
        proxy: Boolean(opts.proxy),
        savedAt: Date.now(),
    };
    next[key] = entry;
    writeStore(next);
    return entry;
}

export function getMovieboxLink(key: string): MovieboxSavedLink | null {
    if (!key) return null;
    return loadMovieboxLinks()[key] ?? null;
}

export function removeMovieboxLink(key: string) {
    const next = loadMovieboxLinks();
    if (!(key in next)) return;
    delete next[key];
    writeStore(next);
}

/** Naye-pehle order me saare saved links (standalone page ki list ke liye). */
export function listMovieboxLinks(): Array<{ key: string; link: MovieboxSavedLink }> {
    return Object.entries(loadMovieboxLinks())
        .map(([key, link]) => ({ key, link }))
        .sort((a, b) => b.link.savedAt - a.link.savedAt);
}

/** Title ke liye stable storage key — tmdb id pehle, warna catalog card id. */
export function movieboxKeyForTitle(title: {
    id?: string | number;
    tmdb_id?: string | number;
    mediaType?: string;
}): string {
    if (title?.tmdb_id != null && String(title.tmdb_id).trim()) {
        return `tmdb:${String(title.tmdb_id).trim()}:${title.mediaType === 'tv' ? 'tv' : 'movie'}`;
    }
    return `id:${String(title?.id ?? '').trim()}`;
}

/**
 * Title row me pehle se maujood m2box link (admin ne `embed_url` ya
 * `videoUrl` me daala ho). Nahi mila to `null`.
 */
export function movieboxLinkFromTitle(title: {
    embed_url?: string;
    videoUrl?: string;
} | null | undefined): string | null {
    if (!title) return null;
    for (const candidate of [title.embed_url, title.videoUrl]) {
        if (typeof candidate === 'string' && isMovieboxUrl(candidate)) return candidate.trim();
    }
    return null;
}

/**
 * Ek title ke liye M2Box ka link, is tarteeb me:
 *   1. row ka apna link (`embed_url` / `videoUrl`),
 *   2. baked catalog link (harvester ne poore Netflix catalog ke liye khoja),
 *   3. is browser me saved link.
 *
 * Teenon na hon to `null` — player link paste karne ko kahega.
 * `fromTitle` tab `true` hai jab link title ke data se hi aaya ho (row ya
 * catalog). "M2Box pehla server hai" ka faisla `source === 'row'` par hota hai.
 */
export function resolveMovieboxLink(
    title:
        | { id?: string | number; tmdb_id?: string | number; mediaType?: string; embed_url?: string; videoUrl?: string }
        | null
        | undefined,
): { link: string; key: string; proxy: boolean; fromTitle: boolean; source: MovieboxLinkSource } | null {
    if (!title) return null;
    const key = movieboxKeyForTitle(title);

    const fromTitle = movieboxLinkFromTitle(title);
    if (fromTitle) return { link: fromTitle, key, proxy: false, fromTitle: true, source: 'row' };

    const baked = movieboxCatalogEntry(title);
    if (baked?.url && isMovieboxUrl(baked.url)) {
        return { link: baked.url, key, proxy: false, fromTitle: true, source: 'catalog' };
    }

    const saved = getMovieboxLink(key);
    if (saved) return { link: saved.url, key, proxy: saved.proxy, fromTitle: false, source: 'saved' };

    return null;
}

/**
 * Link se ek chhota, insaan ke padhne layak label — UI me dikhane ke liye.
 * (Slug hi dikhate hain, poora URL nahi.)
 */
export function describeMovieboxLink(url: string): string {
    const ref = parseMovieboxInput(url);
    if (ref?.detailPath) return ref.detailPath;
    if (ref?.subjectId) return ref.subjectId;
    try {
        return new URL(url).hostname;
    } catch {
        return MOVIEBOX_SITE;
    }
}
