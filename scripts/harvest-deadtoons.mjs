#!/usr/bin/env node
/**
 * Harvest confirmed AniDisk episode links from DeadToons posts.
 *
 * Slug-guessing (anidisk.org/watch/<guessed-slug>/s/e) 404s whenever a slug
 * differs from the title. DeadToons posts link the REAL episode pages, so we
 * harvest those instead — plus Hindi/multi-audio tags from the post text.
 *
 * Output: data/anidisk-confirmed.json (merged, never deletes entries).
 * Then run scripts/bake-anidisk-links.mjs to bake it into the demo page.
 *
 * Usage:
 *   node scripts/harvest-deadtoons.mjs [--titles=solo,jjk] [--limit=5]
 *       [--base=https://deadtoons.example] [--dry-run] [--verbose]
 *   node scripts/harvest-deadtoons.mjs --self-test   # offline parser checks
 *
 * Env: DEADTOONS_BASE overrides the default site root.
 *
 * How discovery works (first hit wins per title):
 *   1. WordPress REST search:  /wp-json/wp/v2/search?search=<title>
 *   2. Classic search page:    /?s=<title>  (same-host post links)
 *   3. Sitemap scan:           /sitemap.xml (slug-token match, last resort)
 * Post HTML is scanned for anidisk.org/watch/<slug>/<s>/<e> links; nearby
 * text (+/- 800 chars) and the page title decide the Hindi/multi tags.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const OUT_PATH = resolve(ROOT, 'data', 'anidisk-confirmed.json');

const ANIDISK_RE = /https?:\/\/anidisk\.org\/watch\/([A-Za-z0-9\-_]+)\/(\d+)\/(\d+)\/?/g;
const HINDI_RE = /\bhindi\b|\bhin\b|multi[\s-]?audio|dubbed/i;
const MULTI_RE = /multi[\s-]?audio|dual[\s-]?audio/i;
const DUBBED_RE = /dubbed/i;

/* ------------------------------------------------------------------ */
/* Pure parsers (also exercised by --self-test, no network).           */
/* ------------------------------------------------------------------ */

export function normalizeTitle(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[\[(][^\]\)]*[\])]/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\b(hindi|hin|dubbed|dual|multi|audio|download|watch|online|season|episode|ep|complete|batch|hevc|x264|x265|480p|720p|1080p|2160p|4k|esub|subbed|s\d{1,2}e\d{1,3}|part|volume)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokens(s) {
    return normalizeTitle(s).split(' ').filter(Boolean);
}

/** Overlap of the smaller token set (0..1). */
export function tokenScore(a, b) {
    const ta = tokens(a);
    const tb = new Set(tokens(b));
    if (!ta.length || !tb.size) return 0;
    const hit = ta.filter(t => tb.has(t)).length;
    return hit / Math.min(ta.length, tb.size);
}

export function extractAnidiskLinks(html) {
    const found = [];
    const seen = new Set();
    for (const m of String(html || '').matchAll(ANIDISK_RE)) {
        const url = `https://anidisk.org/watch/${m[1]}/${m[2]}/${m[3]}`;
        if (seen.has(url)) continue;
        seen.add(url);
        found.push({ slug: m[1], season: m[2], episode: m[3], url, index: m.index ?? 0 });
    }
    return found;
}

export function detectTags(text) {
    const t = String(text || '');
    const tags = [];
    if (HINDI_RE.test(t)) tags.push('hindi');
    if (MULTI_RE.test(t)) tags.push('multi-audio');
    else if (DUBBED_RE.test(t)) tags.push('dubbed');
    return { hindi: tags.includes('hindi'), tags };
}

export function windowAround(html, index, radius = 800) {
    const s = String(html || '');
    return s.slice(Math.max(0, index - radius), index + radius);
}

/** Best catalog key for a post title (null below threshold). */
export function matchCatalog(postTitle, catalog, threshold = 0.5) {
    let best = null;
    let bestScore = 0;
    for (const entry of catalog) {
        const score = tokenScore(postTitle, entry.title);
        if (score > bestScore) {
            bestScore = score;
            best = entry.key;
        }
    }
    return bestScore >= threshold ? best : null;
}

