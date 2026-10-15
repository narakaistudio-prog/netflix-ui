#!/usr/bin/env node
/**
 * Daily DeadToons listing harvest for the Crunchyroll "Fresh Drops" row.
 *
 * DeadToons (deadtoons.sbs) is an anime *listing* here, never a player: this
 * script only reads which anime the site publishes, so the Fresh Drops rail can
 * name titles the catalog does not carry yet. Playback stays on Nxsha.
 *
 * Discovery layers, first hit wins (a site change only has to keep one alive):
 *   1. WordPress REST      /wp-json/wp/v2/posts?orderby=date&order=desc
 *   2. WordPress sitemaps  /wp-sitemap.xml (+ nested post sitemaps), /post-sitemap.xml
 *   3. Listing/search HTML /, /?s=anime, /anime/, /category/anime/, /page/2 …
 * Post links found in HTML listings carry their own <img>, so those need no
 * extra request; the rest get their artwork from the post page's og:image.
 *
 * State: data/deadtoons-drops.json — first date each anime was seen (firstSeen).
 * The first run is a baseline: everything found then is marked baseline=true and
 * never counts as "new". scripts/build-crunchyroll-new-drops.mjs merges this file
 * into the rail + the bell notifications (lib/notifications.ts).
 *
 * Usage:
 *   node scripts/harvest-deadtoons-drops.mjs [--base=<url>] [--limit=N]
 *        [--max-art=N] [--dry-run] [--probe] [--verbose]
 *   node scripts/harvest-deadtoons-drops.mjs --self-test    # offline parsers
 *
 * Env: DEADTOONS_BASE  site root (default https://deadtoons.sbs)
 *      DROPS_DATE     override "today" (IST by default)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = resolve(ROOT, 'data', 'deadtoons-drops.json');

/** Drop this many listing pages at most when walking /page/N and search pages. */
const MAX_LISTING_PAGES = 3;
/** Post pages fetched for artwork / titles in one run. */
const DEFAULT_MAX_ART = 60;
/** Same-origin paths that never hold an anime post. */
const SKIP_PATH = /^\/(wp-|feed|comments|tag|category\/[^/]*$|author|page\/|privacy|dmca|contact|about|how-to|disclaimer|request|sitemap|anime-list)/i;
const LISTING_HINTS = [/^\/?$/, /^\/anime\/?$/i, /^\/category\/anime\/?$/i, /^\/search\//i, /^\/\?s=/i, /^\/page\/\d+\/?$/i];
/** Titles we never rail: adult listings and non-anime noise. */
const TITLE_BLOCK = /\b(harem camp|overflow|hentai|ecchi|nsfw|porn|xxx|sex|nude|adult)\b/i;
const NON_ANIME = /\b(software|apk|mod app|game|wallpaper|cricket|football|news|lyrics|ringtone|tutorial)\b/i;
const ANIME_SIGNAL = /\b(anime|hindi|dub|dubbed|dual audio|multi audio|episode|ep\b|season|batch|complete|subbed|sub|1080p|720p|480p|360p|2160p|web-?dl|webrip|bluray|blu-ray|hevc|x264|x265)\b/i;
/** Junk that trails a post slug/title (case-insensitive: listings shout). */
const TAGS_RE = [
  /\b(hindi|hin|english|eng|japanese|jap|tamil|telugu|malayalam|kannada|bengali|urdu|punjabi|korean)\b/gi,
  /\b(dubbed|dub|dual[\s-]?audio|multi[\s-]?audio|original[\s-]?audio|audios?)\b/gi,
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

export function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|rsquo|lsquo|ldquo|rdquo);/gi, (entity) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
      rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
    }[entity.toLowerCase()] ?? entity));
}

export function stripTags(value) {
  return decodeEntities(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Post slug or post title -> { title, year }.
 * "solo-leveling-season-2-hindi-dubbed-1080p" -> "Solo Leveling"
 */
export function titleFromSlug(slug) {
  let text = decodeEntities(String(slug || ''))
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[+_/]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanAnimeTitle(text);
}

/**
 * Slug text arrives lowercase ("solo-leveling"), post text keeps its own casing
 * ("SPY x FAMILY", "BanG Dream!"). Only fully lowercase text is title-cased, so
 * a listing's own styling is never mangled.
 */
export function titleCase(text) {
  const value = String(text || '');
  if (/[A-Z]/.test(value)) return value;
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word
        .replace(/^([a-z])/, (c) => c.toUpperCase())
        .replace(/-([a-z])/g, (_, c) => `-${c.toUpperCase()}`);
    })
    .join(' ');
}

