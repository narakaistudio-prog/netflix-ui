#!/usr/bin/env node
/**
 * "Fresh Drops" builder for the Crunchyroll (anime) page.
 *
 * 1. Reads the nxsha anime listings (several sorts and pages).
 * 2. Keeps a state file, data/crunchyroll-new-drops.json, with the first date each
 *    title was seen (firstSeen). The very first run is a baseline: everything found
 *    then is marked baseline=true and never counts as "new" (no bell flood).
 * 3. Any title seen later for the first time gets firstSeen = today and becomes a
 *    fresh drop (bell notification, see lib/notifications.ts).
 * 4. Rewrites the block between /*CR_DROPS_START*\/ and /*CR_DROPS_END*\/ in
 *    assets/crunchyroll/crunchyroll.html. That block always tops the home rails
 *    with the "Fresh Drops" row:
 *      - titles first seen after the baseline run when there are any, else
 *      - the newest titles of the drop pool, so the row is never blank.
 *    The row subtitle says which of the two it is, and every card gets a NEW flag
 *    plus the day it was first seen.
 *
 * Safety: if no cards can be parsed at all, the script exits with code 1 and does
 * not touch any file, so the rail is never blanked by a site change.
 *
 * Modes:
 *   (default)      scrape nxsha, update the state file and the page block
 *   --from-state   no network: rebuild the page block from the state file
 *                  (used by `npm run build:web`, so a static export always ships
 *                  a filled Fresh Drops row)
 *   --check        no writes: exit 1 when the page block is out of sync
 *   With --from-state, --dry-run prints what the row would contain instead of writing.
 *   --dry-run      scrape but write nothing
 *
 * Env:   DROPS_DATE=YYYY-MM-DD  override "today" (IST by default)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// DROPS_STATE_FILE points the bake at another state file (previews, tests).
const STATE_FILE = path.resolve(
  process.env.DROPS_STATE_FILE || path.join(ROOT, 'data', 'crunchyroll-new-drops.json'),
);
const REGISTRY_FILE = path.join(ROOT, 'data', 'nxsha-titles.json');
const HTML_FILE = path.join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const START = '/*CR_DROPS_START*/';
const END = '/*CR_DROPS_END*/';
const MAX_ROWS = 12;
const PAGES = 3;
const DRY_RUN = process.argv.includes('--dry-run');
const FROM_STATE = process.argv.includes('--from-state');
const CHECK = process.argv.includes('--check');

const ROW_TITLE = 'Fresh Drops';

/**
 * Titles the public rail never shows.
 *
 * The nxsha anime listings carry adult/ecchi entries alongside mainstream shows
 * (the baseline pool alone had Harem Camp!, Overflow, …). The rail is a hero row
 * on the Crunchyroll page, so those titles are kept off it. They stay in the
 * state file (the drop record and the bell notification source) — this filter
 * only decides what the row displays.
 */
const RAIL_BLOCKED_IDS = new Set([
  'tv:70998', // Souryo to Majiwaru Shikiyoku no Yoru ni...
  'tv:95897', // Overflow
  'tv:204269', // Caressing My Hibernating Bear
  'tv:207840', // Harem Camp!
]);
const RAIL_BLOCKED_TITLE = /\b(harem camp|overflow|hibernating bear|majiwaru|shikiyoku|hentai|ecchi|nsfw)\b/i;

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

/** Listings come out of nxsha with HTML entities ("Atashin&#x27;chi"). */
export function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => (
      { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name.toLowerCase()]
    ));
}

