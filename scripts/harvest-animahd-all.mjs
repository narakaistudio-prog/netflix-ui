#!/usr/bin/env node
/**
 * Harvest AnimaHD episode file_ids for EVERY anime in the Crunchyroll page.
 *
 * This is the "all anime" companion to scripts/harvest-animahd.mjs (which
 * harvests one slug). It reads the catalog straight out of
 * assets/crunchyroll/crunchyroll.html, resolves each title to an
 * animahd.com show page, decodes the `?p=<base64>` player tokens
 * (`player/?file_id=…&show_id=…&ep=…`) and stores the whole franchise
 * episode list per show key.
 *
 * Outputs (all merged, entries are never deleted):
 *   data/animahd-episodes.json  EP_DATA table baked into the demo page
 *   data/animahd-slugs.json     resolved slug per show key (re-used next run)
 *   data/animahd-report.json    per-show status, counts, episode labels
 *
 * Season split: a row from data/anime-seasons.json is used only when its sum
 * equals the harvested episode count; otherwise the entry keeps its previous
 * seasons map, or falls back to {"1": N} and is flagged for review.
 *
 * Usage:
 *   node scripts/harvest-animahd-all.mjs [--only=solo,jjk] [--verbose]
 *        [--base=https://animahd.com] [--slug=key=slug]... [--discover]
 *   node scripts/harvest-animahd-all.mjs --self-test   # offline checks
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    collectEpisodes,
    decodePlayerToken,
    extractPTokens,
} from './harvest-animahd.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const EPISODES_PATH = resolve(ROOT, 'data', 'animahd-episodes.json');
const SLUGS_PATH = resolve(ROOT, 'data', 'animahd-slugs.json');
const REPORT_PATH = resolve(ROOT, 'data', 'animahd-report.json');
const SEASONS_PATH = resolve(ROOT, 'data', 'anime-seasons.json');
const DEFAULT_BASE = 'https://animahd.com';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/*  Demo-page catalog                                                  */
/* ------------------------------------------------------------------ */

/** Read every show key/title plus the movie keys out of the demo page. */
export function readCatalog(html) {
    const keys = [];
    const titleRe = /(?:^|[,{\n])\s*([A-Za-z][A-Za-z0-9_]*):\s*\{\s*title:\s*'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = titleRe.exec(html))) {
        if (keys.some((k) => k.key === m[1])) continue;
        keys.push({ key: m[1], title: unescapeJs(m[2]) });
    }
    const movieBlock = /var\s+movieKeys\s*=\s*\[([^\]]*)\]/.exec(html);
    const movieKeys = movieBlock
        ? movieBlock[1]
              .split(',')
              .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
              .filter(Boolean)
        : [];
    return {
        shows: keys,
        movieKeys,
        series: keys.filter((k) => !movieKeys.includes(k.key)),
        movies: keys.filter((k) => movieKeys.includes(k.key)),
    };
}

function unescapeJs(text) {
    return String(text).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/* ------------------------------------------------------------------ */
/*  Slug candidates + site search                                      */
/* ------------------------------------------------------------------ */

const ALT_SLUGS = {
    aot: ['shingeki-no-kyojin'],
    mha: ['boku-no-hero-academia'],
    demon: ['kimetsu-no-yaiba', 'demon-slayer'],
    hxh: ['hunterxhunter'],
    onepiece: ['one-piece-english-subbed'],
    naruto: ['naruto-shippuden-hindi'],
    rezero: ['rezero'],
    sao: ['sword-art-online-hindi'],
    drstone: ['drstone'],
    haikyuu: ['haikyuu'],
    bluelock: ['bluelock'],
    blackclover: ['blackclover'],
    onepunch: ['one-punch-man'],
};

export function slugCandidates(title, key) {
    const base = slugify(title);
    const out = new Set([base]);
    out.add(base.replace(/^the-/, ''));
    out.add(base.replace(/-x-/, '-'));
    out.add(base.replace(/-/g, ''));
    out.add(base.replace(/-\d+$/, ''));
    out.add(`${base}-hindi`);
    for (const alt of ALT_SLUGS[key] || []) out.add(alt);
    out.add(slugify(key));
    return [...out].filter((s) => s && s.length > 2);
}

export function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function tokens(text) {
    return slugify(text)
        .split('-')
        .filter((t) => t && !['the', 'no', 'of', 'and', 'x'].includes(t));
}

/** Score a candidate slug against a title (shared tokens / title tokens). */
export function scoreSlug(slug, title) {
    const want = tokens(title);
    const got = new Set(tokens(slug));
    if (!want.length) return 0;
    let hit = 0;
    for (const t of want) if (got.has(t)) hit += t.length > 3 ? 1.3 : 1;
    return hit / Math.max(want.length, got.size);
}

export function extractShowLinks(html, base) {
    const links = new Set();
    const re = /href=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(html))) {
        const href = m[1];
        const rel = href.replace(/^https?:\/\/[^/]+/i, '');
        const slug = /^\/([a-z0-9][a-z0-9-]{2,})\/?$/.exec(rel);
        if (slug) links.add(slug[1]);
    }
    return [...links];
}

