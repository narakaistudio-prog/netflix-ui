#!/usr/bin/env node
/**
 * IMDb anime list -> Crunchyroll page (catalog + rows + Nxsha route registry).
 *
 * Owner: "yaha ka sara anime crunchyroll par laga do sab sahi sahi row mae lag
 * jana chiyea or jo anime pehle se hai usse chod dena nxsha aur toonworld se
 * fetch karoo sabka proper episode guide images season sab sahi sahi lag jana
 * chiyea"
 *
 * Isliye ye script:
 *   1. IMDb list (https://www.imdb.com/list/ls540527030/ — "Crunchyroll (hindi
 *      dubbed) anime list") padhti hai -> title + IMDb id + saal + TV/movie.
 *   2. Har title ko **Nxsha** par dhoondhti hai (`/search?q=`), exact naam par
 *      match karti hai, aur uska page khol kar verify karti hai ki wahan title
 *      sach me hai (galat show kabhi catalog me na ghuse).
 *   3. Poster, synopsis aur genres usi Nxsha page se lete hain — isliye image
 *      aur episode guide dono ek hi source (Nxsha) se sahi rehte hain.
 *   4. Jo anime pehle se catalog me hai use **chhod dete hain** (owner ka
 *      instruction), sirf naye add hote hain.
 *
 * Episode guide yahan nahi banti: `scripts/harvest-nxsha-guide.mjs` (hosted
 * runner par) seasons + episodes + stills Nxsha se laata hai aur
 * `scripts/bake-animahd-links.mjs` unhe page me bake karta hai. Ye script bas
 * `data/nxsha-titles.json` me route daal deti hai taaki wo harvest ho sake.
 *
 * Ye script **hosted runner** par chalti hai (workspace sandbox IMDb/Nxsha tak
 * nahi pahunch sakta) — wahi wajah hai jo baaki harvesters ke comments me
 * likhi hai.
 *
 * Usage: node scripts/import-imdb-anime.mjs [--dry-run] [--list=ls540527030]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decode, parseMoviePage } from './build-trending-nxsha.mjs';
import { parseSearchResults } from './build-netflix-genre-rows.mjs';
import { parseNxshaSeriesPage } from './harvest-nxsha-guide.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const NX_TITLES_PATH = resolve(ROOT, 'data', 'nxsha-titles.json');
const REPORT_PATH = resolve(ROOT, 'data', 'imdb-anime-import.json');

const NX_BASE = 'https://nxsha.space';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_DELAY_MS = 180;

/** Marker block inside `var shows={…}` — dobara chalane par yahi replace hota hai. */
const SHOWS_START = '/*__IMDB_ANIME__*/';
const SHOWS_END = '/*__END_IMDB_ANIME__*/';
/** Marker block inside `var rows=[…]`. */
const ROWS_START = '/*__IMDB_ANIME_ROWS__*/';
const ROWS_END = '/*__END_IMDB_ANIME_ROWS__*/';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function arg(name, fallback = '') {
    const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

/* ------------------------------------------------------------------ titles */

/** "My Dress-Up Darling" -> "mydressupdarling" (year, punctuation, case chhod do). */
export function normTitle(value) {
    return decode(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

/** Catalog key: "My Dress-Up Darling" -> "mydressupdarling". */
export function slugKey(title) {
    const base = decode(title)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
    return base || 'anime';
}

/** JSON-LD item -> hamara shape. IMDb list page me har item ka @type hota hai. */
function fromJsonLdItem(item) {
    const url = String(item?.url || '');
    const imdbId = /(\/title\/(tt\d+))/.exec(url)?.[2] || '';
    const name = decode(item?.name || '');
    if (!imdbId || !name) return null;
    const type = String(item?.['@type'] || '');
    return {
        imdbId,
        title: name,
        year: /(\d{4})/.exec(String(item?.datePublished || ''))?.[1] || '',
        poster: String(item?.image || ''),
        description: decode(item?.description || ''),
        kind: /Movie|Film/i.test(type) ? 'movie' : 'tv',
    };
}

/**
 * IMDb list page -> [{ imdbId, title, year, poster, description, kind }].
 *
 * Do raste padhte hain kyunki IMDb page badalte rehta hai:
 *   1. `application/ld+json` ka ItemList (sabse saaf),
 *   2. poster anchors (`<a href="/title/tt…"><img alt="Title (2022)">`).
 * Dono ko merge karte hain, imdbId par dedupe.
 */
export function parseImdbList(html) {
    const source = String(html || '');
    const byId = new Map();

    for (const match of source.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
        let parsed;
        try {
            parsed = JSON.parse(match[1]);
        } catch {
            continue;
        }
        const blocks = Array.isArray(parsed) ? parsed : [parsed];
        for (const block of blocks) {
            const items = block?.['@type'] === 'ItemList' && Array.isArray(block.itemListElement)
                ? block.itemListElement.map((entry) => entry?.item || entry)
                : [];
            for (const item of items) {
                const row = fromJsonLdItem(item);
                if (row && !byId.has(row.imdbId)) byId.set(row.imdbId, row);
            }
        }
    }

    // Poster anchors: `<a href="/title/tt123/…"> <img alt="Title (2022)" src="…">`.
    for (const match of source.matchAll(/<a\b[^>]*href="\/title\/(tt\d+)\/?[^"]*"[^>]*>([\s\S]{0,1500}?)<\/a>/gi)) {
        const imdbId = match[1];
        const body = match[2];
        const img = /<img\b[^>]*>/i.exec(body);
        if (!img) continue;
        const alt = decode((/alt="([^"]*)"/i.exec(img[0]) || [])[1] || '');
        if (!alt) continue;
        const year = /\((\d{4})[^)]*\)/.exec(alt)?.[1] || '';
        const title = alt.replace(/\s*\([^)]*\)\s*$/, '').trim();
        const src = decode((/src="([^"]+)"/i.exec(img[0]) || [])[1] || '');
        const kindGuess = /TV (Mini )?Series|TV Series/i.test(body) ? 'tv' : 'movie';
        if (!title) continue;
        const previous = byId.get(imdbId) || {};
        byId.set(imdbId, {
            imdbId,
            title: previous.title || title,
            year: previous.year || year,
            poster: previous.poster || src,
            description: previous.description || '',
            kind: previous.kind || kindGuess,
        });
    }

    return [...byId.values()].filter((row) => row.title);
}

/**
 * IMDb ko seedha scrape karna datacenter IPs par block ho jata hai (HTTP 202 +
 * khaali challenge page). Isliye ek reader proxy (r.jina.ai) ka markdown bhi
 * padhte hain — usme har title ka poster + `[](/title/tt…)` link saaf milta hai.
 *
 * Example line:
 *   ![Image 3: Akebi's Sailor Uniform (2022)](https://m.media-amazon.com/…jpg)
 *   [](https://www.imdb.com/title/tt15533674/?ref_=ls_i_4)
 */
export function parseImdbMarkdown(text) {
    const source = String(text || '');
    const rows = new Map();
    const chunks = source.split('![');
    for (const chunk of chunks.slice(1)) {
        const head = /^Image \d+: ([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/.exec(chunk);
        if (!head) continue;
        const alt = decode(head[1]).replace(/\s+/g, ' ').trim();
        const poster = head[2];
        const link = /\[\]\((https?:\/\/www\.imdb\.com\/title\/(tt\d+)[^)]*)\)/.exec(chunk);
        if (!link) continue;
        const year = /\((\d{4})[^)]*\)\s*$/.exec(alt)?.[1] || '';
        const title = alt.replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (!title) continue;
        if (!rows.has(link[2])) rows.set(link[2], { imdbId: link[2], title, year, poster, description: '', kind: '' });
    }
    return [...rows.values()];
}

/* ------------------------------------------------------------------ catalog */

/**
 * `'…'` literal padho (escape ko handle karte hue) — backslash-free rakhne ke
 * liye khud scan karte hain, regex escapes me galti nahi hoti.
 */
export function readQuoted(text, from) {
    let out = '';
    for (let i = from + 1; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === BACKSLASH) {
            out += text[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (ch === "'") return { value: out, end: i };
        out += ch;
    }
    return { value: out, end: text.length };
}

/** Crunchyroll page ke `var shows={…}` se pehle se maujood titles. */
export function existingCatalogTitles(html) {
    const source = String(html || '');
    const start = source.indexOf('var shows={');
    const end = source.indexOf('\n      };', start);
    if (start < 0 || end < 0) throw new Error('Crunchyroll catalog (`var shows={`) nahi mila');
    const titles = [];
    for (const line of source.slice(start, end).split('\n')) {
        if (!/^[ ]{8}[A-Za-z_$][A-Za-z0-9_$]*:\{title:/.test(line)) continue;
        const quote = line.indexOf("title:'");
        if (quote < 0) continue;
        titles.push(readQuoted(line, quote + 'title:'.length).value);
    }
    return titles;
}

/**
 * Crunchyroll page ke `var rows=[…]` me use hue saare keys (import wale bhi) —
 * isse pata chalta hai kaunsi row pehle se hai aur duplicate row na bane.
 */
export function existingRowKeys(html) {
    const source = String(html || '');
    const start = source.indexOf('var rows=[');
    const end = source.indexOf('\n      ];', start);
    if (start < 0 || end < 0) throw new Error('Crunchyroll rows (`var rows=[`) nahi mila');
    const body = source.slice(start, end);
    const keys = new Set();
    for (const chunk of body.split('keys:[').slice(1)) {
        const close = chunk.indexOf(']');
        if (close < 0) continue;
        for (const raw of chunk.slice(0, close).split(',')) {
            const key = raw.trim().replace(/^'/, '').replace(/'$/, '').trim();
            if (key) keys.add(key);
        }
    }
    return keys;
}

const BACKSLASH = String.fromCharCode(92);

/** JS string literal ke andar safe text (apostrophe aur backslash escape). */
function jsString(value) {
    return String(value)
        .split(BACKSLASH).join(BACKSLASH + BACKSLASH)
        .split("'").join(BACKSLASH + "'")
        .split(String.fromCharCode(13)).join(' ')
        .split(String.fromCharCode(10)).join(' ');
}

/** Sirf whitespace hatao (comma ko chhod kar). */
function trimTrailingSpace(value) {
    let end = value.length;
    while (end > 0 && ' \n\t\r'.includes(value[end - 1])) end -= 1;
    return value.slice(0, end);
}

/** Pichhle element ka trailing comma/space hatao taaki naya entry lag sake. */
function trimTrailing(value) {
    let end = value.length;
    while (end > 0) {
        const ch = value[end - 1];
        if (ch === ',' || ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
            end -= 1;
            continue;
        }
        break;
    }
    return value.slice(0, end);
}

/**
 * Marker block ko naye content se replace karo (ya pehli baar me add karo).
 * Purana content bilkul chhua nahi jata — dobara chalane par sirf block badalta
 * hai, isliye import idempotent hai (CI har push par chalti hai).
 */
function upsertBlock(source, { bodyStart, closeDelim, startMarker, endMarker, lines }) {
    const start = source.indexOf(bodyStart);
    const end = source.indexOf(closeDelim, start);
    if (start < 0 || end < 0) throw new Error(`Crunchyroll block nahi mila: ${bodyStart.trim()}`);
    const head = source.slice(0, end);
    const tail = source.slice(end);
    const block = [`        ${startMarker}`, ...lines.map((line) => `        ${line}`), `        ${endMarker}`].join('\n');

    const blockStart = head.indexOf(startMarker);
    if (blockStart >= 0) {
        const blockEnd = head.indexOf(endMarker, blockStart);
        if (blockEnd >= 0) {
            // Marker se pehle ki indentation bhi hatao, warna har run par spaces badhte hain.
            return `${trimTrailingSpace(head.slice(0, blockStart))}\n${block}`
                + head.slice(blockEnd + endMarker.length) + tail;
        }
    }
    return `${trimTrailing(head)},\n${block}` + tail;
}

/** Ek `shows` entry wahi style me jo page use karta hai (8 space indent). */
export function catalogEntryLine(key, entry) {
    const parts = [`title:'${jsString(entry.title)}'`];
    if (entry.year) parts.push(`year:${Number(entry.year)}`);
    if (entry.rating) parts.push(`rating:'${jsString(entry.rating)}'`);
    if (entry.genres?.length) parts.push(`genres:[${entry.genres.map((g) => `'${jsString(g)}'`).join(',')}]`);
    parts.push(`audio:'${jsString(entry.audio || 'Sub & Dub')}'`);
    if (entry.img) parts.push(`img:'${jsString(entry.img)}'`);
    if (entry.runtime) parts.push(`runtime:'${jsString(entry.runtime)}'`);
    if (entry.kind === 'movie') parts.push(`type:'Movie'`);
    parts.push(`desc:'${jsString(entry.desc || '')}'`);
    return `${key}:{${parts.join(',')}},`;
}

/**
 * `shows` catalog me naye entries daalo (marker block ke andar).
 * Purane entries bilkul chhue bina rehte hain — owner: "jo pehle se hai use chhod dena".
 */
export function mergeCatalog(html, lines) {
    return upsertBlock(String(html), {
        bodyStart: 'var shows={',
        closeDelim: '\n      };',
        startMarker: SHOWS_START,
        endMarker: SHOWS_END,
        lines,
    });
}

/** Naye rows daalo (marker block ke andar), purane rows jaisa ke taisa. */
export function mergeRows(html, rows) {
    return upsertBlock(String(html), {
        bodyStart: 'var rows=[',
        closeDelim: '\n      ];',
        startMarker: ROWS_START,
        endMarker: ROWS_END,
        lines: rows.map((row) => `{title:'${jsString(row.title)}',keys:[${row.keys.join(',')}]},`),
    });
}

/**
 * Rows ka plan: primary genre ke hisaab se ("Hindi Dub · Action"), aur jo bache
 * unke liye ek catch-all row. Owner: "sab sahi sahi row mae lag jana chiyea".
 */
export function buildRows(entries, { minPerGenre = 5 } = {}) {
    const genres = new Map();
    const leftovers = [];
    for (const entry of entries) {
        const primary = (entry.genres || []).map((g) => String(g).trim().toLowerCase()).find(Boolean);
        if (!primary) {
            leftovers.push(entry);
            continue;
        }
        if (!genres.has(primary)) genres.set(primary, []);
        genres.get(primary).push(entry);
    }
    const rows = [];
    for (const [genre, list] of [...genres.entries()].sort((a, b) => b[1].length - a[1].length)) {
        if (list.length < minPerGenre) {
            leftovers.push(...list);
            continue;
        }
        rows.push({ title: `Hindi Dub · ${genre.replace(/\b\w/g, (c) => c.toUpperCase())}`, keys: list.map((e) => e.key) });
    }
    if (leftovers.length) {
        rows.push({ title: 'Hindi Dub on Crunchyroll', keys: leftovers.map((e) => e.key) });
    }
    return rows;
}

/* -------------------------------------------------------------------- nxsha */

async function get(url, { accept = 'text/html,*/*' } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                redirect: 'follow',
                headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
            });
            const text = await response.text();
            if (response.ok) {
                await sleep(REQUEST_DELAY_MS);
                return text;
            }
            if (response.status === 404) return null;
            lastError = new Error(`HTTP ${response.status} for ${url}`);
            if (response.status < 500 && response.status !== 429) break;
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timer);
        }
        await sleep(500 * attempt);
    }
    throw lastError || new Error(`Request failed: ${url}`);
}

