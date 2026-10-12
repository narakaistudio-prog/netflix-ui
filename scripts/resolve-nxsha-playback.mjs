#!/usr/bin/env node
/**
 * Give Netflix India catalog titles a real Nxsha playback id.
 *
 * Titles in data/movies.json without tmdb_id / imdb_id / embed_url show
 * "Play on Netflix" instead of "Play". This script finds each title's IMDb
 * (and TMDB) id and keeps it only when:
 *   - the release year (when the catalog knows it) agrees with Wikidata, and
 *   - Nxsha's own embed page names exactly the same title.
 * Ids it added earlier are re-checked on every run; a failed re-check removes
 * only the fields this script wrote.
 *
 * Runs on a hosted runner (the workspace sandbox cannot reach nxsha.space) via
 * .github/workflows/resolve-nxsha-playback.yml. It never touches the Crunchyroll
 * data (data/nxsha-*, assets/crunchyroll).
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
// Wikidata asks API clients for a descriptive UA and polite pacing.
const WIKIDATA_UA = 'netflix-ui-catalog-resolver/1.0 (https://github.com/narakaistudio-prog/netflix-ui)';
// Same query string as lib/embeds.ts DEFAULT_NXSHA_* (verified provider defaults).
const PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true';
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 2;

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
                const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
                await sleep((retryAfter > 0 ? retryAfter * 1000 : 8000) * (attempt + 1));
                lastError = new Error('HTTP 429');
                continue;
            }
            return { status: res.status, text };
        } catch (error) {
            lastError = error;
            await sleep(800 * (attempt + 1));
        }
    }
    throw lastError;
}

async function getJson(url, { userAgent = UA } = {}) {
    const res = await request(url, { json: true, userAgent });
    if (res.status !== 200) throw new Error(`HTTP ${res.status} ${url}`);
    return JSON.parse(res.text);
}

/* ---------------------------- Wikidata lookup ---------------------------- */

const WD_API = 'https://www.wikidata.org/w/api.php';
const FILM_CLASS = 'Q11424';   // film
const TV_CLASS = 'Q5398426';   // television series

function wdUrl(params) {
    const url = new URL(WD_API);
    Object.entries({ format: 'json', origin: '*', ...params })
        .forEach(([k, v]) => url.searchParams.set(k, v));
    return url;
}

const claimValue = (entity, prop) => entity?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value ?? null;
const instanceOf = entity => (entity?.claims?.P31 ?? []).map(c => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);

/** Release year from P577 (publication) or P580 (start time). */
function releaseYear(entity) {
    const time = claimValue(entity, 'P577') ?? claimValue(entity, 'P580');
    const m = typeof time?.time === 'string' ? time.time.match(/^[+-]?(\d{4})/) : null;
    return m ? Number.parseInt(m[1], 10) : null;
}

async function findWikidataIds(title, mediaType, catalogYear) {
    const hits = (await getJson(wdUrl({
        action: 'wbsearchentities', search: title, language: 'en', uselang: 'en',
        type: 'item', limit: '10',
    }), { userAgent: WIKIDATA_UA })).search ?? [];
    if (!hits.length) return { reason: 'wikidata: no search hits' };

    const entities = (await getJson(wdUrl({
        action: 'wbgetentities', ids: hits.map(h => h.id).join('|'), props: 'claims|labels|aliases', languages: 'en',
    }), { userAgent: WIKIDATA_UA })).entities ?? {};

    const want = norm(title);
    let yearMismatch = false;
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

        const year = releaseYear(entity);
        if (catalogYear && year && Math.abs(year - catalogYear) > 1) {
            yearMismatch = true;
            continue;
        }

        const imdb = claimValue(entity, 'P345');
        const tmdb = claimValue(entity, mediaType === 'movie' ? 'P4947' : 'P4983');
        if (!imdb && !tmdb) continue;
        return {
            qid: hit.id,
            year,
            imdb_id: typeof imdb === 'string' && /^tt\d{6,10}$/.test(imdb) ? imdb : undefined,
            tmdb_id: tmdb ? String(tmdb) : undefined,
        };
    }
    return {
        reason: yearMismatch
            ? `wikidata: name matches but release year differs from catalog (${catalogYear})`
            : 'wikidata: no exact film/series match with an id',
    };
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

/**
 * Nxsha answers 200 with "Watch <Name> - S1:E1" for a real title and 404 for
 * an unknown id. The name must match exactly (ignoring case/punctuation), so
 * "Fighter" never accepts "The Fighter".
 */
async function verifyNxsha(kind, id, title) {
    const res = await request(nxshaUrl(kind, id));
    if (res.status !== 200) return { ok: false, status: res.status };
    const raw = res.text.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
    const docTitle = decodeEntities(raw)
        .replace(/^\s*Watch\s+/i, '')
        .replace(/\s+-\s+S\d+:E\d+.*$/i, '')
        .trim();
    const named = norm(docTitle).length > 0 && norm(docTitle) === norm(title);
    return { ok: named, status: res.status, docTitle };
}

