#!/usr/bin/env node
/**
 * Bake the "Fresh Drop Toon" rail: toonstream.us's own Fresh Drop list, with
 * the episode guide (titles, stills, synopsis, dates, runtimes) pulled from
 * Nxsha, and one card per anime only.
 *
 * The row used to be fetched in the browser from /api/toonstream?home=1, which
 * meant no episode guide and no memory of what the page already carried. This
 * job runs next to the other daily drops:
 *
 *   1. GET toonstream.us/home -> the Fresh Drop rail (api/toonstream.mjs's parser)
 *   2. Resolve each title to an Nxsha id: the catalog registry, the existing
 *      drop states, then Nxsha's own /search/tv results.
 *   3. Episode guide for the dropped season from Nxsha's
 *      /api/tv/<id>/season/<n> JSON (the same source the catalog guide uses).
 *   4. Titles the page already shows (catalog or an older drop) are marked
 *      `onSite`: the page must not render a second card for them.
 *   5. Write data/toonstream-drops.json and bake it into crunchyroll.html
 *      between the TS_DROPS markers. Playback stays on ToonStream.
 *
 * Usage:
 *   node scripts/harvest-toonstream-drops.mjs            harvest + bake
 *   node scripts/harvest-toonstream-drops.mjs --from-state   bake only (no network)
 *   node scripts/harvest-toonstream-drops.mjs --check        exit 1 when the page block is stale
 *   node scripts/harvest-toonstream-drops.mjs --dry-run      print the block, write nothing
 *
 * Environment: TS_DROPS_STATE_FILE / TS_DROPS_HTML_FILE point the bake at other
 * files (tests, previews). TS_DROPS_DATE pins the day (tests, replays).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _internal } from '../api/toonstream.mjs';
import { buildSeasonGuide, decodeEntities, titleKey } from './harvest-deadtoons-schedule.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = resolve(process.env.TS_DROPS_STATE_FILE || resolve(ROOT, 'data', 'toonstream-drops.json'));
const HTML_FILE = resolve(
    process.env.TS_DROPS_HTML_FILE || resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'),
);
const REGISTRY_FILE = resolve(ROOT, 'data', 'nxsha-titles.json');
const EPISODES_FILE = resolve(ROOT, 'data', 'nxsha-episodes.json');
const NX_DROPS_FILE = resolve(ROOT, 'data', 'crunchyroll-new-drops.json');
const SCHEDULE_FILE = resolve(ROOT, 'data', 'deadtoons-schedule.json');

const BASE = 'https://toonstream.us';
const NX_BASE = 'https://nxsha.space';
const UA = 'Mozilla/5.0 (compatible; netflix-ui-toonstream-drops/1.0)';
const START = '/*TS_DROPS_START*/';
const END = '/*TS_DROPS_END*/';
const MAX_ITEMS = 40;
const REQUEST_TIMEOUT_MS = 30_000;

