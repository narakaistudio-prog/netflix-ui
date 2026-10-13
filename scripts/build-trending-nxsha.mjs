#!/usr/bin/env node
/**
 * Fill the "Trending Now in India" row (data/movies.json) with details and
 * images from Nxsha, the only source for this row.
 *
 * Runs on a hosted runner (the workspace sandbox cannot reach nxsha.space).
 * For each title in the row:
 *   1. Find its Nxsha movie id: keep the id already in the row, otherwise
 *      search /search?q=<title> and take the result whose name matches exactly
 *      (year is preferred when the row has one). Titles without a match keep
 *      their Netflix-only data and are reported.
 *   2. Read /movie/<id>: year, description, runtime, backdrop, cast.
 *   3. Take the poster (w500) from the search result card for that id.
 * Only the Trending row is changed. Crunchyroll data is never read or written.
 *
 * Usage: node scripts/build-trending-nxsha.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOVIES = resolve(ROOT, 'data', 'movies.json');
const ROW_TITLE = 'Trending Now in India';
const BASE = 'https://nxsha.space';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DRY = process.argv.includes('--dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Netflix Tudum names that Nxsha lists under a different title. Only add an
 * entry after checking the Nxsha page; the entry is used as the search name.
 */
const NXSHA_ALIASES = {
    'Demon Slayer: Kimetsu no Yaiba Infinity Castle I': 'Demon Slayer: Kimetsu no Yaiba Infinity Castle',
};

async function get(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const res = await fetch(url, {
                    signal: ctl.signal,
                    redirect: 'follow',
                    headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
                });
                if (res.status === 200) return await res.text();
                if (res.status === 404) return null;
            } catch (e) {
                if (attempt === 3) throw e;
            }
            await sleep(600 * attempt);
        }
        return null;
    } finally {
        clearTimeout(to);
    }
}

export function decode(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
        .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)))
        .replace(/\s+/g, ' ')
        .trim();
}

const norm = (s) =>
    decode(s)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

/** Result cards on /search: [{ id, name, year, poster }] for movie links only. */
export function parseSearchMovies(html) {
    const out = [];
    const seen = new Set();
    for (const m of String(html || '').matchAll(/<a\b[^>]*href="\/movie\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const body = m[2];
        const texts = [...body.replace(/<img\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '\n').split('\n')]
            .map((t) => decode(t))
            .filter(Boolean);
        // Card text order: rating, name, release date (e.g. "Aug 14, 2026").
        const yearHit = texts.map((t) => /\b(19|20)\d{2}\b/.exec(t)).find(Boolean);
        const name = texts.find((t) => !/^(NR|\d+(\.\d+)?|Coming soon)$/i.test(t) && !/\b(19|20)\d{2}\b/.test(t) && !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(t)) || '';
        const img = /<img\b[^>]*src="([^"]+)"/i.exec(body);
        const poster = img && /image\.tmdb\.org\/t\/p\/w500\//.test(img[1]) ? decode(img[1]) : '';
        out.push({ id, name, year: yearHit ? yearHit[0] : '', poster });
    }
    return out;
}

/** Movie page: { title, year, description, backdrop, duration, cast } */
export function parseMoviePage(html) {
    const ogTitle = decode((/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html) || [])[1] || '');
    const ogDesc = decode((/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i.exec(html) || [])[1] || '');
    const ogImage = decode((/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i.exec(html) || [])[1] || '');
    const titleMatch = /^(.*?)\s*\((\d{4})\)/.exec(ogTitle);
    const title = titleMatch ? titleMatch[1].trim() : ogTitle.replace(/\s*-\s*Watch Online Free.*$/i, '').trim();
    const year = titleMatch ? titleMatch[2] : '';
    const visible = html
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, '\n');
    const lines = visible.split('\n').map((l) => decode(l)).filter(Boolean);
    const runtimeLine = lines.find((l) => /^\d+h(\s\d+m)?$|^\d+m$/.test(l));
    const cast = [];
    for (const m of html.matchAll(/<img\b[^>]*src="https:\/\/image\.tmdb\.org\/t\/p\/w185\/[^"]*"[^>]*alt="([^"]+)"/gi)) {
        const name = decode(m[1]);
        if (!name || /^netflix$/i.test(name) || cast.includes(name)) continue;
        cast.push(name);
        if (cast.length >= 10) break;
    }
    // Genre chips sit between "Watch Now" and "Where to watch" on the page.
    const start = lines.indexOf('Watch Now');
    const end = lines.indexOf('Where to watch');
    const genres = start >= 0 && end > start
        ? lines.slice(start + 1, end).filter((g) => g.length <= 30 && !/^(Trailers|Read more)/i.test(g)).slice(0, 5)
        : [];
    return {
        title,
        year,
        description: ogDesc,
        backdrop: ogImage,
        duration: runtimeLine || '',
        cast,
        genres,
    };
}

