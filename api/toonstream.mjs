/**
 * ToonStream resolver — "Server 2" for the Crunchyroll page.
 *
 * GET /api/toonstream?title=<show name>&s=<season>&e=<episode>[&debug=1]
 *   -> { ok: true, episodeUrl, embeds: [...], servers: [{name,quality,url}] }
 *   -> { ok: false, error, steps? }
 *
 * How it finds the episode (verified against the live site, no guessing):
 *   1. Episode permalinks are the title slug plus `-<s>x<e>`:
 *      "Kaiju No. 8" S2E11 -> /episode/kaiju-no-8-2x11/  — so the direct URL
 *      is tried first, one request.
 *   2. On a miss (different spelling), the ?s=<title> search page is parsed
 *      for /series/<slug>/ links, the best title match wins, and the series
 *      page is scanned for the wanted `-<s>x<e>` episode link.
 *   3. The episode page lists player servers (Ruby/vidc/Moly/…, labelled
 *      480p/720p/1080p). Every iframe the page renders inline and every
 *      third-party player/download link is returned. Nothing is invented:
 *      only URLs literally present in the HTML come back.
 *
 * Same-origin for the page; hard fail-soft like api/resolve: the app always
 * gets a 200 JSON answer.
 */

const BASE = 'https://toonstream.us';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 18000;

const RATE = new Map();
function rateOk(ip) {
  const now = Date.now();
  const entry = RATE.get(ip);
  if (!entry || now >= entry.reset) {
    RATE.set(ip, { count: 1, reset: now + 60000 });
    return true;
  }
  entry.count += 1;
  if (RATE.size > 5000) RATE.clear();
  return entry.count <= 30;
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function getText(url, steps, label) {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  const text = await res.text();
  if (steps) steps.push({ step: label, status: res.status, ms: Date.now() - started });
  return { status: res.status, text };
}

/** "Kaiju No. 8!" -> "kaiju-no-8" — the site's own slug rule. */
function titleSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (t) => norm(t).split(' ').filter(Boolean);

/** Jaccard-style overlap so "Kaiju No. 8" still matches "Kaiju No.8 (Hindi)". */
function matchScore(queryTokens, candidate) {
  const have = new Set(tokens(candidate));
  if (!have.size) return 0;
  let hit = 0;
  for (const t of queryTokens) if (have.has(t)) hit += 1;
  return hit / queryTokens.length;
}

/** The wanted `-<s>x<e>` episode link from a series page, or null. */
function findEpisodeLink(html, season, episode) {
  const want = `-${season}x${episode}`;
  const links = extractEpisodeLinks(html);
  return links.find((href) => href.endsWith(want)) || null;
}

/** /series/<slug>/ hrefs with their link text, from any listing/search HTML. */
function extractSeriesLinks(html) {
  const out = new Map();
  const re = /<a[^>]+href=["'](?:https?:\/\/toonstream\.us)?(\/series\/[^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const slug = m[1].replace(/\/+$/, '');
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!out.has(slug)) out.set(slug, text);
  }
  return [...out.entries()].map(([slug, text]) => ({ slug, text }));
}

function extractEpisodeLinks(html) {
  const out = new Set();
  const re = /href=["'](?:https?:\/\/toonstream\.us)?(\/episode\/[^"'#]+)["']/gi;
  for (const m of html.matchAll(re)) out.add(m[1].replace(/\/+$/, ''));
  return [...out];
}

const VIDEO_HOST =
  /(rubystm|filesforever|vidmoly|upns\.pro|openx\.xyz|blakiteapi|voe\.sx|voeunblk|streamwish|filelions|vidhide|mp4upload|awish|dhcplay|luluvdo|smoothpre|megacloud|vidara)/i;

/** Every iframe src on the episode page (the inline embeds, if any). */
function extractIframes(html) {
  const out = [];
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1].trim();
    if (!/^https?:\/\//i.test(src)) continue;
    if (/toonstream\.us|a-ads|adservice|doubleclick/i.test(src)) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out;
}

/**
 * Third-party player/download links with the quality label closest to them
 * (the rows render as "… <host> … Multi Audio … 1080p … [link]").
 */