const DRY_RUN = process.argv.includes('--dry-run');
const FROM_STATE = process.argv.includes('--from-state');
const CHECK = process.argv.includes('--check');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function today() {
    if (process.env.TS_DROPS_DATE) return process.env.TS_DROPS_DATE;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function readJson(file, fallback) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

async function getText(url, { json = false, retries = 2 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const res = await fetch(url, {
                headers: {
                    'user-agent': UA,
                    accept: json ? 'application/json' : 'text/html,application/xhtml+xml,*/*',
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                redirect: 'follow',
            });
            if (res.status === 200) return { status: 200, text: await res.text() };
            if (res.status === 404) return { status: 404, text: '' };
            lastError = new Error(`HTTP ${res.status} for ${url}`);
        } catch (error) {
            lastError = error;
        }
        await sleep(700 * (attempt + 1));
    }
    throw lastError || new Error(`request failed: ${url}`);
}

/**
 * Nxsha /search/tv result cards: `<a href="/tv/45790">…<img alt="Title">…</a>`.
 * The search page prints rating and year around the poster, so the alt text is
 * the trustworthy title; the visible text is the fallback.
 */
export function parseNxshaSearchTv(html) {
    const out = [];
    const seen = new Set();
    const anchors = String(html || '').matchAll(
        /<a\b[^>]*href=["'](?:https?:\/\/nxsha\.space)?\/tv\/(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    );
    for (const match of anchors) {
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const body = match[2];
        const alt = /<img\b[^>]*\balt=["']([^"']*)["']/i.exec(body);
        let title = alt ? decodeEntities(alt[1]).trim() : '';
        if (!title) {
            const lines = body
                .replace(/<img\b[^>]*>/gi, ' ')
                .replace(/<[^>]+>/g, '\n')
                .split('\n')
                .map((line) => decodeEntities(line).trim())
                .filter(Boolean);
            title =
                lines.find(
                    (line) =>
                        !/^(NR|\d+(\.\d+)?)$/.test(line) &&
                        !/^(19|20)\d{2}$/.test(line) &&
                        !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(line),
                ) || '';
        }
        if (!title) continue;
        out.push({ id, title });
    }
    return out;
}

/** Exact title first, then the longest containment match Nxsha's search returned. */
export function pickSearchHit(results, wantedTitle) {
    const want = titleKey(wantedTitle);
    if (!want) return null;
    const exact = results.find((result) => titleKey(result.title) === want);
    if (exact) return exact;
    const near = results
        .filter((result) => {
            const have = titleKey(result.title);
            return have.length >= 5 && (have.includes(want) || want.includes(have));
        })
        .sort((a, b) => titleKey(b.title).length - titleKey(a.title).length);
    return near[0] || null;
}

/** Which page key (catalog or an older drop) already carries this title. */
export function buildSiteIndex() {
    const index = new Map();
    const registry = readJson(REGISTRY_FILE, {});
    for (const [key, entry] of Object.entries(registry)) {
        if (!entry || typeof entry !== 'object' || !entry.title) continue;
        index.set(titleKey(entry.title), { key, id: String(entry.id || ''), kind: entry.kind || 'tv', from: 'catalog' });
    }
    for (const [stateKey, entry] of Object.entries(readJson(NX_DROPS_FILE, {}).items || {})) {
        if (!entry?.title) continue;
        const key = `drop-${entry.kind}-${entry.id}`;
        if (!index.has(titleKey(entry.title))) {
            index.set(titleKey(entry.title), { key, id: String(entry.id || ''), kind: entry.kind || 'tv', from: 'nxsha-drop' });
        }
        void stateKey;
    }
    for (const entry of readJson(SCHEDULE_FILE, {}).items || []) {
        if (!entry?.title) continue;
        const id = String(entry?.nx?.id || '');
        if (!index.has(titleKey(entry.title))) {
            index.set(titleKey(entry.title), { key: '', id, kind: 'tv', from: 'deadtoons' });
        }
    }
    return index;
}

/** Titles on Nxsha differ slightly: strip dub tags, spacing and punctuation. */
export function titleVariants(title) {
    const raw = String(title || '').trim();
    const stripped = raw
        .replace(/\s*[\(\[]?(hindi|english|tamil|telugu|japanese|multi|dual)?\s*(dub|dubbed)[\)\]]?\s*$/i, '')
        .trim();
    return [...new Set([raw, stripped].filter(Boolean))];
}

/**
 * One Nxsha season, exactly as the site returns it, or null when that season
 * number does not exist. Nxsha's season numbering is not ToonStream's: seasons
 * are regularly merged into one (Ranma's 2024 + 2025 runs live in "Season 1"
 * with 36 episodes), so callers must not assume the numbers line up.
 */
async function fetchSeason(id, season, report) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const res = await getText(`${NX_BASE}/api/tv/${id}/season/${season}`, { json: true, retries: 0 });
            if (res.status !== 200) return null;
            const body = JSON.parse(res.text);
            if (!body || body.success !== true || !Array.isArray(body.episodes) || !body.episodes.length) return null;
            return body;
        } catch (error) {
            report.push({ step: 'guide', id, season, attempt, error: String(error?.message || error) });
            await sleep(400 * attempt);
        }
    }
    return null;
}

