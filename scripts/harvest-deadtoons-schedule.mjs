#!/usr/bin/env node
/**
 * Daily DeadToons *release schedule* harvest for the Crunchyroll "Fresh Drops" row.
 *
 * Source of truth: https://deadtoons.sbs/schedule — the day tabs ("Thu 15 Today")
 * plus the "Upcoming" list. Every entry is one anime episode that lands today
 * (or in the next days), with its poster, season, episode, audio list and time.
 *
 * The row must be playable, and playback is Nxsha only, so every entry is given a
 * real Nxsha id before it is stored:
 *   1. the Crunchyroll catalog registry (data/nxsha-titles.json) — already verified
 *      daily by the guide job, matched on the title (so the card can reuse the
 *      catalog show, its poster and its episode guide);
 *   2. otherwise TMDB search (keyless, themoviedb.org) → the first candidate whose
 *      Nxsha embed page names exactly the same title and season;
 *   3. otherwise Wikidata (P4983/P345) → same Nxsha verification.
 * An entry with no verified id is stored under `skipped`, never in `items` — that
 * is what stopped the old slug-shaped ids from opening a 404 player.
 *
 * A card is read from its poster `alt`, its own heading, or its post slug (in that
 * order), so a brand-new episode that went up without artwork is still harvested,
 * and titles are entity-decoded — the page ships `JoJo&#x27;s Bizarre Adventure`,
 * which keys nothing while it stays escaped.
 *
 * Each playable entry also carries its season's episode guide — Nxsha's
 * /api/tv/{id}/season/{n} answers with the still, title, overview, air date and
 * runtime of every episode — so the rail's episode list shows real episode art
 * and real episode details instead of placeholder thumbnails.
 *
 * Writes data/deadtoons-schedule.json:
 *   { updated, source, today, items:[…], resolved:{…}, skipped:[…] }
 *   (an item with a guide: item.guide[season][episode] = {title,image,overview,airDate,runtime})
 * and always writes the diagnostics report (default data/deadtoons-schedule-probe.json, --out=FILE)
 * so a markup change can be fixed from the CI log alone.
 *
 * The page renders clocks (and therefore its day tabs) in the requester's zone, so
 * the run asks for the Indian rendering as well and keeps the richest answer.
 *
 * Usage: node scripts/harvest-deadtoons-schedule.mjs
 *          [--base=URL] [--limit=N] [--dry-run] [--no-resolve] [--probe]
 *          [--verbose] [--self-test] [--out=FILE]
 * Env:   DEADTOONS_BASE, DEADTOONS_SCHEDULE_OUT, DEADTOONS_PROBE_OUT, DROPS_DATE
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'https://deadtoons.sbs';
const OUT_PATH = resolve(process.env.DEADTOONS_SCHEDULE_OUT || resolve(ROOT, 'data', 'deadtoons-schedule.json'));
const PROBE_OUT = resolve(process.env.DEADTOONS_PROBE_OUT || resolve(ROOT, 'data', 'deadtoons-schedule-probe.json'));
const REGISTRY_PATH = resolve(ROOT, 'data', 'nxsha-titles.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const NX_PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true';
const TIMEOUT_MS = 20_000;
const RETRY_DAYS = 30;

const args = process.argv.slice(2);
const argValue = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};
const BASE = (argValue('--base') || process.env.DEADTOONS_BASE || DEFAULT_BASE).replace(/\/+$/, '');
const REPORT_PATH = resolve(argValue('--out') || PROBE_OUT);
const LIMIT = Number.parseInt(argValue('--limit', '0'), 10) || 0;
const DRY_RUN = args.includes('--dry-run');
const NO_RESOLVE = args.includes('--no-resolve');
const PROBE = args.includes('--probe');
const VERBOSE = args.includes('--verbose');

/* ------------------------------- utilities ------------------------------- */
/** Junk that trails a post slug (listings shout: "…-multi-audio-hindi-1080p"). */
const TAGS_RE = [
  /\b(hindi|hin|english|eng|japanese|jap|tamil|telugu|malayalam|kannada|bengali|urdu|punjabi|korean)\b/gi,
  /\b(dubbed|dub|dual[\s-]?audio|multi[\s-]?audio|single[\s-]?audio|original[\s-]?audio|fan[\s-]?dub(?:bed)?|audios?)\b/gi,
  /\b(web[\s-]?dl|web[\s-]?rip|hdrip|bluray|blu[\s-]?ray|hdtv|hdcam|dvdrip|remux|hevc|x264|x265|h\.?264|h\.?265|10[\s-]?bit|aac|esubs?|subs?|subbed|mmsub|softsub)\b/gi,
  /\b(2160p|1440p|1080p|720p|576p|480p|360p|4k|uhd|full[\s-]?hd)\b/gi,
  /\b(zippyshare|gdrive|google[\s-]?drive|mega\.nz|telegram|torrent|direct[\s-]?link)\b/gi,
  /\b(download|watch|streaming|online|mega links?)\b/gi,
  /\b(episode|episodes|ep|eps)\b\s*[-–]?\s*\d{1,4}(\.\d)?/gi,
  /\b(e|ep)\s?-?\d{1,4}(\.\d)?\b/gi,
  /\b(season|s)\s?\d{1,2}\b/gi,
  /\b(part|volume|vol)\s?\d{1,2}\b/gi,
  /\b(complete|batch|pack)\b/gi,
];
/** Words that stay lowercase inside a title-cased name ("Spy x Family"). */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'onto', 'or', 'over', 'so', 'the', 'to', 'up', 'with', 'vs', 'x', 'via']);
const YEAR_RE = /\b(19|20)\d{2}\b/;

/** Slug text arrives lowercase; only fully lowercase text is title-cased. */
export function titleCase(text) {
  const value = String(text || '');
  if (/[A-Z]/.test(value)) return value;
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.replace(/^([a-z])/, (c) => c.toUpperCase());
    })
    .join(' ');
}