/** Loose title key: case, punctuation and spacing are not identity. */
export function titleKey(value) {
  return decodeEntities(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Parse one listing page into cards {kind,id,title,img,rating,year}. */
export function parseListing(text) {
  const cards = [];
  const add = (c) => {
    if (c.kind && c.id && c.title && c.img) cards.push({ ...c, title: decodeEntities(c.title).trim() });
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

export function dropKey(item) {
  return `drop-${item.kind}-${item.id}`;
}

/**
 * Pick the rail for the "Fresh Drops" row.
 *
 * Titles first seen after the baseline run win. When the pool has none yet
 * (e.g. right after the baseline run) the newest pool titles are shown instead,
 * so the row always has content. Skipped: adult listings (RAIL_BLOCKED_*),
 * duplicate titles, and titles the app already routes (passed in as
 * knownTitles) — a drop card has no playback route, so it must not repeat a
 * show that already has one.
 */
export function selectRailItems(items, limit = MAX_ROWS, knownTitles = new Set()) {
  const usable = Object.entries(items || {})
    // Older state entries kept the raw entity in the title ("Atashin&#x27;chi").
    .map(([stateKey, item]) => ({ ...item, title: decodeEntities(item.title).trim(), stateKey, key: dropKey(item) }))
    .filter((item) => item.kind && item.id && item.title && item.img)
    .filter((item) => !RAIL_BLOCKED_IDS.has(item.stateKey) && !RAIL_BLOCKED_TITLE.test(item.title))
    .filter((item) => !knownTitles.has(titleKey(item.title)));

  const newestFirst = (a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0);
  const fresh = usable.filter((item) => !item.baseline).sort(newestFirst);
  const mode = fresh.length ? 'new' : 'pool';
  const candidates = mode === 'new' ? fresh : [...usable].sort(newestFirst);

  const titles = new Set();
  const rail = [];
  for (const item of candidates) {
    const key = titleKey(item.title);
    if (titles.has(key)) continue;
    titles.add(key);
    rail.push(item);
    if (rail.length === limit) break;
  }
  return { mode, items: rail };
}

/** The page block between the CR_DROPS markers. */
export function dropsBlock({ mode, items }) {
  // Data is embedded as JSON; escape "</" so it can't close the script tag early.
  const data = JSON.stringify(
    items.map((item) => ({
      key: item.key,
      kind: item.kind,
      id: item.id,
      title: item.title,
      img: item.img,
      rating: item.rating || '',
      year: item.year || '',
      firstSeen: item.firstSeen || '',
    })),
  ).replace(/<\//g, '<\\/');
  const subtitle = mode === 'new' ? 'Just added to the catalog' : 'Newest in the catalog';

  return [
    START,
    '/* Written by scripts/build-crunchyroll-new-drops.mjs — do not edit by hand. */',
    `var CR_NEW_DROPS=${data};`,
    `var CR_NEW_DROPS_MODE='${mode}';`,
    '(function(){',
    '  if(!CR_NEW_DROPS.length)return;',
    '  window.CR_NX_DROPS={};',
    '  var freshKeys=[],i,d;',
    '  for(i=0;i<CR_NEW_DROPS.length;i++){',
    '    d=CR_NEW_DROPS[i];',
    "    if(!d||!d.key||!d.title||!d.img)continue;",
    // drop:true keeps them out of the browse grid / search — a drop has no Nxsha route yet.
    "    shows[d.key]={title:d.title,year:d.year||'',rating:d.rating||'-',genres:['anime'],audio:'Sub & Dub',img:d.img,type:d.kind==='movie'?'Movie':'TV',drop:true};",
    "    window.CR_NX_DROPS[d.key]={id:d.id,kind:d.kind,seasons:{},added:d.firstSeen||'',mode:CR_NEW_DROPS_MODE};",
    '    freshKeys.push(d.key);',
    '  }',
    '  if(!freshKeys.length)return;',
    `  rows.unshift({title:'${ROW_TITLE}',subtitle:'${subtitle}',fresh:true,ranked:false,keys:freshKeys});`,
    '})();',
    END,
  ].join('\n');
}

function readHtml() {
  return fs.readFileSync(HTML_FILE, 'utf8');
}

/** Replace the marked block in the page. Returns null when the markers are gone. */
export function replaceDropsBlock(html, block) {
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s === -1 || e === -1 || e < s) return null;
  return html.slice(0, s) + block + html.slice(e + END.length);
}

/** Titles the app already routes — a drop card must never repeat one. */
function routedTitles() {
  const registry = readJson(REGISTRY_FILE, {});
  return new Set(Object.values(registry).map((entry) => titleKey(entry?.title || '')).filter(Boolean));
}

/** The block the current state file should produce. */
function blockFromState(state) {
  return dropsBlock(selectRailItems(state?.items || {}, MAX_ROWS, routedTitles()));
}

function currentBlock(html) {
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s === -1 || e === -1 || e < s) return null;
  return html.slice(s, e + END.length);
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

async function main() {
  // Bake (no network) — used by `npm run build:web` and local refreshes.
  if (FROM_STATE || CHECK) {
    const state = readJson(STATE_FILE, null);
    if (!state || !state.items) {
      console.error(`No drop state at ${path.relative(ROOT, STATE_FILE)}. Run the daily job first.`);
      process.exit(1);
    }
    const block = blockFromState(state);
    const html = readHtml();
    const rail = selectRailItems(state.items, MAX_ROWS, routedTitles());

    if (DRY_RUN) {
      console.log(JSON.stringify({ mode: rail.mode, items: rail.items }, null, 2));
      return;
    }

    if (CHECK) {
      if (currentBlock(html) !== block) {
        console.error('Crunchyroll Fresh Drops block is out of sync. Run: node scripts/build-crunchyroll-new-drops.mjs --from-state');
        process.exit(1);
      }
      console.log(`Fresh Drops block is in sync (${rail.items.length} cards, mode: ${rail.mode}).`);
      return;
    }

    const next = replaceDropsBlock(html, block);
    if (next === null) throw new Error('CR_DROPS markers not found in crunchyroll.html');
    fs.writeFileSync(HTML_FILE, next);
    console.log(`baked ${rail.items.length} Fresh Drops cards (mode: ${rail.mode}) into ${path.relative(ROOT, HTML_FILE)}`);
    return;
  }

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
  const rail = selectRailItems(items, MAX_ROWS, routedTitles());
  const marked = rail.items.map((i) => ({ ...i, key: dropKey(i) }));
  const nextState = { updated: day, items };
  console.log(
    `baseline run: ${baselineRun}; new today: ${newCount}; rail: ${marked.length} cards (mode: ${rail.mode}); ` +
      `pool: ${Object.values(items).length} tracked titles`,
  );

  if (DRY_RUN) {
    console.log(JSON.stringify({ mode: rail.mode, items: marked.slice(0, 3) }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2) + '\n');

  const html = readHtml();
  const block = dropsBlock({ mode: rail.mode, items: marked });
  const next = replaceDropsBlock(html, block);
  if (next === null) throw new Error('CR_DROPS markers not found in crunchyroll.html');
  fs.writeFileSync(HTML_FILE, next);
  console.log(`wrote ${path.relative(ROOT, STATE_FILE)} and ${path.relative(ROOT, HTML_FILE)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
