#!/usr/bin/env node
/**
 * "Fresh Drops" builder for the Crunchyroll (anime) page.
 *
 * 1. Reads the nxsha anime listings (several sorts and pages) plus the DeadToons
 *    release schedule (data/deadtoons-schedule.json — scripts/harvest-deadtoons-schedule.mjs).
 * 2. Keeps a state file, data/crunchyroll-new-drops.json, with the first date each
 *    title was seen (firstSeen). The very first run is a baseline: everything found
 *    then is marked baseline=true and never counts as "new" (no bell flood).
 * 3. Any title seen later for the first time gets firstSeen = today and becomes a
 *    fresh drop (bell notification, see lib/notifications.ts).
 * 4. Rewrites the block between /*CR_DROPS_START*\/ and /*CR_DROPS_END*\/ in
 *    assets/crunchyroll/crunchyroll.html. That block always tops the home rails
 *    with the "Fresh Drops" row:
 *      - the DeadToons schedule first — today's episodes, then the upcoming ones —
 *        then the newest pool titles, so the row is never blank.
 *    Every schedule entry the row shows is Nxsha-backed (the harvester only keeps
 *    entries whose Nxsha id it verified), so every card plays. A schedule title
 *    that the catalog already carries reuses the catalog card (poster, episode
 *    guide, playback route); the rest become rail-only drop cards with the
 *    verified Nxsha id, so they play too.
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
 *        DROPS_STATE_FILE       point the bake at another nxsha state file
 *        DROPS_SCHEDULE_FILE    point the bake at another DeadToons schedule file
 *        DROPS_HTML_FILE        write the baked page somewhere else
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
const SCHEDULE_FILE = path.resolve(
  process.env.DROPS_SCHEDULE_FILE || path.join(ROOT, 'data', 'deadtoons-schedule.json'),
);
// DROPS_SCHEDULE_FILE / DROPS_HTML_FILE let previews and tests bake elsewhere.
const HTML_FILE = path.resolve(
  process.env.DROPS_HTML_FILE || path.join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'),
);
const START = '/*CR_DROPS_START*/';
const END = '/*CR_DROPS_END*/';
const MAX_ROWS = 12;
// The Drops Library keeps every title the Fresh Drops pool has ever seen
// (the nxsha state never shrinks), capped only as a safety valve.
const ARCHIVE_MAX = 200;
const LIBRARY_ROW_TITLE = 'Drops Library';
const LIBRARY_ROW_SUBTITLE = 'Everything Fresh Drops ever featured - searchable too';
const PAGES = 3;
const DRY_RUN = process.argv.includes('--dry-run');
const FROM_STATE = process.argv.includes('--from-state');
const CHECK = process.argv.includes('--check');

const ROW_TITLE = 'Fresh Drops';

/** DeadToons finds lead the row: they are the daily "new anime" signal. */
const SOURCE_RANK = { deadtoons: 0, nxsha: 1 };
/** Shorter-than-this containment matches are too weak to call a title "known". */
const KNOWN_MATCH_MIN = 5;

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
    .replace(/&(amp|lt|gt|quot|apos|nbsp)\b;?/gi, (_, name) => (
      { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name.toLowerCase()]
    ));
}