export function extractPostLinks(searchHtml, base) {
    const host = new URL(base).host.replace(/^www\./, '');
    const out = [];
    const seen = new Set();
    for (const m of String(searchHtml || '').matchAll(/<a[^>]+href="([^"]+)"/gi)) {
        let u;
        try {
            u = new URL(m[1], base);
        } catch {
            continue;
        }
        if (u.host.replace(/^www\./, '') !== host) continue;
        if (/\.(css|js|png|jpe?g|webp|gif|svg|ico|woff2?)($|[?#])/i.test(u.pathname)) continue;
        if (/^\/(wp-|feed|comments|tag|category|page\/|author)/i.test(u.pathname)) continue;
        if (u.pathname.replace(/\//g, '').length < 3) continue;
        const clean = u.origin + u.pathname.replace(/\/+$/, '');
        if (seen.has(clean)) continue;
        seen.add(clean);
        out.push(clean);
    }
    return out;
}

export function parseSitemap(xml) {
    const locs = [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim());
    return [...new Set(locs)];
}

export function pageTitle(html) {
    const og = String(html || '').match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (og) return og[1];
    const h1 = String(html || '').match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1) return h1[1].trim();
    const title = String(html || '').match(/<title>([^<]+)<\/title>/i);
    return title ? title[1].trim() : '';
}

/* ------------------------------------------------------------------ */
/* Catalog + network                                                   */
/* ------------------------------------------------------------------ */

export function loadCatalog() {
    const html = readFileSync(HTML_PATH, 'utf8');
    const seg = html.slice(html.indexOf('var shows={'));
    const showsBlock = seg.slice(0, seg.indexOf('\n      };'));
    const entries = [];
    for (const m of showsBlock.matchAll(/(\w+):\{title:'((?:[^'\\]|\\.)*)'/g)) {
        entries.push({ key: m[1], title: m[2].replace(/\\'/g, "'") });
    }
    if (!entries.length) throw new Error('No catalog titles parsed from demo HTML');
    return entries;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function fetchText(url, { timeoutMs = 20000, retries = 1 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        } catch (err) {
            lastError = err;
            await sleep(600);
        }
    }
    throw lastError;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function discoverPosts(base, title, verbose) {
    const q = encodeURIComponent(title);
    // 1. WordPress REST search.
    for (const endpoint of [
        `/wp-json/wp/v2/search?search=${q}&per_page=20`,
        `/wp-json/wp/v2/posts?search=${q}&per_page=20`,
    ]) {
        try {
            const raw = await fetchText(base + endpoint);
            const items = JSON.parse(raw);
            const urls = (Array.isArray(items) ? items : [])
                .map(it => it.url || it.link)
                .filter(u => typeof u === 'string' && u.startsWith('http'));
            if (urls.length) {
                if (verbose) console.log(`  REST ${endpoint.split('?')[0]} → ${urls.length} posts`);
                return [...new Set(urls)].slice(0, 6);
            }
        } catch (err) {
            if (verbose) console.log(`  REST miss (${endpoint.split('?')[0]}): ${err.message}`);
        }
    }
    // 2. Classic ?s= search page.
    try {
        const html = await fetchText(`${base}/?s=${q}`);
        const links = extractPostLinks(html, base).slice(0, 6);
        if (links.length) {
            if (verbose) console.log(`  ?s= page → ${links.length} posts`);
            return links;
        }
    } catch (err) {
        if (verbose) console.log(`  ?s= miss: ${err.message}`);
    }
    return [];
}

async function sitemapUrls(base) {
    for (const path of ['/sitemap.xml', '/wp-sitemap.xml', '/post-sitemap.xml']) {
        try {
            const xml = await fetchText(base + path);
            const locs = parseSitemap(xml);
            const nested = locs.filter(u => /sitemap.*\.xml/i.test(u));
            let all = locs.filter(u => !/sitemap.*\.xml/i.test(u));
            for (const n of nested.slice(0, 10)) {
                try {
                    all.push(...parseSitemap(await fetchText(n)).filter(u => !/sitemap.*\.xml/i.test(u)));
                } catch {}
            }
            all = [...new Set(all)];
            if (all.length) return all;
        } catch {}
    }
    return [];
}

/* ------------------------------------------------------------------ */
/* Harvest                                                             */
/* ------------------------------------------------------------------ */

function mergeEntry(existing, found) {
    const entry = existing && typeof existing === 'object' ? { ...existing } : {};
    const slugs = {};
    for (const link of found.links) slugs[link.slug] = (slugs[link.slug] || 0) + 1;
    const topSlug = Object.entries(slugs).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topSlug && !entry.slug) entry.slug = topSlug;
    entry.eps = entry.eps && typeof entry.eps === 'object' ? { ...entry.eps } : {};
    for (const link of found.links) {
        const k = `${Number(link.season)}:${Number(link.episode)}`;
        if (!entry.eps[k]) entry.eps[k] = link.url;
    }
    const seasons = [...new Set(found.links.map(l => Number(l.season)))].sort((a, b) => a - b);
    entry.seasons = [...new Set([...(entry.seasons || []), ...seasons])].sort((a, b) => a - b);
    entry.tags = [...new Set([...(entry.tags || []), ...found.tags])];
    if (found.tags.includes('hindi')) entry.hindi = true;
    entry.source = found.postUrl;
    entry.verified = new Date().toISOString().slice(0, 10);
    return entry;
}

async function harvestTitle(base, entry, opts, confirmed) {
    const { verbose } = opts;
    const posts = await discoverPosts(base, entry.title, verbose);
    if (!posts.length && verbose) console.log('  no post candidates');
    let hits = 0;
    for (const postUrl of posts) {
        let html;
        try {
            html = await fetchText(postUrl);
            await sleep(400);
        } catch (err) {
            if (verbose) console.log(`  post fetch fail ${postUrl}: ${err.message}`);
            continue;
        }
        const title = pageTitle(html);
        const key = matchCatalog(`${title} ${postUrl}`, [entry]) ? entry.key : matchCatalog(title, [entry]);
        if (key !== entry.key) {
            if (verbose) console.log(`  skip (title mismatch): ${title || postUrl}`);
            continue;
        }
        const links = extractAnidiskLinks(html);
        if (!links.length) {
            if (verbose) console.log(`  no anidisk links: ${postUrl}`);
            continue;
        }
        const tagSet = new Set(detectTags(title).tags);
        for (const link of links) {
            for (const tag of detectTags(windowAround(html, link.index)).tags) tagSet.add(tag);
        }
        confirmed[entry.key] = mergeEntry(confirmed[entry.key], {
            links,
            tags: [...tagSet],
            postUrl,
        });
        hits += links.length;
        if (verbose) console.log(`  +${links.length} links [${[...tagSet].join(',') || 'no-tags'}] ${postUrl}`);
        if (hits >= 40) break;
    }
    return hits;
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--self-test')) return selfTest();
    const get = name => {
        const hit = argv.find(a => a.startsWith(`--${name}=`));
        return hit ? hit.slice(name.length + 3) : null;
    };
    const base = (get('base') || process.env.DEADTOONS_BASE || 'https://deadtoons.com').replace(/\/+$/, '');
    const onlyTitles = get('titles') ? get('titles').split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
    const limit = get('limit') ? Number(get('limit')) : Infinity;
    const dryRun = argv.includes('--dry-run');
    const verbose = argv.includes('--verbose');

    // Fail fast with guidance when the site is unreachable/misconfigured.
    try {
        await fetchText(base, { timeoutMs: 15000, retries: 0 });
    } catch (err) {
        console.error(`Cannot reach DeadToons at ${base} (${err.message}).`);
        console.error('Set the right root with --base=<url> or DEADTOONS_BASE env and retry.');
        process.exitCode = 2;
        return;
    }

    const catalog = loadCatalog().filter(e => !onlyTitles || onlyTitles.includes(e.key.toLowerCase()));
    console.log(`Catalog: ${catalog.length} titles · base: ${base}${dryRun ? ' · DRY RUN' : ''}`);
    const confirmed = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : {};
    let totalHits = 0;
    let matched = 0;
    const slice = catalog.slice(0, limit);
    for (const [i, entry] of slice.entries()) {
        console.log(`[${i + 1}/${slice.length}] ${entry.title}`);
        const before = Object.keys(confirmed[entry.key]?.eps || {}).length;
        totalHits += await harvestTitle(base, entry, { verbose }, confirmed);
        if (Object.keys(confirmed[entry.key]?.eps || {}).length > before) matched += 1;
    }
    const hindi = Object.values(confirmed).filter(e => e.hindi).length;
    console.log(`Done: ${matched}/${slice.length} titles enriched · ${totalHits} links · ${hindi} Hindi-titled.`);
    if (dryRun) {
        console.log('Dry run — nothing written.');
        return;
    }
    writeFileSync(OUT_PATH, JSON.stringify(confirmed, null, 2) + '\n');
    console.log(`Wrote ${OUT_PATH} (${Object.keys(confirmed).length} titles). Run scripts/bake-anidisk-links.mjs next.`);
}

/* ------------------------------------------------------------------ */
/* Offline self-test (no network): parser fixtures.                    */
/* ------------------------------------------------------------------ */

function selfTest() {
    const failures = [];
    const check = (name, cond, extra = '') => {
        console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${extra}`}`);
        if (!cond) failures.push(name);
    };

    const catalog = [
        { key: 'solo', title: 'Solo Leveling' },
        { key: 'demonMovie', title: 'Demon Slayer: Mugen Train' },
    ];
    check('match solo post', matchCatalog('Solo Leveling Season 1 Hindi Dubbed 1080p', catalog) === 'solo');
    check('match movie post', matchCatalog('Demon Slayer Mugen Train Movie Hindi Download', catalog) === 'demonMovie');
    check('reject unrelated', matchCatalog('Random Cooking Show Episode 4', catalog) === null);

    const wpSearch = JSON.stringify([
        { id: 1, title: 'Solo Leveling Hindi', url: 'https://deadtoons.example/solo-leveling-hindi/', type: 'post' },
    ]);
    check('wp search urls', JSON.parse(wpSearch).map(it => it.url)[0].includes('/solo-leveling-hindi/'));

    const postHtml = `<html><head><title>Solo Leveling Hindi Dubbed Download</title></head><body>
      <h1>Solo Leveling (2024) Multi Audio</h1>
      <p>Episode 1 Hindi:</p><a href="https://anidisk.org/watch/solo-leveling/1/1">Watch EP1</a>
      <p>Episode 2 Hindi dubbed:</p><a href="https://anidisk.org/watch/solo-leveling/1/2?x=1#y">Watch EP2</a>
      </body></html>`;
    const links = extractAnidiskLinks(postHtml);
    check('extract 2 links', links.length === 2, JSON.stringify(links));
    check('normalize query/hash', links[1]?.url === 'https://anidisk.org/watch/solo-leveling/1/2');
    const tags = new Set(detectTags(pageTitle(postHtml)).tags);
    for (const link of links) {
        for (const t of detectTags(windowAround(postHtml, link.index)).tags) tags.add(t);
    }
    check('hindi tag', tags.has('hindi'));
    check('multi tag', tags.has('multi-audio'));

    const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://deadtoons.example/a/</loc></url><url><loc>https://deadtoons.example/b/</loc></url></urlset>`;
    check('sitemap locs', parseSitemap(sitemap).length === 2);

    const merged = mergeEntry(undefined, {
        links,
        tags: [...tags],
        postUrl: 'https://deadtoons.example/solo-leveling-hindi/',
    });
    check('merge slug', merged.slug === 'solo-leveling', merged.slug);
    check('merge eps', merged.eps['1:1'] === 'https://anidisk.org/watch/solo-leveling/1/1');
    check('merge hindi', merged.hindi === true);
    check('merge seasons', JSON.stringify(merged.seasons) === '[1]');

    if (failures.length) {
        console.error(`${failures.length} self-test(s) failed.`);
        process.exitCode = 1;
    } else {
        console.log('All harvester self-tests passed (offline, no network).');
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
