/**
 * Baked MovieBox links for the Netflix catalog (Server 2).
 * =======================================================
 * `data/moviebox-links.json` ko harvester bharta hai
 * (`scripts/harvest-moviebox-links.mjs`, GitHub Actions me chalta hai) — catalog
 * ke har title ka MovieBox watch page wahan bake hota hai. Isliye app me
 * "Server 2 · M2Box" bina kuch paste kiye chalta hai.
 *
 * File ka roop:
 *   { generatedAt, stats, links: { "tmdb:<id>": { url, subjectId, detailPath, … } } }
 *
 * Dhyan: yahan sirf watch-page URL rakha jata hai — signed MP4 nahi (wo ghanton
 * me expire hota hai).
 */

import raw from '@/data/moviebox-links.json';
import { isMovieboxUrl } from './moviebox';

export interface MovieboxCatalogEntry {
    /** Canonical m2box.org watch page. */
    url: string;
    subjectId: string;
    detailPath: string;
    /** MovieBox par jo naam hai (dub ke saath, e.g. `Mandaadi [Hindi]`). */
    title?: string;
    year?: number;
    type?: 'movie' | 'tv' | string;
    /** `hindi` jab Hindi dub ka alag subject chuna gaya ho. */
    dub?: string;
    /** Matching confidence (0..1) — harvester ka score. */
    score?: number;
    harvestedAt?: string;
}

interface CatalogFile {
    generatedAt?: string;
    stats?: Record<string, number>;
    links?: Record<string, MovieboxCatalogEntry>;
}

const FILE = (raw ?? {}) as CatalogFile;
const LINKS: Record<string, MovieboxCatalogEntry> = FILE.links ?? {};

/** Kitne titles ka link baked hai (UI/debug ke liye). */
export function movieboxCatalogSize(): number {
    return Object.keys(LINKS).length;
}

/** Bake kab hua tha (ISO string), agar pata ho. */
export function movieboxCatalogGeneratedAt(): string | null {
    return FILE.generatedAt ?? null;
}

/**
 * Pure lookup — koi bhi `links` map aur title do.
 *
 * Key pehle `tmdb:<tmdb_id>` (catalog ka asli id), phir `id:<cardId>` — jin
 * titles ke paas TMDB id nahi hoti unke liye harvester card id par bake karta hai.
 */
export function lookupMovieboxCatalog(
    links: Record<string, MovieboxCatalogEntry> | null | undefined,
    title:
        | { id?: string | number; tmdb_id?: string | number }
        | null
        | undefined,
): MovieboxCatalogEntry | null {
    if (!links || !title) return null;
    const tmdb = title.tmdb_id != null ? String(title.tmdb_id).trim() : '';
    if (tmdb) {
        const hit = links[`tmdb:${tmdb}`];
        if (hit?.url) return hit;
    }
    const id = title.id != null ? String(title.id).trim() : '';
    if (id) {
        const hit = links[`id:${id}`];
        if (hit?.url) return hit;
    }
    return null;
}

/** Is title ka baked MovieBox link (baked file se). */
export function movieboxCatalogEntry(
    title:
        | { id?: string | number; tmdb_id?: string | number; mediaType?: string }
        | null
        | undefined,
): MovieboxCatalogEntry | null {
    return lookupMovieboxCatalog(LINKS, title);
}

/** Sirf URL chahiye ho to (valid m2box page hone par hi). */
export function movieboxCatalogLink(
    title:
        | { id?: string | number; tmdb_id?: string | number; mediaType?: string }
        | null
        | undefined,
): string | null {
    const entry = movieboxCatalogEntry(title);
    return entry && isMovieboxUrl(entry.url) ? entry.url : null;
}
