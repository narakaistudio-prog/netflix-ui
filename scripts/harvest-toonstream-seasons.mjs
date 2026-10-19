#!/usr/bin/env node
/**
 * ToonStream season layout for the whole anime catalog.
 *
 * The Crunchyroll page takes its season numbers from ToonStream (the site the
 * player actually uses) and only borrows episode metadata from Nxsha, which
 * regularly merges cours (JJK's 24 + 23 episodes are one 59-episode Nxsha
 * season). This job resolves every catalog title to its ToonStream series page,
 * walks the season buttons, and bakes the real counts plus the Nxsha mapping:
 *
 *   var TS_SEASONS={ jjk: { slug:'jujutsu-kaisen',
 *                           seasons:{1:24,2:23},
 *                           nxMap:{1:{season:1,base:0},2:{season:1,base:24}} }, … }
 *
 * The page then renders ToonStream's seasons, reads NX_EPISODE_DATA with the
 * mapped coordinates, and builds both players (ToonStream slug + Nxsha embed).
 *
 * Usage:
 *   node scripts/harvest-toonstream-seasons.mjs              harvest + bake
 *   node scripts/harvest-toonstream-seasons.mjs --from-state bake only (no network)
 *   node scripts/harvest-toonstream-seasons.mjs --check      exit 1 when stale
 *   node scripts/harvest-toonstream-seasons.mjs --dry-run    print, write nothing
 *
 * Env: TS_SEASONS_STATE_FILE / TS_SEASONS_HTML_FILE point the bake elsewhere
 * (tests, previews). TS_SEASONS_ONLY=key1,key2 limits a probe run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _internal } from '../api/toonstream.mjs';
import { decodeEntities, titleKey, titleVariants } from './lib/text.mjs';
import { buildSeasonMap, parseSeasonEpisodes, parseToonSeasons } from './lib/seasons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_FILE = resolve(ROOT, 'data', 'nxsha-titles.json');
const EPISODES_FILE = resolve(ROOT, 'data', 'nxsha-episodes.json');
const STATE_FILE = resolve(process.env.TS_SEASONS_STATE_FILE || resolve(ROOT, 'data', 'toonstream-seasons.json'));
const HTML_FILE = resolve(process.env.TS_SEASONS_HTML_FILE || resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'));
const BASE = 'https://toonstream.us';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const START = '/*TS_SEASONS_START*/';
const END = '/*TS_SEASONS_END*/';

const FROM_STATE = process.argv.includes('--from-state');
const CHECK = process.argv.includes('--check');
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = String(process.env.TS_SEASONS_ONLY || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const tokens = (value) => String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const slugify = (value) =>
    decodeEntities(value)
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

function readJson(file, fallback) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

async function getText(url, { retries = 1 } = {}) {
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const res = await fetch(url, {
                headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
                signal: AbortSignal.timeout(25_000),
            });
            return { status: res.status, text: await res.text() };
        } catch (error) {
            last = error;
            if (attempt < retries) await sleep(600 * (attempt + 1));
        }
    }
    return { status: 0, text: '', error: String(last?.message || last) };
}

