#!/usr/bin/env node
/**
 * Build the home rows from the Netflix "Indian Movies & TV" genre page
 * (data/netflix-genre-100381.txt) with details and images from Nxsha.
 *
 * Netflix gives only the list of titles and their rows. Every detail and image
 * comes from nxsha.space, as for the Trending row. A title is kept only when
 * nxsha has an exact name match with a poster, so no row shows a blank card.
 *
 * Runs on a hosted runner because the workspace sandbox cannot reach nxsha.space.
 * For each unique Netflix title:
 *   1. Search /search?q=<title>. Take the exact name match that has a poster.
 *      Both /movie/<id> and /tv/<id> result links are read; the link type sets
 *      mediaType. Names with a "(Hindi)"-style suffix are retried without it.
 *   2. Read the title page for year, runtime, description, backdrop, cast, genres.
 *   3. Take the w500 poster from the search card.
 * Rows named in the source file are replaced. Other rows, including Trending, are
 * left untouched. Crunchyroll data is never read or written.
 *
 * Presets choose the Netflix page to read:
 *   genre (default)  data/netflix-genre-100381.txt, rows named as on Netflix,
 *                    catalogCollection netflix-genre-100381.
 *   anime            data/netflix-anime-7424.txt, rows prefixed "Anime: " so they
 *                    never replace a genre row with the same name ("Your Next Watch").
 *                    catalogCollection netflix-anime-7424.
 * Titles that nxsha does not match are written to data/<source>.unmatched.txt,
 * so the result can be read from the repo (runner logs are not readable from here).
 *
 * Usage: node scripts/build-netflix-genre-rows.mjs [--preset=genre|anime] [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, parseMoviePage } from './build-trending-nxsha.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOVIES = resolve(ROOT, 'data', 'movies.json');
const PRESETS = {
    genre: {
        source: 'data/netflix-genre-100381.txt',
        collection: 'netflix-genre-100381',
        idPrefix: 'netflix-genre-',
        rowPrefix: '',
    },
    anime: {
        source: 'data/netflix-anime-7424.txt',
        collection: 'netflix-anime-7424',
        idPrefix: 'netflix-anime-',
        rowPrefix: 'Anime: ',
    },
};
const PRESET_ARG = process.argv.find((a) => a.startsWith('--preset='));
const PRESET_NAME = PRESET_ARG ? PRESET_ARG.slice('--preset='.length) : 'genre';
if (!PRESETS[PRESET_NAME]) {
    console.error(`unknown --preset=${PRESET_NAME}; use one of: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
}
const PRESET = PRESETS[PRESET_NAME];
const SOURCE = resolve(ROOT, PRESET.source);
const REPORT = resolve(ROOT, PRESET.source.replace(/\.txt$/, '.unmatched.txt'));
const BASE = 'https://nxsha.space';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DRY = process.argv.includes('--dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Netflix names that nxsha lists differently. Add only after checking nxsha. */
const NXSHA_ALIASES = {
    'Demon Slayer: Kimetsu no Yaiba Infinity Castle I': 'Demon Slayer: Kimetsu no Yaiba Infinity Castle',
    'The Ba**ds of Bollywood': 'The Bastards of Bollywood',
    'Operation Safed Sagar: The Highest Air Force Mission': 'Operation Safed Sagar',
    // Anime: the same single show under nxsha's name (checked on nxsha search).
    'Hajime no Ippo: The Fighting!': 'Fighting Spirit',
    'Gin Tama': 'Gintama',
    "Hell's Paradise: Jigokuraku": "Hell's Paradise",
    'Puniru Is a Cute Slime': 'Puniru Is a Kawaii Slime',
};

