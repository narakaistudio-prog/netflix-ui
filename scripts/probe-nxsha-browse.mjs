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
  '/browse/anime?sort=first_air_date.desc&genres=16',
  '/anime',
  '/browse/tv-shows?sort=first_air_date.desc&genres=16',
  '/browse/tv-shows?sort=first_air_date.desc&genres=16&page=2',
  '/browse/tv-shows?sort=first_air_date.desc&genres=16&page=3',
  '/browse/tv-shows?sort=popularity.desc&genres=16',
  '/browse/movies?sort=primary_release_date.desc&genres=16',
  '/browse/movies?sort=release_date.desc&genres=16',
];

const API_CANDIDATES = [
  '/api/media?type=tv&sort=first_air_date.desc&genres=16&page=1',
  '/api/media?type=tv&sort_by=first_air_date.desc&with_genres=16&page=1',
  '/api/media?media_type=tv&sort=first_air_date.desc&genres=16&page=1',
  '/api/media?mediaType=tv&sort=first_air_date.desc&genres=16&page=1',
  '/api/media?type=anime&sort=first_air_date.desc&genres=16&page=1',
  '/api/media?category=anime&sort=first_air_date.desc&page=1',
  '/api/media?type=tv&sort=first_air_date.desc&genres=16&page=2',
  '/api/media?type=tv&sort=popularity.desc&genres=16&page=1',
  '/api/media?type=movie&sort=primary_release_date.desc&genres=16&page=1',
  '/api/media',
  '/api/media?page=1',
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

/** Cards in page order, with the heading that precedes them: [{ heading, cards: [...] }]. */
function sections(text) {
  const out = [];
  let current = { heading: '(top)', cards: [] };
  const re = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>|<a\b[^>]*href="(?:https:\/\/[^"/]+)?\/(tv|movie)\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      if (current.cards.length) out.push(current);
      current = { heading: m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), cards: [] };
      continue;
    }
    const inner = m[4];
    const img = (inner.match(/<img[^>]+src="(https:\/\/image\.tmdb\.org\/t\/p\/[^"]+)"/) || [])[1] || '';
    const alt = (inner.match(/<img[^>]+alt="([^"]*)"/) || [])[1] || '';
    const texts = inner.replace(/<svg\b[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, '\n').split('\n').map((t) => t.trim()).filter(Boolean);
    current.cards.push({ kind: m[2], id: m[3], alt, img, texts: texts.slice(0, 8) });
  }
  if (current.cards.length) out.push(current);
  return out;
}

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
  return { title, tvLinks: tvLinks.slice(0, 80), tvLinkCount: tvLinks.length, tmdbImages, sections: sections(text), anchors: anchors.slice(0, 1), flight: flight.map((f) => ({ bytes: f.bytes, sample: cut(f.sample, 1500) })), apiRoutes, nextData, scripts, textSample: cut(headSample, 1500) };
}

async function scanScripts(scriptUrls) {
  const out = [];
  for (const src of scriptUrls.filter((u) => /_next\/static\/chunks\//.test(u)).slice(0, 14)) {
    const url = src.startsWith('http') ? src : `${BASE}${src}`;
    const res = await get(url, '*/*');
    if (!res.text) {
      out.push({ url, status: res.status, error: res.error });
      continue;
    }
    const routes = uniq([...res.text.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/{}$?=&.%[\]]*)/g)].map((m) => m[1])).slice(0, 80);
    const concat = uniq([...res.text.matchAll(/["'`]\/api\/["'`]\s*[+,]\s*[A-Za-z0-9_.$]+/g)].map((m) => m[0])).slice(0, 20);
    const hints = uniq([...res.text.matchAll(/[A-Za-z0-9_\-/.]*(?:discover|browse|airing|on_the_air|trending|latest|first_air_date|sort_by)[A-Za-z0-9_\-/.?=&]*/g)].map((m) => m[0])).slice(0, 60);
    // Code around the media API call and its query building, if any.
    const around = [];
    for (const needle of ['/api/media', 'first_air_date.lte', 'first_air_date.desc', 'searchParams', 'URLSearchParams']) {
      let from = 0;
      for (let hit = 0; hit < 3; hit += 1) {
        const i = res.text.indexOf(needle, from);
        if (i === -1) break;
        around.push({ needle, code: res.text.slice(Math.max(0, i - 1200), i + 1200) });
        from = i + needle.length;
      }
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
    if (p.startsWith('/browse/tv-shows?sort=first_air_date.desc&genres=16') && entry.scripts) scriptUrls = entry.scripts;
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
