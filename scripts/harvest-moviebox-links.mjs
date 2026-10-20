#!/usr/bin/env node
/**
 * Harvest MovieBox links for the whole Netflix catalog (Server 2).
 * ==================================================================
 * MovieBox ka per-ID embed nahi hota — har title/dub ka apna watch page hota
 * hai (`…/movies/<slug>?id=<subjectId>`). Ye script catalog ke HAR title ke
 * liye wahi link khoj kar `data/moviebox-links.json` me bake kar deta hai,
 * taaki app me "Server 2 · M2Box" bina kuch paste kiye chal jaye.
 *
 * Khoj kaise (vahi flow jo MovieBox ki site khud chalati hai):
 *   1. guest JWT: `GET /home?host=moviebox.ph` ke `x-user` header se
 *      (fallback: `POST /subject/search-suggest` + `X-Client-Token`).
 *   2. `POST /subject/search {keyword, page, perPage:0, subjectType:0}`
 *      — pehle seedha naam, phir `<naam> Hindi`, phir `<naam> <saal>`.
 *   3. matching `scripts/lib/moviebox-match.mjs` (pure, tested): title +
 *      type (movie/tv) + year + Hindi-dub hint.
 *   4. `GET /detail?detailPath=…` se confirm + `dubs[]` nikaal kar **Hindi
 *      dub ka apna subject** chunna (MovieBox par har dub alag subject hai).
 *
 * Usage:
 *   node scripts/harvest-moviebox-links.mjs            # sirf naye/miss hue titles
 *   node scripts/harvest-moviebox-links.mjs --refresh   # sab dobara
 *   node scripts/harvest-moviebox-links.mjs --limit 50  # test run
 *   node scripts/harvest-moviebox-links.mjs --only tmdb:1465943,tmdb:123
 *   node scripts/harvest-moviebox-links.mjs --check     # offline validation
 *   node scripts/harvest-moviebox-links.mjs --dry       # kuch likho mat
 *   node scripts/harvest-moviebox-links.mjs --probe "Mandaadi"   # raw JSON debug
 *
 * Files:
 *   data/moviebox-links.json          — app isi ko bundle karta hai
 *   data/moviebox-harvest-report.json — matched/review/miss + notes
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    MATCH_ACCEPT,
    MATCH_REVIEW,
    languageOfRef,
    pickPlayRef,
    scoreCandidate,
    rankCandidates,
    splitDubHint,
    typeOfSubject,
} from './lib/moviebox-match.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = resolve(ROOT, 'data', 'movies.json');
const LINKS_PATH = resolve(ROOT, 'data', 'moviebox-links.json');
const REPORT_PATH = resolve(ROOT, 'data', 'moviebox-harvest-report.json');
const PINS_PATH = resolve(ROOT, 'data', 'moviebox-pins.json');

const H5_API = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const SITE = 'https://m2box.org';
const FRONT_HOST = process.env.MOVIEBOX_HOST || 'moviebox.ph';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20_000;
const RETRIES = 2;
/** Politeness: har upstream call ke beech itna ruk kar. */
const DEFAULT_DELAY_MS = 260;
/** Kitne din purana link dobara check ho (MovieBox domains badalte rehte hain). */
const DEFAULT_MAX_AGE_DAYS = 14;

const LINKS_COMMENT =
    'MovieBox (m2box.org) watch-pages for the Netflix catalog — Server 2. Baked by scripts/harvest-moviebox-links.mjs (GitHub Actions). Har entry ka `url` seedha MovieboxPagePlayer me jata hai; slug/subjectId dobara naapo mat, script hi update kare.';
