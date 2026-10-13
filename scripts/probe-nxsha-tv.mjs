#!/usr/bin/env node
// PROBE (temporary): find where nxsha serves TV season 2+ episode lists.
// Prints findings to the job log only; writes nothing.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://nxsha.space';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function raw(url) {
    try {
        const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*' } });
        const text = await res.text();
        return { status: res.status, text, ctype: res.headers.get('content-type') || '' };
    } catch (e) {
        return { status: `ERR ${e.message}`, text: '', ctype: '' };
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const movies = JSON.parse(readFileSync(resolve(ROOT, 'data', 'movies.json'), 'utf8'));
const tvIds = [];
for (const r of movies.movies) for (const m of r.movies) if (m.mediaType === 'tv' && m.tmdb_id) tvIds.push(String(m.tmdb_id));
const ids = ['247769', ...tvIds.filter((x) => x !== '247769').slice(0, 2)];
console.log(`PROBE ids: ${ids.join(', ')}`);

const id = '247769';
const page = await raw(`${BASE}/tv/${id}`);
console.log(`PROBE page /tv/${id} status=${page.status} len=${page.text.length}`);
const html = page.text;
console.log(`PROBE "Season " occurrences: ${(html.match(/Season \d/g) || []).length}`);
console.log(`PROBE data-season / season attrs: ${JSON.stringify([...new Set(html.match(/data-[a-z-]*season[a-z-]*="[^"]{0,40}"/gi) || [])].slice(0, 12))}`);
const seasonCtx = [...html.matchAll(/season/gi)].slice(0, 12).map((m) => html.slice(Math.max(0, m.index - 80), m.index + 120).replace(/\s+/g, ' '));
seasonCtx.forEach((c, i) => console.log(`PROBE ctx[${i}]: ${c}`));
const apiLike = [...new Set(html.match(/["'`](\/[a-zA-Z0-9_\-/.?=&{}$]*(api|season|episode)[a-zA-Z0-9_\-/.?=&{}$]*)["'`]/gi) || [])];
console.log(`PROBE api-like paths in page: ${JSON.stringify(apiLike.slice(0, 40))}`);
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
console.log(`PROBE script srcs (${scripts.length}): ${JSON.stringify(scripts.slice(0, 20))}`);
const nextData = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
console.log(`PROBE __NEXT_DATA__: ${nextData ? nextData[1].length + ' chars' : 'none'}`);
if (nextData) {
    const j = nextData[1];
    const hits = [...j.matchAll(/season/gi)].slice(0, 6).map((m) => j.slice(Math.max(0, m.index - 60), m.index + 160));
    hits.forEach((h, i) => console.log(`PROBE next[${i}]: ${h}`));
}

// Watch page: does its raw HTML link to other episodes of season 2?
const watch = await raw(`${BASE}/watch/tv/${id}/2/1`);
const links = [...new Set((watch.text.match(new RegExp(`/watch/tv/${id}/\\d+/\\d+`, 'g')) || []))];
console.log(`PROBE watch raw status=${watch.status} len=${watch.text.length} episode links: ${JSON.stringify(links.slice(0, 30))}`);
const embed = await raw(`${BASE}/embed/tv/${id}/2/1?server=GbruHindi&lang=hi&sub=hi&color=netflix`);
const embedLinks = [...new Set((embed.text.match(/[^"' ]*\/tv\/[^"' ]*/g) || []))];
console.log(`PROBE embed status=${embed.status} len=${embed.text.length} tv-paths: ${JSON.stringify(embedLinks.slice(0, 15))}`);

// Candidate season endpoints.
const candidates = [
    `/api/tv/${id}/season/2`,
    `/api/tv/${id}/seasons/2`,
    `/api/tv/${id}?season=2`,
    `/api/tv/${id}/2`,
    `/api/season/${id}/2`,
    `/api/episodes/${id}/2`,
    `/tv/${id}/season-2`,
    `/tv/${id}/seasons/2`,
    `/tv/${id}?s=2`,
    `/season/${id}/2`,
    `/tv/${id}/2/episodes`,
    `/api/tv/${id}/season/2/episodes`,
];
for (const c of candidates) {
    const r = await raw(`${BASE}${c}`);
    console.log(`PROBE cand ${c} -> ${r.status} ${r.ctype.split(';')[0]} len=${r.text.length} ${r.status === 200 ? JSON.stringify(r.text.slice(0, 160)) : ''}`);
    await sleep(200);
}

// Same-origin JS bundles: look for API paths.
const jsUrls = scripts.filter((s) => !/^https?:\/\/(?!nxsha)/.test(s)).map((s) => (s.startsWith('http') ? s : `${BASE}${s}`)).slice(0, 10);
const apis = new Set();
for (const u of jsUrls) {
    const r = await raw(u);
    for (const m of r.text.matchAll(/["'`](\/api\/[a-zA-Z0-9_\-/.{}$]*)["'`]/g)) apis.add(m[1]);
    for (const m of r.text.matchAll(/["'`]([a-zA-Z0-9_\-/.{}$]*season[a-zA-Z0-9_\-/.{}$]*)["'`]/gi)) apis.add(m[1]);
}
console.log(`PROBE js api/season strings (${apis.size}): ${JSON.stringify([...apis].slice(0, 60))}`);

// Other TV ids: season count and season-2 availability on the page.
for (const other of ids.slice(1)) {
    const p = await raw(`${BASE}/tv/${other}`);
    const seasonsText = /(\d+)\s+seasons?/i.exec(p.text);
    console.log(`PROBE other tv ${other}: status=${p.status} seasons-text=${seasonsText ? seasonsText[0] : 'none'} eps-text=${(/(\d+)\s+episodes/i.exec(p.text) || [''])[0]}`);
    await sleep(300);
}
