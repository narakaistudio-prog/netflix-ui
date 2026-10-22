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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decode, parseMoviePage } from './build-trending-nxsha.mjs';
import { parseSearchResults } from './build-netflix-genre-rows.mjs';
import { parseNxshaSeriesPage } from './harvest-nxsha-guide.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const NX_TITLES_PATH = resolve(ROOT, 'data', 'nxsha-titles.json');
const REPORT_PATH = resolve(ROOT, 'data', 'imdb-anime-import.json');
const CATALOG_STATE_PATH = resolve(ROOT, 'data', 'imdb-anime-catalog.json');
const LIST_SNAPSHOT_PATH = resolve(ROOT, 'data', 'imdb-anime-list.md');
const NX_SAMPLE_PATH = resolve(ROOT, 'data', 'nxsha-page-sample.html');

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

/**
 * Fuzzy title compare: punctuation/case ke alawa **double letters** bhi ek
 * maan lo. IMDb "Haikyuu!!" aur page ka "HAIKYU!!" ek hi show hain — bina iske
 * wahi anime dobara add ho jata (owner: "jo pehle se hai usse chod dena").
 */
export function looseTitle(value) {
    return normTitle(value).replace(/(.)\1+/g, '$1');
}

/** Do naam ek hi show ke hain? (case/punctuation/double-letter tolerant) */
export function isSameShow(a, b) {
    const left = normTitle(a);
    const right = normTitle(b);
    if (!left || !right) return false;
    return left === right || looseTitle(a) === looseTitle(b);
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
 * padhte hain.
 *
 * Us markdown me har card aisa dikhta hai:
 *   ![Image 3: Akebi's Sailor Uniform (2022)](https://m.media-amazon.com/…jpg)
 *   [](https://www.imdb.com/title/tt15533674/?ref_=ls_i_4)
 *
 * Dhyan: IMDb poster ka `alt` kabhi-kabhi **cast photo** ka hota hai, jaise
 * "Minami Hinata and Ayumu Murase in Ranking of Kings (2021)" — usme asli title
 * " in " ke baad hota hai. Isliye title nikalte waqt wo prefix hataate hain,
 * aur jahan `#### [2. Ranking of Kings]` heading mil jaye wahan heading hi
 * jeetta hai (sabse saaf source).
 */
export function titleFromAlt(alt) {
    const noYear = decode(alt).replace(/\s*\((\d{4})[^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
    const inMatch = /^(.+?)\s+in\s+(.+)$/.exec(noYear);
    if (inMatch) {
        const prefix = inMatch[1];
        // Cast list me comma/and hote hain; asli title me aisa nahi ("I Got a
        // Cheat Skill in Another World…" ka prefix comma-free hota hai).
        const looksLikeCast = /,|\band\b/.test(prefix) && prefix.length < 120 && !/[?!]/.test(prefix);
        if (looksLikeCast) return inMatch[2].trim();
    }
    return noYear;
}

export function parseImdbMarkdown(text) {
    const source = String(text || '');
    const rows = new Map();

    // 1) Heading titles: `#### [2. Ranking of Kings](…?ref_=ls_t_2)`.
    const headings = new Map();
    for (const match of source.matchAll(/\[(?:\d+)\.\s*([^\]]+)\]\((https?:\/\/www\.imdb\.com\/title\/(tt\d+)\/[^)]*)\)/g)) {
        const title = decode(match[1]).replace(/\s+/g, ' ').trim();
        if (title && !headings.has(match[3])) headings.set(match[3], title);
    }

    // 2) Poster/still cards: image alt + uske turant baad ka title link.
    for (const chunk of source.split('![').slice(1)) {
        const head = /^Image \d+: ([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/.exec(chunk);
        if (!head) continue;
        const link = /\[\]\((https?:\/\/www\.imdb\.com\/title\/(tt\d+)[^)]*)\)/.exec(chunk);
        if (!link) continue;
        const imdbId = link[2];
        const alt = decode(head[1]).replace(/\s+/g, ' ').trim();
        const year = /\((\d{4})[^)]*\)\s*$/.exec(alt)?.[1] || '';
        const title = headings.get(imdbId) || titleFromAlt(alt);
        if (!title) continue;
        if (!rows.has(imdbId)) {
            rows.set(imdbId, { imdbId, title, year, poster: head[2], description: '', kind: '' });
        }
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
export function buildRows(entries, { minPerGenre = 5, maxPerRow = 24 } = {}) {
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
        const label = `Hindi Dub · ${genre.replace(/\b\w/g, (c) => c.toUpperCase())}`;
        // Bahut lambi row ek rail me thik nahi lagti — 24 ke chunk me tor dete hain.
        for (let index = 0; index < list.length; index += maxPerRow) {
            const chunk = list.slice(index, index + maxPerRow);
            const part = index === 0 ? '' : ` · Part ${index / maxPerRow + 1}`;
            rows.push({ title: `${label}${part}`, keys: chunk.map((entry) => entry.key) });
        }
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
    const exact = usable.filter((row) => isSameShow(row.name, wanted));
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

/* ------------------------------------------------------------------ genres */

/**
 * Nxsha page ka genre text -> page ke genre filter ki vocabulary.
 *
 * Crunchyroll page ka dropdown sirf inhi 8 values par filter karta hai
 * (action / fantasy / adventure / comedy / drama / romance / sports /
 * science-fiction), isliye TMDB ke lambe naam yahan map hote hain. Jo genre
 * kahin fit nahi hota use chhod dete hain — galat label se behtar hai koi
 * label na ho.
 */
const GENRE_MAP = {
    action: 'action',
    adventure: 'adventure',
    animation: '',
    comedy: 'comedy',
    crime: 'drama',
    documentary: '',
    drama: 'drama',
    family: 'drama',
    fantasy: 'fantasy',
    history: 'drama',
    horror: 'drama',
    music: 'drama',
    mystery: 'drama',
    romance: 'romance',
    'science fiction': 'science-fiction',
    'sci fi': 'science-fiction',
    'sci-fi': 'science-fiction',
    'tv movie': '',
    thriller: 'drama',
    war: 'action',
    western: 'action',
    sport: 'sports',
    sports: 'sports',
    'slice of life': 'drama',
    supernatural: 'fantasy',
    mecha: 'science-fiction',
    school: 'comedy',
    shounen: 'action',
    seinen: 'drama',
    isekai: 'fantasy',
    ecchi: '',
};

const GENRE_ORDER = ['action', 'adventure', 'comedy', 'drama', 'fantasy', 'romance', 'science-fiction', 'sports'];

/** Ek page ke HTML se genres (TMDB/JSON-LD, genre links, ya visible text). */
export function parseGenres(html) {
    const source = String(html || '');
    const raw = new Set();

    for (const match of source.matchAll(/"genre[s]?"\s*:\s*\[([^\]]*)\]/gi)) {
        for (const value of match[1].split(',')) raw.add(value.replace(/["']/g, '').trim());
    }
    for (const match of source.matchAll(/\/genre\/([a-z0-9-]+)/gi)) {
        raw.add(match[1].replace(/-/g, ' '));
    }
    for (const match of source.matchAll(/itemprop="genre"[^>]*>([^<]{2,30})</gi)) {
        raw.add(match[1].trim());
    }

    const genres = new Set();
    for (const value of raw) {
        const mapped = GENRE_MAP[value.toLowerCase().replace(/\s+/g, ' ').trim()];
        if (mapped) genres.add(mapped);
    }
    return [...genres].sort((a, b) => GENRE_ORDER.indexOf(a) - GENRE_ORDER.indexOf(b));
}

/* ------------------------------------------------------------- catalog state */

/**
 * Marker block ki apni lines wapas objects me todo — pehli baar state file
 * banate waqt purane import ko seed karne ke liye (format hamara hi hai).
 */
export function parseCatalogLine(line) {
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*):\{/.exec(line);
    if (!keyMatch) return null;
    const entry = { key: keyMatch[1], genres: [] };
    const readString = (from) => readQuoted(line, from);

    for (const field of ['title', 'rating', 'audio', 'img', 'runtime', 'desc']) {
        const at = line.indexOf(`${field}:'`);
        if (at < 0) continue;
        // `at` field ke naam par hai, quote `field:'` ke baad aata hai.
        entry[field] = readString(at + field.length + 1).value;
    }
    const year = /year:(\d{4})/.exec(line);
    if (year) entry.year = Number(year[1]);
    const genresAt = line.indexOf('genres:[');
    if (genresAt >= 0) {
        const close = line.indexOf(']', genresAt);
        if (close > genresAt) {
            entry.genres = line
                .slice(genresAt + 'genres:['.length, close)
                .split(',')
                .map((value) => value.trim().replace(/^'/, '').replace(/'$/, ''))
                .filter(Boolean);
        }
    }
    if (line.includes("type:'Movie'")) entry.kind = 'movie';
    return entry;
}

/** Page ke marker block se saare entries (import se pehle ke liye). */
export function readMarkerEntries(html) {
    const source = String(html);
    const start = source.indexOf(SHOWS_START);
    const end = source.indexOf(SHOWS_END, start);
    if (start < 0 || end < 0) return [];
    return source.slice(start, end)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('/*'))
        .map(parseCatalogLine)
        .filter(Boolean);
}

/**
 * State file (`data/imdb-anime-catalog.json`) hi source of truth hai: isme har
 * imported title ka poora record hota hai. File na mile to marker block se seed
 * karte hain (pehla run). Rows aur catalog dono isi se dobara bante hain, isliye
 * har run par rows/entries ek jaise rehte hain.
 */
function loadState(html, registry) {
    if (existsSync(CATALOG_STATE_PATH)) {
        return JSON.parse(readFileSync(CATALOG_STATE_PATH, 'utf8'));
    }
    const entries = readMarkerEntries(html).map((entry) => {
        const route = registry[entry.key] || {};
        return {
            ...entry,
            kind: entry.kind || (route.kind === 'movie' ? 'movie' : 'tv'),
            id: route.id || '',
            title: entry.title || route.title || '',
        };
    });
    return { entries };
}

/* --------------------------------------------------------------------- main */

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const listId = arg('list', 'ls540527030');
    const html = readFileSync(HTML_PATH, 'utf8');
    const registry = JSON.parse(readFileSync(NX_TITLES_PATH, 'utf8'));
    const state = loadState(html, registry);
    const entries = new Map(state.entries.map((entry) => [entry.key, entry]));

    const items = await readImdbList(listId);
    const report = {
        listId,
        generatedAt: new Date().toISOString(),
        imdbItems: items.length,
        added: [],
        skipped: [],
        missing: [],
        enriched: [],
    };

    const have = new Set(existingCatalogTitles(html).map(looseTitle));
    const takenKeys = new Set([...Object.keys(registry), ...entries.keys()]);

    for (const [index, item] of items.entries()) {
        if (have.has(looseTitle(item.title))) {
            report.skipped.push({ title: item.title, reason: 'already-in-catalog' });
            continue;
        }
        const found = await resolveNxsha(item, report);
        if (!found) continue;
        const key = uniqueKey(slugKey(found.hit.name), takenKeys);
        takenKeys.add(key);
        entries.set(key, {
            key,
            kind: found.kind,
            id: found.hit.id,
            title: found.title,
            year: found.year,
            rating: found.rating,
            genres: found.genres,
            img: found.img,
            runtime: found.runtime,
            desc: found.desc,
            imdbId: item.imdbId,
        });
        have.add(looseTitle(found.title));
        report.added.push({ key, title: found.title, nxsha: `${found.hit.type}/${found.hit.id}`, imdb: item.imdbId });
        if ((index + 1) % 10 === 0) console.log(`… ${index + 1}/${items.length} checked, ${report.added.length} naye mile`);
    }

    // Purane import ki genres khaali reh gayi ho to page dobara padh kar bharo
    // (owner: "sab sahi sahi lagna chiyea" — rows genres par banti hain).
    for (const entry of entries.values()) {
        if (entry.genres?.length || !entry.id) continue;
        try {
            const page = await get(`${NX_BASE}/${entry.kind === 'movie' ? 'movie' : 'tv'}/${entry.id}`);
            const genres = page ? parseGenres(page) : [];
            if (genres.length) {
                entry.genres = genres;
                report.enriched.push({ key: entry.key, genres });
            }
        } catch (error) {
            console.log(`genre enrich fail ${entry.key}: ${error?.message || error}`);
        }
    }

    const ordered = [...entries.values()].filter((entry) => entry.img);
    for (const entry of [...entries.values()].filter((row) => !row.img)) {
        report.missing.push({ title: entry.title, reason: 'no-poster' });
    }

    for (const entry of ordered) {
        registry[entry.key] = {
            id: entry.id,
            kind: entry.kind,
            title: entry.title,
            seasons: registry[entry.key]?.seasons && Object.keys(registry[entry.key].seasons).length
                ? registry[entry.key].seasons
                : (entry.kind === 'movie' ? { '1': 1 } : {}),
        };
    }

    let nextHtml = mergeCatalog(html, ordered.map((entry) => catalogEntryLine(entry.key, entry)));
    nextHtml = mergeRows(nextHtml, buildRows(ordered));

    // Source ka snapshot repo me rakhte hain — agli baar parser bina network
    // verify ho jata hai (aur CI log ke bharose nahi rehna padta).
    writeFileSync(LIST_SNAPSHOT_PATH, String(listSnapshot || '').slice(0, 4_000_000));

    console.log(`Total imported: ${ordered.length} | naye: ${report.added.length} | skip: ${report.skipped.length} | missing: ${report.missing.length} | genres bhare: ${report.enriched.length}`);

    if (dryRun) {
        console.log('--dry-run: page/state nahi likhe');
        return;
    }
    writeFileSync(HTML_PATH, nextHtml);
    writeFileSync(NX_TITLES_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    writeFileSync(CATALOG_STATE_PATH, `${JSON.stringify({ updated: report.generatedAt, entries: ordered }, null, 2)}\n`);
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${ordered.length} catalog entries + registry routes.`);
}

/** IMDb list: pehle seedha, nahi mila to reader proxy se (markdown). */
let listSnapshot = '';
async function readImdbList(listId) {
    let items = [];
    for (const listUrl of [
        `https://www.imdb.com/list/${listId}/?count=250`,
        `https://www.imdb.com/list/${listId}/?view=compact&count=250`,
        `https://m.imdb.com/list/${listId}/`,
    ]) {
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
                listSnapshot = body;
            }
            if (items.length >= 40) return items;
        } catch (error) {
            console.log(`IMDb fetch fail (${listUrl}): ${error?.message || error}`);
        }
        await sleep(600);
    }
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
                listSnapshot = body || '';
            }
        } catch (error) {
            console.log(`Reader fail (${target}): ${error?.message || error}`);
        }
        await sleep(400);
    }
    if (items.length < 40) {
        console.log(`IMDb page snippet: ${String(listSnapshot).slice(0, 700).replace(/\s+/g, ' ')}`);
        throw new Error(`IMDb list se sirf ${items.length} titles mile — page badal gaya lagta hai`);
    }
    return items;
}

/** Ek IMDb title -> Nxsha route + page metadata, ya null (report me wajah). */
async function resolveNxsha(item, report) {
    const candidates = [item.title];
    // Poster ka alt kabhi cast photo ka hota hai ("Kana Ichinose in Mobile Suit
    // Gundam…") — pehla try fail ho to " in " ke baad wala naam bhi try karo.
    const lastIn = item.title.lastIndexOf(' in ');
    if (lastIn > 0) candidates.push(item.title.slice(lastIn + 4).trim());

    let hit = null;
    for (const candidate of candidates) {
        let search;
        try {
            search = parseSearchResults(await get(`${NX_BASE}/search?q=${encodeURIComponent(candidate)}`));
        } catch (error) {
            report.missing.push({ title: item.title, reason: `search-failed: ${error?.message || error}` });
            return null;
        }
        hit = pickNxshaMatch(search, candidate, { kind: item.kind, year: item.year });
        if (hit) break;
        await sleep(200);
    }
    if (!hit) {
        report.missing.push({ title: item.title, reason: 'no-nxsha-match' });
        return null;
    }
    let page;
    try {
        page = await get(`${NX_BASE}/${hit.type}/${hit.id}`);
    } catch (error) {
        report.missing.push({ title: item.title, reason: `page-failed: ${error?.message || error}` });
        return null;
    }
    if (!page) {
        report.missing.push({ title: item.title, reason: 'page-missing' });
        return null;
    }
    let verifiedTitle = hit.name;
    if (hit.type === 'tv') {
        try {
            verifiedTitle = parseNxshaSeriesPage(page, hit.name).title;
        } catch (error) {
            report.missing.push({ title: item.title, reason: `route-mismatch: ${error?.message || error}` });
            return null;
        }
    } else {
        const info = parseMoviePage(page);
        if (!info.title || normTitle(info.title) !== normTitle(hit.name)) {
            report.missing.push({ title: item.title, reason: 'movie-route-mismatch' });
            return null;
        }
        verifiedTitle = info.title;
    }
    // Ek page ka HTML sample repo me rakhte hain taaki genre parser offline
    // verify ho sake (sandbox se Nxsha reach nahi hota).
    if (!existsSync(NX_SAMPLE_PATH)) writeFileSync(NX_SAMPLE_PATH, page.slice(0, 300_000));

    const info = parseMoviePage(page);
    const poster = hit.poster || info.backdrop || '';
    if (!poster) {
        report.missing.push({ title: item.title, reason: 'no-poster' });
        return null;
    }
    return {
        hit,
        kind: hit.type === 'movie' ? 'movie' : 'tv',
        title: verifiedTitle,
        year: info.year || hit.year || item.year || '',
        rating: hit.rating && Number(hit.rating) > 0 ? String((Number(hit.rating) / 2).toFixed(1)) : '',
        genres: parseGenres(page),
        img: poster,
        runtime: info.duration || '',
        desc: info.description || item.description || '',
    };
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

    assert(titleFromAlt('Minami Hinata and Ayumu Murase in Ranking of Kings (2021)') === 'Ranking of Kings', 'cast-photo alt se title');
    assert(titleFromAlt("Akebi's Sailor Uniform (2022)") === "Akebi's Sailor Uniform", 'normal alt');
    assert(titleFromAlt('I Got a Cheat Skill in Another World and Became Unrivaled (2023)') === 'I Got a Cheat Skill in Another World and Became Unrivaled', 'title me "in" ho to na tute');
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
    assert(isSameShow('Haikyuu!!', 'HAIKYU!!') && !isSameShow('Haikyuu!!', 'Bleach'), 'fuzzy title');
    assert(parseGenres('<a href="/genre/action">Action</a><a href="/genre/sci-fi">Sci-Fi</a>').join() === 'action,science-fiction', 'genre map');

    const seeded = parseCatalogLine("dressup:{title:'My Dress-Up Darling',year:2022,rating:'4.2',genres:['romance','comedy'],audio:'Sub & Dub',img:'p.jpg',desc:'Cosplay.'},");
    assert(seeded.key === 'dressup' && seeded.title === 'My Dress-Up Darling' && seeded.year === 2022, 'catalog line seed');
    assert(seeded.genres.join() === 'romance,comedy' && seeded.img === 'p.jpg', 'catalog line genres/img');

    const big = buildRows(Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, genres: ['action'] })));
    assert(big.length === 2 && big[0].keys.length === 24 && big[1].title.endsWith('Part 2'), 'lambi row chunk');

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
