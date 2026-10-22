#!/usr/bin/env node
/**
 * ToonStream movie slugs for the movies already in the Crunchyroll catalog.
 *
 * Owner: "jo movies jitna hai na humne unka toonstream server nhi lagya hai
 * unka laga do jisse movie ka na mile usse rehne dena" — i.e. every movie in the
 * page (19 Ghibli films + DAN DA DAN: First Encounter + Another World) should
 * get a ToonStream (Server 2) route too, and the ones ToonStream does not carry
 * are simply left without it.
 *
 * Movies live on a different URL shape than series:
 *   series -> /series/<slug>/ + /episode/<slug>-<s>x<e>/
 *   movie  -> /movies/<slug>
 * so `api/toonstream.mjs` resolves them through `resolveMovie()` (search +
 * title check + player-slot check) and this script only caches the slug it
 * verified, so the page does not have to search on every play:
 *
 *   var TS_MOVIES={ spirited:{ slug:'spirited-away' }, … }
 *
 * Nothing is invented: a movie only appears here when its page returned 200,
 * the page title matched, and the page carried real player slots. Movies that
 * fail are reported and skipped (owner's "rehne dena").
 *
 * Usage:
 *   node scripts/harvest-toonstream-movies.mjs             harvest + bake
 *   node scripts/harvest-toonstream-movies.mjs --from-state bake only (no network)
 *   node scripts/harvest-toonstream-movies.mjs --check      exit 1 when stale
 *   node scripts/harvest-toonstream-movies.mjs --dry-run    print, write nothing
 *
 * Env: TS_MOVIES_STATE_FILE / TS_MOVIES_HTML_FILE point the bake elsewhere
 * (tests, previews). TS_MOVIES_ONLY=key1,key2 limits a probe run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _internal } from '../api/toonstream.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_FILE = resolve(process.env.TS_MOVIES_HTML_FILE || resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'));
const STATE_FILE = resolve(process.env.TS_MOVIES_STATE_FILE || resolve(ROOT, 'data', 'toonstream-movies.json'));

const START = '/*TS_MOVIES_START*/';
const END = '/*TS_MOVIES_END*/';
const NOTE = '/* Written by scripts/harvest-toonstream-movies.mjs — do not edit by hand. */';

