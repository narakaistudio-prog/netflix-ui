#!/usr/bin/env node
/**
 * Give Netflix India catalog titles a real Nxsha playback id.
 *
 * Titles in data/movies.json without tmdb_id / imdb_id / embed_url show
 * "Play on Netflix" instead of "Play". This script finds each title's IMDb
 * (and TMDB) id and keeps it only when Nxsha's own embed page names the same
 * title. Runs on a hosted runner (the workspace sandbox cannot reach
 * nxsha.space) via .github/workflows/resolve-nxsha-playback.yml.
 *
 *   1. Wikidata: exact-name search, then IMDb (P345) and TMDB (P4947 / P4983).
 *   2. Nxsha:    GET /embed/{movie}/{id} or /embed/tv/{id}/1/1 — the <title>
 *                must name the same show, otherwise the id is rejected.
 *   3. Writes imdb_id / tmdb_id / embed_provider='nxsha' into data/movies.json
 *      for verified titles only, plus data/catalog-playback-resolve.json.
 *
 * Usage: node scripts/resolve-nxsha-playback.mjs [--limit N] [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOVIES_PATH = resolve(ROOT, 'data', 'movies.json');
const REPORT_PATH = resolve(ROOT, 'data', 'catalog-playback-resolve.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// Same query string as lib/embeds.ts DEFAULT_NXSHA_* (verified provider defaults).
const PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true';
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 2;
// Wikidata asks API clients to send a descriptive UA and to stay polite.
const WIKIDATA_UA = 'netflix-ui-catalog-resolver/1.0 (https://github.com/narakaistudio-prog/netflix-ui)';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = Number.parseInt(args[args.indexOf('--limit') + 1] ?? '', 10) || Infinity;

const norm = value => String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(url, { json = false, userAgent = UA, retries = 2 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const res = await fetch(url, {
                headers: { 'user-agent': userAgent, accept: json ? 'application/json' : 'text/html,*/*' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
                redirect: 'follow',
            });
            const text = await res.text();
            if (res.status === 429 && attempt < 6) {
                // Rate limited: back off (Retry-After when given) and try again.
                const wait = Number.parseInt(res.headers.get('retry-after') ?? '', 10) * 1000 || 8000 * (attempt + 1);
                await sleep(wait);
                lastError = new Error('HTTP 429');
                continue;
            }
            return { status: res.status, text, finalUrl: res.url };
        } catch (error) {
            lastError = error;
            await sleep(800 * (attempt + 1));
        }
    }
    throw lastError;
}

async function getJson(url, { userAgent = UA } = {}) {
    const res = await request(url, { json: true, userAgent, retries: 2 });
    if (res.status !== 200) throw new Error(`HTTP ${res.status} ${url}`);
    return JSON.parse(res.text);
}

/* ---------------------------- Wikidata lookup ---------------------------- */

const WD_API = 'https://www.wikidata.org/w/api.php';
const FILM_CLASS = 'Q11424';        // film
const TV_CLASS = 'Q5398426';        // television series

function claimValue(entity, prop) {
    return entity?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value ?? null;
}

function instanceOf(entity) {
    return (entity?.claims?.P31 ?? []).map(c => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
}

async function findWikidataIds(title, mediaType) {
    const search = new URL(WD_API);
    Object.entries({
        action: 'wbsearchentities', search: title, language: 'en', uselang: 'en',
        type: 'item', limit: '10', format: 'json', origin: '*',
    }).forEach(([k, v]) => search.searchParams.set(k, v));
    const hits = (await getJson(search, { userAgent: WIKIDATA_UA })).search ?? [];
    if (!hits.length) return { reason: 'wikidata: no search hits' };

    const ids = hits.map(h => h.id).join('|');
    const get = new URL(WD_API);
    Object.entries({
        action: 'wbgetentities', ids, props: 'claims|labels|aliases', languages: 'en',
        format: 'json', origin: '*',
    }).forEach(([k, v]) => get.searchParams.set(k, v));
    const entities = (await getJson(get, { userAgent: WIKIDATA_UA })).entities ?? {};

    const want = norm(title);
    for (const hit of hits) {
        const entity = entities[hit.id];
        if (!entity) continue;
        const names = [entity.labels?.en?.value, ...(entity.aliases?.en ?? []).map(a => a.value)];
        if (!names.some(n => norm(n) === want)) continue;

        const classes = instanceOf(entity);
        const isFilm = classes.includes(FILM_CLASS);
        const isTv = classes.includes(TV_CLASS);
        if (mediaType === 'movie' && (isTv || !isFilm)) continue;
        if (mediaType === 'tv' && (isFilm || !isTv)) continue;

        const imdb = claimValue(entity, 'P345');
        const tmdb = claimValue(entity, mediaType === 'movie' ? 'P4947' : 'P4983');
        if (!imdb && !tmdb) continue;
        return {
            qid: hit.id,
            imdb_id: typeof imdb === 'string' && /^tt\d{6,10}$/.test(imdb) ? imdb : undefined,
            tmdb_id: tmdb ? String(tmdb) : undefined,
        };
    }
    return { reason: 'wikidata: no exact film/series match with an id' };
}

/* ------------------------------- Nxsha check ------------------------------ */

function nxshaUrl(kind, id) {
    return kind === 'movie'
        ? `https://nxsha.space/embed/movie/${id}?${PARAMS}`
        : `https://nxsha.space/embed/tv/${id}/1/1?${PARAMS}`;
}

function decodeEntities(text) {
    return text
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

/** Nxsha answers 200 with "Watch <Name> - S1:E1" for a real title, 404 otherwise. */
async function verifyNxsha(kind, id, title) {
    const res = await request(nxshaUrl(kind, id));
    if (res.status !== 200) return { ok: false, status: res.status };
    const raw = res.text.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
    const docTitle = decodeEntities(raw)
        .replace(/^\s*Watch\s+/i, '')
        .replace(/\s+-\s+S\d+:E\d+.*$/i, '')
        .trim();
    const a = norm(docTitle);
    const b = norm(title);
    const named = Boolean(a) && Boolean(b) && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))));
    return { ok: named, status: res.status, docTitle };
}

