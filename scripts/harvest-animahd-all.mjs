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
    collectShowRows,
    decodePlayerToken,
    extractPageTitle,
    extractPTokens,
    foreignMarker,
    matchTitle,
    mergeEpisodeRows,
    parseLabelEpisode,
    rankPosts,
    rowsToEpisodes,
} from './harvest-animahd.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const EPISODES_PATH = resolve(ROOT, 'data', 'animahd-episodes.json');
const SLUGS_PATH = resolve(ROOT, 'data', 'animahd-slugs.json');
const REPORT_PATH = resolve(ROOT, 'data', 'animahd-report.json');
const SEASONS_PATH = resolve(ROOT, 'data', 'anime-seasons.json');
const POSTS_PATH = resolve(ROOT, 'data', 'animahd-posts.json');
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

/** Secondary names for the site search + title validation. */
const ALT_TITLES = {
    aot: ['Shingeki no Kyojin'],
    mha: ['Boku no Hero Academia'],
    mhaMovie: ['Boku no Hero Academia Two Heroes', 'My Hero Academia Movie 1'],
    demon: ['Kimetsu no Yaiba', 'Demon Slayer'],
    demonMovie: ['Kimetsu no Yaiba Mugen Train', 'Demon Slayer Mugen Train'],
    hxh: ['Hunter x Hunter'],
    rezero: ['Re Zero', 'Re:ZERO'],
    sao: ['Sword Art Online'],
    saoMovie: ['Sword Art Online The Movie Ordinal Scale', 'Ordinal Scale'],
    jjk0: ['Jujutsu Kaisen 0 The Movie', 'Jujutsu Kaisen Zero'],
    onepiece: ['One Piece'],
    naruto: ['Naruto Shippuden'],
    boruto: ['Boruto Naruto Next Generations'],
    drstone: ['Dr. Stone', 'Dr Stone'],
    blackclover: ['Black Clover'],
    bluelock: ['Blue Lock'],
    haikyuu: ['Haikyu', 'Haikyuu'],
    yourname: ['Kimi no Na wa', 'Your Name'],
    suzume: ['Suzume no Tojimari', 'Suzume'],
    silentvoice: ['Koe no Katachi', 'A Silent Voice'],
    spirited: ['Sen to Chihiro no Kamikakushi', 'Spirited Away'],
    weathering: ['Tenki no Ko', 'Weathering With You'],
    howl: ['Howl no Ugoku Shiro', "Howl's Moving Castle"],
    mononoke: ['Mononoke Hime', 'Princess Mononoke'],
    akira: ['Akira'],
    oshi: ['Oshi no Ko'],
    dandadan: ['Dan Da Dan', 'Dandadan'],
    kaiju: ['Kaiju No 8'],
    chainsaw: ['Chainsaw Man'],
    spy: ['Spy x Family', 'SPY×FAMILY'],
    frieren: ['Frieren Beyond Journeys End', 'Sousou no Frieren'],
    goh: ['The God of High School'],
    tower: ['Tower of God'],
    mob: ['Mob Psycho 100'],
    vinland: ['Vinland Saga'],
    deathnote: ['Death Note'],
    jjk: ['Jujutsu Kaisen'],
    opm: ['One Punch Man', 'One Punch Man'],
    bleach: ['Bleach'],
    onepunch: ['One Punch Man'],
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

/** WordPress REST search for show posts (returns [] when the site blocks it). */
async function wpSearchPosts(base, query) {
    const url = `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=100&orderby=relevance&_fields=id,slug,title,link`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    try {
        const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    } finally {
        clearTimeout(to);
    }
}

function rowToFallback(page) {
    // Old markup path: p-tokens give a flat, ep-indexed file list for one page.
    const col = collectEpisodes(page);
    const rows = col.eps.map((fileId, i) => ({
        season: 1,
        ep: i,
        fileId,
        showId: col.showId,
        label: '',
    }));
    return { rows, showId: col.showId, mixed: col.mixed };
}

async function harvestShow({ key, title, kind, args, slugs, postIndex }) {
    const titles = [title, ...(ALT_TITLES[key] || [])];
    const attempts = [];
    const tried = [];

    // 1. candidate list: pinned slug -> site post index -> live WP search -> generated slugs.
    const cands = [];
    if (args.pins[key]) cands.push({ slug: args.pins[key], source: 'cli-pin' });
    if (slugs[key] && slugs[key].slug) cands.push({ slug: slugs[key].slug, source: 'pin' });
    if (postIndex) {
        const pool = [...(postIndex.posts || []), ...(postIndex.pages || [])];
        for (const r of rankPosts(pool, titles)) {
            cands.push({ slug: r.slug, source: 'index', postTitle: r.postTitle });
        }
        // Sitemap URLs have no title: use the slug text for the match instead.
        const seenSlugs = new Set(cands.map((c) => c.slug));
        for (const url of postIndex.sitemap || []) {
            const slug = (url.replace(/\/$/, '').split('/').pop() || '').trim();
            if (!slug || seenSlugs.has(slug)) continue;
            const m = matchTitle(slug.replace(/-/g, ' '), titles, { strict: kind === 'movie' });
            if (!m.ok) continue;
            seenSlugs.add(slug);
            cands.push({ slug, source: 'sitemap' });
        }
    }
    const wpPosts = [];
    for (const q of titles) {
        const posts = await wpSearchPosts(args.base, q);
        wpPosts.push(...posts);
        await sleep(120);
    }
    const ranked = rankPosts(wpPosts, titles);
    for (const r of ranked) cands.push({ slug: r.slug, source: 'wpsearch', postTitle: r.postTitle });
    const searchRaw = wpPosts.map((p) => ((p.title && p.title.rendered) || '')).slice(0, 12);
    for (const slug of slugCandidates(title, key)) cands.push({ slug, source: 'candidate' });

    const seen = new Set();
    const queue = cands.filter((c) => {
        const k = String(c.slug || '').toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    // 2. fetch pages until maxPages accepted (title must match the catalog name).
    const pages = [];
    const weakPages = [];
    const maxPages = Math.min(args.maxPages || 8, 12);
    for (const cand of queue) {
        if (pages.length >= maxPages) break;
        tried.push(cand.slug);
        let text;
        let finalUrl = `${args.base}/${cand.slug}/`;
        try {
            const res = await fetchText(finalUrl, { timeout: 15000 });
            text = res.text;
            finalUrl = res.url;
        } catch (e) {
            attempts.push({ slug: cand.slug, source: cand.source, error: String((e && e.message) || e) });
            continue;
        }
        const pageTitle = extractPageTitle(text) || cand.postTitle || '';
        const m = matchTitle(pageTitle, titles, { strict: kind === 'movie' });
        if (!m.ok) {
            attempts.push({
                slug: cand.slug,
                source: cand.source,
                note: 'title mismatch',
                pageTitle: String(pageTitle).slice(0, 120),
            });
            await sleep(120);
            continue;
        }
        if (kind !== 'movie') {
            const marker = foreignMarker(pageTitle, titles);
            if (marker) {
                attempts.push({
                    slug: cand.slug,
                    source: cand.source,
                    note: `foreign marker: ${marker}`,
                    pageTitle: String(pageTitle).slice(0, 120),
                });
                await sleep(120);
                continue;
            }
        }
        const rows = collectShowRows(text);
        if (rows.length) {
            const conv = rowsToEpisodes(rows);
            const hist = {};
            for (const r of rows) hist[r.season] = (hist[r.season] || 0) + 1;
            const firstLast = [rows[0] && rows[0].label, rows[rows.length - 1] && rows[rows.length - 1].label];
            const labeled = rows.filter((r) => parseLabelEpisode(r.label)).length;
            if (kind !== 'movie' && labeled < Math.max(1, Math.floor(rows.length * 0.5))) {
                // No episode numbers in the labels: keep as weak fallback only.
                weakPages.push({ slug: cand.slug, source: cand.source, url: finalUrl, pageTitle, rows, showId: conv.showId });
                attempts.push({ slug: cand.slug, source: cand.source, note: 'accepted but unlabeled (weak)', rows: rows.length, pageTitle: String(pageTitle).slice(0, 120) });
                await sleep(150);
                continue;
            }
            pages.push({ slug: cand.slug, source: cand.source, url: finalUrl, pageTitle, rows, showId: conv.showId });
            attempts.push({ slug: cand.slug, source: cand.source, note: 'accepted', rows: rows.length, seasonHist: hist, firstLast, pageTitle: String(pageTitle).slice(0, 120) });
        } else {
            const rich = collectRich(text);
            if (rich.size) {
                const fb = rowToFallback(text);
                pages.push({ slug: cand.slug, source: cand.source, url: finalUrl, pageTitle, rows: fb.rows, showId: fb.showId });
                attempts.push({ slug: cand.slug, source: cand.source, note: 'accepted (legacy tokens)', rows: fb.rows.length });
            } else {
                attempts.push({
                    slug: cand.slug,
                    source: cand.source,
                    note: 'no episode rows',
                    pageTitle: String(pageTitle).slice(0, 120),
                });
            }
        }
        await sleep(150);
    }

    if (!pages.length && weakPages.length) pages.push(...weakPages.slice(0, 2));
    if (!pages.length) {
        return {
            status: 'failed',
            kind,
            title,
            error: 'no matching show page found',
            tried,
            attempts,
            searchCandidates: ranked.slice(0, 6),
            searchRaw,
        };
    }

    // 3. movies: one film, several quality rows -> keep the first row only.
    if (kind === 'movie') {
        pages[0].rows = pages[0].rows.slice(0, 1);
        pages.length = 1;
    }

    const merged = mergeEpisodeRows(pages);
    if (!merged || !merged.eps.length) {
        return { status: 'failed', kind, title, error: 'no episodes found', tried, attempts };
    }
    const labels = merged.labels.some(Boolean) ? merged.labels : null;
    return {
        attempts,
        status: 'ok',
        kind,
        title,
        slug: pages[0].slug,
        source: pages[0].source,
        url: pages[0].url,
        pages: pages.map((p) => p.slug),
        showId: merged.showId,
        mixed: merged.mixed,
        eps: merged.eps,
        labels,
        epContiguous: true,
        siteSeasons: merged.seasons,
    };
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
    const postIndex = readJson(POSTS_PATH, null);
    if (postIndex && Array.isArray(postIndex.posts)) {
        console.log(`post index: ${postIndex.posts.length} posts from ${postIndex.generatedAt}`);
    } else {
        console.log('post index missing — falling back to the live WP search');
    }
    const report = { generatedAt: new Date().toISOString(), base: args.base, shows: {}, summary: {} };

    const wanted = args.only.length
        ? catalog.shows.filter((s) => args.only.includes(s.key))
        : [...catalog.series, ...catalog.movies];

    console.log(`harvest-animahd-all: ${wanted.length} titles against ${args.base}`);

    for (const { key, title } of wanted) {
        const kind = catalog.movieKeys.includes(key) ? 'movie' : 'tv';
        const existing = episodes[key] || null;
        const result = await harvestShow({ key, title, kind, args, slugs, postIndex });
        const entry = { ...result };
        delete entry.kind;
        delete entry.title;
        entry.episodes = Array.isArray(result.eps) ? result.eps.length : 0;
        delete entry.eps;
        if (Array.isArray(entry.labels)) {
            entry.labelSample = [entry.labels[0] || '', entry.labels[entry.labels.length - 1] || ''];
            delete entry.labels;
        }
        if (result.status === 'ok') {
            const count = result.eps.length;
            const siteSum = result.siteSeasons
                ? Object.values(result.siteSeasons).reduce((a, b) => a + b, 0)
                : 0;
            const siteSeasons = result.siteSeasons && siteSum === count ? result.siteSeasons : null;
            const existingSeasons = existing && existing.seasons ? existing.seasons : null;
            const picked =
                siteSeasons && Object.keys(siteSeasons).length > 1
                    ? { seasons: siteSeasons, source: 'site' }
                    : pickSeasons(key, count, siteSeasons || existingSeasons, kind === 'movie' ? movieTable : table);
            episodes[key] = {
                slug: result.slug,
                showId: result.showId,
                seasons: picked.seasons,
                seasonsSource: picked.source,
                ...(picked.review ? { review: true } : {}),
                ...(result.labels && result.labels.some(Boolean) ? { labels: result.labels } : {}),
                eps: result.eps,
            };
            slugs[key] = { slug: result.slug, source: result.source, verified: true, titleAtHarvest: title };
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