/** Loose title key: case, punctuation and spacing are not identity. */
export function titleKey(value) {
  return decodeEntities(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Does the app already carry this title?
 *
 * Drops are titles the catalog has no route for, so the row must not repeat a
 * show that is already playable — including a substring match, because listing
 * titles trail extra words ("Attack on Titan Movie" is Attack on Titan).
 */
export function isKnownTitle(title, knownTitles) {
  const key = titleKey(title);
  if (!key) return true;
  if (knownTitles.has(key)) return true;
  for (const known of knownTitles) {
    if (known.length < KNOWN_MATCH_MIN || key.length < KNOWN_MATCH_MIN) continue;
    if (key.includes(known) || known.includes(key)) return true;
  }
  return false;
}

/** Minutes past midnight for "1:30 PM" — the schedule's clock. */
export function clockMinutes(time) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(time || ''));
  if (!m) return 0;
  let hour = Number.parseInt(m[1], 10) % 12;
  if ((m[3] || '').toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number.parseInt(m[2], 10);
}

/** Rail key for a title only the schedule carries (no catalog entry). */
export function dropKey(title) {
  return `drop-sch-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/**
 * One rail pool from both sources: the DeadToons release schedule (the daily
 * "fresh drop" signal) and the nxsha drop state (the fallback pool).
 *
 * Every entry carries a real Nxsha id — that is what makes the row playable.
 * A schedule title the catalog already carries keeps the catalog key, so its
 * card reuses the catalog poster and its episode guide.
 */
export function collectRailPool(nxshaState, scheduleState, catalogKeys = new Map()) {
  const pool = [];
  for (const [stateKey, item] of Object.entries(nxshaState?.items || {})) {
    if (!item?.title) continue;
    pool.push({
      source: 'nxsha',
      stateKey,
      key: `drop-${item.kind}-${item.id}`,
      kind: item.kind,
      id: item.id,
      title: decodeEntities(item.title).trim(),
      img: item.img || '',
      rating: item.rating || '',
      year: item.year || '',
      firstSeen: item.firstSeen || '',
      baseline: !!item.baseline,
    });
  }
  for (const item of scheduleState?.items || []) {
    // Playable only: the harvester verifies the Nxsha id before storing an entry
    // (an unverified id opened a 404 player in the old listing-based drop).
    if (!item?.title || !item?.nx?.id) continue;
    const title = decodeEntities(item.title).trim();
    const catalogKey = catalogKeys.get(titleKey(title));
    pool.push({
      source: 'deadtoons',
      stateKey: `schedule:${item.key || item.slug || title}`,
      key: catalogKey || dropKey(title),
      kind: item.nx.kind === 'movie' ? 'movie' : 'tv',
      id: String(item.nx.id),
      seasons: item.nx.seasons || {},
      title,
      img: item.img || '',
      rating: '',
      year: '',
      firstSeen: item.date || scheduleState?.updated || '',
      fresh: !!item.today,
      baseline: false,
      scheduled: true,
      slot: item.today ? 0 : 1,
      // Fixed-width minutes: 'date|minutes' sorts correctly as a string and does
      // not depend on collation rules (localeCompare ignores the colon).
      order: `${item.date || ''}|${String(clockMinutes(item.time)).padStart(4, '0')}`,
      season: item.season ?? null,
      episode: item.episode ?? null,
      verb: item.today ? 'Added' : 'Airs',
      // Episode art + details for this title's own episode list (the rail's
      // detail view). Catalog titles keep theirs from NX_EPISODE_DATA.
      ...(item.guide ? { guide: item.guide } : {}),
      url: item.url || '',
    });
  }
  return pool;
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

/**
 * Pick the rail for the "Fresh Drops" row.
 *
 * Order: today's DeadToons episodes first (by clock), then the upcoming ones (by
 * date), then — only if slots are left — the newest nxsha pool titles. The row
 * therefore always has content, and every card has a real Nxsha id.
 *
 * "fresh" (the NEW flag on the card) marks the episodes released today.
 *
 * Skipped: adult listings (RAIL_BLOCKED_*), duplicate titles, and — for the pool
 * filler only — titles the catalog already carries (the schedule may repeat a
 * catalog title on purpose: that is a new episode of a show we already carry,
 * and its card reuses the catalog entry).
 */
export function selectRailItems(pool, limit = MAX_ROWS, knownTitles = new Set()) {
  const usable = (pool || [])
    .map((item) => ({ ...item, title: decodeEntities(item.title).trim() }))
    .filter((item) => item.title && item.kind && item.id)
    .filter((item) => !RAIL_BLOCKED_IDS.has(item.stateKey) && !RAIL_BLOCKED_TITLE.test(item.title))
    .filter((item) => item.scheduled || !isKnownTitle(item.title, knownTitles));

  const newestFirst = (a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0);
  // Within the same first-sighting day the listing's own last-update date decides,
  // then DeadToons (the daily finds) ahead of nxsha, then the title.
  const siteOrder = (a, b) => ((a.siteUpdated || '') < (b.siteUpdated || '') ? 1 : (a.siteUpdated || '') > (b.siteUpdated || '') ? -1 : 0);
  const compare = (a, b) =>
    newestFirst(a, b) ||
    siteOrder(a, b) ||
    (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) ||
    (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

  const bySlot = (a, b) =>
    (a.scheduled ? a.slot : 2) - (b.scheduled ? b.slot : 2) ||
    (a.scheduled && b.scheduled ? String(a.order).localeCompare(String(b.order)) : 0);
  const fresh = usable.filter((item) => !item.baseline && (item.scheduled ? item.slot === 0 : true)).sort(compare);
  const upcoming = usable.filter((item) => item.scheduled && item.slot === 1).sort(compare);
  const rest = usable.filter((item) => !item.scheduled && item.baseline).sort(compare);
  const freshKeys = new Set(fresh.map((item) => item.stateKey));
  const ordered = [...fresh, ...upcoming, ...rest].sort((a, b) => bySlot(a, b));

  const titles = new Set();
  const rail = [];
  for (const item of ordered) {
    const key = titleKey(item.title);
    if (!key || titles.has(key)) continue;
    titles.add(key);
    rail.push({ ...item, fresh: freshKeys.has(item.stateKey) });
    if (rail.length === limit) break;
  }
  const mode = fresh.length ? (upcoming.length ? 'today' : 'new') : upcoming.length ? 'upcoming' : 'pool';
  return { mode, items: rail };
}

/**
 * The Drops Library: every playable drop the pool has ever seen, minus what
 * today's rail already shows. Newest sightings first - this is what keeps a
 * title around (and searchable) after it rotates out of the Fresh Drops row.
 */
export function selectArchiveItems(pool, railItems, limit = ARCHIVE_MAX) {
  const railKeys = new Set((railItems || []).map((item) => item.stateKey));
  const seen = new Set();
  return (pool || [])
    .filter((item) => item.title && item.kind && item.id)
    .filter((item) => !RAIL_BLOCKED_IDS.has(item.stateKey) && !RAIL_BLOCKED_TITLE.test(item.title))
    .filter((item) => !railKeys.has(item.stateKey))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .sort((a, b) =>
      a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : a.title < b.title ? -1 : 1,
    )
    .slice(0, limit);
}

/** The page block between the CR_DROPS markers. */
export function dropsBlock({ mode, items }, archive = []) {
  // Data is embedded as JSON; escape "</" so it can't close the script tag early.
  const dropJson = (item) => ({
    key: item.key,
    kind: item.kind,
    id: item.id,
    title: item.title,
    img: item.img || '',
    rating: item.rating || '',
    year: item.year || '',
    firstSeen: item.firstSeen || '',
    fresh: !!item.fresh,
    src: item.source,
    seasons: item.seasons || {},
    verb: item.verb || '',
    season: item.season ?? null,
    episode: item.episode ?? null,
    ...(item.guide ? { guide: item.guide } : {}),
  });
  const data = JSON.stringify(items.map(dropJson)).replace(/<\//g, '<\\/');
  const archiveData = JSON.stringify(archive.map(dropJson)).replace(/<\//g, '<\\/');
  const subtitle =
    mode === 'today' ? "Today's DeadToons releases"
      : mode === 'upcoming' ? 'Coming up on DeadToons'
        : mode === 'new' ? 'Just added to the catalog'
          : 'Newest in the catalog';

  return [
    START,
    '/* Written by scripts/build-crunchyroll-new-drops.mjs — do not edit by hand. */',
    `var CR_NEW_DROPS=${data};`,
    `var CR_DROPS_ARCHIVE=${archiveData};`,
    `var CR_NEW_DROPS_MODE='${mode}';`,
    '(function(){',
    '  if(!CR_NEW_DROPS.length)return;',
    '  window.CR_NX_DROPS={};',
    '  var freshKeys=[],i,d;',
    '  for(i=0;i<CR_NEW_DROPS.length;i++){',
    '    d=CR_NEW_DROPS[i];',
    "    if(!d||!d.key||!d.title)continue;",
    '    // A schedule title the catalog already carries keeps the catalog entry',
    '    // (poster, episode guide, playback route) and only gains drop metadata.',
    '    // drop:true keeps the rail-only ones out of the browse grid / search.',
    "    if(!shows[d.key])shows[d.key]={title:d.title,year:d.year||'',rating:d.rating||'-',genres:['anime'],audio:'Sub & Dub',img:d.img||'',type:d.kind==='movie'?'Movie':'TV',drop:true};",
    "    window.CR_NX_DROPS[d.key]={id:d.id,kind:d.kind,seasons:d.seasons||{},added:d.firstSeen||'',fresh:!!d.fresh,src:d.src||'',verb:d.verb||'',season:d.season||null,episode:d.episode||null,guide:d.guide||null};",
    '    freshKeys.push(d.key);',
    '  }',
    '  if(!freshKeys.length)return;',
    `  rows.unshift({title:'${ROW_TITLE}',subtitle:'${subtitle.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',fresh:true,ranked:false,keys:freshKeys});`,
    '})();',
    '/* The Drops Library: past drops stay on the page and searchable. */',
    '(function(){',
    '  var libKeys=[],i,d,fresh=Object.create(null);',
    '  for(i=0;i<CR_NEW_DROPS.length;i++){d=CR_NEW_DROPS[i];if(d&&d.key)fresh[d.key]=1}',
    '  for(i=0;i<CR_DROPS_ARCHIVE.length;i++){',
    '    d=CR_DROPS_ARCHIVE[i];',
    '    if(!d||!d.key||!d.title||fresh[d.key])continue;',
    "    if(!shows[d.key])shows[d.key]={title:d.title,year:d.year||'',rating:d.rating||'-',genres:['anime'],audio:'Sub & Dub',img:d.img||'',type:d.kind==='movie'?'Movie':'TV',drop:true};",
    "    if(!window.CR_NX_DROPS[d.key])window.CR_NX_DROPS[d.key]={id:d.id,kind:d.kind,seasons:d.seasons||{},added:d.firstSeen||'',fresh:false,src:d.src||'',verb:'',season:d.season||null,episode:d.episode||null,guide:null};",
    '    libKeys.push(d.key);',
    '  }',
    '  if(!libKeys.length)return;',
    `  var library={title:'${LIBRARY_ROW_TITLE}',subtitle:'${LIBRARY_ROW_SUBTITLE}',fresh:false,ranked:false,keys:libKeys};`,
    '  if(rows.length&&rows[0].fresh)rows.splice(1,0,library);else rows.unshift(library);',
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

/** Titles the app already routes — the pool filler must never repeat one. */
function catalogTitles() {
  return new Set([...catalogKeys().keys()]);
}

/** Catalog title → rail key, so a schedule title reuses its catalog card. */
function catalogKeys() {
  const registry = readJson(REGISTRY_FILE, {});
  const map = new Map();
  for (const [key, entry] of Object.entries(registry)) {
    const title = titleKey(entry?.title || '');
    // The registry key is the key the page's catalog uses, so the rail card
    // reuses that entry (poster, episode guide, playback route) instead of
    // creating a rail-only twin of a show the catalog already carries.
    if (title) map.set(title, key);
  }
  return map;
}

/** Both drop states: the nxsha pool and the DeadToons release schedule. */
function readDropStates() {
  return {
    nxsha: readJson(STATE_FILE, null),
    schedule: readJson(SCHEDULE_FILE, null),
  };
}

/** The block the current state files should produce. */
function blockFromState(states) {
  const pool = collectRailPool(states.nxsha, states.schedule, catalogKeys());
  const rail = selectRailItems(pool, MAX_ROWS, catalogTitles());
  return dropsBlock(rail, selectArchiveItems(pool, rail.items));
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
    const states = readDropStates();
    const pool = collectRailPool(states.nxsha, states.schedule, catalogKeys());
    if (!pool.length) {
      console.error(
        `No drop state at ${path.relative(ROOT, STATE_FILE)} or ${path.relative(ROOT, SCHEDULE_FILE)}. ` +
          'Run the daily job first.',
      );
      process.exit(1);
    }
    const rail = selectRailItems(pool, MAX_ROWS, catalogTitles());
    const block = dropsBlock(rail, selectArchiveItems(pool, rail.items));
    const html = readHtml();

    if (DRY_RUN) {
      console.log(JSON.stringify({ mode: rail.mode, items: rail.items }, null, 2));
      return;
    }

    if (CHECK) {
      if (currentBlock(html) !== block) {
        console.error('Crunchyroll Fresh Drops block is out of sync. Run: node scripts/build-crunchyroll-new-drops.mjs --from-state');
        process.exit(1);
      }
      const freshCount = rail.items.filter((item) => item.fresh).length;
      console.log(
        `Fresh Drops block is in sync (${rail.items.length} cards, ${freshCount} new, mode: ${rail.mode}).`,
      );
      return;
    }

    const next = replaceDropsBlock(html, block);
    if (next === null) throw new Error('CR_DROPS markers not found in crunchyroll.html');
    fs.writeFileSync(HTML_FILE, next);
    console.log(
      `baked ${rail.items.length} Fresh Drops cards (${rail.items.filter((item) => item.fresh).length} new, ` +
        `mode: ${rail.mode}) into ${path.relative(ROOT, HTML_FILE)}`,
    );
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
  const schedule = readJson(SCHEDULE_FILE, null);
  const pool = collectRailPool({ items }, schedule, catalogKeys());
  const rail = selectRailItems(pool, MAX_ROWS, catalogTitles());
  const archive = selectArchiveItems(pool, rail.items);
  const sources = rail.items.reduce((acc, item) => ({ ...acc, [item.source]: (acc[item.source] || 0) + 1 }), {});
  const nextState = { updated: day, items };
  console.log(
    `baseline run: ${baselineRun}; new today: ${newCount}; rail: ${rail.items.length} cards ` +
      `(${rail.items.filter((item) => item.fresh).length} new, mode: ${rail.mode}; ` +
      `sources ${Object.entries(sources).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}); ` +
      `pool: ${Object.values(items).length} nxsha + ${(schedule?.items || []).length} scheduled; ` +
      `library: ${archive.length} past drops`,
  );

  if (DRY_RUN) {
    console.log(JSON.stringify({ mode: rail.mode, items: rail.items.slice(0, 3) }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2) + '\n');

  const html = readHtml();
  const block = dropsBlock(rail, archive);
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