export function cleanAnimeTitle(raw) {
  let text = decodeEntities(stripTags(raw)).replace(/\s*[|–—]\s*DeadToons.*$/i, ' ');
  const year = (text.match(YEAR_RE) || [])[0] || '';
  text = text
    .replace(/\[[^\]]*\]/g, ' ')     // [Hindi Dub] [1080p]
    .replace(/\([^)]*\)/g, ' ')      // (Season 1) (2024)
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ');
  for (const re of TAGS_RE) text = text.replace(re, ' ');
  text = text
    .replace(/[^A-Za-z0-9'&!?:.\s-]/g, ' ')
    .replace(/\s*[-:]\s*$/g, '')
    .replace(/^\s*[-:]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    // trailing punctuation left behind by the tag strip
    .replace(/[\s\-–—:·.,]+$/g, '');
  return { title: titleCase(text), year };
}

/** Is this listing text an anime post (and not adult / non-anime noise)? */
export function isAnimeListing(text, { animeScoped = false } = {}) {
  const value = stripTags(text);
  if (!value || value.length < 3) return false;
  if (NON_ANIME.test(value)) return false;
  if (TITLE_BLOCK.test(value)) return false;
  return ANIME_SIGNAL.test(value) || animeScoped;
}

/** WordPress REST payload -> items. */
export function parseRestPosts(payload, base = '') {
  const rows = typeof payload === 'string' ? safeJson(payload) : payload;
  if (!Array.isArray(rows)) return [];
  const host = hostOf(base);
  return rows
    .map((row) => {
      const url = absolute(row?.link || row?.url, base);
      const title = stripTags(row?.title?.rendered || row?.title || '');
      const date = String(row?.date || '').slice(0, 10);
      return url && sameHost(url, host) ? { url, title, date } : null;
    })
    .filter(Boolean);
}

export function parseSitemapXml(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i) || [])[1];
    if (!loc) continue;
    const lastmod = (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i) || [])[1] || '';
    out.push({ url: decodeEntities(loc), lastmod: lastmod.slice(0, 10) });
  }
  for (const m of String(xml || '').matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i) || [])[1];
    if (loc) out.push({ url: decodeEntities(loc), lastmod: '', nested: true });
  }
  return out;
}

/**
 * HTML listing -> candidate posts with the artwork the listing itself carries.
 * Handles the usual shapes: <article><a href><img></a><h2><a>Title</a></h2></article>,
 * bare <a><img alt="Title"></a>, and plain link lists.
 */
