#!/usr/bin/env node
/**
 * Probe Nxsha for the metadata behind the Trending Now in India row.
 *
 * Runs on a hosted runner (the workspace sandbox cannot reach nxsha.space).
 * For every title in the "Trending Now in India" row of data/movies.json:
 *   - /movie/{tmdb_id} (when the row already has a tmdb id): records the og/meta
 *     tags, the <img> tags, the visible text and the <h1>.
 *   - /search?q={title}: records every /movie/ and /tv/ link with its anchor
 *     text and the nearby <img> src, so exact matches can be picked.
 * Writes data/tudum-nxsha-probe.json only. Does not touch Crunchyroll data.
 *
 * Usage: node scripts/probe-tudum-nxsha.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOVIES = resolve(ROOT, 'data', 'movies.json');
const OUT = resolve(ROOT, 'data', 'tudum-nxsha-probe.json');
const BASE = 'https://nxsha.space';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        return { status: res.status, finalUrl: res.url, text: await res.text() };
    } finally {
        clearTimeout(to);
    }
}

const visible = (html) =>
    html
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 1)
        .join(' | ');

function movieProbe(url, r) {
    const text = r.text || '';
    const row = { url, status: r.status, finalUrl: r.finalUrl, bytes: text.length };
    if (r.status !== 200) return row;
    row.h1 = [...text.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => visible(m[1])).slice(0, 3);
    row.meta = [...text.matchAll(/<meta\s+[^>]*(?:property|name)="((?:og:|twitter:|description)[^"]*)"[^>]*content="([^"]*)"/gi)]
        .map((m) => [m[1], m[2].slice(0, 400)]);
    row.imgTags = [...text.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0].slice(0, 400)).slice(0, 40);
    row.visibleText = visible(text).slice(0, 5000);
    return row;
}

function searchProbe(url, r) {
    const text = r.text || '';
    const row = { url, status: r.status, bytes: text.length, links: [] };
    if (r.status !== 200) return row;
    const seen = new Set();
    for (const m of text.matchAll(/<a\b[^>]*href="(\/(?:movie|tv)\/[^"?#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const href = m[1];
        if (seen.has(href)) continue;
        seen.add(href);
        const img = /<img\b[^>]*src="([^"]+)"/i.exec(m[2]);
        row.links.push({ href, text: visible(m[2]).slice(0, 200), img: img ? img[1].slice(0, 300) : '' });
        if (row.links.length >= 40) break;
    }
    row.visibleText = visible(text).slice(0, 2500);
    return row;
}

async function main() {
    const movies = JSON.parse(readFileSync(MOVIES, 'utf8'));
    const row = movies.movies.find((r) => r.rowTitle === 'Trending Now in India');
    if (!row) throw new Error('Trending Now in India row not found');

    const report = { generatedAt: new Date().toISOString(), source: BASE, titles: [] };

    for (const m of row.movies) {
        const entry = { id: m.id, title: m.title, tmdb_id: m.tmdb_id || null, movie: null, search: null };
        if (m.tmdb_id) {
            const url = `${BASE}/movie/${m.tmdb_id}`;
            try {
                entry.movie = movieProbe(url, await get(url));
            } catch (e) {
                entry.movie = { url, error: String(e?.message || e) };
            }
            await sleep(200);
        }
        const surl = `${BASE}/search?q=${encodeURIComponent(m.title)}`;
        try {
            entry.search = searchProbe(surl, await get(surl));
        } catch (e) {
            entry.search = { url: surl, error: String(e?.message || e) };
        }
        await sleep(200);
        report.titles.push(entry);
        console.log(`${m.title}: movie=${entry.movie?.status ?? '-'} search=${entry.search?.status ?? 'ERR'} links=${entry.search?.links?.length ?? 0}`);
    }

    writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${OUT}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