function extractServers(html) {
  const out = [];
  const seen = new Set();
  const re = /href=["'](https?:\/\/[^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    const url = m[1];
    if (!VIDEO_HOST.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const from = Math.max(0, m.index - 400);
    const before = html.slice(from, m.index);
    const host = String(url.match(/https?:\/\/([^/]+)/)[1]).replace(/^www\./, '');
    // The quality label sits just before its link; the NEAREST one wins (rows
    // sit back to back, so a wider window would leak the previous row's label).
    const labels = [...before.matchAll(/(\d{3,4})p/gi)];
    const q = labels.length ? labels[labels.length - 1][1] : '';
    out.push({
      name: host.split('.')[0],
      quality: q ? `${q}p` : '',
      url,
    });
  }
  return out;
}

function pickEmbed(embeds) {
  // Prefer a player that is not an obvious ad frame; keep site order.
  return embeds.find((src) => VIDEO_HOST.test(src)) || embeds[0] || null;
}

async function resolveEpisode({ title, season, episode }, steps) {
  const direct = `${BASE}/episode/${titleSlug(title)}-${season}x${episode}/`;
  let page = await getText(direct, steps, 'episode-direct');
  if (page.status === 200) {
    return { episodeUrl: direct, html: page.text, via: 'direct' };
  }

  const search = await getText(`${BASE}/?s=${encodeURIComponent(title)}`, steps, 'search');
  if (search.status !== 200) return null; // no search page -> nothing we can match
  const seriesLinks = extractSeriesLinks(search.text);
  if (steps) {
    steps.push({
      step: 'series-candidates',
      count: seriesLinks.length,
      names: seriesLinks.slice(0, 6).map((s) => s.text || s.slug),
    });
  }
  const q = tokens(title);
  const ranked = seriesLinks
    .map((link) => ({ ...link, score: matchScore(q, link.text || link.slug) }))
    .sort((a, b) => b.score - a.score);
  for (const candidate of ranked.filter((c) => c.score > 0).slice(0, 3)) {
    const seriesPage = await getText(`${BASE}${candidate.slug}/`, steps, 'series');
    if (seriesPage.status !== 200) continue;
    const epLink = findEpisodeLink(seriesPage.text, season, episode);
    if (epLink) {
      const epUrl = epLink.startsWith('http') ? epLink : `${BASE}${epLink}/`;
      page = await getText(epUrl, steps, 'episode');
      if (page.status === 200) {
        return { episodeUrl: epUrl, html: page.text, via: 'search' };
      }
    }
  }
  return null;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method-not-allowed' });
    return;
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'ip').split(',')[0].trim();
  if (!rateOk(ip)) {
    res.status(429).json({ ok: false, error: 'rate-limited' });
    return;
  }

  const title = String(req.query.title || '').trim();
  const season = String(Math.max(1, parseInt(String(req.query.s || '1'), 10) || 1));
  const episode = String(Math.max(1, parseInt(String(req.query.e || '1'), 10) || 1));
  const debug = req.query.debug === '1';
  if (!title) {
    res.status(400).json({ ok: false, error: 'missing-title' });
    return;
  }

  const steps = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  try {
    if (Date.now() > deadline) throw new Error('budget-exhausted');
    const found = await resolveEpisode({ title, season, episode }, steps);
    if (!found) {
      res.status(200).json({
        ok: false,
        error: 'no-episode',
        ...(debug ? { steps, hint: `${title} S${season}E${episode} not on toonstream (or spelled differently)` } : {}),
      });
      return;
    }

    const embeds = extractIframes(found.html);
    const servers = extractServers(found.html);
    const chosen = pickEmbed(embeds);
    if (steps) {
      steps.push({ step: 'parsed', iframes: embeds.length, servers: servers.length });
    }

    res.status(200).json({
      ok: true,
      title,
      season: Number(season),
      episode: Number(episode),
      episodeUrl: found.episodeUrl,
      via: found.via,
      embeds,
      chosen,
      servers: servers.slice(0, 12),
      ...(debug ? { steps } : {}),
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      error: String((err && err.message) || 'toonstream-failed').slice(0, 120),
      ...(debug ? { steps } : {}),
    });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.config = { maxDuration: 30 };

// Exposed for tests.
module.exports._internal = { titleSlug, extractSeriesLinks, extractEpisodeLinks, findEpisodeLink, extractIframes, extractServers, matchScore };
