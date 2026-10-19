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
 * Hindi-dub series number episodes absolutely (Naruto S2 = 33..53); those keep
 * their real numbers in `epStart` so playback asks for the right episode.
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
import { buildSeasonMap, compactPlan, parseSeasonCards, parseSeasonEpisodes, parseToonSeasons } from './lib/seasons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_FILE = resolve(ROOT, 'data', 'nxsha-titles.json');
const EPISODES_FILE = resolve(ROOT, 'data', 'nxsha-episodes.json');
const STATE_FILE = resolve(process.env.TS_SEASONS_STATE_FILE || resolve(ROOT, 'data', 'toonstream-seasons.json'));
const HTML_FILE = resolve(process.env.TS_SEASONS_HTML_FILE || resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'));
const BASE = 'https://toonstream.us';
const IMG_START = '/*TS_EP_IMAGES_START*/';
const IMG_END = '/*TS_EP_IMAGES_END*/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const START = '/*TS_SEASONS_START*/';
const END = '/*TS_SEASONS_END*/';

const FROM_STATE = process.argv.includes('--from-state');
const CHECK = process.argv.includes('--check');
const DRY_RUN = process.argv.includes('--dry-run');
const DEBUG = process.env.TS_SEASONS_DEBUG === '1';
const ONLY = String(process.env.TS_SEASONS_ONLY || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const tokens = (value) => String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const normTitle = (value) =>
    decodeEntities(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^the\s+/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
/** The page must be the same show: equal, or the query with a site suffix. */
const titleMatches = (wanted, found) => {
    const a = normTitle(wanted);
    const b = normTitle(found);
    return !!a && !!b && (b === a || b.startsWith(a));
};
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
            if (res.status >= 500 && attempt < retries) {
                await sleep(700 * (attempt + 1));
                continue;
            }
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
    if (page.status !== 200) {
        if (DEBUG) console.log(`    ${slug}: HTTP ${page.status}`);
        return null;
    }
    const links = parseToonSeasons(page.text);
    if (DEBUG) {
        const probe = parseSeasonEpisodes(page.text);
        console.log(`    ${slug}: "${pageTitle(page.text)}" buttons=${links.length} inline=${probe.first}-${probe.last} (${probe.count})`);
    }
    const seasons = [];
    if (links.length) {
        for (const link of links) {
            const url = link.url.startsWith('http') ? link.url : `${BASE}${link.url}`;
            // Always use the season page: the series page's inline list belongs
            // to whichever season the site considers active, not necessarily 1.
            const body = await getText(url.endsWith('/') ? url : `${url}/`);
            const info = parseSeasonEpisodes(body.text || '');
            if (info.count && link.n > 0) {
                const cards = parseSeasonCards(body.text || '');
                // Keep the images keyed like the UI: 1..count inside the season,
                // even when the site numbers the episode absolutely (One Piece S1
                // starts at 6).
                const images = {};
                for (const [episode, url] of cards) {
                    const local = episode - info.first + 1;
                    if (local >= 1 && local <= info.count) images[String(local)] = url;
                }
                seasons.push({
                    n: link.n,
                    count: info.count,
                    start: info.first,
                    last: info.last,
                    missing: info.missing,
                    ...(Object.keys(images).length ? { images } : {}),
                });
            }
            await sleep(120);
        }
    } else {
        const info = parseSeasonEpisodes(page.text);
        if (info.count) seasons.push({ n: 1, count: info.count, start: info.first, last: info.last, missing: info.missing });
    }
    if (!seasons.length) {
        if (DEBUG) console.log(`    ${slug}: no episodes parsed`);
        return null;
    }
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

    for (const slug of [...new Set(guesses)].slice(0, 10)) {
        const found = await seasonsOf(slug);
        if (found && titleMatches(title, found.title || slug)) return found;
        if (found && DEBUG) console.log(`    ${slug}: rejected "${found.title}" for "${title}"`);
        await sleep(120);
    }

    const seen = new Set();
    for (const variant of [...new Set([...titleVariants(title), title.split(/[:–—]/)[0]])]) {
        const query = encodeURIComponent(variant);
        for (const suffix of ['/s?q=', '/search?q=']) {
            const page = await getText(`${BASE}${suffix}${query}`);
            if (page.status !== 200) continue;
            const links = _internal.extractSeriesLinks(page.text);
            if (DEBUG) {
                console.log(`  search "${variant}"${suffix}: ${links.length} series links`);
                for (const link of links.slice(0, 6)) console.log(`    - ${link.slug} "${String(link.text || '').replace(/\s+/g, ' ').trim().slice(0, 50)}"`);
            }
            const ranked = links
                .map((link) => ({
                    slug: String(link.slug).replace(/^\/series\//, '').replace(/\/+$/, ''),
                    score: _internal.matchScore(tokens(title), `${link.text || ''} ${link.slug || ''}`),
                }))
                .filter((link) => link.slug && link.score >= 0.6 && !seen.has(link.slug))
                .sort((a, b) => b.score - a.score);
            const matches = [];
            for (const candidate of ranked.slice(0, 6)) {
                seen.add(candidate.slug);
                const found = await seasonsOf(candidate.slug);
                if (!found) continue;
                if (!titleMatches(title, found.title || candidate.slug)) {
                    if (DEBUG) console.log(`    ${candidate.slug}: rejected "${found.title}" for "${title}"`);
                    continue;
                }
                // "One Piece" must beat "One Piece Wano Arc"/"LEGO ONE PIECE".
                matches.push({ ...found, extra: normTitle(found.title).length - normTitle(title).length });
                await sleep(120);
            }
            if (matches.length) {
                matches.sort((a, b) => a.extra - b.extra || a.slug.localeCompare(b.slug));
                return matches[0];
            }
        }
    }
    return null;
}

/** `season:localEpisode` pairs that already have an Nxsha still. */
function nxImageIndex(show) {
    const out = new Set();
    const bySeason = {};
    for (const episode of show?.episodes || []) {
        const season = Number(episode.season);
        const number = Number(episode.episode);
        if (!Number.isInteger(season) || !Number.isInteger(number)) continue;
        (bySeason[season] ||= []).push({ number, image: Boolean(episode.image) });
    }
    for (const [season, list] of Object.entries(bySeason)) {
        list.sort((a, b) => a.number - b.number).forEach((episode, index) => {
            if (episode.image) out.add(`${season}:${index + 1}`);
        });
    }
    return out;
}

/** Nxsha coordinates of a local ToonStream episode, segment aware. */
function planCoords(plan, episode) {
    let left = Math.max(0, (Number(episode) || 1) - 1);
    if (Array.isArray(plan?.segments) && plan.segments.length) {
        for (const segment of plan.segments) {
            if (left < segment.count) return { season: segment.season, ep: segment.from + left };
            left -= segment.count;
        }
        const last = plan.segments[plan.segments.length - 1];
        return { season: last.season, ep: last.from + left };
    }
    return { season: plan.season, ep: (Number(plan.base) || 0) + left + 1 };
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
    const imgStart = html.indexOf(IMG_START);
    const imgEnd = html.indexOf(IMG_END);
    if (imgStart === -1 || imgEnd === -1 || imgEnd < imgStart) throw new Error('TS_EP_IMAGES markers are missing from the page');
    return { start, end, imgStart, imgEnd };
}

/** Only the episodes Nxsha has no still for, keyed by ToonStream season/ep. */
function imageBlock(shows) {
    const payload = {};
    for (const [key, entry] of Object.entries(shows)) {
        const seasons = entry?.images;
        if (!seasons || !Object.keys(seasons).length) continue;
        payload[key] = seasons;
    }
    return [
        IMG_START,
        '/* Written by scripts/harvest-toonstream-seasons.mjs — do not edit by hand. */',
        `var TS_EP_IMAGES=${JSON.stringify(payload)};`,
        IMG_END,
    ].join('\n');
}

/** Rebuild nxMap for every saved show from its own season layout. */
function remapNx(shows) {
    const nxEpisodesData = readJson(EPISODES_FILE, {}).shows || {};
    const registry = readJson(REGISTRY_FILE, {});
    const out = {};
    for (const [key, entry] of Object.entries(shows)) {
        const counts = entry?.seasons || {};
        if (!entry?.slug || !Object.keys(counts).length) continue;
        const nxCounts = (nxEpisodesData[key] && nxEpisodesData[key].seasons) || registry[key]?.seasons || {};
        const nxSeasons = Object.entries(nxCounts)
            .map(([season, count]) => ({ season: { season_number: Number(season) }, count: Number(count) }))
            .filter((body) => body.count > 0);
        const tsSeasons = Object.entries(counts).map(([n, count]) => ({
            n: Number(n),
            count: Number(count),
            start: Number(entry.epStart?.[n]) || 0,
        }));
        const { map } = buildSeasonMap(tsSeasons, nxSeasons);
        const nxMap = {};
        for (const [season, plan] of Object.entries(map)) nxMap[season] = compactPlan(plan);
        out[key] = { ...entry, ...(Object.keys(nxMap).length ? { nxMap } : {}) };
    }
    return out;
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
        for (const [season, plan] of Object.entries(map)) nxMap[season] = compactPlan(plan);
        const seasonsMap = {};
        const epStart = {};
        const haveImage = nxImageIndex(nxEpisodesData[key]);
        const images = {};
        for (const season of found.seasons) {
            seasonsMap[String(season.n)] = season.count;
            if (Number(season.start) > 1) epStart[String(season.n)] = Number(season.start);
            if (!season.images) continue;
            const plan = map[season.n];
            for (const [episode, url] of Object.entries(season.images)) {
                const at = plan ? planCoords(plan, episode) : null;
                if (at && haveImage.has(`${at.season}:${at.ep}`)) continue;
                (images[String(season.n)] ||= {})[String(episode)] = url;
            }
        }
        shows[key] = {
            title: entry.title,
            slug: found.slug,
            seasons: seasonsMap,
            ...(Object.keys(epStart).length ? { epStart } : {}),
            nxMap,
            ...(Object.keys(images).length ? { images } : {}),
        };
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
        const images = imageBlock(state.shows || {});
        const currentImages = html.slice(html.indexOf(IMG_START), html.indexOf(IMG_END) + IMG_END.length);
        if (current !== block || currentImages !== images) {
            console.error(`TS_SEASONS/TS_EP_IMAGES block is out of sync. Run: node scripts/harvest-toonstream-seasons.mjs --from-state`);
            console.error(`(state has ${Object.keys(state.shows || {}).length} shows)`);
            process.exit(1);
        }
        console.log(
            `TS_SEASONS/TS_EP_IMAGES blocks are in sync (${Object.keys(state.shows || {}).length} shows, ` +
                `${Object.values(state.shows || {}).reduce((n, s) => n + Object.values(s.images || {}).reduce((m, x) => m + Object.keys(x).length, 0), 0)} fallback stills).`,
        );
        return;
    }

    let state;
    if (FROM_STATE) {
        state = readJson(STATE_FILE, null);
        if (!state) throw new Error(`no state file at ${STATE_FILE}`);
        // Recompute the Nxsha coordinates from the saved layout, so a refreshed
        // Nxsha guide (One Piece finally has one) is picked up without a full
        // ToonStream crawl.
        state.shows = remapNx(state.shows || {});
        if (!DRY_RUN) writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    } else {
        state = (await harvest()).state;
        if (!Object.keys(state.shows).length) throw new Error('no ToonStream seasons found — site down or markup changed');
        if (!DRY_RUN && !CHECK) writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    }

    const block = stateBlock(state.shows || {});
    const images = imageBlock(state.shows || {});
    if (DRY_RUN) {
        console.log(block.slice(0, 4000));
        return;
    }
    const { start, end, imgStart, imgEnd } = replaceBlock(html);
    const withImages =
        html.slice(0, imgStart) + images + html.slice(imgEnd + IMG_END.length);
    const withSeasons =
        withImages.slice(0, start) + block + withImages.slice(end + END.length);
    writeFileSync(HTML_FILE, withSeasons);
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

export { stateBlock, imageBlock, pageVar, tokens, slugify, titleKey, remapNx };
