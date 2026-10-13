#!/usr/bin/env node
/**
 * Keep the "Trending Now in India" row in step with Netflix's Tudum Top 10 for
 * India (Movies), https://www.netflix.com/tudum/top10/india.
 *
 * Each run:
 *   1. Reads the Tudum page and takes the 10 ranked movies (rank, title, Netflix id)
 *      and the week the page shows.
 *   2. Writes the 10 titles into the Trending row in data/movies.json, reusing the
 *      nxsha details already in the row. New titles are added with only their
 *      Netflix data; scripts/build-trending-nxsha.mjs then fills their details and
 *      images from nxsha, the only source for those.
 *   3. Keeps only titles that have an nxsha id and an image, so no blank card is
 *      shown. If fewer than MIN_TITLES remain, or Tudum cannot be read, the row
 *      keeps its previous titles.
 *   4. Records each week's list in data/tudum-top10-india-history.json, so earlier
 *      weeks stay in the repo. A week is added once, when it is first seen.
 *
 * Netflix publishes the list weekly, so the row changes when a new week appears.
 * Runs on a hosted runner: the workspace sandbox cannot reach nxsha.space.
 * Crunchyroll data is never read or written.
 *
 * Usage: node scripts/update-tudum-top10.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOVIES = resolve(ROOT, 'data', 'movies.json');
const HISTORY = resolve(ROOT, 'data', 'tudum-top10-india-history.json');
const STATUS = resolve(ROOT, 'data', 'tudum-top10-india-status.json');
const TRENDING_BUILDER = resolve(ROOT, 'scripts', 'build-trending-nxsha.mjs');
export const TUDUM_URL = 'https://www.netflix.com/tudum/top10/india';
export const ROW_TITLE = 'Trending Now in India';
/** Row with the titles that entered the India Top 10 this week (not in last week's list). */
export const FRESH_ROW_TITLE = 'New Entries in India Top 10';
export const CATALOG_SOURCE = 'tudum-top10-india';
/** Fewer usable titles than this keeps the previous row. */
export const MIN_TITLES = 5;
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DRY = process.argv.includes('--dry-run');

export function decode(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
        .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)))
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Pull the ranked movie list out of the Tudum page HTML.
 *
 * Each list entry has a card whose data-entity-id ends with the Netflix id, a
 * poster whose alt text is usually the title, and the text "#<rank> in Movies".
 * The raw HTML does not always carry every title (the page fills some in on the
 * client), so a missing title comes back as '' and resolveTitles() fills it in.
 * Tags become markers first, so the order of the page decides the result. The
 * first entry for each rank wins; the page can repeat the list.
 *
 * Returns { week, movies: [{ rank, title, netflixId }] } with exactly ranks 1..10,
 * and throws when an id or rank is missing.
 */
export function parseTudumTop10(html) {
    const marked = String(html || '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, tag => {
            const img = /<img\b/i.test(tag) ? /\balt="([^"]*)"/i.exec(tag) : null;
            if (img) return ` [[IMG:${img[1].replace(/[\[\]]/g, '')}]] `;
            // The Watch link is often a sign-in URL that carries the title page encoded:
            // ...login?nextpage=https%3A%2F%2Fwww.netflix.com%2Fwatch%2F<id>...
            const watch = /(?:\/|%2F)watch(?:\/|%2F)(\d+)/i.exec(tag);
            if (watch) return ` [[WATCH:${watch[1]}]] `;
            // Rank cards carry the id at the end of data-entity-id, e.g. "top10-4hB3…-82723106".
            const entity = /data-entity-id="[^"]*-(\d{6,9})"/i.exec(tag);
            if (entity) return ` [[WATCH:${entity[1]}]] `;
            return ' ';
        });
    const text = decode(marked);
    const weekMatch = /(\d{1,2}\/\d{1,2}\/\d{2})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2})/.exec(text);
    const week = weekMatch ? `${weekMatch[1]} - ${weekMatch[2]}` : '';

    const byRank = new Map();
    let pendingTitle = '';
    let pendingId = '';
    const token = /\[\[IMG:([^\]]*)\]\]|\[\[WATCH:(\d+)\]\]|#(\d+)\s+in\s+(Movies|Shows)\b/g;
    for (const m of text.matchAll(token)) {
        if (m[1] !== undefined) {
            const alt = decode(m[1]);
            if (alt && !/^netflix$/i.test(alt)) pendingTitle = alt;
        } else if (m[2] !== undefined) {
            if (!pendingId) pendingId = m[2];
        } else {
            const rank = Number(m[3]);
            if (m[4] === 'Movies' && !byRank.has(rank) && pendingId) {
                byRank.set(rank, { rank, title: pendingTitle, netflixId: pendingId });
            }
            pendingTitle = '';
            pendingId = '';
        }
    }

    const movies = [];
    for (let rank = 1; rank <= 10; rank += 1) {
        const hit = byRank.get(rank);
        if (!hit) throw new Error(`Tudum page: no movie at rank ${rank} (found ${byRank.size} ranked movies)`);
        movies.push(hit);
    }
    return { week, movies };
}

