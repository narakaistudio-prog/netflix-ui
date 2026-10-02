/**
 * Backfill missing IMDb ids in data/movies.json.
 *
 * Nxsha/NHD embeds are keyed by IMDb (tt…) or TMDB id. Most catalog rows are
 * scraped from JustWatch/Netflix pages and only carry a Netflix id, which made
 * the player fall back to "Play on Netflix". The client can resolve ids at
 * runtime (lib/titleIds.ts + api/title-id.js), but resolving them here — once,
 * in the daily refresh — means the app can play instantly and offline-ish.
 *
 * Usage: node scripts/backfill-title-ids.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data/movies.json');

const MOVIE_KINDS = new Set(['movie', 'video', 'tvMovie', 'short', 'tvSpecial']);
const TV_KINDS = new Set(['tvSeries', 'tvMiniSeries', 'tvShort']);
const CONCURRENCY = 4;

const normalize = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d]/g, '')
        .replace(/\b(season|part)\s+\d+\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

function pick(suggestions, title, mediaType, year) {
    if (!Array.isArray(suggestions)) return null;
    const wanted = normalize(title);
    const kinds = mediaType === 'tv' ? TV_KINDS : MOVIE_KINDS;
    const scored = suggestions
        .filter((item) => typeof item?.id === 'string' && /^tt\d+$/.test(item.id))
        .map((item) => {
            const name = normalize(item.l);
            let score = 0;
            if (name === wanted) score += 100;
            else if (name.startsWith(wanted) || wanted.startsWith(name)) score += 55;
            else if (name.includes(wanted)) score += 25;
            const kind = item.qid || '';
            if (kinds.has(kind)) score += 30;
            else if (kind) score -= 25;
            if (year && item.y) {
                const diff = Math.abs(item.y - year);
                if (diff === 0) score += 25;
                else if (diff === 1) score += 12;
                else if (diff > 3) score -= 10;
            }
            if (typeof item.rank === 'number') score += Math.max(0, 10 - item.rank / 2000);
            return { id: item.id, score };
        })
        .sort((a, b) => b.score - a.score);
    const best = scored[0];
    return best && best.score >= 40 ? best.id.toLowerCase() : null;
}

async function lookup(title, mediaType, year) {
    const query = String(title).trim().toLowerCase().replace(/\s+/g, '%20');
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURI(query)}.json?includeVideos=0`;
    try {
        const res = await fetch(url, { headers: { 'user-agent': 'netflix-ui/1.0' } });
        if (!res.ok) return null;
        const data = await res.json();
        return pick(data?.d, title, mediaType, year);
    } catch {
        return null;
    }
}

async function mapConcurrent(items, limit, worker) {
    const results = [];
    let index = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const current = index++;
            results[current] = await worker(items[current], current);
        }
    });
    await Promise.all(runners);
    return results;
}

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const allItems = data.movies.flatMap((row) => row.movies ?? []);

const pending = new Map();
for (const item of allItems) {
    if (item.imdb_id || item.tmdb_id || item.embed_url || !item.title) continue;
    const mediaType = item.mediaType === 'tv' || item.type === 'SERIES' ? 'tv' : 'movie';
    const key = `${mediaType}:${normalize(item.title)}`;
    if (!pending.has(key)) {
        pending.set(key, { title: item.title, mediaType, year: Number.parseInt(String(item.year || ''), 10) || undefined });
    }
}

console.log(`Resolving IMDb ids for ${pending.size} titles…`);
const entries = [...pending.entries()];
const resolved = new Map();
let done = 0;
await mapConcurrent(entries, CONCURRENCY, async ([key, info]) => {
    const id = await lookup(info.title, info.mediaType, info.year);
    done += 1;
    if (done % 25 === 0) console.log(`  ${done}/${entries.length}`);
    if (id) resolved.set(key, id);
});

let patched = 0;
for (const item of allItems) {
    if (item.imdb_id || item.tmdb_id || item.embed_url || !item.title) continue;
    const mediaType = item.mediaType === 'tv' || item.type === 'SERIES' ? 'tv' : 'movie';
    const id = resolved.get(`${mediaType}:${normalize(item.title)}`);
    if (id) {
        item.imdb_id = id;
        item.embed_provider = item.embed_provider || 'nxsha';
        patched += 1;
    }
}

writeFileSync(FILE, JSON.stringify({ movies: data.movies }, null, 4));
console.log(`Backfilled ${patched} catalog entries (${resolved.size}/${entries.length} titles resolved).`);
