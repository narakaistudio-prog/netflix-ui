#!/usr/bin/env node
/**
 * Fills the IMDb id gap for TV catalog entries using TVMaze — a free,
 * keyless, CORS-enabled API (https://www.tvmaze.com/api).
 *
 * Why this exists: most of the "JustWatch Current TV Shows" shelf is
 * discovered with only a title + poster (no tmdb_id/imdb_id), so Nxsha/NHD
 * playback and the real episode list can never resolve for those titles —
 * the detail screen falls back to a single generic "Episode 1" placeholder.
 * The app already resolves this live, in the browser, via
 * services/tvmaze.ts + hooks/useTvMazeFallback.ts. This script does the same
 * lookup server-side and bakes the IMDb id into data/movies.json, so:
 *   - playback is correct immediately, with zero client-side lookup latency
 *   - it still works in network environments that block TVMaze client-side
 *   - the live client-side fallback still fetches the full episode list with
 *     stills on open (this script intentionally does NOT bake full season/
 *     episode arrays — that would bloat the catalog file for data the app
 *     already fetches on demand)
 *
 * Non-destructive: only ever fills `imdb_id`/`embed_provider` when they are
 * missing. Never overwrites existing identifiers or OMDb-sourced metadata.
 *
 * Usage:
 *   node scripts/enrich-tvmaze.mjs            # enrich every eligible TV title
 *   node scripts/enrich-tvmaze.mjs --limit=50  # cap how many shows to resolve this run
 *   node scripts/enrich-tvmaze.mjs --dry-run   # report matches without writing
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = join(ROOT, 'data', 'movies.json');
const TVMAZE_BASE = 'https://api.tvmaze.com';
// TVMaze's documented rate limit is 20 requests / 10s per IP. Two requests
// per title (search + show+episodes), so one title every 1.1s stays well
// under that even accounting for retries.
const REQUEST_SPACING_MS = 1100;
const REQUEST_TIMEOUT_MS = 10_000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : Infinity;

function normalize(title) {
    return String(title || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function tvMazeGet(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${TVMAZE_BASE}${path}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`TVMaze ${res.status} for ${path}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function findShow(title, year) {
    const results = await tvMazeGet(`/search/shows?q=${encodeURIComponent(title)}`);
    if (!Array.isArray(results) || results.length === 0) return null;

    const target = normalize(title);
    const exact = results.filter(r => normalize(r.show?.name) === target);
    const pool = exact.length ? exact : results;

    if (year) {
        const y = Number.parseInt(year, 10);
        const withYear = pool.find(r => {
            const premiered = r.show?.premiered ? Number.parseInt(r.show.premiered.slice(0, 4), 10) : null;
            return premiered != null && Math.abs(premiered - y) <= 1;
        });
        if (withYear) return withYear.show;
    }
    return pool[0]?.show ?? null;
}

async function main() {
    const raw = readFileSync(CATALOG_PATH, 'utf8');
    const data = JSON.parse(raw);

    // Dedupe by id — the catalog is denormalized across many shelves.
    const byId = new Map();
    for (const row of data.movies) {
        for (const movie of row.movies ?? []) {
            if (!byId.has(movie.id)) byId.set(movie.id, movie);
        }
    }

    const candidates = [...byId.values()].filter(m => {
        const isSeries = m.mediaType === 'tv' || (m.mediaType !== 'movie' && m.type === 'SERIES');
        return isSeries && !m.tmdb_id && !m.imdb_id && m.title;
    });

    console.log(`Catalog has ${byId.size} unique titles; ${candidates.length} TV shows need an IMDb id.`);
    const toProcess = candidates.slice(0, limit);
    if (toProcess.length < candidates.length) {
        console.log(`Processing the first ${toProcess.length} (--limit) this run.`);
    }

    const resolved = new Map(); // id -> { imdbId }
    let matched = 0;
    let failed = 0;

    for (let i = 0; i < toProcess.length; i++) {
        const movie = toProcess[i];
        try {
            const show = await findShow(movie.title, movie.year);
            const imdbId = show?.externals?.imdb;
            if (imdbId) {
                resolved.set(movie.id, { imdbId });
                matched += 1;
                console.log(`[${i + 1}/${toProcess.length}] ✓ ${movie.title} -> ${imdbId}`);
            } else {
                failed += 1;
                console.log(`[${i + 1}/${toProcess.length}] ✗ ${movie.title} (no TVMaze/IMDb match)`);
            }
        } catch (err) {
            failed += 1;
            console.log(`[${i + 1}/${toProcess.length}] ✗ ${movie.title} (${err.message})`);
        }
        if (i < toProcess.length - 1) await sleep(REQUEST_SPACING_MS);
    }

    console.log(`\nMatched ${matched}, unmatched ${failed}.`);
    if (dryRun) {
        console.log('--dry-run: not writing data/movies.json.');
        return;
    }
    if (matched === 0) {
        console.log('Nothing to write.');
        return;
    }

    let fieldsSet = 0;
    for (const row of data.movies) {
        for (const movie of row.movies ?? []) {
            const patch = resolved.get(movie.id);
            if (!patch) continue;
            if (!movie.imdb_id) {
                movie.imdb_id = patch.imdbId;
                fieldsSet += 1;
            }
            if (!movie.embed_provider) {
                movie.embed_provider = 'nxsha';
            }
        }
    }

    writeFileSync(CATALOG_PATH, `${JSON.stringify(data, null, 4)}\n`);
    console.log(`Wrote ${fieldsSet} imdb_id fields to ${CATALOG_PATH}.`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
