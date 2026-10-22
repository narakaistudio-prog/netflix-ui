#!/usr/bin/env node
/**
 * ToonStream movie probe — network-side diagnostics.
 *
 * Sandbox se toonstream.us reach nahi hota, isliye ye chhota script hosted
 * runner par chalta hai aur batata hai movie pages ki asli shape kya hai:
 *
 *   - /s?q=<title>&type=movies ka status aur kitne /movies/<slug> links mile
 *   - har slug variant ka status, page ka title, player slots aur iframes
 *
 * Output `data/toonstream-movie-probe.json` (aur pehli search ka raw HTML)
 * repo me commit hota hai, taaki slug search ko asli data par theek kiya ja
 * sake — andaze se nahi.
 *
 * Usage: node scripts/probe-toonstream-movies.mjs [--only kaguya,totoro]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _internal } from '../api/toonstream.mjs';
import { catalogMovies } from './harvest-toonstream-movies.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const OUT_PATH = resolve(ROOT, 'data', 'toonstream-movie-probe.json');
const SEARCH_SAMPLE = resolve(ROOT, 'data', 'toonstream-movie-search.html');
const BASE = 'https://toonstream.us';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function pageText(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow' });
        return { status: res.status, text: await res.text() };
    } catch (error) {
        return { status: 0, text: '', error: String(error?.message || error) };
    }
}

const slugify = (title) =>
    String(title || '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/** Site ke slug ke plausible variants (spelling + leading "the"). */
function variants(title) {
    const base = slugify(title);
    const out = new Set([base]);
    if (/^the-/.test(base)) out.add(base.slice(4));
    else out.add(`the-${base}`);
    out.add(base.replace(/\bneighbor\b/g, 'neighbour'));
    out.add(base.replace(/\bneighbour\b/g, 'neighbor'));
    if (base.includes('princess')) out.add(base.replace(/-the-/, '-'));
    return [...out];
}

async function main() {
    const only = String(process.argv.find((arg) => arg.startsWith('--only=')) || '').replace('--only=', '');
    const wanted = new Set(only.split(',').map((v) => v.trim()).filter(Boolean));
    const html = readFileSync(HTML_PATH, 'utf8');
    const routes = JSON.parse(readFileSync(resolve(ROOT, 'data', 'nxsha-titles.json'), 'utf8'));
    const movies = catalogMovies(html, routes).filter((movie) => !wanted.size || wanted.has(movie.key));
    console.log(`Probing ${movies.length} movie(s)`);

    const report = { generatedAt: new Date().toISOString(), movies: [] };
    let dumpedSearch = false;

    for (const movie of movies) {
        const entry = { key: movie.key, title: movie.title, search: null, slugs: [] };

        const search = await pageText(`${BASE}/s?q=${encodeURIComponent(movie.title)}&type=movies`);
        const links = search.status === 200 ? _internal.extractMovieLinks(search.text) : [];
        entry.search = { status: search.status, links: links.length, first: links.slice(0, 5) };
        if (!dumpedSearch && search.text) {
            writeFileSync(SEARCH_SAMPLE, search.text.slice(0, 300_000));
            dumpedSearch = true;
        }

        // Search ne jo links diye + slug variants — dono ko check karte hain.
        const candidates = [...new Set([...links, ...variants(movie.title)])].slice(0, 8);
        for (const slug of candidates) {
            const page = await pageText(`${BASE}/movies/${slug}`);
            const title = page.status === 200 ? _internal.moviePageTitle(page.text) : '';
            const slots = page.status === 200 ? _internal.extractPlayerSlots(page.text).length : 0;
            const iframes = page.status === 200 ? _internal.extractIframes(page.text).length : 0;
            entry.slugs.push({ slug, status: page.status, title: title.slice(0, 60), slots, iframes });
            await sleep(120);
        }
        const best = entry.slugs.find((row) => row.status === 200 && row.slots) || null;
        entry.found = best ? best.slug : null;
        console.log(`${entry.found ? 'OK  ' : 'MISS'} ${movie.key.padEnd(24)} ${JSON.stringify(entry.search.first)} ${entry.found || ''}`);
        report.movies.push(entry);
    }

    writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    const found = report.movies.filter((movie) => movie.found).length;
    console.log(`Probe done: ${found}/${report.movies.length} movies resolvable`);
}

main().catch((error) => {
    console.error(`probe-toonstream-movies: ${error?.stack || error?.message || error}`);
    process.exitCode = 1;
});
