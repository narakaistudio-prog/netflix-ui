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