async function get(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const res = await fetch(url, {
                    signal: ctl.signal,
                    redirect: 'follow',
                    headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
                });
                if (res.status === 200) return await res.text();
                if (res.status === 404) return null;
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

const norm = (s) =>
    decode(s)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

/** "Title | 123" lines under "## Row" headers. */
export function parseGenreSource(text) {
    const rows = [];
    let current = null;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.replace(/\u200b/g, '').trim();
        if (!line || line.startsWith('#') && !line.startsWith('## ')) continue;
        if (line.startsWith('## ')) {
            current = { rowTitle: line.slice(3).trim(), titles: [] };
            rows.push(current);
            continue;
        }
        const m = /^(.+?)\s*\|\s*(\d+)$/.exec(line);
        if (m && current) current.titles.push({ title: m[1].trim(), netflixId: m[2] });
    }
    return rows;
}

/** Result cards on /search for both movies and TV: [{ type, id, name, year, poster }]. */
export function parseSearchResults(html) {
    const out = [];
    const seen = new Set();
    for (const m of String(html || '').matchAll(/<a\b[^>]*href="\/(movie|tv)\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const type = m[1].toLowerCase() === 'tv' ? 'tv' : 'movie';
        const id = m[2];
        const key = `${type}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const body = m[3];
        const texts = body
            .replace(/<img\b[^>]*>/gi, ' ')
            .replace(/<[^>]+>/g, '\n')
            .split('\n')
            .map((t) => decode(t))
            .filter(Boolean);
        const yearHit = texts.map((t) => /\b(19|20)\d{2}\b/.exec(t)).find(Boolean);
        const name =
            texts.find(
                (t) =>
                    !/^(NR|\d+(\.\d+)?|Coming soon)$/i.test(t) &&
                    !/\b(19|20)\d{2}\b/.test(t) &&
                    !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(t),
            ) || '';
        const img = /<img\b[^>]*src="([^"]+)"/i.exec(body);
        const poster = img && /image\.tmdb\.org\/t\/p\/w500\//.test(img[1]) ? decode(img[1]) : '';
        out.push({ type, id, name, year: yearHit ? yearHit[0] : '', poster });
    }
    return out;
}

/** Name variants to try in order: the alias or name, then shorter forms of it. */
export function searchNames(title) {
    const base = NXSHA_ALIASES[title] || title;
    const names = [base];
    const add = (n) => {
        const t = n.replace(/\s+/g, ' ').trim();
        if (t && !names.includes(t)) names.push(t);
    };
    add(base.replace(/\s*\((Hindi|English|Hindi Version|Reloaded Version|Raw & Undekha|Raw \(Hindi\)|Raw)\)\s*$/i, ''));
    add(base.replace(/\s*\([^)]*\)\s*$/, ''));
    add(base.replace(/\s+-\s+.*$/, ''));
    add(base.replace(/:?\s*Extended Cut$/i, ''));
    return names;
}

/** Name before any subtitle: "Salaar: Part 1 - Ceasefire" -> "Salaar". */
export function headOf(name) {
    return decode(name).split(/\s*:\s*|\s*\(|\s+[-–]\s+/)[0];
}

/**
 * Pick a result with a poster. An exact name match wins; otherwise the result
 * whose name before its subtitle matches (the film "Devara: Part 1" for "Devara").
 * Newest year first among equals.
 */
export function pickMatch(results, wantedName) {
    const want = norm(wantedName);
    const withPoster = results.filter((r) => r.poster);
    const byYear = (a, b) => Number(b.year || 0) - Number(a.year || 0);
    const exact = withPoster.filter((r) => norm(r.name) === want).sort(byYear);
    if (exact.length) return exact[0];
    // A sequel number is part of the name ("Dhoom: 2" is not "Dhoom"), so it never head-matches.
    const isNumberedSequel = (name) => /^[:(\-–]?\s*\d/.test(decode(name).slice(headOf(name).length).trim());
    const head = withPoster
        .filter((r) => norm(headOf(r.name)) === want && !isNumberedSequel(r.name))
        .sort(byYear);
    return head[0] || null;
}

async function findOnNxsha(title) {
    for (const name of searchNames(title)) {
        const html = await get(`${BASE}/search?q=${encodeURIComponent(name)}`);
        const hit = pickMatch(parseSearchResults(html || ''), name);
        if (hit) return { hit, searched: name };
        await sleep(250);
    }
    return null;
}

/** Full item for one Netflix title, or null when nxsha has no usable match. */
async function buildItem({ title, netflixId }) {
    const found = await findOnNxsha(title);
    if (!found) return { status: 'no-nxsha-match' };
    const { hit } = found;
    const page = await get(`${BASE}/${hit.type}/${hit.id}`);
    if (!page) return { status: 'page-missing' };
    const info = parseMoviePage(page);
    const mediaType = hit.type;
    const item = {
        id: `${PRESET.idPrefix}${netflixId}`,
        title: info.title || hit.name || title,
        imageUrl: hit.poster || info.backdrop || '',
        type: mediaType === 'tv' ? 'SERIES' : 'FILM',
        mediaType,
        tmdb_id: hit.id,
        embed_provider: 'nxsha',
        netflixId,
        netflixUrl: `https://www.netflix.com/in/title/${netflixId}`,
        catalogCollection: PRESET.collection,
    };
    if (info.year || hit.year) item.year = info.year || hit.year;
    if (info.description) item.description = info.description;
    if (info.duration) item.duration = info.duration;
    if (info.cast.length) item.cast = info.cast;
    if (info.genres.length) item.genres = info.genres;
    if (info.backdrop) item.backdropUrl = info.backdrop;
    if (!item.imageUrl) return { status: 'no-image' };
    return { status: 'ok', item, nxsha: hit.id, mediaType };
}

async function main() {
    const source = parseGenreSource(readFileSync(SOURCE, 'utf8'));
    const uniq = new Map();
    for (const row of source) for (const t of row.titles) if (!uniq.has(t.netflixId)) uniq.set(t.netflixId, t);
    console.log(`source: ${source.length} rows, ${uniq.size} unique titles`);

    const built = new Map();
    const unmatched = [];
    const report = { ok: 0, failed: 0, byStatus: {} };
    for (const [netflixId, t] of uniq) {
        let res;
        try {
            res = await buildItem({ title: t.title, netflixId });
        } catch (e) {
            res = { status: `error: ${String(e?.message || e)}` };
        }
        built.set(netflixId, res.status === 'ok' ? res.item : null);
        if (res.status === 'ok') {
            report.ok += 1;
            console.log(`ok       ${t.title} -> nxsha ${res.mediaType}/${res.nxsha}`);
        } else {
            report.failed += 1;
            report.byStatus[res.status] = (report.byStatus[res.status] || 0) + 1;
            unmatched.push(`${t.title} | ${netflixId} | ${res.status}`);
            console.log(`${res.status.padEnd(16)} ${t.title}`);
        }
        await sleep(300);
    }

    const rows = [];
    for (const src of source) {
        const seen = new Set();
        const movies = [];
        for (const t of src.titles) {
            const item = built.get(t.netflixId);
            if (!item || seen.has(item.id)) continue;
            seen.add(item.id);
            movies.push(item);
        }
        if (movies.length) rows.push({ rowTitle: `${PRESET.rowPrefix}${src.rowTitle}`, type: 'normal', movies });
    }

    console.log(`built ${report.ok}/${uniq.size} titles into ${rows.length} rows; failed: ${JSON.stringify(report.byStatus)}`);
    if (DRY) {
        console.log('dry run: data/movies.json not written');
        return;
    }

    writeFileSync(REPORT, `# Titles from ${PRESET.source} that nxsha did not match (not shown in the app).\n` +
        unmatched.join('\n') + '\n');
    console.log(`wrote ${REPORT}: ${unmatched.length} unmatched`);

    const data = JSON.parse(readFileSync(MOVIES, 'utf8'));
    const replaced = new Set(source.map((r) => `${PRESET.rowPrefix}${r.rowTitle}`));
    // Keep rows that are not from this source (Trending and others) in their order.
    const kept = data.movies.filter((r) => !replaced.has(r.rowTitle));
    data.movies = [...kept, ...rows];
    writeFileSync(MOVIES, JSON.stringify(data, null, 4) + '\n');
    console.log(`wrote data/movies.json: ${rows.length} ${PRESET_NAME} rows, ${kept.length} other rows kept`);
}

// Run only when executed directly; the parsers above are importable for tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