/* --------------------------------- Main ---------------------------------- */

function collectTargets(catalog) {
    const byId = new Map();
    for (const row of catalog.movies) {
        for (const item of row.movies ?? []) {
            if (!item?.id || byId.has(item.id)) continue;
            if (item.embed_url || item.tmdb_id || item.imdb_id) continue;
            byId.set(item.id, item);
        }
    }
    return [...byId.values()];
}

async function resolveOne(item) {
    const mediaType = item.mediaType === 'tv' || item.type === 'SERIES' ? 'tv' : 'movie';
    const kind = mediaType;
    const base = { id: item.id, title: item.title, mediaType };
    let wd;
    try {
        wd = await findWikidataIds(item.title, mediaType);
    } catch (error) {
        return { ...base, ok: false, reason: `wikidata error: ${error.message}` };
    }
    if (wd.reason) return { ...base, ok: false, reason: wd.reason };

    const attempts = [];
    if (wd.imdb_id) attempts.push({ source: 'imdb', id: wd.imdb_id });
    if (wd.tmdb_id) attempts.push({ source: 'tmdb', id: wd.tmdb_id });
    for (const attempt of attempts) {
        try {
            const v = await verifyNxsha(kind, attempt.id, item.title);
            if (v.ok) {
                return {
                    ...base,
                    ok: true,
                    qid: wd.qid,
                    verifiedBy: attempt.source,
                    imdb_id: wd.imdb_id,
                    tmdb_id: wd.tmdb_id,
                    nxshaDocTitle: v.docTitle,
                };
            }
            attempt.status = v.status;
            attempt.docTitle = v.docTitle;
        } catch (error) {
            attempt.error = error.message;
        }
    }
    return {
        ...base,
        ok: false,
        reason: 'nxsha did not confirm the title',
        qid: wd.qid,
        tried: attempts,
    };
}

async function mapConcurrent(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            out[index] = await fn(items[index], index);
            await sleep(1200);
        }
    });
    await Promise.all(workers);
    return out;
}

async function main() {
    const raw = readFileSync(MOVIES_PATH, 'utf8');
    const catalog = JSON.parse(raw);
    const targets = collectTargets(catalog).slice(0, LIMIT);
    console.log(`Titles without a playback id: ${targets.length}`);

    const results = await mapConcurrent(targets, CONCURRENCY, async (item, index) => {
        const result = await resolveOne(item);
        console.log(`[${index + 1}/${targets.length}] ${result.ok ? 'OK  ' : 'miss'} ${item.title} ${result.imdb_id ?? ''} ${result.ok ? '' : result.reason}`);
        return result;
    });

    // Keep verified ids from earlier runs in the report (the catalog keeps them too).
    const previous = (() => {
        try {
            return JSON.parse(readFileSync(REPORT_PATH, 'utf8')).titles ?? [];
        } catch {
            return [];
        }
    })();
    const current = new Map(previous.filter(r => r.ok).map(r => [r.id, r]));
    for (const r of results) current.set(r.id, r);
    const mergedTitles = [...current.values()];

    const verified = new Map(results.filter(r => r.ok).map(r => [r.id, r]));
    let updatedRows = 0;
    for (const row of catalog.movies) {
        for (const item of row.movies ?? []) {
            const hit = verified.get(item?.id);
            if (!hit || item.embed_url || item.tmdb_id || item.imdb_id) continue;
            if (hit.imdb_id) item.imdb_id = hit.imdb_id;
            if (hit.tmdb_id) item.tmdb_id = hit.tmdb_id;
            item.embed_provider = 'nxsha';
            updatedRows += 1;
        }
    }

    const summary = {
        generatedAt: new Date().toISOString(),
        source: 'wikidata (ids) + nxsha.space/embed (verification)',
        requested: targets.length,
        verified: verified.size,
        unresolved: results.length - verified.size,
        itemsUpdated: updatedRows,
    };
    writeFileSync(REPORT_PATH, JSON.stringify({ summary, titles: mergedTitles }, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));

    if (DRY_RUN) {
        console.log('Dry run: data/movies.json not written.');
        return;
    }
    if (updatedRows > 0) {
        writeFileSync(MOVIES_PATH, JSON.stringify(catalog, null, 4));
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