/** Every season Nxsha carries for the show (stops after two empty numbers). */
async function fetchNxshaSeasons(id, report) {
    const seasons = [];
    let misses = 0;
    for (let n = 1; n <= 14; n += 1) {
        const body = await fetchSeason(id, n, report);
        if (!body) {
            misses += 1;
            if (misses >= 2 && seasons.length) break;
            if (misses >= 3) break;
            continue;
        }
        misses = 0;
        seasons.push(body);
        await sleep(120);
    }
    return seasons;
}

const latestAirDate = (body) => {
    let latest = '';
    for (const ep of body.episodes || []) {
        const day = String(ep?.air_date || '');
        if (day > latest) latest = day;
    }
    return latest;
};

/**
 * Which Nxsha season should the guide open on? The exact ToonStream number when
 * Nxsha has it; a dub drop prefers season 1 (a dub of the original run); every
 * other mismatch falls back to the season that aired most recently, because a
 * Fresh Drop is by definition the newest episode.
 */
export function pickGuideSeason(seasons, dropSeason, title = '') {
    if (!Array.isArray(seasons) || !seasons.length) return null;
    const number = (body) => Number(body?.season?.season_number) || 0;
    const exact = seasons.find((body) => number(body) === Number(dropSeason));
    if (exact) return exact;
    if (/\bdub(bed)?\b/i.test(String(title))) {
        return seasons.slice().sort((a, b) => number(a) - number(b))[0];
    }
    return seasons
        .slice()
        .sort((a, b) => latestAirDate(b).localeCompare(latestAirDate(a)) || number(b) - number(a))[0];
}

/**
 * Guide for the whole show in CR_NX_DROPS.guide shape: every Nxsha season, the
 * chosen one first, capped so a 300-episode backlog cannot bloat the page.
 * `seasons` carries the baked episode count per season, never a fake count.
 */
export function buildShowGuide(seasons, preferred, { maxEpisodes = 150, overviewLimit = 200 } = {}) {
    if (!Array.isArray(seasons) || !seasons.length) return { guide: null, seasons: null, mappedSeason: null };
    const number = (body) => Number(body?.season?.season_number) || 0;
    const preferredNumber = Number(preferred?.season?.season_number) || number(seasons[0]);
    const ordered = [
        ...seasons.filter((body) => number(body) === preferredNumber),
        ...seasons
            .filter((body) => number(body) !== preferredNumber)
            .sort((a, b) => latestAirDate(b).localeCompare(latestAirDate(a)) || number(b) - number(a)),
    ];
    const guide = {};
    const counts = {};
    let budget = maxEpisodes;
    for (const body of ordered) {
        if (budget <= 0) break;
        const seasonNumber = number(body);
        const episodes = [...(body.episodes || [])]
            .filter((ep) => Number.isInteger(Number(ep?.episode_number)) && Number(ep.episode_number) > 0)
            .sort((a, b) => Number(a.episode_number) - Number(b.episode_number))
            .slice(0, budget);
        if (!episodes.length) continue;
        const built = buildSeasonGuide({ ...body, episodes }, seasonNumber, { overviewLimit });
        const seasonGuide = built?.[String(seasonNumber)];
        if (!seasonGuide || !Object.keys(seasonGuide).length) continue;
        guide[seasonNumber] = seasonGuide;
        counts[seasonNumber] = Object.keys(seasonGuide).length;
        budget -= counts[seasonNumber];
    }
    if (!Object.keys(guide).length) return { guide: null, seasons: null, mappedSeason: null };
    return { guide, seasons: counts, mappedSeason: preferredNumber };
}

async function resolveNxsha(title, indexHit, report) {
    if (indexHit && indexHit.id) return { id: indexHit.id, from: indexHit.from };
    for (const variant of titleVariants(title)) {
        try {
            const res = await getText(`${NX_BASE}/search/tv?q=${encodeURIComponent(variant)}`);
            const hit = pickSearchHit(parseNxshaSearchTv(res.text), variant);
            if (hit) return { id: hit.id, from: 'search' };
        } catch (error) {
            report.push({ step: 'search', title: variant, error: String(error?.message || error) });
        }
        await sleep(120);
    }
    return null;
}