export function parseHtmlListing(html, base = '') {
  const text = String(html || '');
  const host = hostOf(base);
  const byUrl = new Map();

  const add = (url, title, img) => {
    if (!url || !sameHost(url, host)) return;
    if (!isPostUrl(url, base)) return;
    const existing = byUrl.get(url) || {};
    byUrl.set(url, {
      url,
      title: existing.title || title || '',
      img: existing.img || img || '',
    });
  };

  // <a ...>…<img src=…>…</a> — the anchor wraps the artwork.
  for (const m of text.matchAll(/<a\b[^>]*href=("|')([^"']+)\1[^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
    const inner = m[3];
    const img = (inner.match(/<img\b[^>]*?\bsrc=("|')([^"']+)\1/i) || [])[2] || '';
    const alt = (inner.match(/<img\b[^>]*?\balt=("|')([^"']+)\1/i) || [])[2] || '';
    const textInside = stripTags(inner);
    const title = textInside || decodeEntities(alt);
    add(absolute(m[2], base), isAnimeTitleText(title) ? title : '', img ? absolute(img, base) : '');
  }

  // Headings carry the real post title even when the artwork link has none.
  for (const m of text.matchAll(/<h[1-4]\b[^>]*>([\s\S]{0,300}?)<\/h[1-4]>/gi)) {
    const heading = m[1];
    const href = (heading.match(/href=("|')([^"']+)\1/i) || [])[2] || '';
    if (!href) continue;
    add(absolute(href, base), stripTags(heading), '');
  }

  // <a href="…" title="Post title">
  for (const m of text.matchAll(/<a\b[^>]*href=("|')([^"']+)\1[^>]*\btitle=("|')([^"']+)\3[^>]*>/gi)) {
    const title = decodeEntities(m[4]);
    if (isAnimeTitleText(title)) add(absolute(m[2], base), title, '');
  }

  return [...byUrl.values()].filter((item) => item.title || item.img);
}

/** og:image / first uploads image on a post page. */
export function extractPostImage(html) {
  const text = String(html || '');
  const og =
    (text.match(/<meta\b[^>]*property=("|')og:image[^"']*\1[^>]*content=("|')([^"']+)\2/i) || [])[3] ||
    (text.match(/<meta\b[^>]*content=("|')([^"']+)\1[^>]*property=("|')og:image[^"']*\3/i) || [])[2];
  if (og) return decodeEntities(og);
  const uploads = text.match(/https?:\/\/[^"'\s)]+\/wp-content\/uploads\/[^"'\s)]+\.(?:jpe?g|png|webp)/i);
  return uploads ? uploads[0] : '';
}

export function pageTitle(html) {
  const text = String(html || '');
  const og =
    (text.match(/<meta\b[^>]*property=("|')og:title\1[^>]*content=("|')([^"']+)\2/i) || [])[3] ||
    (text.match(/<meta\b[^>]*content=("|')([^"']+)\1[^>]*property=("|')og:title\3/i) || [])[2];
  if (og) return decodeEntities(og);
  const h1 = text.match(/<h1\b[^>]*>([\s\S]{0,300}?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  const title = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title ? stripTags(title[1]) : '';
}

/** Is this same-host URL a post (not a listing, feed, asset or admin page)? */
export function isPostUrl(url, base = '') {
  let u;
  try {
    u = new URL(url, base || undefined);
  } catch {
    return false;
  }
  if (u.search || u.hash) return false;
  if (/\/[^/]+\/?$/.test(u.pathname) === false) return false;
  if (/\/(wp-json|wp-content|wp-admin|wp-includes|feed|rss)/i.test(u.pathname)) return false;
  if (/\.(?:css|js|png|jpe?g|webp|gif|svg|ico|woff2?|xml|json|txt|mp4|zip|apk)$/i.test(u.pathname)) return false;
  if (SKIP_PATH.test(u.pathname)) return false;
  if (LISTING_HINTS.some((re) => re.test(u.pathname) || re.test(u.pathname + u.search))) return false;
  const slug = u.pathname.replace(/^\/|\/$/g, '');
  if (slug.length < 3 || slug.split('/').length > 1) return false;
  return true;
}

function isAnimeTitleText(text) {
  const value = stripTags(text);
  return value.length >= 3 && !NON_ANIME.test(value) && !TITLE_BLOCK.test(value) && ANIME_SIGNAL.test(value);
}

function hostOf(base) {
  try {
    return new URL(base).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sameHost(url, host) {
  if (!host) return true;
  try {
    return new URL(url).host.replace(/^www\./, '') === host;
  } catch {
    return false;
  }
}

function absolute(url, base) {
  try {
    return new URL(String(url), base || undefined).toString().split('#')[0];
  } catch {
    return '';
  }
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function dropsDate() {
  if (process.env.DROPS_DATE) return process.env.DROPS_DATE;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** Fold one listing item into the state map (keeps the first date seen). */
export function mergeDropItem(items, item, day, baselineRun) {
  const key = item.slug;
  const existing = items[key];
  if (existing) {
    items[key] = {
      ...existing,
      title: item.title || existing.title,
      img: item.img || existing.img,
      url: item.url || existing.url,
      tags: [...new Set([...(existing.tags || []), ...(item.tags || [])])],
    };
    return items[key];
  }
  items[key] = {
    slug: item.slug,
    title: item.title,
    kind: item.kind || 'tv',
    url: item.url,
    img: item.img || '',
    year: item.year || '',
    tags: item.tags || [],
    firstSeen: item.date || day,
    baseline: baselineRun,
  };
  return items[key];
}

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { timeoutMs = 20000, retries = 1, probe = null } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.text();
      if (probe) probe.push({ url, status: res.status, type: res.headers.get('content-type') || '', bytes: body.length, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return body;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(600);
    }
  }
  throw lastError;
}

async function discoverFromRest(base, verbose) {
  const items = [];
  for (const endpoint of [
    '/wp-json/wp/v2/posts?per_page=100&orderby=date&order=desc',
    '/wp-json/wp/v2/posts?per_page=100&orderby=date&order=desc&page=2',
  ]) {
    try {
      const raw = await fetchText(base + endpoint);
      const rows = parseRestPosts(raw, base);
      if (verbose) console.log(`  REST ${endpoint.split('?')[0]} → ${rows.length} posts`);
      if (!rows.length) break;
      items.push(...rows);
    } catch (err) {
      if (verbose) console.log(`  REST miss (${endpoint.split('?')[0]}): ${err.message}`);
      break;
    }
  }
  return items;
}

async function discoverFromSitemaps(base, verbose) {
  const seen = [];
  const queue = ['/wp-sitemap.xml', '/sitemap_index.xml', '/post-sitemap.xml', '/sitemap.xml'];
  const visited = new Set();
  while (queue.length && visited.size < 12) {
    const path = queue.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    try {
      const xml = await fetchText(base + path, { retries: 0 });
      const rows = parseSitemapXml(xml);
      const nested = rows.filter((r) => r.nested || /\.xml($|\?)/i.test(r.url));
      const posts = rows.filter((r) => !nested.includes(r));
      if (verbose) console.log(`  sitemap ${path} → ${rows.length} locs (${nested.length} nested)`);
      for (const n of nested.slice(0, 8)) {
        const nestedPath = n.url.startsWith('http') ? n.url : base + n.url;
        if (visited.has(nestedPath)) continue;
        visited.add(nestedPath);
        try {
          const child = parseSitemapXml(await fetchText(nestedPath, { retries: 0 }));
          posts.push(...child.filter((r) => !r.nested));
        } catch (err) {
          if (verbose) console.log(`  nested sitemap miss ${nestedPath}: ${err.message}`);
        }
      }
      seen.push(...posts);
      if (seen.length) break;
    } catch (err) {
      if (verbose) console.log(`  sitemap miss ${path}: ${err.message}`);
    }
  }
  return seen.map((r) => ({ url: r.url, date: r.lastmod }));
}

async function discoverFromHtml(base, verbose) {
  const found = [];
  for (const path of ['/', '/?s=anime', '/anime/', '/category/anime/', '/page/2/']) {
    let html;
    try {
      html = await fetchText(base + path, { retries: 0 });
    } catch (err) {
      if (verbose) console.log(`  listing miss ${path}: ${err.message}`);
      continue;
    }
    const items = parseHtmlListing(html, base);
    if (verbose) console.log(`  listing ${path} → ${items.length} post links`);
    found.push(...items);
    await sleep(250);
  }
  // Extra listing pages only when the site paginates.
  for (let page = 2; page <= MAX_LISTING_PAGES; page++) {
    try {
      const items = parseHtmlListing(await fetchText(`${base}/page/${page}/`, { retries: 0 }), base);
      if (!items.length) break;
      if (verbose) console.log(`  listing /page/${page}/ → ${items.length} post links`);
      found.push(...items);
    } catch {
      break;
    }
  }
  return found;
}

function slugFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\/|\/$/g, '').split('/').pop();
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Harvest                                                             */
/* ------------------------------------------------------------------ */

async function harvest({ base, limit, maxArt, verbose, probe }) {
  const requests = probe ? [] : null;
  const candidates = new Map();
  const addCandidate = (url, title, img, date) => {
    if (!url || !isPostUrl(url, base)) return;
    const slug = slugFromUrl(url);
    if (!slug) return;
    const existing = candidates.get(slug) || {};
    candidates.set(slug, {
      slug,
      url,
      title: existing.title || title || '',
      img: existing.img || img || '',
      date: existing.date || date || '',
    });
  };

  console.log('deadtoons: discovery');
  const rest = await discoverFromRest(base, verbose).catch((err) => (console.log(`  REST failed: ${err.message}`), []));
  for (const row of rest) {
    const clean = cleanAnimeTitle(row.title || titleFromSlug(slugFromUrl(row.url)).title);
    addCandidate(row.url, isAnimeListing(row.title, { animeScoped: true }) ? clean.title : '', row.img, row.date);
  }
  if (!candidates.size) {
    const sitemap = await discoverFromSitemaps(base, verbose).catch((err) => (console.log(`  sitemaps failed: ${err.message}`), []));
    for (const row of sitemap) {
      const clean = titleFromSlug(slugFromUrl(row.url));
      addCandidate(row.url, isAnimeListing(clean.title, { animeScoped: true }) ? clean.title : '', '', row.date);
    }
  }
  if (!candidates.size) {
    const html = await discoverFromHtml(base, verbose).catch((err) => (console.log(`  listings failed: ${err.message}`), []));
    for (const row of html) addCandidate(row.url, row.title, row.img, '');
  }

  const all = [...candidates.values()].map((c) => {
    const clean = c.title ? cleanAnimeTitle(c.title) : titleFromSlug(c.slug);
    return { ...c, title: clean.title, year: clean.year };
  }).filter((c) => c.title && c.title.length > 2 && !TITLE_BLOCK.test(c.title));

  console.log(`deadtoons: ${all.length} candidate posts`);
  const known = new Set();
  const items = [];
  for (const item of all) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (known.has(key)) continue;
    known.add(key);
    items.push(item);
    if (items.length >= limit) break;
  }
  console.log(`deadtoons: ${items.length} unique anime titles`);

  // Artwork for entries the listings did not carry.
  let artFetches = 0;
  for (const item of items) {
    if (item.img && item.img.startsWith('http')) continue;
    if (artFetches >= maxArt) break;
    artFetches += 1;
    try {
      const html = await fetchText(item.url, { timeoutMs: 15000, retries: 0 });
      item.img = extractPostImage(html);
      const title = cleanAnimeTitle(pageTitle(html) || '');
      if (title.title) item.title = title.title;
      item.year = item.year || title.year;
    } catch (err) {
      if (verbose) console.log(`  art miss ${item.url}: ${err.message}`);
    }
    await sleep(300);
  }
  console.log(`deadtoons: artwork for ${artFetches} post(s)`);

  return { items, probe: requests };
}

async function probeSite(base, verbose) {
  console.log(`deadtoons: probing ${base}`);
  const requests = [];
  const paths = [
    '/',
    '/wp-json/wp/v2/posts?per_page=5&orderby=date&order=desc',
    '/wp-json/wp/v2/search?search=anime&per_page=5',
    '/wp-sitemap.xml',
    '/post-sitemap.xml',
    '/?s=anime',
    '/anime/',
    '/category/anime/',
  ];
  for (const path of paths) {
    try {
      await fetchText(base + path, { retries: 0, timeoutMs: 15000, probe: requests });
    } catch (err) {
      requests.push({ url: base + path, status: `error: ${err.message}`, bytes: 0, body: '' });
    }
    const last = requests[requests.length - 1];
    console.log(`  ${path} → ${last.status} · ${last.type || ''} · ${last.bytes} bytes`);
    const posts = parseRestPosts(last.body || '', base);
    const sitemap = parseSitemapXml(last.body || '');
    const listing = parseHtmlListing(last.body || '', base);
    if (posts.length) console.log(`      REST posts: ${posts.slice(0, 3).map((p) => p.title).join(' | ')}`);
    if (sitemap.length) console.log(`      sitemap locs: ${sitemap.slice(0, 3).map((s) => s.url).join(' | ')}`);
    if (listing.length) console.log(`      listing: ${listing.slice(0, 3).map((p) => `${p.title}${p.img ? ' [img]' : ''}`).join(' | ')}`);
  }
  if (verbose) {
    for (const r of requests) {
      console.log(`  --- ${r.url}`);
      console.log(`      ${String(r.body || '').slice(0, 300).replace(/\s+/g, ' ')}`);
    }
  }
  const usable = requests.filter((r) => typeof r.status === 'number' && r.status < 400 && r.bytes > 200).length;
  console.log(`deadtoons: probe done — ${usable}/${requests.length} endpoints reachable`);
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function selfTest() {
  const failures = [];
  const check = (name, cond, extra = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${extra}`}`);
    if (!cond) failures.push(name);
  };

  check(
    'slug with tags and season',
    titleFromSlug('solo-leveling-season-2-hindi-dubbed-1080p-web-dl').title === 'Solo Leveling',
    titleFromSlug('solo-leveling-season-2-hindi-dubbed-1080p-web-dl').title,
  );
  check(
    'slug with episode number',
    titleFromSlug('one-piece-episode-1096-hindi-dub-480p').title === 'One Piece',
    titleFromSlug('one-piece-episode-1096-hindi-dub-480p').title,
  );
  check('slug keeps punctuation', titleFromSlug('spy-x-family-hindi-dubbed').title === 'Spy x Family');
  check(
    'title with brackets/year',
    cleanAnimeTitle('Jujutsu Kaisen [Hindi Dubbed] 720p WEB-DL (2023)').title === 'Jujutsu Kaisen',
    cleanAnimeTitle('Jujutsu Kaisen [Hindi Dubbed] 720p WEB-DL (2023)').title,
  );
  check('year kept aside', cleanAnimeTitle('Blue Lock 2022 Hindi Dub 1080p').year === '2022');
  check('listing casing survives', cleanAnimeTitle('BanG Dream! - Season 1 Hindi').title === 'BanG Dream!');
  check('spy x family stays lowercase x', titleFromSlug('spy-x-family-season-3-hindi').title === 'Spy x Family');
  check('all-caps listing kept', cleanAnimeTitle('DAN DA DAN Episode 12 Hindi').title === 'DAN DA DAN');

  check('anime post accepted', isAnimeListing('Attack on Titan Season 4 Hindi Dubbed 1080p'));
  check('episode-only title accepted with scope', isAnimeListing('Ep 12', { animeScoped: true }));
  check('adult blocked', !isAnimeListing('Harem Camp! Episode 3 Hindi'));
  check('non-anime noise blocked', !isAnimeListing('Cricket Live Streaming App Mod'));

  const rest = JSON.stringify([
    { link: 'https://deadtoons.sbs/solo-leveling-season-2-hindi-dubbed/', date: '2026-10-15T06:00:00', title: { rendered: 'Solo Leveling Season 2 Hindi' } },
    { link: 'https://other.example/post/', date: '2026-10-15', title: { rendered: 'Off site' } },
  ]);
  const restItems = parseRestPosts(rest, 'https://deadtoons.sbs');
  check('REST parse keeps same-host only', restItems.length === 1 && restItems[0].date === '2026-10-15', JSON.stringify(restItems));

  const sitemap = `<sitemapindex><sitemap><loc>https://deadtoons.sbs/wp-sitemap-posts-post-1.xml</loc></sitemap></sitemapindex>`;
  check('sitemap nested detection', parseSitemapXml(sitemap)[0].nested === true);
  const postSitemap = `<urlset><url><loc>https://deadtoons.sbs/bleach-tybw-episode-2-hindi/</loc><lastmod>2026-10-14T10:00:00+00:00</lastmod></url></urlset>`;
  check('sitemap post loc', parseSitemapXml(postSitemap)[0].url.endsWith('/bleach-tybw-episode-2-hindi/'));
  check('sitemap lastmod date', parseSitemapXml(postSitemap)[0].lastmod === '2026-10-14');

  const listing = `<html><body>
    <article><a href="/kaiju-no-8-season-2-episode-3-hindi-dub/"><img src="/wp-content/uploads/2026/10/kaiju.jpg" alt="Kaiju"></a>
      <h2><a href="/kaiju-no-8-season-2-episode-3-hindi-dub/">Kaiju No. 8 Season 2 Episode 3 [Hindi Dubbed]</a></h2></article>
    <a href="/about/" title="About us">About</a>
    <a href="/wp-json/wp/v2/posts" title="Feed">Feed</a>
    <h3><a href="/dandadan-episode-12-hindi/">DAN DA DAN Episode 12</a></h3>
  </body></html>`;
  const parsed = parseHtmlListing(listing, 'https://deadtoons.sbs');
  check('listing keeps post links', parsed.length === 2, JSON.stringify(parsed.map((p) => p.title)));
  check('listing keeps artwork', parsed[0].img === 'https://deadtoons.sbs/wp-content/uploads/2026/10/kaiju.jpg', parsed[0].img);
  check('listing skips about page', !parsed.some((p) => /about/i.test(p.url)));
  check('listing title from heading', parsed.some((p) => /Kaiju No\. 8/i.test(p.title)));

  const postHtml = `<html><head><meta property="og:image" content="https://deadtoons.sbs/wp-content/uploads/2026/10/bleach.jpg"><title>Bleach TYBW Episode 2 Hindi | DeadToons</title></head><body><h1>Bleach TYBW Episode 2 Hindi</h1></body></html>`;
  check('og image', extractPostImage(postHtml) === 'https://deadtoons.sbs/wp-content/uploads/2026/10/bleach.jpg');
  check('page title from <title>', pageTitle(postHtml).startsWith('Bleach TYBW'));

  const state = { items: {} };
  const day = '2026-10-15';
  mergeDropItem(state.items, { slug: 'kaiju-no-8', title: 'Kaiju No. 8', url: 'https://deadtoons.sbs/kaiju-no-8/', img: 'a.jpg' }, day, true);
  mergeDropItem(state.items, { slug: 'kaiju-no-8', title: 'Kaiju No. 8', img: 'b.jpg' }, '2026-10-16', false);
  check('firstSeen sticks', state.items['kaiju-no-8'].firstSeen === day, state.items['kaiju-no-8'].firstSeen);
  check('baseline sticks', state.items['kaiju-no-8'].baseline === true);
  check('artwork upgrades in place', state.items['kaiju-no-8'].img === 'b.jpg');

  check('post url filter', isPostUrl('https://deadtoons.sbs/one-piece-episode-1/', 'https://deadtoons.sbs'));
  check('listing url rejected', !isPostUrl('https://deadtoons.sbs/category/anime/', 'https://deadtoons.sbs'));
  check('asset url rejected', !isPostUrl('https://deadtoons.sbs/wp-content/uploads/a.jpg', 'https://deadtoons.sbs'));

  if (failures.length) {
    console.error(`${failures.length} self-test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('All DeadToons drop self-tests passed (offline, no network).');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  const get = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const base = (get('base') || process.env.DEADTOONS_BASE || 'https://deadtoons.sbs').replace(/\/+$/, '');
  const limit = Number(get('limit') || 120);
  const maxArt = Number(get('max-art') || DEFAULT_MAX_ART);
  const dryRun = argv.includes('--dry-run');
  const verbose = argv.includes('--verbose');
  const probe = argv.includes('--probe');

  if (probe) {
    await probeSite(base, verbose);
    return;
  }

  const day = dropsDate();
  const { items } = await harvest({ base, limit, maxArt, verbose });

  if (!items.length) {
    console.error('No DeadToons listings parsed. Leaving files untouched.');
    process.exitCode = 1;
    return;
  }

  const state = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : null;
  const baselineRun = !state || !state.items || Object.keys(state.items).length === 0;
  const stateItems = state?.items || {};
  const before = Object.keys(stateItems).length;
  const fresh = [];
  for (const item of items) {
    const entry = mergeDropItem(stateItems, item, day, baselineRun);
    if (!entry.baseline && entry.firstSeen === (item.date || day)) fresh.push(entry.title);
  }

  console.log(
    `deadtoons: pool ${before} → ${Object.keys(stateItems).length} titles · ` +
      `new today: ${fresh.length}${fresh.length ? ` (${fresh.slice(0, 5).join(', ')})` : ''} · baseline run: ${baselineRun}`,
  );

  if (dryRun) {
    console.log('Dry run — nothing written.');
    console.log(JSON.stringify(items.slice(0, 3), null, 2));
    return;
  }

  writeFileSync(OUT_PATH, JSON.stringify({ updated: day, source: base, items: stateItems }, null, 2) + '\n');
  console.log(`Wrote ${OUT_PATH}. Run scripts/build-crunchyroll-new-drops.mjs to bake the row.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