function pickSearchMatch(results, wantedName, wantedYear) {
    const want = norm(wantedName);
    // Prefer released titles (real poster and year) over "Coming soon" placeholders.
    const exact = results
        .filter((r) => norm(r.name) === want)
        .sort((a, b) => Number(Boolean(b.poster)) - Number(Boolean(a.poster)) || Number(Boolean(b.year)) - Number(Boolean(a.year)));
    if (!exact.length) return null;
    if (wantedYear) {
        const sameYear = exact.find((r) => r.year === String(wantedYear));
        if (sameYear) return sameYear;
    }
    return exact[0];
}

async function main() {
    const movies = JSON.parse(readFileSync(MOVIES, 'utf8'));
    const row = movies.movies.find((r) => r.rowTitle === ROW_TITLE);
    if (!row) throw new Error(`${ROW_TITLE} row not found in data/movies.json`);

    const report = [];
    for (const item of row.movies) {
        const searchName = NXSHA_ALIASES[item.title] || item.title;
        const entry = { title: item.title, status: 'ok' };
        try {
            const html = await get(`${BASE}/search?q=${encodeURIComponent(searchName)}`);
            const results = parseSearchMovies(html || '');
            let tmdbId = item.tmdb_id || '';
            let poster = '';
            if (tmdbId) {
                poster = results.find((r) => r.id === tmdbId)?.poster || '';
            } else {
                const hit = pickSearchMatch(results, searchName, item.year);
                if (!hit) {
                    entry.status = 'no-nxsha-match';
                    report.push(entry);
                    await sleep(250);
                    continue;
                }
                tmdbId = hit.id;
                poster = hit.poster;
            }
            const page = await get(`${BASE}/movie/${tmdbId}`);
            if (!page) {
                entry.status = 'page-missing';
                report.push(entry);
                await sleep(250);
                continue;
            }
            const info = parseMoviePage(page);
            const next = {
                ...item,
                tmdb_id: tmdbId,
                embed_provider: 'nxsha',
                ...(info.year ? { year: info.year } : {}),
                ...(info.description ? { description: info.description } : {}),
                ...(info.duration ? { duration: info.duration } : {}),
                ...(info.cast.length ? { cast: info.cast } : {}),
                ...(info.genres.length ? { genres: info.genres } : {}),
                ...(info.backdrop ? { backdropUrl: info.backdrop } : {}),
                ...(poster || info.backdrop ? { imageUrl: poster || info.backdrop } : {}),
            };
            Object.assign(item, next);
            entry.nxsha = { id: tmdbId, title: info.title, year: info.year, duration: info.duration, cast: info.cast.length, poster: Boolean(poster) };
        } catch (e) {
            entry.status = `error: ${String(e?.message || e)}`;
        }
        report.push(entry);
        console.log(`${entry.status.padEnd(18)} ${item.title} ${entry.nxsha ? `-> nxsha ${entry.nxsha.id} (${entry.nxsha.year}, ${entry.nxsha.duration || 'no runtime'}, ${entry.nxsha.cast} cast)` : ''}`);
        await sleep(300);
    }

    if (DRY) {
        console.log('dry run: data/movies.json not written');
        return;
    }
    writeFileSync(MOVIES, JSON.stringify(movies, null, 4) + '\n');
    const failed = report.filter((r) => r.status !== 'ok').length;
    console.log(`updated ${ROW_TITLE}: ${report.length - failed}/${report.length} titles from nxsha`);
}

// Export helpers for tests; run only when executed directly.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