/** Bake payload: one compact record per rail card. */
function toBlockItem(record) {
    return {
        title: record.title,
        slug: record.slug,
        ...(record.img ? { img: record.img } : {}),
        season: record.season ?? null,
        episode: record.episode ?? null,
        ...(record.episodeUrl ? { episodeUrl: record.episodeUrl } : {}),
        ...(record.nxId ? { nxId: record.nxId } : {}),
        ...(record.seasons && Object.keys(record.seasons).length ? { seasons: record.seasons } : {}),
        ...(record.guide && Object.keys(record.guide).length ? { guide: record.guide } : {}),
        ...(record.mappedSeason ? { mappedSeason: record.mappedSeason } : {}),
        ...(record.firstSeen ? { firstSeen: record.firstSeen } : {}),
        ...(record.onSite ? { onSite: true } : {}),
    };
}

export function dropsBlock(items) {
    const payload = items.slice(0, MAX_ITEMS).map(toBlockItem);
    return [
        START,
        '/* Written by scripts/harvest-toonstream-drops.mjs — do not edit by hand. */',
        `var TS_DROPS=${JSON.stringify(payload)};`,
        END,
    ].join('\n');
}

function replaceBlock(html, block) {
    const start = html.indexOf(START);
    const end = html.indexOf(END);
    if (start === -1 || end === -1 || end < start) return null;
    return html.slice(0, start) + block + html.slice(end + END.length);
}

function currentBlock(html) {
    const start = html.indexOf(START);
    const end = html.indexOf(END);
    if (start === -1 || end === -1 || end < start) return null;
    return html.slice(start, end + END.length);
}

/** Fold the previous state into the fresh one: firstSeen survives, guides persist. */
function mergeState(previous, incoming, updated) {
    const items = {};
    for (const [slug, record] of Object.entries(incoming)) {
        const old = previous.items?.[slug];
        const guide = {
            ...(old?.guide || {}),
            ...(record.guide || {}),
        };
        const merged = {
            ...old,
            ...record,
            firstSeen: old?.firstSeen || record.firstSeen,
            ...(Object.keys(guide).length ? { guide } : {}),
        };
        // A remap only describes today's drop; never carry a stale one forward.
        if (!record.mappedSeason) delete merged.mappedSeason;
        items[slug] = merged;
    }
    return { updated, source: BASE + '/home', items };
}

async function harvest() {
    const report = [];
    const previous = readJson(STATE_FILE, { items: {} });
    const index = buildSiteIndex();
    const day = today();

    const home = await getText(`${BASE}/home`);
    const drops = _internal.parseFreshDrops(home.text || '');
    if (!drops.length) {
        throw new Error('toonstream.us/home returned no Fresh Drop cards (site down or markup changed)');
    }

    // One card per anime: the same show can appear for two seasons in a row.
    const byTitle = new Map();
    for (const drop of drops) {
        if (!drop?.title || !drop.slug) continue;
        const key = titleKey(drop.title);
        const seen = byTitle.get(key);
        if (!seen || Number(drop.season || 0) > Number(seen.season || 0)
            || (Number(drop.season || 0) === Number(seen.season || 0) && Number(drop.ep || 0) > Number(seen.ep || 0))) {
            byTitle.set(key, drop);
        }
    }

    const incoming = {};
    for (const drop of byTitle.values()) {
        const title = drop.title;
        // Nxsha files titles slightly differently ("Ranma1/2", "Bleach" vs a
        // "- Hindi Dub" post), so try the plain title and its cleaned variants.
        let hit = null;
        for (const variant of titleVariants(title)) {
            hit = index.get(titleKey(variant)) || null;
            if (hit) break;
        }
        const season = Number(drop.season || 0) || null;
        const episode = Number(drop.ep || 0) || null;
        const old = previous.items?.[drop.slug] || {};
        const record = {
            title,
            slug: drop.slug,
            img: drop.img || '',
            season,
            episode,
            episodeUrl: drop.episode || drop.url || '',
            firstSeen: old.firstSeen || day,
            ...(hit && hit.from !== 'nxsha-drop' ? { onSite: true } : {}),
        };

        // A catalog title already ships NX_EPISODE_DATA — do not bake a twin.
        if (hit?.key) {
            record.nxId = hit.id || '';
            incoming[drop.slug] = record;
            continue;
        }

        const resolved = await resolveNxsha(title, hit, report);
        const nxId = resolved?.id || hit?.id || '';
        if (!nxId) {
            incoming[drop.slug] = record;
            continue;
        }
        record.nxId = nxId;

        // Fetch the show's whole Nxsha guide, not just the dropped season: the
        // season numbers rarely line up (Nxsha merges split cours), and a guide
        // with real stills/names matters more than a matching season label.
        const seasons = await fetchNxshaSeasons(nxId, report);
        const preferred = pickGuideSeason(seasons, season, title);
        const built = buildShowGuide(seasons, preferred);
        if (built.guide) {
            record.guide = built.guide;
            record.seasons = built.seasons;
            if (built.mappedSeason && Number(built.mappedSeason) !== Number(season)) {
                // ToonStream's season does not exist on Nxsha; the guide is the
                // closest real season (newest, or S1 for a dub). Playback keeps
                // ToonStream's own S/E — only the guide is remapped.
                record.mappedSeason = built.mappedSeason;
            }
        }
        if (report.length > 40) report.length = 40;
        const guideCount = Object.values(record.seasons || {}).reduce((sum, n) => sum + n, 0);
        console.log(
            `  ${title.slice(0, 44).padEnd(46)} nx=${nxId} (${resolved?.from || hit?.from || '-'}) ` +
                `s${season ?? '?'}e${episode ?? '?'} -> guide ${guideCount} eps` +
                (record.mappedSeason ? ` (season ${record.mappedSeason})` : ''),
        );
        incoming[drop.slug] = record;
    }

    return {
        state: mergeState(previous, incoming, day),
        report,
        count: byTitle.size,
        matched: report.length,
    };
}

