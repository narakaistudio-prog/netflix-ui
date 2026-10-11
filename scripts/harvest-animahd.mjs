#!/usr/bin/env node
/**
 * Harvest per-episode Google Drive file_ids from AnimaHD show pages.
 *
 * Recipe (per show page):
 *   1. GET https://animahd.com/<slug>/ (redirects followed)
 *   2. Regex out every [?&]p=<base64> token from the HTML
 *   3. Base64-decode each token -> "player/?file_id=...&show_id=...&ep=..."
 *      and store file_id/show_id/ep.
 *
 * Output: data/animahd-episodes.json (merged, never deletes entries).
 * Then run scripts/bake-animahd-links.mjs to bake it into the demo page.
 *
 * Usage:
 *   node scripts/harvest-animahd.mjs <slug> [--key=solo] [--seasons=12,13]
 *       [--base=https://animahd.com] [--out=data/animahd-episodes.json]
 *       [--verbose]
 *   node scripts/harvest-animahd.mjs --self-test   # offline parser checks
 *   node scripts/harvest-animahd.mjs --help
 *
 * Notes:
 *   --key     player key to store under (default: slug sanitised to [a-z0-9]+).
 *   --seasons comma counts per season, e.g. "12,13" (default: all eps in S1).
 *   Mixed show_ids across episodes warn and keep the most frequent one.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(ROOT, 'data', 'animahd-episodes.json');
const DEFAULT_BASE = 'https://animahd.com';

const P_RE = /[?&]p=([A-Za-z0-9+/=]+)/g;
const FILEID_RE = /^[A-Za-z0-9_-]{10,}$/;

export function extractPTokens(html) {
    const out = [];
    P_RE.lastIndex = 0;
    let m;
    while ((m = P_RE.exec(String(html || '')))) out.push(m[1]);
    return out;
}

export function decodePlayerToken(tok) {
    let text;
    try {
        text = Buffer.from(String(tok), 'base64').toString('utf8');
    } catch {
        return null;
    }
    if (!text.includes('player/') || !text.includes('file_id=')) return null;
    let u;
    try {
        u = new URL(text, 'https://animahd.com/');
    } catch {
        return null;
    }
    const fileId = u.searchParams.get('file_id') || '';
    const showId = Number.parseInt(u.searchParams.get('show_id') || '', 10);
    const ep = Number.parseInt(u.searchParams.get('ep') || '', 10);
    if (!FILEID_RE.test(fileId)) return null;
    if (!Number.isInteger(showId) || showId <= 0) return null;
    if (!Number.isInteger(ep) || ep < 0 || ep > 500) return null;
    return { fileId, showId, ep };
}

/** Parse one show page -> { showId, eps: [fileId...] } (ep index = array index). */
export function collectEpisodes(html) {
    const byEp = new Map();
    const showVotes = new Map();
    for (const tok of extractPTokens(html)) {
        const d = decodePlayerToken(tok);
        if (!d) continue;
        if (!byEp.has(d.ep)) byEp.set(d.ep, d.fileId);
        showVotes.set(d.showId, (showVotes.get(d.showId) || 0) + 1);
    }
    if (!byEp.size) throw new Error('no player/?file_id links found on page');
    let showId = 0;
    let best = -1;
    for (const [id, votes] of showVotes) {
        if (votes > best) { best = votes; showId = id; }
    }
    const mixed = showVotes.size > 1;
    const maxEp = Math.max(...byEp.keys());
    const eps = [];
    const missing = [];
    for (let e = 0; e <= maxEp; e++) {
        if (byEp.has(e)) eps.push(byEp.get(e));
        else missing.push(e);
    }
    if (missing.length) throw new Error(`missing ep indexes: ${missing.join(',')}`);
    return { showId, eps, mixed };
}

/**
 * Decode the HTML entities WordPress' Vodi theme puts in hrefs
 * (`&#038;` = `&`), so the same regexes work on old and new markup.
 */
