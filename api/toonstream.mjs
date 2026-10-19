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
  const frameBlocked =
    res.headers.has('x-frame-options') ||
    /frame-ancestors/i.test(String(res.headers.get('content-security-policy') || ''));
  return { status: res.status, text, frameBlocked };
}

/** "Kaiju No. 8!" -> "kaiju-no-8" — the site's own slug rule. */
function titleSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[\u2019'\u2032`]/g, '') // the site drops apostrophes: jojo's -> jojos
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
 * The site's own player slots: `id="options-N"` divs each wrap one player
 * iframe (slot 0 is the sidebar's SERVER 1 "PLAY"). Lazy slots carry the URL
 * in data-src. Returns [{slot, url}] in slot order, trailer frames skipped.
 */
function extractPlayerSlots(html) {
  const out = [];
  const divs = [...html.matchAll(/id="options-(\d+)"/g)];
  for (let i = 0; i < divs.length; i++) {
    const slot = parseInt(divs[i][1], 10);
    const end = i + 1 < divs.length ? divs[i + 1].index : Math.min(html.length, divs[i].index + 1600);
    const seg = html.slice(divs[i].index, end);
    const f = seg.match(/(?:data-src|src)="(https?:\/\/[^"]+)"/i);
    if (!f) continue;
    const url = f[1].trim();
    if (/youtube|youtu\.be|dailymotion/i.test(url)) continue;
    if (!out.some((o) => o.slot === slot)) out.push({ slot, url });
  }
  return out;
}

/**
 * The site's server switcher (rendered client-side) promotes three servers
 * to the top of its sidebar: SERVER 1 "PLAY" (the default options-0 player),
 * then the "Short" row, then the "MultiQ" row. Download row N maps to player
 * slot N-1 (verified against live pages). We replicate that order here.
 */
function extractSiteServers(html) {
  const slots = extractPlayerSlots(html);
  const rowNames = extractServerNames(html);
  const byRow = (row) => slots.find((x) => x.slot === row - 1) || null;
  const findRow = (re) => {
    for (const k of Object.keys(names())) if (re.test(names()[k])) return parseInt(k, 10);
    return 0;
  };
  const names = () => rowNames;
  const out = [];
  const first = byRow(1);
  if (first) out.push({ name: 'Play', url: first.url });
  for (const re of [/^short$/i, /multi\s*q/i]) {
    const row = findRow(re);
    const sl = row ? byRow(row) : null;
    if (sl && !out.some((o) => o.url === sl.url)) out.push({ name: names()[String(row)] || 'Server', url: sl.url });
  }
  for (const sl of slots) {
    if (out.length >= 3) break;
    if (sl.slot === 0 && out.some((o) => o.url === sl.url)) continue;
    if (!out.some((o) => o.url === sl.url)) {
      out.push({ name: names()[String(sl.slot + 1)] || `S${sl.slot + 1}`, url: sl.url });
    }
  }
  return out.slice(0, 3);
}

/**
 * Sidebar row names: <span class="hex-number">01</span> ... <span class="server-name">Play</span>.
 * Returns {'1': 'Play', '2': 'Short', ...}.
 */
function extractServerNames(html) {
  const names = {};
  for (const m of html.matchAll(/hex-number">\s*(\d+)\s*<\/span>[\s\S]{0,500}?server-name">\s*([^<]+?)\s*</gi)) {
    names[String(parseInt(m[1], 10))] = m[2];
  }
  return names;
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
  // Toonstream's own Server 1 ("PLAY") is the first iframe on the episode
  // page and the only one the site itself autoplays - always pick it. Just
  // skip obvious non-player frames (trailers). Host-regex guesses come last:
  // named rows like "Ruby" are often dead even on toonstream itself.
  const players = embeds.filter((src) => !/(youtube|youtu\.be|dailymotion)/i.test(src));
  const list = players.length ? players : embeds;
  return list[0] || embeds.find((src) => VIDEO_HOST.test(src)) || null;
}

async function resolveEpisode({ title, slug, season, episode }, steps) {
  // EP_DATA slugs are copied from toonstream URLs, so they beat any guess.
  const direct = `${BASE}/episode/${titleSlug(slug || title)}-${season}x${episode}/`;
  let page = await getText(direct, steps, 'episode-direct');
  if (page.status === 200) {
    return { episodeUrl: direct, html: page.text, via: 'direct', frameBlocked: !!page.frameBlocked };
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
  const slug = String(req.query.slug || '').trim();
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
    const found = await resolveEpisode({ title, slug, season, episode }, steps);
    if (!found) {
      res.status(200).json({
        ok: false,
        error: 'no-episode',
        ...(debug ? { steps, hint: `${title} S${season}E${episode} not on toonstream (or spelled differently)` } : {}),
      });
      return;
    }

    if (String(req.query.raw || '') === '1') {
      // Debug aid: windows around player/server-relevant markup, base64 so
      // markdown fetchers cannot mangle the tags.
      const html = found.html;
      const wins = [];
      const re = /iframe|player|data-litespeed|server-|epsdsnv| Watching |serverList/gi;
      for (const m of html.matchAll(re)) {
        const at = m.index || 0;
        wins.push(html.slice(Math.max(0, at - 250), at + 700));
        if (wins.length >= 30) break;
      }
      // The right-sidebar switcher ("SERVER 1 PLAY / 2 SHORT / ...") sits
      // after the download rows - dump that region explicitly.
      const si = html.search(/SERVER\s*1/i);
      const side = si === -1 ? 'NO-SERVER-1-MARKER' : html.slice(Math.max(0, si - 2000), si + 7000);
      const sB64 = Buffer.from(side).toString('base64');
      const b64 = Buffer.from([...new Set(wins)].join('\n~~~\n')).toString('base64');
      return res.status(200).json({ ok: true, frameBlocked: !!found.frameBlocked, sB64, b64 });
    }
    if (String(req.query.servers || '') === '1') {
      const cfg = await getText(`${BASE}/public/servers`, steps, 'servers-config');
      return res.status(200).json({ ok: true, status: cfg.status, body: cfg.text.slice(0, 8000) });
    }
    if (String(req.query.raw || '') === '1x') {
      // Structured debug: every player slot, every named row, every script
      // that could build the client-side sidebar, plus our own picks.
      const opts = [];
      for (const m of found.html.matchAll(/<div[^>]*id="options-(\d+)"[^>]*>/gi)) {
        const seg = found.html.slice(m.index, Math.min(found.html.length, m.index + 2500));
        const f = seg.match(/(?:data-src|src)="(https?:\/\/[^"]+)"/i);
        opts.push({ s: parseInt(m[1], 10), on: /class="[^"]*\bon\b/.test(m[0]), u: f ? f[1] : null });
      }
      const rows = extractServerNames(found.html);
      const scripts = [];
      for (const m of found.html.matchAll(/<script([^>]*)>([\s\S]{0,80000}?)<\/script>/gi)) {
        const attrs = m[1] || '';
        const body = m[2] || '';
        if (attrs.includes('src=')) {
          const sm = attrs.match(/src="([^"]+)"/);
          if (sm && /custom|server|player|torofill|single/i.test(sm[1])) scripts.push({ ext: sm[1] });
        } else if (/options-|SERVER 1|aa-tb|switchS|playS|serverList|hex-number/i.test(body)) {
          scripts.push({ inline: body.slice(0, 9000) });
        }
      }
      const tsi = found.html.search(/aa-tbs-video/);
      const tbs = tsi === -1 ? 'NO-TBS' : found.html.slice(Math.max(0, tsi - 300), tsi + 9000);
      const b64 = Buffer.from(JSON.stringify({ opts, rows, tbs, scripts: scripts.slice(0, 8), mine: extractSiteServers(found.html) })).toString('base64');
      return res.status(200).json({ ok: true, b64 });
    }
    const embeds = extractIframes(found.html);
    // Only the site's first three servers (SERVER 1/2/3 in the sidebar),
    // named from the page's own server list - everything else is dropped.
    let siteServers = extractSiteServers(found.html);
    if (!siteServers.length) {
      siteServers = embeds.slice(0, 3).map((url, i) => ({ name: `S${i + 1}`, url }));
    }
    const chosen = siteServers[0] ? siteServers[0].url : pickEmbed(embeds);
    const embeds3 = siteServers.map((x) => x.url);
    if (steps) {
      steps.push({ step: 'parsed', iframes: embeds.length, servers: siteServers.length });
    }

    res.status(200).json({
      ok: true,
      title,
      season: Number(season),
      episode: Number(episode),
      episodeUrl: found.episodeUrl,
      via: found.via,
      embeds: embeds3,
      chosen,
      servers: siteServers,
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

// ESM exports: on Vercel this file is imported as a real ES module.
export default handler;
export const config = { maxDuration: 30 };

// Exposed for tests.
export const _internal = { titleSlug, extractSeriesLinks, extractEpisodeLinks, findEpisodeLink, extractIframes, extractPlayerSlots, extractServerNames, extractSiteServers, extractServers, matchScore, pickEmbed };