function orderedItems(state) {
    return Object.values(state.items || {})
        .sort((a, b) => {
            if (!!a.onSite !== !!b.onSite) return a.onSite ? 1 : -1;
            return String(b.firstSeen || '').localeCompare(String(a.firstSeen || '')) || a.title.localeCompare(b.title);
        })
        .slice(0, MAX_ITEMS);
}

async function main() {
    const html = readFileSync(HTML_FILE, 'utf8');

    if (FROM_STATE || CHECK) {
        const state = readJson(STATE_FILE, null);
        if (!state) {
            console.error(`No ToonStream drop state at ${STATE_FILE}. Run the daily job first.`);
            process.exitCode = 1;
            return;
        }
        const block = dropsBlock(orderedItems(state));
        if (CHECK) {
            if (currentBlock(html) !== block) {
                console.error('ToonStream Fresh Drop block is out of sync. Run: node scripts/harvest-toonstream-drops.mjs --from-state');
                process.exitCode = 1;
                return;
            }
            console.log(`ToonStream Fresh Drop block is in sync (${orderedItems(state).length} cards).`);
            return;
        }
        if (DRY_RUN) {
            console.log(block);
            return;
        }
        const next = replaceBlock(html, block);
        if (next === null) throw new Error('TS_DROPS markers are missing from crunchyroll.html');
        writeFileSync(HTML_FILE, next);
        console.log(`baked ${orderedItems(state).length} ToonStream Fresh Drop cards into crunchyroll.html`);
        return;
    }

    const { state, report, count } = await harvest();
    const block = dropsBlock(orderedItems(state));
    if (DRY_RUN) {
        console.log(JSON.stringify({ count, matched: report.length, state }, null, 2));
        return;
    }
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    const next = replaceBlock(html, block);
    if (next === null) throw new Error('TS_DROPS markers are missing from crunchyroll.html');
    writeFileSync(HTML_FILE, next);
    const withGuide = Object.values(state.items).filter((item) => item.guide).length;
    console.log(
        `toonstream: ${count} fresh drops · ${withGuide} with an Nxsha episode guide · ` +
            `${Object.values(state.items).filter((item) => item.onSite).length} already on the page (no twin card)`,
    );
    if (report.length) {
        console.log(`warnings: ${report.length}`);
        for (const warning of report.slice(0, 20)) console.log(`  ! ${JSON.stringify(warning)}`);
    }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((error) => {
        console.error(`harvest-toonstream-drops: ${error?.message || error}`);
        process.exitCode = 1;
    });
}