export function decodeEntities(text) {
    return String(text || '')
        .replace(/&#0*38;/g, '&')
        .replace(/&#x0*26;/gi, '&')
        .replace(/&amp;/g, '&')
        .replace(/&#8217;|&#039;|&apos;/g, "'");
}

/**
 * Parse the current Vodi-theme episode rows. Each row looks like:
 *   <a href='https://animahd.com/?sec_route=1&#038;p=<base64>&#038;s=<sig>'
 *      class='app-ep-row-item' data-season='Season 2'>
 *     <div class='gdrive-ep-meta' data-fileid='<fileId>'>
 *       <div>[ANIMAHD.COM] S02E01 Show Name.mkv</div>
 * The base64 `p` param decodes to the animahd player URL
 * (`player/?file_id=…&show_id=…&ep=…`).
 *
 * Returns rows in document order:
 *   [{ season: 1, ep: 0, fileId, showId, label: 'S01E01 Show Name' }]
 */
export function collectShowRows(html) {
    const text = decodeEntities(html);
    const rows = [];
    const re = /<a\s[^>]*href='([^']*?)'[^>]*class='app-ep-row-item'[^>]*data-season='([^']*)'[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(text))) {
        const href = m[1];
        const seasonLabel = m[2];
        const inner = m[3];
        const tok = /[?&]p=([A-Za-z0-9+/=]+)/.exec(href);
        if (!tok) continue;
        let decoded = '';
        try {
            decoded = Buffer.from(tok[1], 'base64').toString('utf8');
        } catch {
            continue;
        }
        const player = /file_id=([A-Za-z0-9_-]{10,})/.exec(decoded);
        const metaFile = /data-fileid='([^']+)'/.exec(inner);
        const fileId = (player && player[1]) || (metaFile && metaFile[1]) || '';
        if (!fileId) continue;
        const showId = Number.parseInt(/[?&]show_id=(\d+)/.exec(decoded)?.[1] || '', 10) || 0;
        const ep = Number.parseInt(/[?&]ep=(\d+)/.exec(decoded)?.[1] || '', 10);
        const season = Number.parseInt(/season\D*(\d+)/i.exec(seasonLabel)?.[1] || '', 10) || 1;
        const label = /\[ANIMAHD[^\]]*\]\s*([^<]*?)\s*(?:<|\.mkv)/i.exec(inner)?.[1] || '';
        rows.push({
            season,
            seasonLabel: seasonLabel.trim(),
            ep: Number.isInteger(ep) ? ep : rows.length,
            fileId,
            showId,
            label: label.replace(/\s+/g, ' ').trim().slice(0, 140),
        });
    }
    return rows;
}

/** Rows -> { showId, seasons: {1: n, …}, eps: [fileId…], labels: [..], mixed } */
export function rowsToEpisodes(rows) {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => (a.season - b.season) || (a.ep - b.ep));
    const seasons = {};
    for (const r of sorted) seasons[String(r.season)] = (seasons[String(r.season)] || 0) + 1;
    const votes = new Map();
    for (const r of sorted) votes.set(r.showId, (votes.get(r.showId) || 0) + 1);
    let showId = 0;
    let best = -1;
    for (const [id, n] of votes) if (n > best) { best = n; showId = id; }
    const eps = sorted.map((r) => r.fileId);
    const labels = sorted.map((r) => r.label);
    return { showId, seasons, eps, labels, mixed: votes.size > 1 };
}

/* ------------------------------------------------------------------ */
/*  Title matching (guards against wrong-slug matches)                 */
/* ------------------------------------------------------------------ */

export function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const TITLE_BOILER = new Set([
    'watch', 'watching', 'online', 'all', 'episode', 'episodes', 'hd', 'full', 'movie', 'movies',
    'series', 'season', 'seasons', 'download', 'free', 'hindi', 'dubbed', 'dub', 'dual', 'audio',
    'multi', 'sub', 'subbed', 'eng', 'english', 'jap', 'japanese', 'tamil', 'telugu', 'korean',
    'malayalam', 'complete', 'completed', 'quality', 'web', 'bluray', 'rip', 'anime', 'animahd',
    'the', 'of', 'and', 'in', 'at', 'to', 'a', 'an',
]);