/** Title from a Netflix title page: og:title or <title>, without the site name or "Watch". */
export function titleFromNetflixPage(html) {
    const og = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(String(html || ''));
    const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
    const raw = decode(og ? og[1] : tag ? tag[1] : '');
    const title = raw
        .replace(/\s*[|\u2013\u2014-]\s*Netflix.*$/i, '')
        .replace(/^Watch\s+/i, '')
        .trim();
    if (!title || /^netflix/i.test(title)) return '';
    return title;
}

/** Log of title lookups in this run, written to the status file on failure. */
const lookupLog = [];

/**
 * Give every ranked movie a title: the title the Tudum page gave, else the title the
 * row already has for that id, else the Netflix title page. Throws when none works.
 */
export async function resolveTitles(ranked, knownTitles) {
    const out = [];
    for (const m of ranked) {
        if (m.title) {
            out.push(m);
            continue;
        }
        const known = knownTitles.get(String(m.netflixId));
        if (known) {
            out.push({ ...m, title: known });
            continue;
        }
        const html = await get(`https://www.netflix.com/in/title/${m.netflixId}`);
        const title = html ? titleFromNetflixPage(html) : '';
        lookupLog.push({ netflixId: m.netflixId, found: Boolean(html), title });
        if (!title) throw new Error(`no title for Netflix id ${m.netflixId} (rank ${m.rank})`);
        out.push({ ...m, title });
    }
    return out;
}

/** GET with a few retries; null on 404. Used for the Netflix title page. */
async function get(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
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
            await new Promise(r => setTimeout(r, 800 * attempt));
        }
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Titles in `week` that were not in the previous week's list. The previous week is the
 * recorded week with the latest firstSeen before `week`. No previous week = no new
 * entries (the first recorded week is a baseline).
 */
export function newEntriesFor(weeks, week, titles) {
    const current = weeks.find(w => w.week === week);
    const previous = weeks
        .filter(w => w.week !== week && current && w.firstSeen < current.firstSeen)
        .sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0))[0];
    if (!previous) return [];
    const before = new Set(previous.movies.map(m => m.title.toLowerCase()));
    return titles.filter(t => !before.has(t.toLowerCase()));
}

/** Upsert one week into the history (keeps first-seen date, never rewrites an unchanged week). */
export function mergeHistory(history, week, movies, today) {
    const weeks = Array.isArray(history?.weeks) ? [...history.weeks] : [];
    const existing = weeks.find(w => w.week === week);
    if (existing) {
        const same = JSON.stringify(existing.movies) === JSON.stringify(movies);
        if (same) return { weeks, changed: false };
        existing.movies = movies;
        return { weeks, changed: true };
    }
    weeks.push({ week, firstSeen: today, movies });
    return { weeks, changed: true };
}