/* --------------------------------- Main ---------------------------------- */

async function resolveOne(item) {
    const mediaType = item.mediaType === 'tv' || item.type === 'SERIES' ? 'tv' : 'movie';
    const base = { id: item.id, title: item.title, mediaType, catalogYear: item.year ? Number(item.year) : null };
    let wd;
    try {
        wd = await findWikidataIds(item.title, mediaType, base.catalogYear);
    } catch (error) {
        return { ...base, ok: false, reason: `wikidata error: ${error.message}` };
    }
    if (wd.reason) return { ...base, ok: false, reason: wd.reason };

    const attempts = [];
    if (wd.imdb_id) attempts.push({ source: 'imdb', id: wd.imdb_id });
    if (wd.tmdb_id) attempts.push({ source: 'tmdb', id: wd.tmdb_id });
    for (const attempt of attempts) {
        try {
            const v = await verifyNxsha(mediaType, attempt.id, item.title);
            if (v.ok) {
                return {
                    ...base,
                    ok: true,
                    qid: wd.qid,
                    wikidataYear: wd.year,
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
    return { ...base, ok: false, reason: 'nxsha did not confirm the title', qid: wd.qid, tried: attempts };
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

function readPreviousReport() {
    try {
        return JSON.parse(readFileSync(REPORT_PATH, 'utf8')).titles ?? [];
    } catch {
        return [];
    }
}

async function main() {
    const catalog = JSON.parse(readFileSync(MOVIES_PATH, 'utf8'));
    const previousOk = new Map(readPreviousReport().filter(r => r.ok).map(r => [r.id, r]));

    // Targets: titles with no playback id, plus earlier resolver ids to re-check.
    const byId = new Map();
    for (const row of catalog.movies) {
        for (const item of row.movies ?? []) {
            if (!item?.id || byId.has(item.id)) continue;
            const ours = previousOk.has(item.id) && item.imdb_id === previousOk.get(item.id).imdb_id;
            const missing = !item.embed_url && !item.tmdb_id && !item.imdb_id;
            if (missing || ours) byId.set(item.id, item);
        }
    }
    const targets = [...byId.values()].slice(0, LIMIT);
    console.log(`Titles to resolve or re-check: ${targets.length} (previously verified: ${previousOk.size})`);

    const results = await mapConcurrent(targets, CONCURRENCY, async (item, index) => {
        const result = await resolveOne(item);
        console.log(`[${index + 1}/${targets.length}] ${result.ok ? 'OK  ' : 'miss'} ${item.title} ${result.imdb_id ?? ''} ${result.ok ? '' : result.reason}`);
        return result;
    });

    const resultById = new Map(results.map(r => [r.id, r]));
    let added = 0;
    let removed = 0;
    for (const row of catalog.movies) {
        for (const item of row.movies ?? []) {
            const result = resultById.get(item?.id);
            if (!result) continue;
            const prev = previousOk.get(item.id);
            const ours = prev && item.imdb_id === prev.imdb_id;
            if (result.ok) {
                if (!item.embed_url && !item.tmdb_id && !item.imdb_id) added += 1;
                if (result.imdb_id) item.imdb_id = result.imdb_id;
                if (result.tmdb_id) item.tmdb_id = result.tmdb_id;
                item.embed_provider = 'nxsha';
            } else if (ours) {
                // Re-check failed: undo only the fields this script wrote.
                delete item.imdb_id;
                if (prev.tmdb_id && item.tmdb_id === prev.tmdb_id) delete item.tmdb_id;
                if (item.embed_provider === 'nxsha') delete item.embed_provider;
                removed += 1;
            }
        }
    }

    // Report: current verdicts for every target, plus earlier verified ids not re-checked.
    const merged = new Map(previousOk);
    for (const r of results) {
        if (r.ok) merged.set(r.id, r);
        else merged.delete(r.id);
    }
    const summary = {
        generatedAt: new Date().toISOString(),
        source: 'wikidata (ids + release year) + nxsha.space/embed (exact title check)',
        checked: targets.length,
        verifiedNow: results.filter(r => r.ok).length,
        newlyAdded: added,
        removedAfterRecheck: removed,
        verifiedTotal: merged.size,
    };
    writeFileSync(REPORT_PATH, JSON.stringify({ summary, titles: [...merged.values()] }, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));

    if (DRY_RUN) {
        console.log('Dry run: data/movies.json not written.');
        return;
    }
    if (added > 0 || removed > 0) {
        writeFileSync(MOVIES_PATH, JSON.stringify(catalog, null, 4));
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
