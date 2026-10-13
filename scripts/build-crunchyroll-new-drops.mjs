#!/usr/bin/env node
/**
 * Daily "Fresh Drops" builder for the Crunchyroll (anime) page.
 *
 * 1. Reads the nxsha anime listings (several sorts and pages).
 * 2. Keeps a state file, data/crunchyroll-new-drops.json, with the first date each
 *    title was seen (firstSeen). The very first run is a baseline: everything found
 *    then is marked baseline=true and never counts as "new" (no bell flood).
 * 3. Any title seen later for the first time gets firstSeen = today and becomes a
 *    fresh drop (rail row + bell notification).
 * 4. Rewrites the block between /*CR_DROPS_START*\/ and /*CR_DROPS_END*\/ in
 *    assets/crunchyroll/crunchyroll.html.
 *
 * Safety: if no cards can be parsed at all, the script exits with code 1 and does
 * not touch any file, so the rail is never blanked by a site change.
 *
 * Usage: node scripts/build-crunchyroll-new-drops.mjs [--dry-run]
 * Env:   DROPS_DATE=YYYY-MM-DD  override "today" (IST by default)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = path.join(ROOT, 'data', 'crunchyroll-new-drops.json');
const REGISTRY_FILE = path.join(ROOT, 'data', 'nxsha-titles.json');
const HTML_FILE = path.join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const START = '/*CR_DROPS_START*/';
const END = '/*CR_DROPS_END*/';
const MAX_ROWS = 12;
const PAGES = 3;
const DRY_RUN = process.argv.includes('--dry-run');

const SOURCES = [
  'https://nxsha.space/browse/anime?sort=popularity.desc&genres=16',
  'https://nxsha.space/browse/anime?sort=first_air_date.desc&genres=16',
  'https://nxsha.space/browse/anime?sort=vote_average.desc&genres=16&vote_count.gte=500',
];

function today() {
  if (process.env.DROPS_DATE) return process.env.DROPS_DATE;
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; netflix-ui-drops/1.0)', accept: 'text/html' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Parse one listing page into cards {kind,id,title,img,rating,year}. */
export function parseListing(text) {
  const cards = [];
  const add = (c) => {
    if (c.kind && c.id && c.title && c.img) cards.push(c);
  };

  // Markdown-style cards: [![Title](img) ... rating ... Title ... year](https://nxsha.space/tv/ID)
  const md = /\[!\[([^\]]*)\]\((https:\/\/image\.tmdb\.org\/t\/p\/w500\/[^)\s]+)\)([\s\S]*?)\]\((?:https:\/\/nxsha\.space)?\/(tv|movie)\/(\d+)\)/g;
  for (const m of text.matchAll(md)) {
    const tokens = m[3].split(/\\+\s*\n/).map((s) => s.trim()).filter(Boolean);
    const rating = tokens.find((t) => /^\d(\.\d)?$/.test(t)) || '';
    const year = (tokens.find((t) => /^(19|20)\d{2}$/.test(t)) || '').slice(0, 4);
    const title = tokens.find((t) => t !== rating && t !== year) || m[1];
    add({ kind: m[4], id: m[5], title, img: m[2], rating, year });
  }
  if (cards.length) return cards;

  // HTML-style cards: <a href="/tv/ID" ...> <img alt="Title" src="tmdb"> ... </a>
  const html = /<a[^>]*href="(?:https:\/\/nxsha\.space)?\/(tv|movie)\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of text.matchAll(html)) {
    const inner = m[3];
    const img = (inner.match(/src="(https:\/\/image\.tmdb\.org\/t\/p\/w500\/[^"]+)"/) || [])[1];
    const alt = (inner.match(/alt="([^"]*)"/) || [])[1] || '';
    const rating = (inner.match(/\b(\d\.\d)\b/) || [])[1] || '';
    const year = (inner.match(/\b((?:19|20)\d{2})\b/) || [])[1] || '';
    const title = alt || (inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    add({ kind: m[1], id: m[2], title, img, rating, year });
  }
  return cards;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function scrape() {
  const found = new Map();
  let okPages = 0;
  for (const base of SOURCES) {
    for (let page = 1; page <= PAGES; page++) {
      const url = page === 1 ? base : `${base}&page=${page}`;
      try {
        const cards = parseListing(await fetchText(url));
        if (!cards.length) break;
        okPages++;
        for (const c of cards) found.set(`${c.kind}:${c.id}`, c);
      } catch (err) {
        console.warn(`skip ${url}: ${err.message}`);
        break;
      }
    }
  }
  return { found, okPages };
}

function keyFor(item) {
  return `drop-${item.kind}-${item.id}`;
}

async function main() {
  const day = today();
  const { found, okPages } = await scrape();
  if (found.size === 0) {
    console.error('No cards parsed from any source. Leaving files untouched.');
    process.exit(1);
  }
  console.log(`parsed ${found.size} unique titles from ${okPages} pages`);

  const state = readJson(STATE_FILE, null);
  // First run (no file, or an empty file) is the baseline: nothing found then is "new".
  const baselineRun = !state || !state.items || Object.keys(state.items).length === 0;
  const items = state?.items || {};

  // Titles already on the route registry are not drops (they already have a page).
  const registry = readJson(REGISTRY_FILE, {});
  const known = new Set(Object.values(registry).map((r) => `${r.kind}:${r.id}`));

  for (const [id, c] of found) {
    if (known.has(id)) continue;
    if (items[id]) {
      items[id] = { ...items[id], title: c.title, img: c.img, rating: c.rating, year: c.year };
    } else {
      items[id] = {
        kind: c.kind,
        id: c.id,
        title: c.title,
        img: c.img,
        rating: c.rating,
        year: c.year,
        firstSeen: day,
        baseline: baselineRun,
      };
    }
  }

  const newCount = Object.values(items).filter((i) => !i.baseline && i.firstSeen === day).length;
  const fresh = Object.values(items)
    .filter((i) => !i.baseline)
    .sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0))
    .slice(0, MAX_ROWS)
    .map((i) => ({ ...i, key: keyFor(i) }));

  const nextState = { updated: day, items };
  console.log(`baseline run: ${baselineRun}; new today: ${newCount}; rail items: ${fresh.length}`);

  if (DRY_RUN) {
    console.log(JSON.stringify(fresh.slice(0, 3), null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2) + '\n');

  // Data is embedded as JSON; escape "</" so it can't close the script tag early.
  const data = JSON.stringify(fresh).replace(/<\//g, '<\\/');
  const block = [
    START,
    `var CR_NEW_DROPS=${data};`,
    '(function(){',
    '  if(!CR_NEW_DROPS.length)return;',
    '  window.CR_NX_DROPS={};',
    '  CR_NEW_DROPS.forEach(function(d){',
    "    shows[d.key]={title:d.title,year:d.year||'',rating:d.rating||'-',genres:['anime'],audio:'Sub & Dub',img:d.img,type:d.kind==='movie'?'Movie':'TV'};",
    "    CR_NX_DROPS[d.key]={id:d.id,kind:d.kind,seasons:{}};",
    '  });',
    "  rows.unshift({title:'Fresh Drops',ranked:false,keys:CR_NEW_DROPS.map(function(d){return d.key})});",
    '})();',
    END,
  ].join('\n');

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s === -1 || e === -1 || e < s) {
    throw new Error('CR_DROPS markers not found in crunchyroll.html');
  }
  const next = html.slice(0, s) + block + html.slice(e + END.length);
  fs.writeFileSync(HTML_FILE, next);
  console.log(`wrote ${path.relative(ROOT, STATE_FILE)} and ${path.relative(ROOT, HTML_FILE)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