/** `var NAME=<json>;` out of the page (balanced scan, no regex truncation). */
function pageVar(html, name) {
    const key = `var ${name}=`;
    const start = html.indexOf(key);
    if (start < 0) return null;
    let i = start + key.length;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; i < html.length; i += 1) {
        const ch = html[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth += 1;
        else if (ch === '}' || ch === ']') {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(start + key.length, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/** Sites carry the display title in <title>; that is what we compare against. */
function pageTitle(html) {
    const m = /<title>([^<]*)<\/title>/i.exec(html);
    return decodeEntities(m ? m[1] : '').replace(/\s*[-|]\s*ToonStream\s*$/i, '').replace(/\s*Series\s*$/i, '').trim();
}

/** Every season of a series page with its real episode count. */
async function seasonsOf(slug) {
    const page = await getText(`${BASE}/series/${slug}/`);
    if (page.status !== 200) return null;
    const links = parseToonSeasons(page.text);
    const seasons = [];
    if (links.length) {
        for (const link of links) {
            const url = link.url.startsWith('http') ? link.url : `${BASE}${link.url}`;
            // Always use the season page: the series page's inline list belongs
            // to whichever season the site considers active, not necessarily 1.
            const body = await getText(url.endsWith('/') ? url : `${url}/`);
            const info = parseSeasonEpisodes(body.text || '');
            if (info.count && link.n > 0) {
                seasons.push({ n: link.n, count: info.count, start: info.first, last: info.last, missing: info.missing });
            }
            await sleep(120);
        }
    } else {
        const info = parseSeasonEpisodes(page.text);
        if (info.count) seasons.push({ n: 1, count: info.count, start: info.first, last: info.last, missing: info.missing });
    }
    if (!seasons.length) return null;
    return { slug, title: pageTitle(page.text), seasons };
}

/** The title's ToonStream series: known slug, slug guesses, then site search. */
async function findSeries(key, title) {
    const guesses = [];
    const add = (value) => {
        const slug = slugify(value);
        if (slug && !guesses.includes(slug)) guesses.push(slug);
    };
    add(title.replace(/^the\s+/i, ''));
    add(title);
    add(title.split(/[:–—]/)[0]);
    for (const variant of titleVariants(title)) add(variant);
    for (const base of guesses.slice()) {
        guesses.push(`${base}-hindi-dub`, `${base}-dub`, `${base}-english-dub`);
    }

    for (const slug of guesses.slice(0, 4)) {
        const found = await seasonsOf(slug);
        if (found && _internal.matchScore(tokens(title), found.title || slug) >= 0.5) return found;
        await sleep(120);
    }

    const seen = new Set();
    for (const variant of [...new Set([...titleVariants(title), title.split(/[:–—]/)[0]])]) {
        const query = encodeURIComponent(variant);
        for (const suffix of ['/s?q=', '/search?q=']) {
            const page = await getText(`${BASE}${suffix}${query}`);
            if (page.status !== 200) continue;
            const links = _internal.extractSeriesLinks(page.text);
            const ranked = links
                .map((link) => ({
                    slug: String(link.slug).replace(/^\/series\//, '').replace(/\/+$/, ''),
                    score: _internal.matchScore(tokens(title), `${link.text || ''} ${link.slug || ''}`),
                }))
                .filter((link) => link.slug && link.score >= 0.6 && !seen.has(link.slug))
                .sort((a, b) => b.score - a.score);
            for (const candidate of ranked.slice(0, 2)) {
                seen.add(candidate.slug);
                const found = await seasonsOf(candidate.slug);
                if (found) return found;
                await sleep(120);
            }
        }
    }
    return null;
}

function stateBlock(shows) {
    const payload = {};
    for (const [key, entry] of Object.entries(shows)) {
        if (!entry?.slug || !entry?.seasons || !Object.keys(entry.seasons).length) continue;
        payload[key] = {
            slug: entry.slug,
            seasons: entry.seasons,
            ...(entry.epStart && Object.keys(entry.epStart).length ? { epStart: entry.epStart } : {}),
            ...(entry.nxMap && Object.keys(entry.nxMap).length ? { nxMap: entry.nxMap } : {}),
        };
    }
    return [
        START,
        '/* Written by scripts/harvest-toonstream-seasons.mjs — do not edit by hand. */',
        `var TS_SEASONS=${JSON.stringify(payload)};`,
        END,
    ].join('\n');
}

function replaceBlock(html) {
    const start = html.indexOf(START);
    const end = html.indexOf(END);
    if (start === -1 || end === -1 || end < start) throw new Error('TS_SEASONS markers are missing from the page');
    return { start, end };
}

async function harvest() {
    const registry = readJson(REGISTRY_FILE, {});
    const nxEpisodesData = readJson(EPISODES_FILE, {}).shows || {};
    const html = readFileSync(HTML_FILE, 'utf8');
    const epData = pageVar(html, 'EP_DATA') || {};
    const shows = {};
    const misses = [];
    let index = 0;
    for (const [key, entry] of Object.entries(registry)) {
        if (!entry || typeof entry !== 'object' || !entry.title) continue;
        if (entry.kind && entry.kind !== 'tv') continue;
        if (ONLY.length && !ONLY.includes(key)) continue;
        index += 1;
        const found = await findSeries(key, entry.title);
        if (!found) {
            misses.push({ key, title: entry.title });
            console.log(`  ${String(index).padStart(2)} ${entry.title.slice(0, 46).padEnd(48)} MISS`);
            continue;
        }
        const nxCounts = (nxEpisodesData[key] && nxEpisodesData[key].seasons) || entry.seasons || {};
        const nxSeasons = Object.entries(nxCounts)
            .map(([season, count]) => ({ season: { season_number: Number(season) }, count: Number(count) }))
            .filter((body) => body.count > 0);
        const { map } = buildSeasonMap(found.seasons, nxSeasons);
        const nxMap = {};
        for (const [season, plan] of Object.entries(map)) {
            nxMap[season] = { season: plan.season, base: plan.base };
        }
        const seasonsMap = {};
        const epStart = {};
        for (const season of found.seasons) {
            seasonsMap[String(season.n)] = season.count;
            if (Number(season.start) > 1) epStart[String(season.n)] = Number(season.start);
        }
        shows[key] = { title: entry.title, slug: found.slug, seasons: seasonsMap, ...(Object.keys(epStart).length ? { epStart } : {}), nxMap };
        console.log(
            `  ${String(index).padStart(2)} ${entry.title.slice(0, 38).padEnd(40)} ${found.slug.slice(0, 32).padEnd(34)} ` +
                found.seasons.map((s) => `S${s.n}:${s.count}${s.start > 1 ? `@${s.start}` : ''}`).join(' '),
        );
    }
    return { state: { updated: new Date().toISOString().slice(0, 10), source: `${BASE}/home`, shows, misses }, report: misses };
}

async function main() {
    const html = readFileSync(HTML_FILE, 'utf8');
    if (CHECK) {
        const state = readJson(STATE_FILE, null);
        if (!state) {
            console.error('no state file');
            process.exit(1);
        }
        const block = stateBlock(state.shows || {});
        const current = html.slice(html.indexOf(START), html.indexOf(END) + END.length);
        if (current !== block) {
            console.error(`TS_SEASONS block is out of sync. Run: node scripts/harvest-toonstream-seasons.mjs --from-state`);
            console.error(`(state has ${Object.keys(state.shows || {}).length} shows)`);
            process.exit(1);
        }
        console.log(`TS_SEASONS block is in sync (${Object.keys(state.shows || {}).length} shows).`);
        return;
    }

    let state;
    if (FROM_STATE) {
        state = readJson(STATE_FILE, null);
        if (!state) throw new Error(`no state file at ${STATE_FILE}`);
    } else {
        state = (await harvest()).state;
        if (!Object.keys(state.shows).length) throw new Error('no ToonStream seasons found — site down or markup changed');
        if (!DRY_RUN && !CHECK) writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    }

    const block = stateBlock(state.shows || {});
    if (DRY_RUN) {
        console.log(block.slice(0, 4000));
        return;
    }
    const { start, end } = replaceBlock(html);
    writeFileSync(HTML_FILE, html.slice(0, start) + block + html.slice(end + END.length));
    console.log(
        `baked ${Object.keys(state.shows || {}).length} ToonStream season layouts` +
            (state.misses?.length ? ` (${state.misses.length} not found)` : ''),
    );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((error) => {
        console.error(`harvest-toonstream-seasons failed: ${error?.message || error}`);
        process.exit(1);
    });
}

export { stateBlock, pageVar, tokens, slugify, titleKey };