export function titleTokens(text) {
    const cleaned = String(text || '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .split('|')[0]
        .replace(/[’'`]/g, '');
    return slugify(cleaned)
        .split('-')
        .filter((t) => t && !TITLE_BOILER.has(t));
}

const tokenEq = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

/** Does a page/post title really name this catalog title? */
export function matchTitle(pageTitle, titles) {
    const want = titleTokens(Array.isArray(titles) ? titles[0] : titles);
    const altlist = (Array.isArray(titles) ? titles.slice(1) : []).map(titleTokens);
    if (!want.length) return { ok: false, score: 0 };
    for (const [i, tokens] of [want, ...altlist].entries()) {
        const got = new Set(titleTokens(pageTitle));
        const hit = tokens.filter((w) => [...got].some((g) => tokenEq(w, g))).length;
        const score = hit / tokens.length;
        const firstOk = tokens.length > 0 && [...got].some((g) => tokenEq(tokens[0], g));
        const alt = i > 0;
        if (hit === tokens.length || (firstOk && score >= (alt ? 0.6 : 0.7))) {
            return { ok: true, score, tokens, alt };
        }
    }
    return { ok: false, score: 0 };
}

/** Page <h1> (cleanest show name) falling back to <title>. */
export function extractPageTitle(html) {
    const h1 = [...String(html || '').matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
        .map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    if (h1.length) return h1[0];
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return title ? title[1].trim() : '';
}

/** 'S02E13 Solo Leveling', 'EP-01 Show', 'E01 Show', 'S20E41(E932) One Piece' -> {season, ep} */
export function parseLabelEpisode(label) {
    const text = String(label || '');
    let m = /S(\d{1,2})\s*E(\d{1,4})/i.exec(text);
    if (m) return { season: Number.parseInt(m[1], 10), ep: Number.parseInt(m[2], 10) };
    m = /(?:EP|E)[\s._-]*(\d{1,4})/i.exec(text);
    if (m) return { season: null, ep: Number.parseInt(m[1], 10) };
    return null;
}

/** Rank WP REST search hits for a title (title match + slug hint). */
export function rankPosts(posts, titles) {
    const out = [];
    for (const p of posts || []) {
        const pt = (p && p.title && (p.title.rendered || p.title)) || '';
        const m = matchTitle(pt, titles);
        if (m.ok) out.push({ slug: p.slug, id: p.id, postTitle: pt, score: m.score });
    }
    return out.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/*  Merging episode rows across pages                                  */
/* ------------------------------------------------------------------ */

/**
 * Merge parsed rows from one or more pages into EP_DATA shape.
 * Rows are keyed by (season from label or data-season) + episode number
 * from the label, falling back to document order.
 */
export function mergeEpisodeRows(pages) {
    const seasonRows = new Map(); // season -> Map<epKey, {fileId, label, showId}>
    const fileSeen = new Set();
    for (const page of pages) {
        const counters = new Map();
        for (const r of page.rows || []) {
            const labelEp = parseLabelEpisode(r.label);
            const season = (labelEp && labelEp.season) || r.season || 1;
            let epNum = (labelEp && Number.isInteger(labelEp.ep)) ? labelEp.ep : null;
            if (epNum === null) {
                epNum = (counters.get(season) || 0) + 1;
            }
            counters.set(season, Math.max(counters.get(season) || 0, epNum));
            if (fileSeen.has(r.fileId)) continue;
            if (!seasonRows.has(season)) seasonRows.set(season, new Map());
            const bucket = seasonRows.get(season);
            const key = String(epNum);
            if (bucket.has(key)) continue;
            fileSeen.add(r.fileId);
            bucket.set(key, { fileId: r.fileId, label: r.label || '', showId: r.showId || 0 });
        }
    }
    if (!seasonRows.size) return null;
    const seasons = [...seasonRows.keys()].sort((a, b) => a - b);
    const out = { showId: 0, seasons: {}, eps: [], labels: [] };
    const votes = new Map();
    for (const season of seasons) {
        const bucket = seasonRows.get(season);
        const eps = [...bucket.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
        out.seasons[String(season)] = eps.length;
        for (const [, item] of eps) {
            out.eps.push(item.fileId);
            out.labels.push(item.label);
            if (item.showId) votes.set(item.showId, (votes.get(item.showId) || 0) + 1);
        }
    }
    let best = -1;
    for (const [id, n] of votes) if (n > best) { best = n; out.showId = id; }
    out.mixed = votes.size > 1;
    return out;
}

export function parseSeasonsOpt(value, epCount) {
    if (!value) return { 1: epCount };
    const counts = String(value).split(',').map((x) => Number.parseInt(x.trim(), 10));
    if (!counts.length || counts.some((n) => !Number.isInteger(n) || n <= 0)) {
        throw new Error(`bad --seasons "${value}" (want e.g. "12,13")`);
    }
    const sum = counts.reduce((a, b) => a + b, 0);
    if (sum !== epCount) {
        throw new Error(`--seasons sum ${sum} != ${epCount} episodes harvested`);
    }
    const seasons = {};
    counts.forEach((n, i) => { seasons[String(i + 1)] = n; });
    return seasons;
}

async function fetchPage(url, verbose) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                Accept: 'text/html,*/*',
            },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const text = await res.text();
        if (verbose) console.log(`fetched ${url} -> ${res.url} (${text.length} chars)`);
        return text;
    } finally {
        clearTimeout(to);
    }
}

function sanitiseKey(slug) {
    return String(slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseArgs(argv) {
    const args = { slugs: [], key: '', seasons: '', base: DEFAULT_BASE, out: DEFAULT_OUT, verbose: false, selfTest: false, help: false };
    for (const a of argv) {
        if (a === '--self-test') args.selfTest = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (a === '--verbose' || a === '-v') args.verbose = true;
        else if (a.startsWith('--key=')) args.key = a.slice(6);
        else if (a.startsWith('--seasons=')) args.seasons = a.slice(10);
        else if (a.startsWith('--base=')) args.base = a.slice(7).replace(/\/+$/, '');
        else if (a.startsWith('--out=')) args.out = resolve(ROOT, a.slice(6));
        else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
        else args.slugs.push(a.replace(/^\/+|\/+$/g, ''));
    }
    return args;
}

function printHelp() {
    console.log(`harvest-animahd.mjs — AnimaHD file_id harvester
Usage:
  node scripts/harvest-animahd.mjs <slug> [--key=solo] [--seasons=12,13]
      [--base=https://animahd.com] [--out=data/animahd-episodes.json] [--verbose]
  node scripts/harvest-animahd.mjs --self-test
Examples:
  node scripts/harvest-animahd.mjs solo-leveling --key solo --seasons 12,13`);
}

function runSelfTest() {
    let n = 0;
    let ok = 0;
    const check = (name, cond) => {
        n += 1;
        if (cond) { ok += 1; console.log(`  ok - ${name}`); }
        else console.log(`  FAIL - ${name}`);
    };
    console.log('harvest-animahd self-test (offline fixtures)');
    const tok = (f, s, e) => Buffer.from(`player/?file_id=${f}&show_id=${s}&ep=${e}`).toString('base64');
    const html = `<a href="/watch/?p=${tok('AAA111AAA111', 1138, 0)}">1</a>` +
        `<a href="/watch/?p=${tok('BBB222BBB222', 1138, 1)}&x=1">2</a>` +
        `<a href="/watch/?p=${tok('CCC333CCC333', 1138, 2)}">3</a>`;
    check('finds 3 p tokens', extractPTokens(html).length === 3);
    const d0 = decodePlayerToken(extractPTokens(html)[0]);
    check('decodes file/show/ep', !!d0 && d0.fileId === 'AAA111AAA111' && d0.showId === 1138 && d0.ep === 0);
    const col = collectEpisodes(html);
    check('collects in ep order', col.eps.join(',') === 'AAA111AAA111,BBB222BBB222,CCC333CCC333');
    check('showId + not mixed', col.showId === 1138 && col.mixed === false);
    check('junk token skipped', decodePlayerToken(Buffer.from('hello').toString('base64')) === null);
    check('bad file_id skipped', decodePlayerToken(tok('short', 1138, 0)) === null);
    const dup = html + `<a href="/watch/?p=${tok('ZZZ999ZZZ999', 1138, 1)}">dup</a>`;
    check('first hit wins per ep', collectEpisodes(dup).eps[1] === 'BBB222BBB222');
    const gap = `<a href="/watch/?p=${tok('AAA111AAA111', 1138, 0)}">1</a>` +
        `<a href="/watch/?p=${tok('CCC333CCC333', 1138, 2)}">3</a>`;
    let gapErr = '';
    try { collectEpisodes(gap); } catch (e) { gapErr = String(e && e.message || e); }
    check('gap detected', gapErrorIncludes(gapErr));
    const mixed = html + `<a href="/watch/?p=${tok('DDD444DDD444', 9999, 3)}">4</a>`;
    const mc = collectEpisodes(mixed);
    check('mixed show_ids keep majority', mc.mixed === true && mc.showId === 1138);
    let noneErr = '';
    try { collectEpisodes('<p>nothing here</p>'); } catch (e) { noneErr = String(e && e.message || e); }
    check('empty page errors', noneErr.includes('no player/'));
    // Vodi-theme rows (the live markup as of 2026-10): base64 player URL inside
    // an HTML-encoded href + data-season labels on the anchor.
    const row = (f, sid, ep, season) => {
        const url = `https://animahd.com/player/?file_id=${f}&show_id=${sid}&ep=${ep}`;
        const tok = Buffer.from(url).toString('base64');
        return `<a href='https://animahd.com/?sec_route=1&#038;p=${tok}&#038;s=deadbeef' class='app-ep-row-item' data-season='Season ${season}'><div><img src='https://animahd.com/?sec_route=1&#038;p=x'></div><div class='gdrive-ep-meta' data-fileid='${f}'><div>[ANIMAHD.COM] S0${season}E0${ep + 1} Test Show.mkv</div></div></a>`;
    };
    const rowsHtml = `<div class='ff-episodes-list'>${row('AAA111AAA111', 814, 0, 1)}${row('BBB222BBB222', 814, 1, 1)}${row('CCC333CCC333', 814, 2, 2)}</div>`;
    const rows = collectShowRows(rowsHtml);
    check('site rows parsed (season + ep)', rows.length === 3 && rows[0].season === 1 && rows[2].season === 2 && rows[1].fileId === 'BBB222BBB222');
    check('row labels keep SxxEyy', rows[0].label.includes('S01E01') && rows[2].label.includes('S02E03'));
    const conv = rowsToEpisodes(rows);
    check('rows -> seasons {1:2,2:1}', JSON.stringify(conv.seasons) === '{"1":2,"2":1}' && conv.eps.length === 3 && conv.showId === 814);

    check('default seasons all S1', JSON.stringify(parseSeasonsOpt('', 25)) === '{"1":25}');
    check('explicit seasons split', JSON.stringify(parseSeasonsOpt('12,13', 25)) === '{"1":12,"2":13}');
    let seasErr = '';
    try { parseSeasonsOpt('12,12', 25); } catch (e) { seasErr = String(e && e.message || e); }
    check('season sum mismatch errors', seasErr.includes('!= 25'));
    console.log(`${ok}/${n} self-tests passed`);
    if (ok !== n) process.exitCode = 1;
}

function gapErrorIncludes(msg) {
    return msg.includes('missing ep indexes');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { printHelp(); return; }
    if (args.selfTest) { runSelfTest(); return; }
    if (!args.slugs.length) { printHelp(); process.exitCode = 2; return; }
    let data = {};
    if (existsSync(args.out)) {
        data = JSON.parse(readFileSync(args.out, 'utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error(`${args.out} is not a JSON object`);
        }
    }
    for (const slug of args.slugs) {
        const key = args.key || sanitiseKey(slug);
        if (!key) throw new Error(`cannot derive key for slug "${slug}" (pass --key=)`);
        if (args.slugs.length > 1 && args.key) {
            throw new Error('--key only allowed with a single slug');
        }
        const url = `${args.base}/${slug}/`;
        const page = await fetchPage(url, args.verbose);
        const col = collectEpisodes(page);
        if (col.mixed) console.warn(`warn: mixed show_ids for ${slug}, kept ${col.showId}`);
        const seasons = parseSeasonsOpt(args.seasons, col.eps.length);
        data[key] = { slug, showId: col.showId, seasons, eps: col.eps };
        console.log(`harvested ${key}: show_id=${col.showId}, ${col.eps.length} eps`);
    }
    writeFileSync(args.out, JSON.stringify(data, null, 2) + '\n');
    console.log(`wrote ${args.out}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((e) => { console.error(`harvest-animahd: ${e && e.message || e}`); process.exitCode = 1; });
}
