#!/usr/bin/env node
/**
 * Probe Nxsha for the metadata behind the Trending Now in India row.
 *
 * Runs on a hosted runner (the workspace sandbox cannot reach nxsha.space).
 * For every title in data/movies.json "Trending Now in India" it tries the
 * Nxsha movie/search endpoints it can guess and records what came back:
 * status, content type, a body sample, JSON keys, image URLs and meta tags.
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
const PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true';
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
        const text = await res.text();
        return { status: res.status, finalUrl: res.url, ctype: res.headers.get('content-type') || '', text };
    } finally {
        clearTimeout(to);
    }
}

/** Keep a compact, inspectable summary of one response. */
function summarize(url, r) {
    const text = r.text || '';
    const isJson = /json/i.test(r.ctype) || /^\s*[\[{]/.test(text);
    const row = { url, status: r.status, finalUrl: r.finalUrl, ctype: r.ctype, bytes: text.length };
    if (r.status !== 200 || !text) return row;
    if (isJson) {
        try {
            const json = JSON.parse(text);
            row.json = text.length <= 30000 ? json : { _truncated: true, keys: Object.keys(json || {}) };
            row.keys = json && typeof json === 'object' ? Object.keys(json) : [];
        } catch {
            row.jsonParseError = true;
            row.sample = text.slice(0, 1200);
        }
        return row;
    }
    row.title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1]?.trim() || '';
    row.meta = [...text.matchAll(/<meta\s+[^>]*(?:property|name)="((?:og:|twitter:|description)[^"]*)"[^>]*content="([^"]*)"/gi)]
        .map((m) => [m[1], m[2].slice(0, 300)]);
    const nd = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(text);
    if (nd) row.nextData = nd[1].length <= 30000 ? nd[1] : nd[1].slice(0, 30000);
    row.imageUrls = [...new Set([...text.matchAll(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi)].map((m) => m[0]))].slice(0, 25);
    const hits = [];
    for (const m of text.matchAll(/"(overview|poster_path|backdrop_path|logo_path|release_date|first_air_date|runtime|genres|imdb_id|tmdb_id|vote_average)"\s*:\s*("[^"]{0,300}"|\d+(\.\d+)?|null|\[[^\]]{0,200}\])/g)) {
        hits.push(`${m[1]}=${m[2]}`);
        if (hits.length >= 30) break;
    }
    row.dataHits = hits;
    row.sample = text.slice(0, 600);
    return row;
}

async function main() {
    const movies = JSON.parse(readFileSync(MOVIES, 'utf8'));
    const row = movies.movies.find((r) => r.rowTitle === 'Trending Now in India');
    if (!row) throw new Error('Trending Now in India row not found');

    const report = { generatedAt: new Date().toISOString(), source: BASE, titles: [], generic: [] };

    for (const url of [`${BASE}/sitemap.xml`, `${BASE}/movie`, `${BASE}/search?q=Irumudi`, `${BASE}/api/search?query=Irumudi`]) {
        try {
            report.generic.push(summarize(url, await get(url)));
        } catch (e) {
            report.generic.push({ url, error: String(e?.message || e) });
        }
        await sleep(200);
    }

    for (const m of row.movies) {
        const entry = { id: m.id, title: m.title, tmdb_id: m.tmdb_id || null, imdb_id: m.imdb_id || null, probes: [] };
        const ids = [m.tmdb_id, m.imdb_id].filter(Boolean);
        const urls = [];
        for (const id of ids) {
            urls.push(
                `${BASE}/movie/${id}`,
                `${BASE}/api/movie/${id}`,
                `${BASE}/api/movie/${id}/details`,
                `${BASE}/api/movies/${id}`,
                `${BASE}/api/tmdb/movie/${id}`,
                `${BASE}/embed/movie/${id}?${PARAMS}`,
            );
        }
        urls.push(`${BASE}/search?q=${encodeURIComponent(m.title)}`, `${BASE}/api/search?query=${encodeURIComponent(m.title)}`);
        for (const url of urls) {
            try {
                entry.probes.push(summarize(url, await get(url)));
            } catch (e) {
                entry.probes.push({ url, error: String(e?.message || e) });
            }
            await sleep(150);
        }
        report.titles.push(entry);
        console.log(`${m.title}: ${entry.probes.map((p) => `${p.status ?? 'ERR'}`).join(' ')}`);
    }

    writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${OUT}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
