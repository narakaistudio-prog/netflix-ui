#!/usr/bin/env node
/**
 * Build data/tv-episodes.json: seasons and episodes for every TV title in
 * data/movies.json, from Nxsha's season API.
 *
 * Runs on a hosted runner (the workspace sandbox cannot reach nxsha.space).
 * For each TV title (keyed by its nxsha/TMDB id):
 *   GET /api/tv/<id>/season/<n> for n = 1, 2, ... until nxsha answers 404
 *   ("Season not found"). Each season gives its name, overview and episodes:
 *   episode number, name, overview, runtime (minutes), still image and air date.
 * Movies and other rows are never changed. Crunchyroll data is never read or written.
 *
 * Usage: node scripts/build-tv-episodes-nxsha.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOVIES = resolve(ROOT, 'data', 'movies.json');
const OUT = resolve(ROOT, 'data', 'tv-episodes.json');
const BASE = 'https://nxsha.space';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SEASON_CAP = 30;
const DRY = process.argv.includes('--dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** JSON from one season endpoint, or null when the season does not exist. */
async function getSeason(id, n) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const res = await fetch(`${BASE}/api/tv/${id}/season/${n}`, {
                    signal: ctl.signal,
                    headers: { 'User-Agent': UA, Accept: 'application/json' },
                });
                if (res.status === 404) return null;
                if (res.status === 200) {
                    const json = await res.json();
                    return json && json.success ? json : null;
                }
            } catch (e) {
                if (attempt === 3) throw e;
            }
            await sleep(600 * attempt);
        }
        return null;
    } finally {
        clearTimeout(to);
    }
}

const clean = (s, max) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** One season in the shape the app reads: { season_number, name, overview, episodes[] }. */
export function toSeason(json) {
    const s = json.season || {};
    const episodes = (json.episodes || []).map((e) => ({
        season: Number(e.season_number ?? s.season_number),
        episode: Number(e.episode_number),
        name: clean(e.name, 160),
        overview: clean(e.overview, 260),
        ...(e.runtime ? { runtime: Number(e.runtime) } : {}),
        ...(e.still_path ? { still: `https://image.tmdb.org/t/p/w500${e.still_path}` } : {}),
        ...(e.air_date ? { air_date: e.air_date } : {}),
    }));
    return {
        season_number: Number(s.season_number),
        name: clean(s.name, 80),
        overview: clean(s.overview, 260),
        episode_count: episodes.length,
        episodes: episodes.sort((a, b) => a.episode - b.episode),
    };
}

async function main() {
    const data = JSON.parse(readFileSync(MOVIES, 'utf8'));
    const ids = new Map();
    for (const row of data.movies) {
        for (const m of row.movies) {
            if (m.mediaType === 'tv' && m.tmdb_id) ids.set(String(m.tmdb_id), m.title || String(m.tmdb_id));
        }
    }
    console.log(`TV titles: ${ids.size}`);

    const out = {};
    let withEpisodes = 0;
    for (const [id, title] of ids) {
        const seasons = [];
        for (let n = 1; n <= SEASON_CAP; n += 1) {
            let json = null;
            try {
                json = await getSeason(id, n);
            } catch (e) {
                console.log(`error     ${title} season ${n}: ${String(e?.message || e)}`);
                break;
            }
            if (!json) break;
            const season = toSeason(json);
            if (season.episodes.length) seasons.push(season);
            await sleep(250);
        }
        if (seasons.length) {
            out[id] = { seasons };
            withEpisodes += 1;
            const eps = seasons.reduce((t, s) => t + s.episodes.length, 0);
            console.log(`ok        ${title} (${id}): ${seasons.length} seasons, ${eps} episodes`);
        } else {
            console.log(`no-seasons ${title} (${id})`);
        }
        await sleep(250);
    }

    console.log(`titles with episodes: ${withEpisodes}/${ids.size}`);
    if (DRY) {
        console.log('dry run: data/tv-episodes.json not written');
        return;
    }
    writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
    console.log(`wrote data/tv-episodes.json (${Object.keys(out).length} titles)`);
}

// Run only when executed directly; the helper above is importable for tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