/** "link-click-season-3-multi-audio-hindi-1080p" -> "Link Click" */
export function titleFromSlug(slug) {
  let text = decodeEntities(String(slug || ''))
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[+_/]+/g, ' ')
    // "jojo-s-bizarre" is a possessive, not a word.
    .replace(/([a-z0-9])-s-/gi, "$1's ")
    .replace(/-+/g, ' ');
  text = text
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    // "season 3" is stripped by TAGS_RE below, which also eats the number.
    .replace(/\b(episodes?|eps?|hd|sd|uhd|movie|movies)\b/gi, ' ');
  for (const re of TAGS_RE) text = text.replace(re, ' ');
  return titleCase(
    text
      .replace(/[^A-Za-z0-9'&!?:.\s-]/g, ' ')
      .replace(/[\s\-–—:·.,]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–',
};

const fromCodePoint = (code) => {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
};

/**
 * The schedule page escapes its titles (`JoJo&#x27;s Bizarre Adventure`), in hex
 * as often as in decimal, and a title that reaches the resolver still escaped
 * matches nothing — not the catalog registry, not TMDB, not Wikidata.
 */
export function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]{1,6});?/gi, (m, hex) => fromCodePoint(Number.parseInt(hex, 16)) || m)
    .replace(/&#(\d{2,6});?/g, (m, dec) => fromCodePoint(Number.parseInt(dec, 10)) || m)
    .replace(/&([a-z][a-z0-9]{1,9});?/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

export function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|article|section|header|footer|tr|td)>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Comparison key for titles: case, punctuation and audio tails do not matter. */
export function titleKey(title) {
  return decodeEntities(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** "S3 · Episode 11 · Hin-Tam-Tel-Eng-Jap" → season/episode/audio. */
export function parseEpisodeMeta(text) {
  const value = String(text || '');
  // "S3 · Episode 11" is the long form; cards also print "S3E11" and "3x11".
  const m =
    /(?:^|\b)S\s*(\d{1,2})\s*[·:.\-–—]\s*(?:EP|Episode)\s*(\d{1,3})\b/i.exec(value) ||
    /(?:^|\b)S\s*(\d{1,2})\s*E\s*P?\s*(\d{1,3})\b/i.exec(value) ||
    /(?:^|\b)(\d{1,2})\s*[xX]\s*(\d{1,3})\b/.exec(value);
  if (!m) return null;
  const rest = value.slice(m.index + m[0].length);
  const until = rest.split(/\n|\b\d{1,2}:\d{2}\s*(?:AM|PM)\b|\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/i)[0] || '';
  const line = until.replace(/^[\s·:\-–—]+/, '').replace(/[\s·:\-–—]+$/, '').trim();
  const audio = /^[A-Za-z][A-Za-z\-\s]{2,60}$/.test(line) ? line : '';
  return {
    season: Number.parseInt(m[1], 10),
    episode: Number.parseInt(m[2], 10),
    audio,
  };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = new RegExp(
  `\\b(${Object.keys(MONTHS).map((m) => m[0].toUpperCase() + m.slice(1)).join('|')})[a-z]*,?\\s+(\\d{1,2})\\b`,
);

/** "Fri, Oct 23 12:30 PM" → { date: '2026-10-23', time: '12:30 PM' } (year optional). */
export function parseScheduleDate(text, today = '') {
  const raw = String(text || '');
  const time = (raw.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i) || [])[0] || '';
  const md = MONTH_RE.exec(raw);
  if (!md) return { date: '', time: time.replace(/\s+/g, ' ').toUpperCase() };
  const month = MONTHS[md[1].toLowerCase()];
  if (!month) return { date: '', time: time.replace(/\s+/g, ' ').toUpperCase() };
  const day = Number.parseInt(md[2], 10);
  let year = Number.parseInt((today || '').slice(0, 4), 10) || new Date().getUTCFullYear();
  if (today) {
    // A month earlier than "today" rolls into the next year (Dec → Jan).
    const todayMonth = Number.parseInt(today.slice(5, 7), 10);
    if (month < todayMonth - 6) year += 1;
  }
  return { date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, time: time.replace(/\s+/g, ' ').toUpperCase() };
}

/** "4:07 AM" keeps only the clock; the day is the schedule day. */
export function clockOnly(text) {
  const m = /\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i.exec(String(text || ''));
  return m ? m[1].replace(/\s+/g, ' ').toUpperCase() : '';
}

const isoDay = (date = new Date()) => date.toISOString().slice(0, 10);

/**
 * Nxsha's own episode API: /api/tv/{id}/season/{n} -> one entry per episode with
 * its still, title, overview, air date and runtime. The rail's detail view draws
 * its episode list from this, so a schedule title the catalog does not carry gets
 * real thumbnails instead of the placeholder art.
 */
/** Title -> catalog key, so a schedule title can be matched to the catalog guide. */
export function catalogKeysByTitle(guideData) {
  const map = new Map();
  for (const [key, show] of Object.entries(guideData?.shows || {})) {
    if (show && show.title) map.set(titleKey(show.title), key);
  }
  return map;
}

/** Does the catalog's own guide already carry this title's season? */
export function catalogGuideCovers(guideData, key, season) {
  const episodes = guideData?.shows?.[key]?.episodes;
  if (!Array.isArray(episodes)) return false;
  return episodes.some((episode) => String(episode.season) === String(season));
}

/** The numeric TMDB id the guide job resolved for a catalog key ('' if none). */
export function catalogNumericId(guideData, key) {
  const id = String(guideData?.shows?.[key]?.id || '');
  return /^\d+$/.test(id) ? id : '';
}

export function buildSeasonGuide(response, requestedSeason, { overviewLimit = 320 } = {}) {
  const season = Number(response?.season?.season_number) || Number(requestedSeason) || 1;
  const episodes = Array.isArray(response?.episodes) ? response.episodes : [];
  const guide = {};
  for (const episode of episodes) {
    const number = Number.parseInt(episode?.episode_number, 10);
    if (!Number.isInteger(number) || number < 1) continue;
    const still = String(episode.still_path || '').trim();
    const image = !still
      ? ''
      : /^https?:\/\//i.test(still)
        ? still
        : `https://image.tmdb.org/t/p/w300${still.startsWith('/') ? '' : '/'}${still}`;
    const overview = String(episode.overview || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, overviewLimit);
    const runtime = Number.parseInt(episode.runtime, 10);
    const meta = {
      ...(episode.name ? { title: String(episode.name).trim() } : {}),
      ...(overview ? { overview } : {}),
      ...(image ? { image } : {}),
      ...(episode.air_date ? { airDate: String(episode.air_date) } : {}),
      ...(Number.isInteger(runtime) && runtime > 0 ? { runtime } : {}),
    };
    if (Object.keys(meta).length) guide[String(number)] = meta;
  }
  if (!Object.keys(guide).length) return null;
  return { [String(season)]: guide };
}

/** Nxsha embed page title: "Watch JoJo's Bizarre Adventure - S4:E1". */
export function embedTitle(html) {
  const raw = /<title>([^<]*)<\/title>/i.exec(String(html || ''))?.[1] ?? '';
  return decodeEntities(raw).replace(/^\s*Watch\s+/i, '').trim();
}

export function parseEmbedTitle(title) {
  const m = /^(.*?)\s*[-–—]\s*S(\d{1,2}):E(\d{1,4})\s*$/i.exec(String(title || '').trim());
  return m
    ? { name: m[1].trim(), season: Number.parseInt(m[2], 10), episode: Number.parseInt(m[3], 10) }
    : { name: String(title || '').trim(), season: null, episode: null };
}

const sameName = (a, b) => titleKey(a).length > 2 && titleKey(a) === titleKey(b);

/* ------------------------------ schedule page ---------------------------- */

/**
 * Every poster on the page, with the slice of HTML that follows it.
 *
 * The schedule renders one card per episode and each card starts with its
 * poster (`alt` is the clean title, e.g. "JoJo's Bizarre Adventure"), so the
 * slice between two posters is exactly one entry — that works for today's list,
 * for the day tabs and for the "Upcoming" list without depending on class names.
 */
export function scheduleBlocks(html) {
  const text = String(html || '');
  const hits = [...text.matchAll(/<img\b[^>]*>/gi)];
  const blocks = hits.map((hit, i) => {
    const start = hit.index;
    const next = i + 1 < hits.length ? hits[i + 1].index : Math.min(text.length, start + 4000);
    // Cards are anchors (<a href="/posts/…">) or plain blocks (upcoming days);
    // inside an anchor the card ends at its closing tag, so the next card's href
    // can never be read as this one's.
    // Anchors only — `text.lastIndexOf('<a')` would also match `<article>`.
    const open = [...text.matchAll(/<a\b[^>]*>/gi)].filter((m) => m.index + m[0].length <= start).pop();
    const container = open && !text.slice(open.index + open[0].length, start).includes('</a>') ? open[0] : '';
    const hrefAttr = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(container);
    const closeA = container ? text.indexOf('</a>', start) : -1;
    const end = closeA !== -1 && closeA < next ? closeA : next;
    return {
      tag: hit[0],
      index: start,
      href: decodeEntities(hrefAttr ? (hrefAttr[2] ?? hrefAttr[3] ?? hrefAttr[4] ?? '') : ''),
      body: text.slice(start + hit[0].length, end),
    };
  });

  // Posters load lazily and a brand-new episode can go up without one, so a card
  // with no <img> is invisible to the loop above. Scan the /posts/ anchors too,
  // but only the ones that really are a schedule card (episode number plus a
  // clock or a date) — a nav or sidebar link has none of that. Anchors that do
  // carry a poster are already covered, and their `alt` is the better title.
  for (const open of text.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*\/posts\/[^"]*)"|'([^']*\/posts\/[^']*)'|([^\s>]*\/posts\/[^\s>]*))[^>]*>/gi)) {
    const start = open.index;
    const closeA = text.indexOf('</a>', start + open[0].length);
    const end = closeA === -1 ? Math.min(text.length, start + 4000) : closeA;
    if (hits.some((h) => h.index > start && h.index < end)) continue;
    const body = text.slice(start + open[0].length, end);
    const plain = stripTags(body);
    // Anything that mentions an episode number or a clock is worth keeping: a
    // card whose episode line the parser cannot read shows up in the report
    // instead of vanishing.
    const looksLikeAVideo = /\d{1,2}:\d{2}\s*(?:AM|PM)|\bS\d{1,2}\s*[·:.]?\s*(?:E\s*P?\s*\d|Episode)|\bEpisode\s*\d/i.test(plain);
    if (!looksLikeAVideo) continue;
    const cardLike = Boolean(parseEpisodeMeta(plain)) && /\d{1,2}:\d{2}\s*(?:AM|PM)|\b[A-Z][a-z]{2},?\s+[A-Z][a-z]{2}\s+\d{1,2}\b/i.test(plain);
    if (!cardLike) {
      blocks.push({ tag: '', index: start, href: decodeEntities(open[2] ?? open[3] ?? open[4] ?? ''), body, refused: true });
      continue;
    }
    blocks.push({
      tag: '',
      index: start,
      href: decodeEntities(open[2] ?? open[3] ?? open[4] ?? ''),
      body,
    });
  }
  return blocks.sort((a, b) => a.index - b.index);
}

function imgAttr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}

/** Bigger poster for the rail (the page itself ships w154 thumbs). */
export function posterUrl(url, size = 'w300') {
  const clean = decodeEntities(String(url || '').trim());
  if (!clean) return '';
  return clean
    .replace(/\/(w\d+|original|h\d+)\//, `/${size}/`)
    .replace(/^http:\/\//, 'https://');
}

/**
 * Parse https://deadtoons.sbs/schedule into episode entries.
 *
 * `afterUpcoming` marks the part of the page under the "Upcoming" heading, so an
 * entry without a weekday is today's and one with a weekday is upcoming.
 */
export function parseSchedule(html, { base = DEFAULT_BASE, today = isoDay() } = {}) {
  const text = String(html || '');
  const upcomingAt = text.search(/upcoming/i);
  const items = [];
  const seen = new Set();
  const skipped = [];
  // What the page actually offered, card by card, and what happened to it. The
  // report carries this so a card that never reaches the row can be explained
  // from the repository alone.
  const cards = [];

  for (const block of scheduleBlocks(text)) {
    if (block.refused) {
      cards.push({
        poster: false,
        refused: true,
        href: block.href,
        text: stripTags(block.body).slice(0, 140),
        html: block.body.slice(0, 300),
        reason: 'episode line unreadable',
      });
      continue;
    }
    const { tag, body } = block;
    const meta = parseEpisodeMeta(stripTags(body).split('\n').slice(0, 6).join('\n')) || parseEpisodeMeta(body);
    const plain = stripTags(body);
    // The poster's `alt` is the clean title. A card without one (or without a
    // poster at all) falls back to its own heading, then to its post slug.
    const heading = /<(h[1-6]|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2] ?? '';
    const title = (
      decodeEntities(imgAttr(tag, 'alt')).trim() ||
      decodeEntities(stripTags(heading)).trim() ||
      ''
    );
    const link = /(?:https?:\/\/deadtoons\.sbs)?\/posts\/[^"'\s>)]+/.exec(block.href || '') || /(?:https?:\/\/deadtoons\.sbs)?\/posts\/[^"'\s>)]+/.exec(body);
    const slug = link ? decodeURIComponent(link[0].replace(/^https?:\/\/deadtoons\.sbs/, '').replace(/^\/posts\//, '')).replace(/[#?].*$/, '') : '';
    // Self-contained signal first: an upcoming card carries a weekday + month +
    // day, today's card only carries a clock. The "Upcoming" heading position is
    // just a fallback for a card with neither.
    const hasDate = MONTH_RE.test(plain);
    const hasClock = /\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(plain);
    const isUpcoming = hasDate || (!hasClock && upcomingAt !== -1 && block.index > upcomingAt);
    const parsed = isUpcoming ? parseScheduleDate(plain, today) : { date: today, time: clockOnly(plain) };
    const slugTitle = titleFromSlug(slug);
    const name = title.length > 1 ? title : slugTitle;
    const card = {
      poster: Boolean(tag),
      alt: decodeEntities(imgAttr(tag, 'alt')).trim(),
      href: block.href,
      slug,
      title: name,
      today: !isUpcoming,
      season: meta?.season ?? null,
      episode: meta?.episode ?? null,
      time: parsed.time || '',
      date: parsed.date || '',
      reason: '',
    };
    if (!name || name.length < 2) {
      card.reason = 'no title';
      cards.push(card);
      continue;
    }
    const key = `${titleKey(name)}:${isUpcoming ? 'upcoming' : 'today'}`;
    if (seen.has(key)) {
      card.reason = 'duplicate';
      cards.push(card);
      continue;
    }
    seen.add(key);

    const entry = {
      key: `sch-${slug || key}`,
      title: name,
      slug,
      url: link ? `${base}/posts/${slug}` : '',
      img: posterUrl(imgAttr(tag, 'src')),
      season: meta?.season ?? null,
      episode: meta?.episode ?? null,
      audio: meta?.audio || '',
      day: isUpcoming ? '' : (plain.match(/\b([A-Z][a-z]{2})\b/)?.[1] || ''),
      date: parsed.date || '',
      time: parsed.time || '',
      today: !isUpcoming,
      nx: null,
    };
    if (!entry.season || !entry.episode) {
      card.reason = 'no season/episode';
      skipped.push({ title: entry.title, reason: 'schedule: no season/episode' });
      cards.push(card);
      continue;
    }
    card.reason = 'ok';
    cards.push(card);
    items.push(entry);
  }

  items.sort((a, b) => {
    if (a.today !== b.today) return a.today ? -1 : 1;
    if (a.today) return clockMinutes(a.time) - clockMinutes(b.time);
    return (a.date || '').localeCompare(b.date || '') || clockMinutes(a.time) - clockMinutes(b.time);
  });
  return { items: LIMIT > 0 ? items.slice(0, LIMIT) : items, skipped, cards };
}

function clockMinutes(time) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(time || ''));
  if (!m) return 0;
  let hour = Number.parseInt(m[1], 10) % 12;
  if ((m[3] || '').toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number.parseInt(m[2], 10);
}

/* ------------------------------- resolution ------------------------------ */

export function registryIndex(registry) {
  const byTitle = new Map();
  for (const entry of Object.values(registry || {})) {
    if (!entry?.title || !entry?.id) continue;
    byTitle.set(titleKey(entry.title), {
      id: String(entry.id),
      kind: entry.kind === 'movie' ? 'movie' : 'tv',
      seasons: entry.seasons || {},
    });
  }
  return byTitle;
}

/** TMDB's own site is a keyless way to turn a title into candidate ids. */
export function tmdbCandidates(html, wantKind = 'tv') {
  const out = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(/href="\/(movie|tv)\/(\d+)(?:-([a-z0-9-]+))?"/g)) {
    if (m[1] !== wantKind || seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ id: m[2], kind: m[1], slug: m[3] || '' });
    if (out.length >= 8) break;
  }
  return out;
}

export function wikidataIds(entities, qid, wantKind = 'tv') {
  const entity = entities?.[qid];
  const claim = (prop) => entity?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value ?? null;
  const imdb = claim('P345');
  const tmdb = claim(wantKind === 'movie' ? 'P4947' : 'P4983');
  return {
    imdb: typeof imdb === 'string' && /^tt\d{6,10}$/.test(imdb) ? imdb : '',
    tmdb: tmdb ? String(tmdb) : '',
  };
}

/** Every id we are willing to try, best first. */
export function candidateIds(entry, registryHit) {
  const ids = [];
  if (registryHit) ids.push({ id: registryHit.id, kind: registryHit.kind, from: 'catalog' });
  for (const id of entry.ids || []) ids.push(id);
  const seen = new Set();
  return ids.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

const NX_BASE = 'https://nxsha.space';
// The catalog's own episode guides (data/nxsha-episodes.json, written by the
// daily guide job). A drop of a title the catalog already covers does not need a
// second guide — unless the drop's season is one the catalog does not carry yet.
const NX_GUIDE_PATH = resolve(process.env.DROPS_NX_GUIDE_FILE || resolve(ROOT, 'data', 'nxsha-episodes.json'));

export function nxshaVerifyUrl(kind, id, season = 1, episode = 1) {
  return kind === 'movie'
    ? `${'https://nxsha.space'}/embed/movie/${id}?${NX_PARAMS}`
    : `https://nxsha.space/embed/tv/${id}/${season}/${episode}?${NX_PARAMS}`;
}

/* --------------------------------- network -------------------------------- */

async function fetchText(url, { timeoutMs = TIMEOUT_MS, retries = 2, json = false, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: json ? 'application/json' : 'text/html,application/xhtml+xml,*/*',
          'accept-language': 'en-IN,en;q=0.9',
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (res.status === 429 && attempt < 4) {
        const after = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
        await sleep((after > 0 ? after * 1000 : 6000) * (attempt + 1));
        lastError = new Error('HTTP 429');
        continue;
      }
      return {
        status: res.status,
        text: await res.text(),
        // The schedule page renders "times in your own local time", so whatever
        // the server tells us about the zone it picked is worth keeping.
        headers: [...res.headers.entries()].filter(([key]) => /cookie|zone|tz|geo|country|city|vary/i.test(key)),
      };
    } catch (error) {
      lastError = error;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastError;
}

async function getJson(url) {
  const res = await fetchText(url, { json: true });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.text);
}

/** Resolve one entry to a verified Nxsha id, or a reason why not. */
async function resolveEntry(entry, byTitle, report) {
  const wantKind = 'tv';
  const hit = byTitle.get(titleKey(entry.title));
  const tried = [];
  if (hit && hit.id) {
    // The catalog registry is verified by the daily guide job already.
    return {
      ok: true,
      nx: { id: hit.id, kind: hit.kind, seasons: hit.seasons || {}, from: 'catalog' },
      tried: [{ id: hit.id, from: 'catalog' }],
    };
  }

  // 1. TMDB search (keyless) for candidate ids.
  const candidates = [];
  for (const searchUrl of [
    `https://www.themoviedb.org/search/tv?query=${encodeURIComponent(entry.title)}`,
    `https://www.themoviedb.org/search?query=${encodeURIComponent(entry.title)}`,
  ]) {
    try {
      const search = await fetchText(searchUrl);
      candidates.push(...tmdbCandidates(search.text, wantKind));
    } catch (error) {
      report.push({ title: entry.title, step: 'tmdb', url: searchUrl, error: String(error?.message || error) });
    }
    if (candidates.length) break;
    await sleep(150);
  }

  // 2. Wikidata fallback (exact label match, TV series class).
  if (!candidates.length) {
    try {
      const search = await getJson(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(entry.title)}&language=en&uselang=en&type=item&limit=10&format=json`,
      );
      const ids = (search.search || []).map((h) => h.id);
      if (ids.length) {
        const entities = await getJson(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=claims|labels|aliases&languages=en&format=json`,
        );
        for (const qid of ids) {
          const names = [
            entities.entities?.[qid]?.labels?.en?.value,
            ...(entities.entities?.[qid]?.aliases?.en ?? []).map((a) => a.value),
          ].filter(Boolean);
          if (!names.some((n) => sameName(n, entry.title))) continue;
          const wd = wikidataIds(entities.entities, qid, wantKind);
          if (wd.tmdb) candidates.push({ id: wd.tmdb, kind: wantKind, from: 'wikidata-tmdb' });
          if (wd.imdb) candidates.push({ id: wd.imdb, kind: wantKind, from: 'wikidata-imdb' });
          if (candidates.length) break;
        }
      }
    } catch (error) {
      report.push({ title: entry.title, step: 'wikidata', error: String(error?.message || error) });
    }
  }

  for (const candidate of candidates.slice(0, 6)) {
    const season = entry.season || 1;
    const url = nxshaVerifyUrl(candidate.kind, candidate.id, season, entry.episode || 1);
    tried.push({ id: candidate.id, from: candidate.from || 'tmdb' });
    try {
      const res = await fetchText(url, { retries: 0 });
      const named = res.status === 200 && sameName(parseEmbedTitle(embedTitle(res.text)).name, entry.title);
      if (VERBOSE) console.log(`  verify ${candidate.id} ${res.status} ${named ? '✓' : '✗'} ${embedTitle(res.text).slice(0, 60)}`);
      if (named) {
        return {
          ok: true,
          nx: {
            id: String(candidate.id),
            kind: candidate.kind,
            seasons: { [season]: Math.max(entry.episode || 1, 1) },
            from: candidate.from || 'tmdb',
          },
          tried,
        };
      }
    } catch (error) {
      if (VERBOSE) console.log(`  verify ${candidate.id} failed: ${error.message}`);
    }
    await sleep(150);
  }

  return { ok: false, reason: 'nxsha: no verified id', tried };
}

/* ---------------------------------- probe --------------------------------- */

export function siteReport(html, { base = DEFAULT_BASE, status = 0, bytes = 0 } = {}) {
  const text = String(html || '');
  const hrefs = [...new Set([...text.matchAll(/href\s*=\s*("|')([^"']+)\1/gi)].map((m) => m[2]))].slice(0, 60);
  const images = [...new Set([...text.matchAll(/<img\b[^>]*\bsrc\s*=\s*("|')([^"']+)\1/gi)].map((m) => m[2]))].slice(0, 30);
  const markers = ['S1 · Episode', 'Episode', 'Upcoming', 'Today', 'release-schedule', '__NEXT_DATA__', 'wp-content'].filter((m) =>
    text.toLowerCase().includes(m.toLowerCase()),
  );
  const payloadAt = text.search(/self\.__next_f/);
  const payload = payloadAt === -1 ? '' : text.slice(payloadAt);
  const payloadKeys = [...new Set([...payload.matchAll(/\\?"([A-Za-z][A-Za-z0-9_]{1,24})\\?":/g)].map((m) => m[1]))].slice(0, 40);
  return {
    url: `${base}/schedule`,
    status,
    bytes: bytes || text.length,
    markers,
    hrefs,
    images,
    episodeHits: (text.match(/S\d{1,2}\s*[·:.\-–—]\s*(?:EP|Episode)\s*\d{1,3}/gi) || []).length,
    upcomingAt: text.search(/upcoming/i),
    rawHead: text.slice(0, 1500),
    rawBody: text.length > 2000 ? text.slice(-2000) : '',
    // The page is a Next.js app: the data the client renders from travels in the
    // RSC payload. The report keeps where it starts and which keys it carries —
    // the ground truth if the DOM parse ever has to be replaced by a
    // zone-independent one.
    payloadAt,
    payloadKeys,
  };
}

/* -------------------------------- self-test ------------------------------- */

function selfTest() {
  let failures = 0;
  const check = (name, ok, detail = '') => {
    if (ok) console.log(`ok   ${name}`);
    else {
      failures += 1;
      console.log(`FAIL ${name}${detail ? ` → ${detail}` : ''}`);
    }
  };

  check('episode meta', (() => {
    const m = parseEpisodeMeta('Chainsmoker Cat\nS1 · Episode 12\n1:00 PM');
    return m && m.season === 1 && m.episode === 12;
  })());
  check('episode meta with audio', (() => {
    const m = parseEpisodeMeta('Black Clover S5 · Episode 1 · Hin-Tam-Tel-Eng-Jap');
    return m && m.season === 5 && m.episode === 1 && m.audio === 'Hin-Tam-Tel-Eng-Jap';
  })(), JSON.stringify(parseEpisodeMeta('Black Clover S5 · Episode 1 · Hin-Tam-Tel-Eng-Jap')));
  check('clock only', clockOnly('1:30 PM') === '1:30 PM');
  check('compact episode meta', (() => {
    const a = parseEpisodeMeta('LINK CLICK\nS3E11\n11:20 PM');
    const b = parseEpisodeMeta('Some Show 2x11 9:00 PM');
    return a && a.season === 3 && a.episode === 11 && b && b.season === 2 && b.episode === 11;
  })(), JSON.stringify(parseEpisodeMeta('LINK CLICK\nS3E11\n11:20 PM')));
  check('escaped titles are decoded', (() => {
    const title = decodeEntities('JoJo&#x27;s Bizarre Adventure');
    // The escaped form keys nothing: the resolver would look for a show called
    // "jojox27sbizarreadventure".
    return title === "JoJo's Bizarre Adventure" && titleKey(title) === 'jojosbizarreadventure';
  })(), decodeEntities('JoJo&#x27;s Bizarre Adventure'));
  check('slug is the last-resort title', (() => {
    return titleFromSlug('link-click-season-3-multi-audio-hindi-1080p') === 'Link Click';
  })(), titleFromSlug('link-click-season-3-multi-audio-hindi-1080p'));
  check('upcoming date', (() => {
    const d = parseScheduleDate('Fri, Oct 23 12:30 PM', '2026-10-15');
    return d.date === '2026-10-23' && d.time === '12:30 PM';
  })(), JSON.stringify(parseScheduleDate('Fri, Oct 23 12:30 PM', '2026-10-15')));
  check('embed title matches its show', (() => {
    const parsed = parseEmbedTitle(embedTitle("<html><head><title>Watch JoJo's Bizarre Adventure - S4:E1</title></head></html>"));
    return sameName(parsed.name, "JoJo's Bizarre Adventure") && parsed.season === 4;
  })());
  check('different show is not a match', !sameName('Fighter', 'The Fighter'));
  check('poster upgrade', posterUrl('https://image.tmdb.org/t/p/w154/abc.jpg') === 'https://image.tmdb.org/t/p/w300/abc.jpg');

  const fixture = `
    <section class="schedule"><div class="days"><button>Sun11 2</button><button>Thu15 Today 6</button></div>
      <a class="slot" href="https://deadtoons.sbs/posts/jojo-s-bizarre-adventure-season-4-2018">
        <img src="https://image.tmdb.org/t/p/w154/cMFg7X0gSJjWajuj9DNL4UaUmcP.jpg" alt="JoJo's Bizarre Adventure">
        <div>JoJo's Bizarre Adventure</div><span>S4 · Episode 5</span><time>1:30 PM</time>
      </a>
      <a class="slot" href="https://deadtoons.sbs/posts/chainsmoker-cat-season-1-multi-audio-hindi-tamil-telugu-eng-jap-480p-720p-1080p-hd-web-dl-10bit-hevc-esub">
        <img src="https://image.tmdb.org/t/p/w154/kqeKlSd7o9BCbTraZsDnksRSfxm.jpg" alt="Chainsmoker Cat">
        <span>S1 · Episode 12</span><time>1:00 PM</time>
      </a>
    </section>
    <section class="upcoming"><h2>Upcoming</h2>
      <article><img src="https://image.tmdb.org/t/p/w154/7qx7OwBZcI0dRWc8DrbtxY5IrlV.jpg" alt="The Apothecary Diaries">
        <strong>The Apothecary Diaries</strong><span>S3 · Episode 1 · Hin-Tam-Tel-Eng-Jap</span><span>Fri, Oct 23 12:30 PM</span></article>
      <article><img src="https://media.deadbase.host/w154/47649b78.webp" alt="Black Clover">
        <a href="https://deadtoons.sbs/posts/black-clover-season-5-2026"><strong>Black Clover</strong></a>
        <span>S5 · Episode 1 · Hin-Tam-Tel-Eng-Jap</span><span>Sat, Oct 24 3:00 AM</span></article>
    </section>`;

  const parsed = parseSchedule(fixture, { today: '2026-10-15' });
  check('schedule finds every poster card', parsed.items.length === 4, String(parsed.items.length));

  // A card whose poster has not loaded yet ships no <img> at all — it still has
  // to be harvested, and the slug has to name it when there is no alt text.
  const posterless = `
    <section class="schedule">
      <a class="slot" href="/posts/link-click-season-3-multi-audio-hindi-1080p">
        <span>LINK CLICK</span><span>S3E11</span><time>11:20 PM</time></a>
      <a class="nav" href="/posts/trending-now">Trending now</a>
    </section>`;
  const posterlessParsed = parseSchedule(posterless, { today: '2026-10-15' });
  const link = posterlessParsed.items[0] || {};
  check('card without a poster is still harvested', posterlessParsed.items.length === 1 && link.season === 3 && link.episode === 11, JSON.stringify(posterlessParsed.items));
  check('poster-less card is named from its slug', link.title === 'Link Click', link.title);
  check('poster-less card keeps its post link', link.url === 'https://deadtoons.sbs/posts/link-click-season-3-multi-audio-hindi-1080p', link.url);
  check('plain nav link is not a card', !posterlessParsed.skipped.some((x) => /trending/i.test(x.title)), JSON.stringify(posterlessParsed.skipped));
  const jojo = parsed.items.find((i) => /jojo/i.test(i.title)) || {};
  check('today first, by clock', parsed.items[0]?.title === 'Chainsmoker Cat', parsed.items.map((i) => `${i.title}@${i.time}`).join(', '));
  check('today entry keeps its post link and art', /\/posts\/jojo-s-bizarre-adventure-season-4-2018$/.test(jojo.url || '') && /w300/.test(jojo.img || ''), JSON.stringify(jojo));
  check('today entry is flagged and dated today', jojo.today === true && jojo.date === '2026-10-15');
  const apo = parsed.items.find((i) => /apothecary/i.test(i.title)) || {};
  check('upcoming entry has a date and no link', apo.today === false && apo.date === '2026-10-23' && apo.url === '', JSON.stringify(apo));
  check('upcoming audio list parsed', apo.audio === 'Hin-Tam-Tel-Eng-Jap', apo.audio);
  check('registry match prefers catalog id', (() => {
    const byTitle = registryIndex({ jojo: { id: '45790', kind: 'tv', title: "JoJo's Bizarre Adventure", seasons: { 4: 28 } } });
    const hit = byTitle.get(titleKey("JoJo's Bizarre Adventure"));
    return hit && hit.id === '45790' && hit.seasons['4'] === 28;
  })());
  check('tmdb candidates prefer tv', (() => {
    const list = tmdbCandidates('<a href="/movie/1-x"></a><a href="/tv/45790-jojo"></a><a href="/tv/2"></a>');
    return list.length === 2 && list[0].id === '45790' && list[0].kind === 'tv';
  })());
  check('wikidata ids', (() => {
    const entities = { Q1: { claims: { P345: [{ mainsnak: { datavalue: { value: 'tt1234567' } } }], P4983: [{ mainsnak: { datavalue: { value: 987 } } }] } } };
    const wd = wikidataIds(entities, 'Q1', 'tv');
    return wd.imdb === 'tt1234567' && wd.tmdb === '987';
  })());
  check('embed url shape', nxshaVerifyUrl('tv', '45790', 4, 5).startsWith('https://nxsha.space/embed/tv/45790/4/5?server=GbruHindi'));
  check('schedule report counts episode hits', siteReport(fixture).episodeHits === 4, String(siteReport(fixture).episodeHits));
  check('season guide keeps stills, titles and dates', (() => {
    const guide = buildSeasonGuide({
      success: true,
      season: { season_number: 4, episode_count: 2 },
      episodes: [
        { episode_number: 2, name: 'Golden Wind', overview: '<p>Koichi lands in Italy</p>', still_path: '/iPT7iMdv1W5ThQDgPhWpBTAkX3T.jpg', air_date: '2018-10-13', runtime: 24 },
        { episode_number: 1, still_path: 'https://image.tmdb.org/t/p/w500/x.jpg' },
      ],
    }, 4);
    const fourth = guide && guide['4'];
    return Boolean(
      fourth &&
        fourth['1'].image === 'https://image.tmdb.org/t/p/w500/x.jpg' &&
        fourth['2'].title === 'Golden Wind' &&
        fourth['2'].overview === 'Koichi lands in Italy' &&
        fourth['2'].image === 'https://image.tmdb.org/t/p/w300/iPT7iMdv1W5ThQDgPhWpBTAkX3T.jpg' &&
        fourth['2'].airDate === '2018-10-13' &&
        fourth['2'].runtime === 24,
    );
  })(), JSON.stringify(buildSeasonGuide({ success: true, season: { season_number: 1 }, episodes: [{ episode_number: 1, name: 'A' }] }, 1)));
  check('an episode-less season has no guide', buildSeasonGuide({ success: false, message: 'Season not found' }, 5) === null);
  check('the catalog guide is reused when it covers the drop season', (() => {
    const guideData = { shows: { apothecary: { id: '220542', episodes: [{ season: 1, episode: 1 }] } } };
    return (
      catalogGuideCovers(guideData, 'apothecary', 1) === true &&
      // Season 3 of the same title is not in the catalog guide yet.
      catalogGuideCovers(guideData, 'apothecary', 3) === false &&
      catalogGuideCovers(guideData, 'unknown', 1) === false
    );
  })());
  check('a schedule title finds its catalog key', (() => {
    const guideData = { shows: { jojo: { title: "JoJo's Bizarre Adventure", id: '45790', episodes: [{ season: 4, episode: 5 }] } } };
    const keys = catalogKeysByTitle(guideData);
    const key = keys.get(titleKey("JoJo's Bizarre Adventure")) || '';
    return key === 'jojo' && catalogGuideCovers(guideData, key, 4) === true;
  })());
  check('the catalog knows the numeric id behind a title', (() => {
    const guideData = { shows: { blackclover: { id: '34572', episodes: [] } } };
    return catalogNumericId(guideData, 'blackclover') === '34572' && catalogNumericId(guideData, 'nope') === '';
  })());
  check('a stale copy loses to a richer one', (() => {
    const stale = parseSchedule(fixture, { today: '2026-10-15' });
    const fresh = parseSchedule(`${fixture}<a href="/posts/link-click-season-3-2026"><img src="https://image.tmdb.org/t/p/w154/4PCQ.jpg" alt="LINK CLICK"><span>S3 · Episode 11</span><time>11:20 PM</time></a>`, { today: '2026-10-15' });
    return stale.cards.length === 4 && fresh.cards.length === 5;
  })());

  if (failures) {
    console.error(`\n${failures} DeadToons schedule self-test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll DeadToons schedule self-tests passed (offline, no network).');
}

/* ----------------------------------- main --------------------------------- */

async function main() {
  if (args.includes('--self-test')) return selfTest();

  const today = process.env.DROPS_DATE || isoDay();
  const url = `${BASE}/schedule`;
  const requests = [];
  const state = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : null;
  const cached = state?.resolved && typeof state.resolved === 'object' ? state.resolved : {};
  const registry = existsSync(REGISTRY_PATH) ? JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) : {};
  const byTitle = registryIndex(registry);

  console.log(`deadtoons: schedule ${url}`);
  // Twice: the page behind the CDN can still be the previous render, and the row
  // is built from whichever answer carries more cards. (Its clock — and therefore
  // its day tabs — is rendered for the requester's zone; ?tz= and timezone
  // cookies are ignored, so a late-evening entry can land on tomorrow's tab and
  // arrive one run later.)
  const attempts = [
    { label: 'plain', url },
    { label: 'fresh', url: `${url}?v=${Date.now()}` },
  ];
  const fetches = [];
  for (const attempt of attempts) {
    try {
      const res = await fetchText(attempt.url, { headers: attempt.headers || {} });
      fetches.push({ label: attempt.label, url: attempt.url, status: res.status, html: res.text, headers: res.headers });
      requests.push({ url: attempt.url, status: res.status, bytes: res.text.length, label: attempt.label });
    } catch (error) {
      requests.push({ url: attempt.url, label: attempt.label, error: String(error?.message || error) });
    }
    await sleep(200);
  }
  const usable = fetches.filter((f) => f.status === 200 && f.html);
  let html = usable[0]?.html ?? '';
  const status = usable.length ? 200 : (fetches[0]?.status ?? 0);

  const report = {
    generated: new Date().toISOString(),
    source: url,
    requests,
    site: siteReport(html, { base: BASE, status }),
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (!html || status !== 200) {
    console.error(`DeadToons schedule unreachable (status ${status || 'ERR'}); diagnostics written to ${REPORT_PATH}; state untouched.`);
    process.exitCode = 1;
    return;
  }

  const renderings = usable.map((f) => {
    const attempt = parseSchedule(f.html, { base: BASE, today });
    const todays = attempt.cards.filter((c) => c.today);
    return {
      label: f.label,
      url: f.url,
      cards: attempt.cards.length,
      today: todays.length,
      first: todays[0]?.time || '',
      last: todays[todays.length - 1]?.time || '',
      headers: f.headers,
      html: f.html,
      parsed: attempt,
    };
  });
  report.parses = renderings.map(({ html: _html, parsed: _parsed, ...rest }) => rest);
  const prefersIndia = (rendering) => (/tz|timezone/.test(rendering.label) ? 0 : 1);
  const best =
    [...renderings].sort(
      (a, b) =>
        b.cards - a.cards ||
        b.today - a.today ||
        prefersIndia(a) - prefersIndia(b) ||
        renderings.indexOf(a) - renderings.indexOf(b),
    )[0] ?? null;
  let parsed = best?.parsed ?? { items: [], cards: [], skipped: [] };
  if (best) {
    html = best.html;
    console.log(`deadtoons: ${best.label} rendering has the most cards (${best.cards}, ${best.today} today) of ${renderings.length} attempt(s)`);
  }
  report.site = siteReport(html, { base: BASE, status });
  console.log(`deadtoons: ${parsed.items.length} schedule episode(s) parsed${LIMIT ? ` (limit ${LIMIT})` : ''}`);

  const unresolved = [];
  const items = [];
  for (const entry of parsed.items) {
    if (NO_RESOLVE) {
      entry.nx = null;
    } else {
      const cacheKey = titleKey(entry.title);
      const memo = cached[cacheKey];
      const fresh = memo && Number.parseInt(memo.id ? memo.checked : memo.checked, 10) > 0;
      const checkedDate = memo?.checked || '';
      const stale = !checkedDate || (Date.parse(today) - Date.parse(checkedDate)) / 86_400_000 > RETRY_DAYS;
      if (memo && !stale) {
        entry.nx = memo.id ? { id: memo.id, kind: memo.kind || 'tv', seasons: memo.seasons || {}, from: memo.from || 'cache' } : null;
      } else {
        const resolved = await resolveEntry(entry, byTitle, report.resolution || (report.resolution = []));
        entry.nx = resolved.ok ? resolved.nx : null;
        if (resolved.ok) {
          cached[cacheKey] = { ...resolved.nx, checked: today };
        } else {
          cached[cacheKey] = { checked: today, tried: resolved.tried?.slice(0, 4) || [] };
        }
        await sleep(250);
      }
      void fresh;
    }
    if (entry.nx) items.push(entry);
    else unresolved.push({ title: entry.title, reason: 'nxsha: no verified id' });
  }
  report.resolved = items.filter((i) => i.nx).length;
  report.unresolved = unresolved.length;
  // Episode art and episode details for the rail's episode list. The catalog's own
  // shows already carry a guide (the daily guide job bakes NX_EPISODE_DATA); a
  // schedule title that the catalog does not carry needs its own, or its episode
  // grid shows placeholder art and "Episode 7" instead of the real episode.
  const guides = [];
  const guideData = existsSync(NX_GUIDE_PATH) ? JSON.parse(readFileSync(NX_GUIDE_PATH, 'utf8')) : {};
  const catalogKeys = catalogKeysByTitle(guideData);
  let guidesSkipped = 0;
  for (const entry of items) {
    const season = Number(entry.season) || 1;
    const catalogKey = catalogKeys.get(titleKey(entry.title)) || '';
    // The catalog's own guide is already in the page, so it is only worth a call
    // when the drop airs a season the catalog does not carry yet.
    if (catalogKey && catalogGuideCovers(guideData, catalogKey, season)) {
      guidesSkipped += 1;
      continue;
    }
    // A catalog title resolved by title may only carry an IMDb id; the guide job
    // knows the numeric id Nxsha's API answers to.
    const ownId = String(entry.nx?.id || '');
    const id = /^\d+$/.test(ownId) ? ownId : catalogNumericId(guideData, catalogKey);
    if (!/^\d+$/.test(id)) {
      guides.push({ title: entry.title, key: catalogKey || titleKey(entry.title), season, reason: 'no numeric Nxsha id' });
      continue;
    }
    try {
      const res = await getJson(`${NX_BASE}/api/tv/${id}/season/${season}`);
      const guide = buildSeasonGuide(res, season);
      if (guide) {
        entry.guide = guide;
        guides.push({ title: entry.title, key: catalogKey || titleKey(entry.title), id, season, episodes: Object.keys(guide[String(season)]).length });
      } else {
        guides.push({ title: entry.title, key: catalogKey || titleKey(entry.title), id, season, episodes: 0, reason: String(res?.message || 'no episodes') });
      }
    } catch (error) {
      guides.push({ title: entry.title, key: catalogKey || titleKey(entry.title), id, season, error: String(error?.message || error).slice(0, 140) });
    }
    await sleep(250);
  }
  report.guides = guides;
  report.guidesSkipped = guidesSkipped;
  report.items = items.map((i) => ({ title: i.title, season: i.season, episode: i.episode, today: i.today, nx: i.nx }));
  report.cards = parsed.cards;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const playable = items.length;
  console.log(
    `deadtoons: ${playable} playable via nxsha · ${unresolved.length} skipped` +
      `${unresolved.length ? ` (${unresolved.slice(0, 4).map((u) => u.title).join(', ')}${unresolved.length > 4 ? ' …' : ''})` : ''}`,
  );

  if (!items.length) {
    console.error(`Nothing playable on the DeadToons schedule; diagnostics written to ${REPORT_PATH}; leaving the state untouched.`);
    process.exitCode = 1;
    return;
  }

  const next = {
    updated: today,
    source: url,
    today,
    items,
    resolved: cached,
    skipped: [...parsed.skipped, ...unresolved],
  };
  if (DRY_RUN || PROBE) {
    console.log(JSON.stringify({ updated: next.updated, items: next.items.map((i) => ({ title: i.title, season: i.season, episode: i.episode, nx: i.nx })) }, null, 2));
    return;
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`deadtoons: wrote ${items.length} entry(ies) to ${OUT_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`harvest-deadtoons-schedule failed: ${error?.message || error}`);
    process.exit(1);
  });
}