const REPORT_COMMENT =
    'MovieBox harvest report: matched / review / miss + per-title notes. Sirf debugging ke liye — app ise nahi padhta.';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name, fallback = '') => {
    const index = args.indexOf(name);
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const OPTIONS = {
    check: flag('--check'),
    dry: flag('--dry'),
    refresh: flag('--refresh'),
    limit: Number(valueOf('--limit', '0')) || 0,
    only: valueOf('--only', '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    probe: valueOf('--probe', ''),
    relabel: flag('--relabel'),
    pins: flag('--pins'),
    delay: Number(valueOf('--delay', String(DEFAULT_DELAY_MS))) || DEFAULT_DELAY_MS,
    maxAgeDays: Number(valueOf('--max-age-days', String(DEFAULT_MAX_AGE_DAYS))) || DEFAULT_MAX_AGE_DAYS,
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (...parts) => console.log(...parts);
const today = () => new Date().toISOString().slice(0, 10);

/* -------------------------------------------------------------------------- */
/*  Catalog                                                                   */
/* -------------------------------------------------------------------------- */

/** `data/movies.json` se unique targets: `tmdb:<id>` (ya `id:<cardId>`). */
export function catalogTargets(catalog) {
    const rows = Array.isArray(catalog?.movies) ? catalog.movies : [];
    const byKey = new Map();
    for (const row of rows) {
        for (const movie of Array.isArray(row?.movies) ? row.movies : []) {
            const tmdb = movie?.tmdb_id != null ? String(movie.tmdb_id).trim() : '';
            const key = tmdb ? `tmdb:${tmdb}` : `id:${String(movie?.id ?? '').trim()}`;
            if (!key || key === 'id:') continue;
            const title = String(movie?.title ?? '').trim();
            if (!title) continue;
            const mediaType =
                movie?.mediaType === 'tv' || (!movie?.mediaType && movie?.type === 'SERIES') ? 'tv' : 'movie';
            const year = Number(String(movie?.year ?? '').slice(0, 4)) || undefined;
            if (byKey.has(key)) continue;
            byKey.set(key, {
                key,
                title,
                year,
                mediaType,
                netflixId: movie?.netflixId ? String(movie.netflixId) : undefined,
            });
        }
    }
    return Array.from(byKey.values());
}

/* -------------------------------------------------------------------------- */
/*  Upstream (MovieBox H5 API)                                                */
/* -------------------------------------------------------------------------- */

function headers(extra = {}) {
    return {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
        'X-Request-Lang': 'en',
        Referer: `https://${FRONT_HOST}/`,
        Origin: `https://${FRONT_HOST}`,
        ...extra,
    };
}

async function fetchJson(url, init = {}) {
    let lastError = '';
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
        try {
            const res = await fetch(url, {
                method: init.method || 'GET',
                headers: init.headers,
                body: init.body,
                redirect: 'follow',
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const text = await res.text().catch(() => '');
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch {
                data = null;
            }
            if (res.status === 429 && attempt < RETRIES) {
                await sleep(1500 * (attempt + 1));
                lastError = 'rate-limited';
                continue;
            }
            return { status: res.status, data, headers: res.headers, text };
        } catch (error) {
            lastError = error?.message || String(error);
            if (attempt < RETRIES) await sleep(700 * (attempt + 1));
        }
    }
    return { status: 0, data: null, headers: null, text: '', error: lastError };
}

/** `X-Client-Token`: `<unix-sec>,<md5(reverse(sec))>` — MovieBox ka apna formula. */
function clientToken(nowMs = Date.now()) {
    const sec = String(Math.floor(nowMs / 1000));
    const md5 = createHash('md5').update(sec.split('').reverse().join('')).digest('hex');
    return `${sec},${md5}`;
}

function tokenFrom(xUserHeader, cookies) {
    if (xUserHeader) {
        try {
            const token = JSON.parse(xUserHeader)?.token;
            if (token) return String(token);
        } catch {
            // header JSON nahi tha
        }
    }
    const match = String(cookies || '').match(/token=([^;]+)/);
    return match ? match[1] : '';
}

const tokenState = { value: '', at: 0 };

async function getToken(force = false) {
    if (!force && tokenState.value && Date.now() - tokenState.at < 45 * 60 * 1000) return tokenState.value;
    const home = await fetchJson(`${H5_API}/home?host=${encodeURIComponent(FRONT_HOST)}`, { headers: headers() });
    let token = tokenFrom(home.headers?.get('x-user'), home.headers?.get('set-cookie'));
    if (!token) {
        const mint = await fetchJson(`${H5_API}/subject/search-suggest`, {
            method: 'POST',
            headers: headers({
                'Content-Type': 'application/json',
                'X-Client-Token': clientToken(),
            }),
            body: JSON.stringify({ keyword: 'a', perPage: 10 }),
        });
        token = tokenFrom(mint.headers?.get('x-user'), mint.headers?.get('set-cookie'));
    }
    if (token) {
        tokenState.value = token;
        tokenState.at = Date.now();
    }
    return token;
}

/** `{status, data}` — MovieBox search ka normalized jawab. */
async function searchSubjects(keyword) {
    let token = await getToken();
    const call = (bearer) =>
        fetchJson(`${H5_API}/subject/search`, {
            method: 'POST',
            headers: headers({
                'Content-Type': 'application/json',
                ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
            }),
            // Site khud perPage:0 bhejti hai — isi se order/count site jaisa rehta hai.
            body: JSON.stringify({ keyword, page: 1, perPage: 0, subjectType: 0 }),
        });

    let result = await call(token);
    if (result.status === 401 || result.status === 403 || !result.data) {
        token = await getToken(true);
        result = await call(token);
    }

    const items = result?.data?.data?.items;
    const list = Array.isArray(items) ? items : [];
    return {
        status: result.status,
        items: list.map((item) => ({
            title: String(item?.title ?? ''),
            subjectId: String(item?.subjectId ?? item?.id ?? ''),
            detailPath: String(item?.detailPath ?? ''),
            subjectType: Number(item?.subjectType) || 0,
            year: Number(String(item?.releaseDate ?? '').slice(0, 4)) || undefined,
            hasResource: item?.hasResource !== false,
        })),
        total: Number(result?.data?.data?.pager?.totalCount) || list.length,
    };
}

/** `/detail` — confirm + dubs (Hindi dub ka apna subjectId hota hai). */
async function fetchDetail(ref) {
    const queries = [];
    if (ref.detailPath) queries.push(`detailPath=${encodeURIComponent(ref.detailPath)}`);
    if (ref.subjectId) queries.push(`subjectId=${encodeURIComponent(ref.subjectId)}`);
    const token = await getToken();
    for (const query of queries) {
        const result = await fetchJson(`${H5_API}/detail?${query}`, {
            headers: headers(token ? { Authorization: `Bearer ${token}` } : {}),
        });
        const subject = result?.data?.data?.subject;
        if (result.status === 200 && subject) {
            const releaseDate = String(subject.releaseDate ?? '');
            return {
                subjectId: String(subject.subjectId ?? ''),
                detailPath: String(subject.detailPath ?? ''),
                title: String(subject.title ?? ''),
                subjectType: Number(subject.subjectType) || 0,
                year: Number(releaseDate.slice(0, 4)) || undefined,
                hasResource: subject.hasResource !== false,
                dubs: Array.isArray(subject.dubs)
                    ? subject.dubs.map((dub) => ({
                          subjectId: String(dub?.subjectId ?? ''),
                          detailPath: String(dub?.detailPath ?? ''),
                          lanName: String(dub?.lanName ?? ''),
                          lanCode: String(dub?.lanCode ?? ''),
                          type: Number(dub?.type ?? 0),
                          original: dub?.original === true,
                      }))
                    : [],
            };
        }
    }
    return null;
}

/* -------------------------------------------------------------------------- */
/*  Link building                                                             */
/* -------------------------------------------------------------------------- */

/** Canonical m2box.org watch page (season/episode player khud lagata hai). */
export function movieboxUrl({ detailPath, subjectId }) {
    if (!detailPath || !subjectId) return '';
    return (
        `${SITE}/movies/${encodeURIComponent(detailPath)}` +
        `?id=${encodeURIComponent(subjectId)}&type=/movie/detail&detailSe=&detailEp=&lang=en`
    );
}

/**
 * `https://m2box.org/movies/<detailPath>?id=<subjectId>…` ko todo.
 * Pins me poora URL hi rakha jata hai (owner wahi paste karta hai).
 */

/**
 * Owner-verified pins ko baked links me daalo (pure — koi file/network nahi).
 * Pin ka URL hamesha jeetta hai: harvester na use search se replace karta hai,
 * na refresh se.
 */
export function applyPins(pins, previousLinks = {}) {
    const links = {};
    const keys = [];
    for (const [key, pin] of Object.entries(pins && typeof pins === 'object' ? pins : {})) {
        const parsed = parseMovieboxUrl(typeof pin === 'string' ? pin : pin?.url);
        if (!parsed) continue;
        const dub = languageOfRef(parsed);
        const prev = previousLinks[key] || {};
        links[key] = {
            url: movieboxUrl(parsed),
            subjectId: parsed.subjectId,
            detailPath: parsed.detailPath,
            title: (typeof pin === 'object' && pin?.title) || prev.title || '',
            year: (typeof pin === 'object' && pin?.year) || prev.year,
            type: (typeof pin === 'object' && pin?.type) || prev.type,
            dub,
            hindiAudio: dub === 'hindi',
            score: 1,
            query: 'pin',
            pinned: true,
            harvestedAt: new Date().toISOString(),
        };
        keys.push(key);
    }
    return { links, keys };
}

export function parseMovieboxUrl(value) {
    try {
        const url = new URL(String(value ?? ''));
        const match = url.pathname.match(/\/movies\/([^/]+)\/?$/);
        const subjectId = url.searchParams.get('id') || '';
        if (!match || !subjectId) return null;
        return { detailPath: decodeURIComponent(match[1]), subjectId };
    } catch {
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/*  Load / save                                                               */
/* -------------------------------------------------------------------------- */

function readJson(path, fallback) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

const fresh = (entry, maxAgeDays) => {
    const stamp = Date.parse(entry?.harvestedAt || '');
    if (!Number.isFinite(stamp)) return false;
    return Date.now() - stamp < maxAgeDays * 24 * 60 * 60 * 1000;
};

/* -------------------------------------------------------------------------- */
/*  --check (offline)                                                         */
/* -------------------------------------------------------------------------- */

function runCheck() {
    const store = readJson(LINKS_PATH, null);
    if (!store || typeof store !== 'object' || !store.links) {
        throw new Error('data/moviebox-links.json missing ya kharab hai (links object chahiye).');
    }
    const entries = Object.entries(store.links);
    let bad = 0;
    for (const [key, entry] of entries) {
        const problems = [];
        if (!/^(tmdb|id):/.test(key)) problems.push('key');
        if (!entry?.detailPath) problems.push('detailPath');
        if (!entry?.subjectId) problems.push('subjectId');
        if (!/^https:\/\/m2box\.org\/movies\//.test(String(entry?.url ?? ''))) problems.push('url');
        if (!entry?.dub) problems.push('dub');
        else if (entry.dub !== languageOfRef(entry)) problems.push(`dub=${entry.dub} (slug ${languageOfRef(entry)})`);
        if (problems.length) {
            bad += 1;
            console.error(`✗ ${key}: ${problems.join(', ')}`);
        }
    }
    const pins = readJson(PINS_PATH, { links: {} })?.links ?? {};
    for (const [key, pin] of Object.entries(pins)) {
        if (!/^(tmdb|id):/.test(key)) {
            bad += 1;
            console.error(`✗ pin ${key}: key`);
            continue;
        }
        if (!parseMovieboxUrl(typeof pin === 'string' ? pin : pin?.url)) {
            bad += 1;
            console.error(`✗ pin ${key}: url`);
        }
    }
    const targets = catalogTargets(readJson(CATALOG_PATH, { movies: [] }));
    log(`links: ${entries.length} | pins: ${Object.keys(pins).length} | catalog targets: ${targets.length} | kharab: ${bad}`);
    if (bad) process.exitCode = 1;
    else log('✓ moviebox-links.json theek hai');
}

/* -------------------------------------------------------------------------- */
/*  --relabel (offline: purane entries ka dub label slug se theek karo)        */
/* -------------------------------------------------------------------------- */

/**
 * `--pins` (offline): pins ko baked JSON me merge karo — network ke bina.
 * Baki entries jaisi hain waisi rehti hain.
 */
function runPins() {
    const store = readJson(LINKS_PATH, { links: {} });
    const links = store?.links && typeof store.links === 'object' ? store.links : {};
    const pins = readJson(PINS_PATH, { links: {} })?.links ?? {};
    const { links: pinned, keys } = applyPins(pins, links);
    if (!keys.length) {
        log('· koi valid pin nahi mila');
        return;
    }
    Object.assign(links, pinned);
    const entries = Object.values(links);
    const stats = {
        ...(store.stats || {}),
        linked: entries.length,
        hindi: entries.filter((entry) => entry.dub === 'hindi').length,
        hindiAudio: entries.filter((entry) => entry.hindiAudio).length,
        pinned: keys.length,
    };
    if (!OPTIONS.dry) {
        writeFileSync(
            LINKS_PATH,
            `${JSON.stringify({ $comment: LINKS_COMMENT, generatedAt: new Date().toISOString(), stats, links }, null, 1)}\n`,
        );
    }
    log(`✓ pins merged: ${keys.join(', ')}`);
}

function runRelabel() {
    const store = readJson(LINKS_PATH, null);
    if (!store || typeof store !== 'object' || !store.links) {
        throw new Error('data/moviebox-links.json missing ya kharab hai (links object chahiye).');
    }
    let changed = 0;
    for (const entry of Object.values(store.links)) {
        const next = languageOfRef(entry);
        if (entry.dub !== next) {
            entry.dub = next;
            changed += 1;
        }
        // PuranE runs ne har Hindi-audio title ko `hindi` likh diya tha.
        if (entry.hindiAudio === undefined) entry.hindiAudio = next === 'hindi';
    }
    const entries = Object.values(store.links);
    if (store.stats && typeof store.stats === 'object') {
        store.stats.linked = entries.length;
        store.stats.hindi = entries.filter((entry) => entry.dub === 'hindi').length;
    }
    if (!OPTIONS.dry) {
        store.generatedAt = new Date().toISOString();
        writeFileSync(LINKS_PATH, `${JSON.stringify(store, null, 1)}\n`);
    }
    log(`✓ relabelled ${changed}/${entries.length} entries (hindi: ${store.stats?.hindi ?? '?'})`);
    return changed;
}

/* -------------------------------------------------------------------------- */
/*  --probe (debug one query)                                                 */
/* -------------------------------------------------------------------------- */

async function runProbe(query) {
    log(`probe: ${query}`);
    const token = await getToken();
    log(`token: ${token ? `${token.slice(0, 24)}…` : '(khali — bina token try hoga)'}`);
    const result = await searchSubjects(query);
    log(`search status=${result.status} total=${result.total} items=${result.items.length}`);
    log(JSON.stringify(result.items.slice(0, 10), null, 2));
    const best = result.items[0];
    if (best) {
        const detail = await fetchDetail(best);
        log('detail:', JSON.stringify(detail, null, 2).slice(0, 4000));
    }
}

/* -------------------------------------------------------------------------- */
/*  Main harvest                                                              */
/* -------------------------------------------------------------------------- */

async function harvest() {
    const catalog = readJson(CATALOG_PATH, null);
    if (!catalog) throw new Error('data/movies.json missing hai');

    const allTargets = catalogTargets(catalog);
    const existing = readJson(LINKS_PATH, { links: {} });
    const previousLinks = existing?.links && typeof existing.links === 'object' ? existing.links : {};

    // Pins = owner-verified links (jaise Mandaadi ka Hindi page). Ye kabhi
    // overwrite nahi hote, aur network bhi nahi maangte.
    const previousOrEmpty = previousLinks;
    const pins = readJson(PINS_PATH, { links: {} })?.links ?? {};
    const { links: linksFromPins, keys: pinnedKeys } = applyPins(pins, previousOrEmpty);
    if (pinnedKeys.length) log(`pins: ${pinnedKeys.length} owner-verified link(s) locked`);

    let work = allTargets;
    if (pinnedKeys.length) work = work.filter((target) => !pinnedKeys.includes(target.key));
    if (OPTIONS.only.length) work = work.filter((target) => OPTIONS.only.includes(target.key));
    if (!OPTIONS.refresh) {
        work = work.filter((target) => {
            const entry = previousLinks[target.key];
            return !entry || !entry.url || !fresh(entry, OPTIONS.maxAgeDays);
        });
    }
    if (OPTIONS.limit > 0) work = work.slice(0, OPTIONS.limit);

    log(`catalog targets: ${allTargets.length} | pinned: ${pinnedKeys.length} | is run me kaam: ${work.length}`);

    const links = { ...previousLinks, ...linksFromPins };
    const review = [];
    const misses = [];
    const errors = [];
    const queriesUsed = { primary: 0, hindi: 0, year: 0, clean: 0, ampersand: 0 };
    let matchedNow = 0;

    for (let index = 0; index < work.length; index += 1) {
        const target = work[index];
        const label = `[${index + 1}/${work.length}] ${target.title} (${target.year ?? '?'}, ${target.mediaType})`;

        const queries = [{ text: target.title, tag: 'primary' }];
        if (!/\bhindi\b/i.test(target.title)) queries.push({ text: `${target.title} Hindi`, tag: 'hindi' });
        if (target.year) queries.push({ text: `${target.title} ${target.year}`, tag: 'year' });
        // Clean variant: brackets/parenthetical hata kar ("Mandaadi (2026)" → "Mandaadi").
        const clean = target.title.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean && clean !== target.title && clean.length >= 3) {
            queries.push({ text: clean, tag: 'clean' });
        }
        const ampersand = target.title.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
        if (ampersand !== target.title) queries.push({ text: ampersand, tag: 'ampersand' });

        let chosen = null;
        let chosenQuery = '';
        let bestSeen = null;
        let bestSeenQuery = '';

        for (const query of queries) {
            const result = await searchSubjects(query.text);
            queriesUsed[query.tag] += 1;
            if (result.status === 401 || result.status === 403) {
                errors.push({ key: target.key, title: target.title, error: `search HTTP ${result.status}` });
                break;
            }
            const { best } = rankCandidates(target, result.items);
            if (best && (!bestSeen || best.score > bestSeen.score)) {
                bestSeen = { ...best, query: query.text };
                bestSeenQuery = query.text;
            }
            if (best && best.score >= MATCH_ACCEPT) {
                chosen = best;
                chosenQuery = query.text;
                break;
            }
            await sleep(OPTIONS.delay);
        }

        if (!chosen) {
            const top = bestSeen;
            const entry = {
                key: target.key,
                title: target.title,
                year: target.year,
                mediaType: target.mediaType,
                best: top
                    ? {
                          title: top.item.title,
                          subjectType: top.item.subjectType,
                          year: top.item.year,
                          score: Number(top.score.toFixed(3)),
                          query: top.query,
                      }
                    : null,
            };
            if (top && top.score >= MATCH_REVIEW) review.push(entry);
            else misses.push(entry);
            if (!top) log(`   · nahi mila${bestSeenQuery ? ` (${bestSeenQuery})` : ''}`);
            else log(`   ~ ${Math.round(top.score * 100)}% ${top.item.title}`);
            continue;
        }

        // Confirm + Hindi dub ka apna subject chuno.
        const detail = await fetchDetail({
            detailPath: chosen.item.detailPath,
            subjectId: chosen.item.subjectId,
        });
        await sleep(OPTIONS.delay);

        const play = pickPlayRef(detail, chosen.item);
        let playRef = play.ref;
        let playDub = play.dub;

        // Refresh par purana **Hindi page** na chhodo: jo link pehle se baked
        // hai aur naye matcher par bhi pass hota hai, use base/English page se
        // replace karne ka koi fayda nahi (owner ne Hindi page hi chuna tha).
        const prev = previousLinks[target.key];
        if (OPTIONS.refresh && prev?.detailPath && prev?.subjectId && prev.dub === 'hindi' && playDub !== 'hindi') {
            const prevScore = scoreCandidate(target, {
                title: prev.title,
                year: prev.year,
                subjectType: prev.type === 'tv' ? 2 : 1,
                detailPath: prev.detailPath,
                hasResource: true,
            }).score;
            if (prevScore >= MATCH_ACCEPT) {
                playRef = { detailPath: prev.detailPath, subjectId: prev.subjectId };
                playDub = 'hindi';
                log('   · purana Hindi page rakha');
            }
        }

        const url = movieboxUrl(playRef);
        if (!url) {
            errors.push({ key: target.key, title: target.title, error: 'url not buildable' });
            continue;
        }

        links[target.key] = {
            url,
            subjectId: playRef.subjectId,
            detailPath: playRef.detailPath,
            title: play.title || chosen.item.title,
            year: detail?.year || chosen.item.year,
            type: typeOfSubject(detail?.subjectType || chosen.item.subjectType) || target.mediaType,
            dub: playDub,
            hindiAudio: play.hindiAudio || playDub === 'hindi',
            score: Number(chosen.score.toFixed(3)),
            query: chosenQuery,
            harvestedAt: new Date().toISOString(),
        };
        matchedNow += 1;
        log(`   ✓ ${Math.round(chosen.score * 100)}% ${links[target.key].title} (${play.dub})`);
    }

    const entries = Object.values(links);
    const hindi = entries.filter((entry) => entry.dub === 'hindi').length;
    const hindiAudio = entries.filter((entry) => entry.hindiAudio).length;
    const stats = {
        catalog: allTargets.length,
        linked: entries.length,
        hindi,
        hindiAudio,
        review: review.length,
        miss: misses.length,
        errors: errors.length,
        matchedThisRun: matchedNow,
        pinned: pinnedKeys.length,
        queriesUsed,
    };

    if (!OPTIONS.dry) {
        if (matchedNow > 0 || !existsSync(LINKS_PATH)) {
            writeFileSync(
                LINKS_PATH,
                `${JSON.stringify({ $comment: LINKS_COMMENT, generatedAt: new Date().toISOString(), stats, links, }, null, 1)}\n`,
            );
            log(`✓ wrote data/moviebox-links.json (${entries.length} links)`);
        } else {
            log('· moviebox-links.json unchanged');
        }
        writeFileSync(
            REPORT_PATH,
            `${JSON.stringify(
                {
                    $comment: REPORT_COMMENT,
                    generatedAt: new Date().toISOString(),
                    stats,
                    review,
                    misses,
                    errors,
                },
                null,
                1,
            )}\n`,
        );
    }

    log(
        `\nmatched is run: ${matchedNow} | total links: ${entries.length}/${allTargets.length}` +
            ` | hindi dub: ${hindi} | review: ${review.length} | miss: ${misses.length} | errors: ${errors.length}`,
    );
    return { stats, links };
}

/* -------------------------------------------------------------------------- */

async function main() {
    if (OPTIONS.check) {
        runCheck();
        return;
    }
    if (OPTIONS.probe) {
        await runProbe(OPTIONS.probe);
        return;
    }
    if (OPTIONS.relabel) {
        runRelabel();
        return;
    }
    if (OPTIONS.pins) {
        runPins();
        return;
    }
    await harvest();
}

const isEntryPoint = (() => {
    try {
        return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
})();

if (isEntryPoint) {
    main().catch((error) => {
        console.error(`✗ ${error?.stack || error}`);
        process.exitCode = 1;
    });
}

export { harvest, movieboxUrl as buildMovieboxUrl };
