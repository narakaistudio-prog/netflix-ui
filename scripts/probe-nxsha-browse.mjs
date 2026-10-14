#!/usr/bin/env node
/**
 * Diagnostic probe for the nxsha anime listings used by the Fresh Drops builder
 * (scripts/build-crunchyroll-new-drops.mjs).
 *
 * The workspace sandbox cannot reach nxsha.space, so this runs on a hosted runner
 * and records what the listing pages really contain: card markup samples, the
 * Next.js flight (RSC) chunks that carry the listing data, every /api/ route the
 * page or its scripts mention, and the responses of a few candidate JSON routes.
 * The result is written to data/nxsha-browse-probe.json so it can be read from
 * the repository (runner logs are not readable from the sandbox).
 *
 * Usage: node scripts/probe-nxsha-browse.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'nxsha-browse-probe.json');
const BASE = 'https://nxsha.space';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PAGES = [
  '/browse/anime?sort=popularity.desc&genres=16',
  '/browse/anime?sort=first_air_date.desc&genres=16',
  '/browse/anime?sort=first_air_date.desc&genres=16&page=2',
  '/browse/anime',
  '/anime',
  '/browse/tv-shows?sort=first_air_date.desc&genres=16',
  '/',
];

const API_CANDIDATES = [
  '/api/browse/anime?sort=first_air_date.desc&genres=16&page=1',
  '/api/browse?type=anime&sort=first_air_date.desc&genres=16&page=1',
  '/api/discover/tv?sort_by=first_air_date.desc&with_genres=16&page=1',
  '/api/discover?type=tv&sort=first_air_date.desc&genres=16&page=1',
  '/api/anime?sort=first_air_date.desc&page=1',
  '/api/anime/latest',
  '/api/tv/airing-today',
  '/api/tv/on-the-air',
  '/api/trending/tv',
  '/api/trending',
  '/api/home',
  '/api/tv/1429',
  '/api/tv/1429/season/1',
];

async function get(url, accept) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: accept || 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    return { status: res.status, finalUrl: res.url, contentType: res.headers.get('content-type') || '', bytes: text.length, ms: Date.now() - started, text };
  } catch (err) {
    return { status: 0, error: String(err && err.message || err), ms: Date.now() - started, text: '' };
  }
}

const uniq = (list) => [...new Set(list)];
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

function describeHtml(text) {
  const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const tvLinks = uniq([...text.matchAll(/href="(?:https:\/\/[^"/]+)?\/(tv|movie)\/(\d+)[^"]*"/g)].map((m) => `${m[1]}/${m[2]}`));
  const tmdbImages = (text.match(/image\.tmdb\.org\/t\/p\//g) || []).length;
  // Sample card markup: the first anchors that point at a title.
  const anchors = [];
  for (const m of text.matchAll(/<a\b[^>]*href="(?:https:\/\/[^"/]+)?\/(?:tv|movie)\/\d+[^"]*"[^>]*>[\s\S]*?<\/a>/g)) {
    anchors.push(cut(m[0], 2500));
    if (anchors.length >= 3) break;
  }
  // Next.js flight chunks that carry data: look for ones mentioning dates or ratings.
  const flight = [];
  for (const m of text.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g)) {
    const chunk = m[1];
    if (/first_air_date|vote_average|release_date|poster_path|"results"/.test(chunk)) {
      flight.push({ bytes: chunk.length, sample: cut(chunk, 4000) });
    }
    if (flight.length >= 3) break;
  }
  const apiRoutes = uniq([...text.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/{}$?=&.%[\]]*)/g)].map((m) => m[1])).slice(0, 80);
  const nextData = uniq([...text.matchAll(/\/_next\/data\/[^"'\s]+/g)].map((m) => m[0])).slice(0, 20);
  const scripts = uniq([...text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])).slice(0, 40);
  const headSample = cut(text.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, ''), 6000);
  return { title, tvLinks: tvLinks.slice(0, 80), tvLinkCount: tvLinks.length, tmdbImages, anchors, flight, apiRoutes, nextData, scripts, textSample: headSample };
}

async function scanScripts(scriptUrls) {
  const out = [];
  for (const src of scriptUrls.slice(0, 14)) {
    const url = src.startsWith('http') ? src : `${BASE}${src}`;
    const res = await get(url, '*/*');
    if (!res.text) {
      out.push({ url, status: res.status, error: res.error });
      continue;
    }
    const routes = uniq([...res.text.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/{}$?=&.%[\]]*)/g)].map((m) => m[1])).slice(0, 80);
    const concat = uniq([...res.text.matchAll(/["'`]\/api\/["'`]\s*[+,]\s*[A-Za-z0-9_.$]+/g)].map((m) => m[0])).slice(0, 20);
    const hints = uniq([...res.text.matchAll(/[A-Za-z0-9_\-/.]*(?:discover|browse|airing|on_the_air|trending|latest|first_air_date|sort_by)[A-Za-z0-9_\-/.?=&]*/g)].map((m) => m[0])).slice(0, 60);
    // Code around the browse/discover fetch call, if any.
    const around = [];
    for (const m of res.text.matchAll(/fetch\([^)]{0,300}(?:discover|browse|sort)[^)]{0,300}\)/g)) {
      around.push(cut(m[0], 700));
      if (around.length >= 4) break;
    }
    out.push({ url, status: res.status, bytes: res.bytes, routes, concat, hints, around });
  }
  return out;
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), base: BASE, pages: [], api: [], scripts: [] };
  let scriptUrls = [];
  for (const p of PAGES) {
    const res = await get(`${BASE}${p}`);
    const entry = { path: p, status: res.status, finalUrl: res.finalUrl, contentType: res.contentType, bytes: res.bytes, ms: res.ms, error: res.error };
    if (res.text && /html/i.test(res.contentType || '')) Object.assign(entry, describeHtml(res.text));
    else if (res.text) entry.sample = cut(res.text, 3000);
    report.pages.push(entry);
    if (p.startsWith('/browse/anime?sort=first_air_date') && entry.scripts) scriptUrls = entry.scripts;
    console.log(`${p}: ${res.status} ${res.bytes}b tv-links=${entry.tvLinkCount ?? '-'} api=${(entry.apiRoutes || []).length}`);
  }
  for (const p of API_CANDIDATES) {
    const res = await get(`${BASE}${p}`, 'application/json,*/*;q=0.8');
    report.api.push({ path: p, status: res.status, contentType: res.contentType, bytes: res.bytes, ms: res.ms, error: res.error, sample: cut(res.text || '', /json/i.test(res.contentType || '') ? 5000 : 400) });
    console.log(`${p}: ${res.status} ${res.contentType} ${res.bytes}b`);
  }
  report.scripts = await scanScripts(scriptUrls);
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