const FROM_STATE = process.argv.includes('--from-state');
const CHECK = process.argv.includes('--check');
const DRY_RUN = process.argv.includes('--dry-run');
const DEBUG = process.env.TS_MOVIES_DEBUG === '1';
const ONLY = String(process.env.TS_MOVIES_ONLY || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

/** Site ka slug rule (series wala hi): lowercase, punctuation hata kar dashes. */
function guessedSlug(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const BASE = 'https://toonstream.us';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAMPLE_FILE = resolve(ROOT, 'data', 'toonstream-movie-sample.html');

async function pageText(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
        return { status: res.status, text: await res.text() };
    } catch (error) {
        return { status: 0, text: '', error: String(error?.message || error) };
    }
}

/**
 * Ek failing movie ka raw page repo me rakh dete hain.
 *
 * Sandbox se toonstream reach nahi hota, isliye "page hai par server nahi
 * mila" ka asli karan sirf HTML dekh kar pata chalta hai (slots JS se aate
 * hain ya site ne markup badla). Sample sirf ek baar likha jata hai.
 */
async function dumpSample(slug) {
    if (existsSync(SAMPLE_FILE)) return;
    const page = await pageText(`${BASE}/movies/${slug}`);
    if (!page.text) return;
    writeFileSync(SAMPLE_FILE, page.text.slice(0, 400_000));
    console.log(`sample saved: data/toonstream-movie-sample.html (${page.status}, ${slug})`);
}

/**
 * Movies in the page: every `shows` entry marked `type:'Movie'`.
 *
 * The `shows` object is plain JS (not JSON), so this reads just the fields we
 * need with the same quote-aware regex the other harvesters use. Imported
 * entries always open with `key:{title:'…'`.
 */
export function catalogMovies(html) {
    const block = String(html).slice(
        String(html).indexOf('var shows={'),
        String(html).indexOf('var rows=['),
    );
    const out = [];
    const re = /\n\s+([A-Za-z0-9_]+):\{title:'((?:\\.|[^'\\])*)'/g;
    for (const match of block.matchAll(re)) {
        const start = match.index;
        // The entry ends at the next entry (or the block's closing brace).
        const next = block.indexOf(':{title:', start + match[0].length);
        const entry = block.slice(start, next === -1 ? block.length : next);
        if (!/type:'Movie'/.test(entry)) continue;
        out.push({ key: match[1], title: match[2].replace(/\\'/g, "'") });
    }
    return out;
}

/** Bake the state into the page's TS_MOVIES block. */
export function bake(html, state) {
    const source = String(html);
    const start = source.indexOf(START);
    const end = source.indexOf(END);
    if (start === -1 || end === -1 || end < start) throw new Error('TS_MOVIES markers are missing from the page');
    const payload = {};
    for (const [key, entry] of Object.entries(state.movies || {})) {
        if (!entry?.slug) continue;
        payload[key] = { slug: entry.slug, ...(entry.pageTitle ? { title: entry.pageTitle } : {}) };
    }
    const block = [START, NOTE, `var TS_MOVIES=${JSON.stringify(payload)};`, END].join('\n');
    return { html: source.slice(0, start) + block + source.slice(end + END.length), block, count: Object.keys(payload).length };
}

async function main() {
    const html = readFileSync(HTML_FILE, 'utf8');
    const movies = catalogMovies(html);
    const target = ONLY.length ? movies.filter((movie) => ONLY.includes(movie.key)) : movies;
    console.log(`Movies in catalog: ${movies.length} | checking: ${target.length}`);

    const state = FROM_STATE
        ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
        : { updated: new Date().toISOString(), movies: {} };

    if (!FROM_STATE) {
        /* Har run par saari movies dobara verify hoti hain.
           Pehle purane slugs merge kiye ja rahe the, aur ek galat match
           ("Another World" -> Re:ZERO Frozen Bond) state me chipka reh gaya —
           user ko galat server dikhta. Ab state sirf is run ka sach hai. */
        const missed = [];
        for (const movie of target) {
            try {
                const steps = [];
                const found = await _internal.resolveMovie({ title: movie.title, slug: '' }, steps);
                if (!found) {
                    missed.push(movie.key);
                    const detail = steps.map((step) => `${step.step}${step.status ? ':' + step.status : ''}${step.links !== undefined ? ':' + step.links : ''}${step.got ? ':"' + step.got + '"' : ''}`).join(' ');
                    console.log(`MISS ${movie.key.padEnd(28)} ${movie.title} | ${detail}`);
                    // Jo sample pehle se hai use nahi chhedte; warna pehla fail.
                    const lastSlug = guessedSlug(movie.title);
                    await dumpSample(lastSlug);
                    continue;
                }
                const slug = found.movieUrl.replace(/^.*\/movies\//, '');
                state.movies[movie.key] = { slug, pageTitle: found.title, servers: found.servers.length };
                console.log(`OK   ${movie.key.padEnd(28)} ${slug} (${found.servers.length} servers)`);
            } catch (error) {
                missed.push(movie.key);
                console.log(`FAIL ${movie.key.padEnd(28)} ${String(error?.message || error).slice(0, 80)}`);
            }
            await sleep(150);
        }
        // Jo movie ToonStream par nahi hai uska purana slug bhi hata do — warna
        // server button khaali player kholta.
        if (!ONLY.length) {
            for (const key of Object.keys(state.movies)) {
                if (!movies.some((movie) => movie.key === key)) delete state.movies[key];
            }
        }
        state.missed = missed;
        state.updated = new Date().toISOString();
    }

    const baked = bake(html, state);
    console.log(
        `Movies with a ToonStream route: ${baked.count}/${movies.length}` +
            (state.missed?.length ? ` | nahi mile: ${state.missed.join(', ')}` : ''),
    );

    if (CHECK) {
        const current = html.slice(html.indexOf(START), html.indexOf(END) + END.length);
        if (current !== baked.block) {
            console.error('TS_MOVIES block out of date — `node scripts/harvest-toonstream-movies.mjs` chalao.');
            process.exitCode = 1;
            return;
        }
        console.log('TS_MOVIES in sync');
        return;
    }
    if (DRY_RUN) {
        console.log('--dry-run: kuch nahi likha');
        return;
    }
    if (!FROM_STATE) writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    writeFileSync(HTML_FILE, baked.html);
    console.log('baked TS_MOVIES into the page');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((error) => {
        console.error(`harvest-toonstream-movies: ${error?.stack || error?.message || error}`);
        process.exitCode = 1;
    });
}