/** Search results me se sahi card chuno: exact naam, phir saal, phir type. */
export function pickNxshaMatch(results, wanted, { kind = '', year = '' } = {}) {
    const want = normTitle(wanted);
    const usable = (results || []).filter((row) => row.name && row.id);
    const exact = usable.filter((row) => normTitle(row.name) === want);
    const pool = exact.length ? exact : [];
    if (!pool.length) return null;
    const score = (row) => (
        (row.year && year && String(row.year) === String(year) ? 4 : 0)
        + (row.type === kind ? 2 : 0)
        + (row.poster ? 1 : 0)
    );
    return [...pool].sort((a, b) => score(b) - score(a))[0];
}

/* --------------------------------------------------------------------- main */

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const listId = arg('list', 'ls540527030');
    const html = readFileSync(HTML_PATH, 'utf8');
    const registry = JSON.parse(readFileSync(NX_TITLES_PATH, 'utf8'));

    // IMDb kabhi-kabhi bot check ya chhota "compact" page deta hai — teen URL
    // try karte hain aur sabse zyada titles wala use karte hain.
    const listUrls = [
        `https://www.imdb.com/list/${listId}/?count=250`,
        `https://www.imdb.com/list/${listId}/?view=compact&count=250`,
        `https://m.imdb.com/list/${listId}/`,
    ];
    let items = [];
    let listHtml = '';
    for (const listUrl of listUrls) {
        try {
            const response = await fetch(listUrl, {
                redirect: 'follow',
                headers: {
                    'User-Agent': UA,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });
            const body = await response.text();
            const parsed = parseImdbList(body);
            console.log(`IMDb ${response.status} ${body.length} chars -> ${parsed.length} titles (${listUrl})`);
            if (parsed.length > items.length) {
                items = parsed;
                listHtml = body;
            }
            if (items.length >= 40) break;
        } catch (error) {
            console.log(`IMDb fetch fail (${listUrl}): ${error?.message || error}`);
        }
        await sleep(600);
    }
    if (items.length < 40) {
        // Reader proxy: IMDb datacenter IPs ko block karta hai, ye rasta reliable hai.
        for (const target of [
            `https://www.imdb.com/list/${listId}/`,
            `https://r.jina.ai/https://www.imdb.com/list/${listId}/`,
        ]) {
            try {
                const body = await get(target, { accept: 'text/plain,text/markdown,*/*' });
                const parsed = parseImdbMarkdown(body || '');
                console.log(`Reader ${target} -> ${parsed.length} titles`);
                if (parsed.length > items.length) {
                    items = parsed;
                    listHtml = body || '';
                }
            } catch (error) {
                console.log(`Reader fail (${target}): ${error?.message || error}`);
            }
            await sleep(400);
        }
    }
    if (items.length < 40) {
        // Debug ke liye page ka shuru ka hissa log me chhod do (CI log branch me aata hai).
        console.log(`IMDb page snippet: ${String(listHtml).slice(0, 700).replace(/\s+/g, ' ')}`);
        throw new Error(`IMDb list se sirf ${items.length} titles mile — page badal gaya lagta hai`);
    }

    const have = new Set(existingCatalogTitles(html).map(normTitle));
    const report = { listId, generatedAt: new Date().toISOString(), added: [], skipped: [], missing: [] };
    const added = [];

    for (const [index, item] of items.entries()) {
        if (have.has(normTitle(item.title))) {
            report.skipped.push({ title: item.title, reason: 'already-in-catalog' });
            continue;
        }
        let search;
        try {
            search = parseSearchResults(await get(`${NX_BASE}/search?q=${encodeURIComponent(item.title)}`));
        } catch (error) {
            report.missing.push({ title: item.title, reason: `search-failed: ${error?.message || error}` });
            continue;
        }
        const hit = pickNxshaMatch(search, item.title, { kind: item.kind, year: item.year });
        if (!hit) {
            report.missing.push({ title: item.title, reason: 'no-nxsha-match' });
            continue;
        }
        // Page khol kar confirm: title wahan sach me hai (galat show na ghuse).
        const pageUrl = `${NX_BASE}/${hit.type}/${hit.id}`;
        let page;
        try {
            page = await get(pageUrl);
        } catch (error) {
            report.missing.push({ title: item.title, reason: `page-failed: ${error?.message || error}` });
            continue;
        }
        if (!page) {
            report.missing.push({ title: item.title, reason: 'page-missing' });
            continue;
        }
        let verifiedTitle = hit.name;
        if (hit.type === 'tv') {
            try {
                verifiedTitle = parseNxshaSeriesPage(page, hit.name).title;
            } catch (error) {
                report.missing.push({ title: item.title, reason: `route-mismatch: ${error?.message || error}` });
                continue;
            }
        } else {
            const info = parseMoviePage(page);
            if (!info.title || normTitle(info.title) !== normTitle(hit.name)) {
                report.missing.push({ title: item.title, reason: 'movie-route-mismatch' });
                continue;
            }
            verifiedTitle = info.title;
        }
        const info = parseMoviePage(page);
        const year = info.year || hit.year || item.year || '';
        const rating = hit.rating && Number(hit.rating) > 0 ? String((Number(hit.rating) / 2).toFixed(1)) : '';
        const key = uniqueKey(slugKey(hit.name), new Set([...Object.keys(registry), ...added.map((row) => row.key)]));
        added.push({
            key,
            kind: hit.type === 'movie' ? 'movie' : 'tv',
            id: hit.id,
            title: verifiedTitle,
            year,
            rating,
            genres: (info.genres || []).filter((genre) => /^[a-z][a-z -]{2,24}$/i.test(genre)).slice(0, 4),
            img: hit.poster || info.backdrop || '',
            runtime: info.duration || '',
            desc: info.description || item.description || '',
            imdbId: item.imdbId,
        });
        report.added.push({ key, title: verifiedTitle, nxsha: `${hit.type}/${hit.id}`, imdb: item.imdbId });
        if ((index + 1) % 10 === 0) console.log(`… ${index + 1}/${items.length} checked, ${added.length} naye mile`);
    }

    // Poster na ho to card khaali dikhega — aise titles skip (owner: "images sahi sahi").
    const withPoster = added.filter((entry) => entry.img);
    for (const entry of added.filter((row) => !row.img)) {
        report.missing.push({ title: entry.title, reason: 'no-poster' });
    }
    console.log(`Naye titles: ${withPoster.length} (skip ${report.skipped.length}, missing ${report.missing.length})`);

    for (const entry of withPoster) {
        registry[entry.key] = {
            id: entry.id,
            kind: entry.kind,
            title: entry.title,
            seasons: entry.kind === 'movie' ? { '1': 1 } : {},
        };
    }

    let nextHtml = mergeCatalog(html, withPoster.map((entry) => catalogEntryLine(entry.key, entry)));
    nextHtml = mergeRows(nextHtml, buildRows(withPoster));

    if (dryRun) {
        console.log('--dry-run: kuch nahi likha');
        console.log(JSON.stringify(withPoster.slice(0, 3), null, 2));
        return;
    }
    writeFileSync(HTML_PATH, nextHtml);
    writeFileSync(NX_TITLES_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${withPoster.length} catalog entries + registry routes.`);
    console.log(`Keys: ${withPoster.map((entry) => entry.key).join(',')}`);
}

/** Slug takra jaye to `-2`, `-3` … (keys unique rehne chahiye). */
function uniqueKey(base, taken) {
    let key = base;
    let n = 2;
    while (taken.has(key)) {
        key = `${base}${n}`;
        n += 1;
    }
    return key;
}

/* ---------------------------------------------------------------- self-test */

/** `node scripts/import-imdb-anime.mjs --self-test` — network ke bina checks. */
export function selfTest() {
    const assert = (condition, message) => {
        if (!condition) throw new Error(`self-test failed: ${message}`);
    };
    const listHtml = `
        <script type="application/ld+json">
        {"@type":"ItemList","itemListElement":[
          {"@type":"ListItem","item":{"@type":"TVSeries","url":"https://www.imdb.com/title/tt15765670/","name":"My Dress-Up Darling","description":"Cosplay dreams."}},
          {"@type":"ListItem","item":{"@type":"Movie","url":"https://www.imdb.com/title/tt0245429/","name":"Spirited Away"}}
        ]}
        </script>
        <a href="/title/tt13409432/?ref_=ls_i_2"><img alt="Ranking of Kings (2021)" src="https://m.media-amazon.com/images/M/abc._V1_QL75.jpg"></a>
        <a href="/title/tt13409432/?ref_=ls_t_2">Ranking of Kings</a>
    `;
    const items = parseImdbList(listHtml);
    assert(items.length === 3, `IMDb items ${items.length}`);
    assert(items.find((row) => row.imdbId === 'tt13409432')?.year === '2021', 'anchor year');
    assert(items.find((row) => row.imdbId === 'tt0245429')?.kind === 'movie', 'JSON-LD movie kind');
    assert(items.find((row) => row.imdbId === 'tt15765670')?.title === 'My Dress-Up Darling', 'JSON-LD title');

    const md = '![Image 1: My Dress-Up Darling (2022)](https://x/a.jpg)\n\n[](https://www.imdb.com/title/tt15765670/?ref_=ls_i_1) x\n';
    const mdItems = parseImdbMarkdown(md);
    assert(mdItems.length === 1 && mdItems[0].imdbId === 'tt15765670' && mdItems[0].title === 'My Dress-Up Darling', 'markdown reader parse');

    const page = `<!doctype html><html><body>
      <script>var shows={
        solo:{title:'Solo Leveling',year:2024,rating:'4.9',genres:['action'],audio:'Sub & Dub',img:'x.jpg',desc:'hi'}
      };
      var rows=[
        {title:'Trending Now',keys:['solo']}
      ];
      </body></html>`;
    assert(existingCatalogTitles(page).join() === 'Solo Leveling', 'existing titles');
    assert(existingRowKeys(page).has('solo'), 'existing row keys');

    const line = catalogEntryLine('dressup', {
        title: "Akebi's Sailor Uniform", year: 2022, rating: '4.0',
        genres: ['slice of life'], img: 'https://image.tmdb.org/t/p/w500/a.jpg', desc: "Akebi's dream",
    });
    assert(line.includes("title:'Akebi" + BACKSLASH + "'s Sailor Uniform'"), 'apostrophe escape');
    assert(line.startsWith('dressup:{') && line.endsWith('},'), 'catalog line shape');

    const once = mergeCatalog(page, [line]);
    const twice = mergeCatalog(once, [line]);
    assert(twice === once, 'mergeCatalog must be idempotent');
    const occurrences = twice.split('dressup:{').length - 1;
    assert(occurrences === 1, `catalog duplicate (${occurrences})`);
    assert(twice.split(SHOWS_START).length === 2, 'one marker pair in catalog');
    // Marker block JS comment hai — catalog parse isse break nahi hona chahiye.
    assert(existingCatalogTitles(twice).length === 2, 'catalog parse after merge');

    const rows = buildRows([
        { key: 'a', genres: ['action'] }, { key: 'b', genres: ['action'] },
        { key: 'c', genres: ['action'] }, { key: 'd', genres: ['action'] },
        { key: 'e', genres: ['action'] }, { key: 'f', genres: ['romance'] },
    ]);
    assert(rows[0].title === 'Hindi Dub · Action' && rows[0].keys.length === 5, 'genre row');
    assert(rows[1].title === 'Hindi Dub on Crunchyroll' && rows[1].keys.join() === 'f', 'leftover row');

    const mergedRows = mergeRows(page, rows);
    assert(mergeRows(mergedRows, rows) === mergedRows, 'mergeRows must be idempotent');
    assert(mergedRows.includes("keys:['solo']"), 'old row kept');
    assert(mergedRows.split(ROWS_START).length === 2, 'one marker pair in rows');
    assert(existingRowKeys(mergedRows).has('a'), 'new row keys readable');

    const match = pickNxshaMatch([
        { type: 'tv', id: '1', name: 'Blue Lock', year: '2024', poster: 'p.jpg' },
        { type: 'tv', id: '2', name: 'Blue Lock', year: '2022', poster: 'p.jpg' },
        { type: 'movie', id: '3', name: 'Blue Lock Movie', year: '2022', poster: '' },
    ], 'Blue Lock', { kind: 'tv', year: '2022' });
    assert(match?.id === '2', 'year tie-break');
    assert(pickNxshaMatch([{ type: 'tv', id: '9', name: 'Something Else', year: '2020' }], 'Blue Lock') === null, 'no loose match');
    assert(slugKey('My Dress-Up Darling') === 'mydressupdarling', 'slug');
    console.log('import-imdb-anime self-tests passed');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    if (process.argv.includes('--self-test')) {
        try {
            selfTest();
        } catch (error) {
            console.error(error?.message || error);
            process.exitCode = 1;
        }
    } else {
        main().catch((error) => {
            console.error(`import-imdb-anime: ${error?.stack || error?.message || error}`);
            process.exitCode = 1;
        });
    }
}