/* ------------------------------------------------------------------ */
/*  Episode labels (for season review)                                 */
/* ------------------------------------------------------------------ */

/** ep index -> { fileId, label } taking the anchor text next to the token. */
export function collectRich(html) {
    const byEp = new Map();
    for (const tok of extractPTokens(html)) {
        const d = decodePlayerToken(tok);
        if (!d || byEp.has(d.ep)) continue;
        const at = html.indexOf(tok);
        const open = at === -1 ? -1 : html.lastIndexOf('<a', at);
        const close = at === -1 ? -1 : html.indexOf('</a>', at);
        let label = '';
        if (open !== -1 && close !== -1 && close > open) {
            label = html
                .slice(html.indexOf('>', open) + 1, close)
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        byEp.set(d.ep, { fileId: d.fileId, label: label.slice(0, 140) });
    }
    return byEp;
}

/* ------------------------------------------------------------------ */
/*  Season mapping                                                     */
/* ------------------------------------------------------------------ */

export function seasonsFromCounts(counts) {
    const seasons = {};
    counts.forEach((n, i) => {
        seasons[String(i + 1)] = n;
    });
    return seasons;
}

const sum = (seasons) => Object.values(seasons).reduce((a, b) => a + b, 0);

/**
 * Pick the seasons map for a harvested episode count.
 * Order: existing entry (still consistent) -> curated table (exact sum)
 *        -> single season fallback flagged for review.
 */
export function pickSeasons(key, count, existing, table) {
    if (existing && typeof existing === 'object' && sum(existing) === count) {
        return { seasons: existing, source: 'existing' };
    }
    const curated = table && Array.isArray(table[key]) ? table[key] : null;
    if (curated && curated.reduce((a, b) => a + b, 0) === count) {
        return { seasons: seasonsFromCounts(curated), source: 'table' };
    }
    return { seasons: { 1: count }, source: 'single', review: true };
}

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

async function fetchText(url, { timeout = 25000 } = {}) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeout);
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return { url: res.url, text: await res.text() };
    } finally {
        clearTimeout(to);
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function readJson(path, fallback) {
    if (!existsSync(path)) return fallback;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

function parseArgs(argv) {
    const args = { only: [], verbose: false, base: DEFAULT_BASE, pins: {}, discover: false, selfTest: false };
    for (const a of argv) {
        if (a === '--verbose' || a === '-v') args.verbose = true;
        else if (a === '--discover') args.discover = true;
        else if (a === '--self-test') args.selfTest = true;
        else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
        else if (a.startsWith('--base=')) args.base = a.slice(7).replace(/\/+$/, '');
        else if (a.startsWith('--slug=')) {
            const [k, s] = a.slice(7).split('=');
            if (k && s) args.pins[k] = s;
        } else throw new Error(`unknown flag ${a}`);
    }
    return args;
}

async function discover(base) {
    const { text, url } = await fetchText(`${base}/`);
    const forms = [];
    const formRe = /<form[^>]*>[\s\S]{0,800}?<\/form>/gi;
    let m;
    while ((m = formRe.exec(text))) {
        const action = /action=["']([^"']*)["']/i.exec(m[0]);
        const names = [...m[0].matchAll(/name=["']([^"']+)["']/gi)].map((x) => x[1]);
        forms.push({ action: action ? action[1] : '', names });
    }
    const links = extractShowLinks(text, base).slice(0, 25);
    console.log(`discover: ${url}`);
    console.log(`forms: ${JSON.stringify(forms).slice(0, 800)}`);
    console.log(`sample show links: ${links.join(', ')}`);
    return { url, forms, links };
}

async function harvestShow({ key, title, kind, args, existing, table, slugs }) {
    const pins = { ...slugs, ...args.pins };
    const tried = [];
    // 1. pinned slug wins.
    const candidates = [];
    if (pins[key]) candidates.push({ slug: pins[key], source: 'pin' });
    for (const slug of slugCandidates(title, key)) {
        if (!candidates.some((c) => c.slug === slug)) candidates.push({ slug, source: 'candidate' });
    }

    for (const cand of candidates) {
        const url = `${args.base}/${cand.slug}/`;
        tried.push(cand.slug);
        try {
            const { text, url: finalUrl } = await fetchText(url, { timeout: 15000 });
            const rich = collectRich(text);
            if (!rich.size) continue;
            const col = collectEpisodes(text);
            const labels = [];
            for (let i = 0; i < col.eps.length; i += 1) labels.push((rich.get(i) || {}).label || '');
            return {
                status: 'ok',
                kind,
                title,
                slug: cand.slug,
                source: cand.source,
                url: finalUrl,
                showId: col.showId,
                mixed: col.mixed,
                eps: col.eps,
                labels,
            };
        } catch (e) {
            if (args.verbose) console.log(`  miss ${url} — ${e.message}`);
        }
        await sleep(150);
    }

    // 2. Fall back to the site search.
    const searchUrl = `${args.base}/?s=${encodeURIComponent(title)}`;
    try {
        const { text } = await fetchText(searchUrl);
        const links = extractShowLinks(text, args.base);
        const ranked = links
            .map((slug) => ({ slug, score: scoreSlug(slug, title) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
        for (const cand of ranked) {
            if (cand.score < 0.5) break;
            tried.push(`search:${cand.slug}`);
            try {
                const { text: page, url: finalUrl } = await fetchText(`${args.base}/${cand.slug}/`, { timeout: 15000 });
                const rich = collectRich(page);
                if (!rich.size) continue;
                const col = collectEpisodes(page);
                const labels = [];
                for (let i = 0; i < col.eps.length; i += 1) labels.push((rich.get(i) || {}).label || '');
                return {
                    status: 'ok',
                    kind,
                    title,
                    slug: cand.slug,
                    source: 'search',
                    url: finalUrl,
                    showId: col.showId,
                    mixed: col.mixed,
                    eps: col.eps,
                    labels,
                };
            } catch (e) {
                if (args.verbose) console.log(`  search miss ${cand.slug} — ${e.message}`);
            }
            await sleep(150);
        }
        return {
            status: 'failed',
            kind,
            title,
            error: 'no show page found',
            tried,
            searchUrl,
            searchCandidates: ranked,
        };
    } catch (e) {
        return { status: 'failed', kind, title, error: `search failed: ${e.message}`, tried, searchUrl };
    }
}

function runSelfTest() {
    let n = 0;
    let ok = 0;
    const check = (name, cond) => {
        n += 1;
        if (cond) {
            ok += 1;
            console.log(`  ok - ${name}`);
        } else console.log(`  FAIL - ${name}`);
    };
    console.log('harvest-animahd-all self-test (offline fixtures)');
    const catalog = readCatalog(
        "<script>var shows={\n a:{title:'Alpha Show',year:2020,img:'x'},\n b:{title:'Beta',year:2021,img:'x'}\n};var movieKeys=['b'];</script>",
    );
    check('catalog parsed', catalog.shows.length === 2 && catalog.series.length === 1 && catalog.movies.length === 1);
    check('slug candidates include plain + hindi', slugCandidates("Frieren: Beyond Journey's End", 'frieren').includes('frieren-beyond-journeys-end') && slugCandidates('One Piece', 'onepiece').includes('one-piece-hindi'));
    check('score picks the right search hit', scoreSlug('solo-leveling', 'Solo Leveling') > scoreSlug('solo-leveling-hindi-dub', 'Solo Leveling'));
    check('show links extracted', extractShowLinks('<a href="/solo-leveling/">x</a><a href="/about/">y</a>', 'https://animahd.com').includes('solo-leveling'));
    check('single season fallback flagged', pickSeasons('ghost', 7, null, null).review === true);
    check('existing seasons kept when count matches', pickSeasons('solo', 25, { 1: 12, 2: 13 }, null).seasons['2'] === 13);
    check('table applied on exact sum', pickSeasons('jjk', 47, null, { jjk: [24, 23] }).seasons['2'] === 23);
    const tok = (f, s, e) => Buffer.from(`player/?file_id=${f}&show_id=${s}&ep=${e}`).toString('base64');
    const html = `<a class="ep" href="/watch/?p=${tok('AAA111AAA111', 1138, 0)}">1</a><a class="ep" href="/watch/?p=${tok('BBB222BBB222', 1138, 1)}">2</a>`;
    const rich = collectRich(html);
    check('rich labels captured', rich.get(0).label === '1' && rich.get(1).fileId === 'BBB222BBB222');
    console.log(`${ok}/${n} self-tests passed`);
    if (ok !== n) process.exitCode = 1;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.selfTest) {
        runSelfTest();
        return;
    }
    if (args.discover) {
        await discover(args.base);
        return;
    }

    const html = readFileSync(HTML_PATH, 'utf8');
    const catalog = readCatalog(html);
    const table = (readJson(SEASONS_PATH, {}) || {}).series || {};
    const movieTable = (readJson(SEASONS_PATH, {}) || {}).movies || {};
    const episodes = readJson(EPISODES_PATH, {}) || {};
    const slugs = readJson(SLUGS_PATH, {}) || {};
    const report = { generatedAt: new Date().toISOString(), base: args.base, shows: {}, summary: {} };

    const wanted = args.only.length
        ? catalog.shows.filter((s) => args.only.includes(s.key))
        : [...catalog.series, ...catalog.movies];

    console.log(`harvest-animahd-all: ${wanted.length} titles against ${args.base}`);

    for (const { key, title } of wanted) {
        const kind = catalog.movieKeys.includes(key) ? 'movie' : 'tv';
        const existing = episodes[key] || null;
        const pinned = slugs[key] && slugs[key].verified ? slugs[key].slug : '';
        const result = await harvestShow({
            key,
            title,
            kind,
            args,
            existing,
            table: kind === 'movie' ? movieTable : table,
            slugs: pinned ? { [key]: pinned } : {},
        });
        const entry = { ...result };
        delete entry.kind;
        delete entry.title;
        if (result.status === 'ok') {
            const count = result.eps.length;
            const picked = pickSeasons(key, count, existing && existing.seasons, kind === 'movie' ? movieTable : table);
            episodes[key] = {
                slug: result.slug,
                showId: result.showId,
                seasons: picked.seasons,
                seasonsSource: picked.source,
                ...(picked.review ? { review: true } : {}),
                eps: result.eps,
            };
            slugs[key] = { slug: result.slug, source: result.source, verified: result.source !== 'search' };
            entry.seasons = picked.seasons;
            entry.seasonsSource = picked.source;
            if (picked.review) entry.review = true;
            console.log(
                `ok   ${key.padEnd(12)} ${String(count).padStart(4)} eps  s=${JSON.stringify(picked.seasons)} (${picked.source}${picked.review ? ', REVIEW' : ''})`,
            );
        } else {
            console.log(`FAIL ${key.padEnd(12)} ${result.error}`);
            if (slugs[key]) slugs[key] = { ...slugs[key], failedAt: new Date().toISOString() };
        }
        report.shows[key] = entry;
        await sleep(250);
    }

    const entries = Object.values(report.shows);
    report.summary = {
        titles: entries.length,
        ok: entries.filter((e) => e.status === 'ok').length,
        failed: entries.filter((e) => e.status !== 'ok').length,
        review: entries.filter((e) => e.review).length,
        episodes: entries.reduce((n, e) => n + (e.eps ? e.eps.length : 0), 0),
    };

    writeFileSync(EPISODES_PATH, `${JSON.stringify(episodes, null, 2)}\n`);
    writeFileSync(SLUGS_PATH, `${JSON.stringify(slugs, null, 2)}\n`);
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
        `wrote ${EPISODES_PATH} (${Object.keys(episodes).length} titles), ${SLUGS_PATH}, ${REPORT_PATH}\n` +
            `summary: ${JSON.stringify(report.summary)}`,
    );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((e) => {
        console.error(`harvest-animahd-all: ${(e && e.message) || e}`);
        process.exitCode = 1;
    });
}