export function slugify(title) {
    return decode(title)
        .replace(/&/g, ' and ')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Items for the row, in rank order. A title already in the row keeps its item
 * (its nxsha id, details and image); a new title gets a Netflix-only item that the
 * nxsha builder completes.
 */
export function buildRowItems(previousItems, ranked) {
    const previous = new Map((previousItems || []).map(item => [String(item.netflixId), item]));
    return ranked.map(({ rank, title, netflixId }) => {
        const old = previous.get(String(netflixId));
        const rankingText = `#${rank} in Movies`;
        if (old) return { ...old, title: old.title || title, ranking_text: rankingText };
        return {
            id: `tudum-top10-india-${slugify(title)}`,
            imageUrl: '',
            title,
            type: 'FILM',
            mediaType: 'movie',
            ranking_text: rankingText,
            catalogSource: CATALOG_SOURCE,
            netflixId: String(netflixId),
            netflixUrl: `https://www.netflix.com/in/title/${netflixId}`,
        };
    });
}

/** Items that are usable on the home row: nxsha id and an image. */
export function usableItems(items) {
    return items.filter(item => item.tmdb_id && item.imageUrl);
}

function rankOf(item) {
    return Number(/#(\d+)/.exec(item.ranking_text || '')?.[1] || 999);
}

async function fetchTudum() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const res = await fetch(TUDUM_URL, {
                    signal: ctl.signal,
                    redirect: 'follow',
                    headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
                });
                if (res.status === 200) return await res.text();
                throw new Error(`HTTP ${res.status}`);
            } catch (e) {
                if (attempt === 3) throw e;
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
        throw new Error('unreachable');
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Facts about a page that did not parse, for the status file: counts and the raw HTML
 * around the first "in Movies" texts. Only written on failure, so it stays small.
 */
export function diagnose(html) {
    const raw = String(html || '');
    const hits = [...raw.matchAll(/in\s*Movies/gi)].map(m => m.index);
    return {
        length: raw.length,
        inMoviesCount: hits.length,
        watchLinkCount: (raw.match(/(?:\/|%2F)watch(?:\/|%2F)\d+/gi) || []).length,
        posterCount: (raw.match(/dnm\.nflximg\.net/g) || []).length,
        windows: hits.slice(0, 6).map(i => raw.slice(Math.max(0, i - 350), i + 60).replace(/\s+/g, ' ')),
        // Where a title and a Netflix id from the Movies list (rank 6 this week) appear.
        around: [
            ['82723106', raw.indexOf('82723106')],
            ['Romanchakam', raw.indexOf('Romanchakam')],
        ].map(([needle, i]) => ({
            needle,
            count: raw.split(needle).length - 1,
            window: i < 0 ? '' : raw.slice(Math.max(0, i - 300), i + 120).replace(/\s+/g, ' '),
        })),
    };
}

let lastHtml = '';

function readHistory() {
    if (!existsSync(HISTORY)) return { source: TUDUM_URL, weeks: [] };
    return JSON.parse(readFileSync(HISTORY, 'utf8'));
}

/** Last run in one small file: no timestamp, so it changes only when the outcome changes. */
function writeStatus(status) {
    if (DRY) return;
    writeFileSync(STATUS, JSON.stringify(status, null, 4) + '\n');
}

async function main() {
    const html = await fetchTudum();
    lastHtml = html;
    const parsed = parseTudumTop10(html);
    const knownTitles = new Map();
    for (const row of JSON.parse(readFileSync(MOVIES, 'utf8')).movies) {
        for (const item of row.movies || []) if (item.netflixId && item.title) knownTitles.set(String(item.netflixId), item.title);
    }
    const week = parsed.week;
    const ranked = await resolveTitles(parsed.movies, knownTitles);
    console.log(`Tudum Top 10 Movies in India, week ${week || 'unknown'}:`);
    for (const m of ranked) console.log(`  #${m.rank} ${m.title} (netflix ${m.netflixId})`);
    if (DRY) {
        console.log('dry run: nothing written');
        return;
    }
    if (!week) throw new Error('Tudum page: week label not found; keeping the previous row');
    await updateRow(week, ranked);
}

async function updateRow(week, ranked) {

    const originalMovies = readFileSync(MOVIES, 'utf8');
    const data = JSON.parse(originalMovies);
    const row = data.movies.find(r => r.rowTitle === ROW_TITLE);
    if (!row) throw new Error(`${ROW_TITLE} row not found in data/movies.json`);

    const history = readHistory();
    const today = new Date().toISOString().slice(0, 10);
    const merged = mergeHistory(history, week, ranked, today);
    if (merged.changed) {
        writeFileSync(HISTORY, JSON.stringify({ source: TUDUM_URL, weeks: merged.weeks }, null, 4) + '\n');
        console.log(`history: week ${week} recorded (${merged.weeks.length} weeks kept)`);
    } else {
        console.log(`history: week ${week} already recorded`);
    }

    row.movies = buildRowItems(row.movies, ranked);
    writeFileSync(MOVIES, JSON.stringify(data, null, 4) + '\n');
    try {
        execFileSync(process.execPath, [TRENDING_BUILDER], { stdio: 'inherit', cwd: ROOT });

        const after = JSON.parse(readFileSync(MOVIES, 'utf8'));
        const filled = after.movies.find(r => r.rowTitle === ROW_TITLE);
        const kept = usableItems(filled.movies).sort((a, b) => rankOf(a) - rankOf(b));
        if (kept.length < MIN_TITLES) {
            throw new Error(`only ${kept.length} titles have nxsha details and an image; keeping the previous row`);
        }
        filled.movies = kept;

        // "New Entries" row: a subset of the Trending items that are new this week.
        const newTitles = newEntriesFor(merged.weeks, week, ranked.map(m => m.title));
        after.movies = after.movies.filter(r => r.rowTitle !== FRESH_ROW_TITLE);
        const fresh = kept.filter(m => newTitles.some(t => t.toLowerCase() === String(m.title).toLowerCase()));
        if (fresh.length) {
            const at = after.movies.indexOf(filled);
            after.movies.splice(at + 1, 0, { rowTitle: FRESH_ROW_TITLE, type: 'normal', movies: fresh });
        }
        writeFileSync(MOVIES, JSON.stringify(after, null, 4) + '\n');
        writeStatus({ ok: true, week, titles: kept.map(m => m.title), titleLookups: lookupLog });
        console.log(`updated ${ROW_TITLE}: ${kept.length} of ${ranked.length} titles usable (${kept.map(m => m.title).join(', ')})`);
    } catch (e) {
        // Put the previous row back, so a failed run never leaves a half-filled row.
        writeFileSync(MOVIES, originalMovies);
        throw e;
    }
}

// Export helpers for tests; run only when executed directly.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(e => {
        console.error(e);
        writeStatus({
            ok: false,
            error: String(e?.message || e),
            titleLookups: lookupLog,
            diagnostic: diagnose(lastHtml),
        });
        process.exit(1);
    });
}
