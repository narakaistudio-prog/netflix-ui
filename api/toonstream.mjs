/**
 * ToonStream resolver — "Server 2" for the Crunchyroll page.
 *
 * GET /api/toonstream?title=<show name>&s=<season>&e=<episode>[&debug=1]
 *   -> { ok: true, episodeUrl, embeds: [...], servers: [{name,quality,url}] }
 * GET /api/toonstream?type=movie&title=<movie name>[&slug=<site slug>]
 *   -> { ok: true, movieUrl, embeds: [...], servers: [{name,url}] }
 *      (movies live on /movies/<slug>; no season/episode coordinates)
 *   -> { ok: false, error, steps? }
 *
 * How it finds the episode (verified against the live site, no guessing):
 *   1. Episode permalinks are the title slug plus `-<s>x<e>`:
 *      "Kaiju No. 8" S2E11 -> /episode/kaiju-no-8-2x11/  — so the direct URL
 *      is tried first, one request.
 *   2. On a miss, the SSR search page /s?q=<title> is parsed for series links
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

/**
 * "Kaiju No. 8!" -> "kaiju-no-8" — the site's own slug rule.
 *
 * The site is inconsistent about punctuation: older posts drop it
 * ("jojos-bizarre-adventure-6x1"), newer ones keep it
 * ("jojo's-bizarre-adventure-4x1", "mushoku-tensei:-jobless-reincarnation-3x1").
 * `keep` selects the characters to preserve: true means ':' (back-compat),
 * or pass a string such as ":'".
 */
function titleSlug(title, keep = false) {
  const keepSet = keep === true ? ':' : String(keep || '');
  const keepsApos = keepSet.includes("'");
  let s = String(title || '')
    .toLowerCase()
    .replace(/[\u2019\u2032`]/g, "'"); // curly/backtick apostrophes -> straight
  if (!keepsApos) s = s.replace(/'/g, ''); // older slugs: jojo's -> jojos
  s = s.replace(/&/g, ' and ');
  s = keepSet
    ? s.replace(new RegExp(`[^a-z0-9${keepSet.replace(/[^\s]/g, (c) => (c === ':' || c === "'" ? c : ''))}]+`, 'g'), '-')
    : s.replace(/[^a-z0-9]+/g, '-');
  return s.replace(/^-+|-+$/g, '');
}

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (t) => norm(t).split(' ').filter(Boolean);

/** Fresh Drop rail ka safety ceiling — asli row isse chhoti hoti hai. */
const MAX_FRESH_DROPS = 200;

/** Jaccard-style overlap so "Kaiju No. 8" still matches "Kaiju No.8 (Hindi)". */
function matchScore(queryTokens, candidate) {
  const have = new Set(tokens(candidate));
  if (!have.size) return 0;
  let hit = 0;
  for (const t of queryTokens) if (have.has(t)) hit += 1;
  let score = hit / queryTokens.length;
  // Punctuation-split titles still have to match: "Re:ZERO" -> re|zero is
  // the site's single token "rezero-starting-life-in-another-world".
  const qCompact = queryTokens.join('');
  const cCompact = [...have].join('');
  if (qCompact.length >= 4 && cCompact.includes(qCompact)) score = Math.max(score, 0.9);
  return score;
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
  // Ground truth from toonstream's own /public/servers config: the sidebar
  // labels three promoted hosts - SERVER 1 "Play" (ravok.buzz, the site's
  // default player), SERVER 2 "Short" (abyssplayer.com), SERVER 3 "MultiQ"
  // (blakiteapi.xyz). Ruby/StreamRuby is server #14 there and must never be
  // used for the Play chip.
  const PROMOTED = [
    { label: 'Play', hosts: ['ravok.buzz', 'as-cdn26.top'] },
    { label: 'Short', hosts: ['abyssplayer.com'] },
    { label: 'MultiQ', hosts: ['blakiteapi.xyz'] },
  ];
  const slots = extractPlayerSlots(html);
  const out = [];
  for (const { label, hosts } of PROMOTED) {
    const sl = slots.find((x) => hosts.some((h) => x.url.includes(h)));
    if (sl) out.push({ name: label, url: sl.url });
  }
  if (!out.length) {
    // Hosts rotated someday: degrade to the page's first three players.
    return slots.slice(0, 3).map((x, i) => ({ name: `S${i + 1}`, url: x.url }));
  }
  return out;
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

const stripTags = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ movies */

/**
 * Movies live on a **different URL shape**: `/movies/<slug>` (plural), while
 * series use `/series/<slug>` + `/episode/<slug>-<s>x<e>`. Owner: "jo movies
 * jitna hai na humne unka toonstream server nahi lagya hai unka laga do".
 * The page markup is the same otherwise, so the server parser is reused.
 */
function extractMovieLinks(html) {
  const out = new Map();
  // Search cards render the poster + title inside the card and link it from
  // an anchor whose text is often just "View Movie" — so the slug itself is
  // what we keep, and it is scored against the wanted title later.
  const re = /href=["'](?:https?:\/\/toonstream\.us)?(\/movies\/[^"'#?]+)["']/gi;
  for (const m of html.matchAll(re)) {
    const slug = m[1].replace(/^\/movies\//, '').replace(/\/+$/, '');
    if (!slug) continue;
    out.set(slug, (out.get(slug) || 0) + 1);
  }
  return [...out.keys()];
}

/** "Spirited Away - Movie - ToonStream" -> "Spirited Away". */
function moviePageTitle(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html || ''));
  const raw = h1 ? h1[1] : (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''))?.[1] || '');
  return stripTags(raw).replace(/\s*[-|]\s*Movie\s*[-|]\s*ToonStream.*$/i, '').trim();
}

/**
 * Movie page for one catalog title.
 *
 * 1. The baked slug (`TS_MOVIES[key].slug`) is tried first: it came from the
 *    site itself, so zero guessing.
 * 2. Otherwise the site search (`/s?q=<title>&type=movies`) is parsed for
 *    `/movies/<slug>` links, ranked by title-token overlap.
 * 3. Every candidate page must actually name the movie AND carry player slots
 *    (`id="options-N"`); a 404 or a title card with no players is rejected, so
 *    "jisse movie ka na mile usse rehne dena" holds.
 */
async function resolveMovie({ title, slug }, steps) {
  const wanted = tokens(title);
  const probed = new Set();

  const tryPage = async (candidateSlug, via) => {
    if (!candidateSlug || probed.has(candidateSlug)) return null;
    probed.add(candidateSlug);
    const url = `${BASE}/movies/${candidateSlug}`;
    const page = await getText(url, steps, `movie-${via}`);
    if (page.status !== 200) return null;
    const pageTitle = moviePageTitle(page.text);
    // Search hits can point at a sequel/spin-off — "Another World" par search
    // "Re:ZERO … The Frozen Bond" bhi de deta hai (dono tokens mil jate hain).
    // Isliye sirf token overlap nahi: page ka title wanted se bahut lamba na ho.
    const extraWords = pageTitle ? tokens(pageTitle).length - wanted.length : 99;
    const score = pageTitle ? matchScore(wanted, pageTitle) : 0;
    if (!pageTitle || score < 0.6 || extraWords > 2) {
      if (steps) steps.push({ step: 'movie-rejected', slug: candidateSlug, got: pageTitle.slice(0, 60), score: +score.toFixed(2), extraWords });
      return null;
    }
    // Movie pages carry the same `options-N` slots as episodes; if the site
    // ever ships them as bare iframes instead, fall back to those (trailers
    // are not players, same rule as the episode path).
    let servers = extractSiteServers(page.text);
    if (!servers.length) {
      const iframes = extractIframes(page.text).filter((src) => !/(youtube|youtu\.be|dailymotion)/i.test(src));
      servers = iframes.slice(0, 3).map((url, index) => ({ name: `S${index + 1}`, url }));
    }
    if (!servers.length) {
      if (steps) steps.push({ step: 'movie-no-servers', slug: candidateSlug });
      return null;
    }
    return { movieUrl: url, html: page.text, via, title: pageTitle, servers, score };
  };

  if (slug) {
    const direct = await tryPage(String(slug).trim().replace(/^\/+|\/+$/g, ''), 'baked');
    if (direct) return direct;
  }

  // The site's own slug rule, same as series (apostrophes/colons dropped).
  const guesses = [...new Set([titleSlug(title), titleSlug(title, ':'), titleSlug(title, "'")])];
  for (const guess of guesses) {
    const hit = await tryPage(guess, 'guess');
    if (hit) return hit;
  }

  // NOTE: `&type=movies` **query ko ignore** kar deta hai — site har title ke
  // liye wahi generic movie list (Shrek, Toy Story…) lauta deta hai. Isliye
  // plain search, aur usme se sirf /movies/<slug> links.
  const search = await getText(`${BASE}/s?q=${encodeURIComponent(title)}`, steps, 'movie-search');
  if (search.status !== 200) return null;
  if (steps) steps.push({ step: 'movie-search', status: search.status, links: extractMovieLinks(search.text).length });
  const ranked = extractMovieLinks(search.text)
    .map((candidate) => ({ slug: candidate, score: matchScore(wanted, candidate.replace(/-/g, ' ')) }))
    .filter((row) => row.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  if (steps) steps.push({ step: 'movie-candidates', count: ranked.length, names: ranked.slice(0, 6).map((r) => r.slug) });
  for (const candidate of ranked.slice(0, 4)) {
    const hit = await tryPage(candidate.slug, 'search');
    if (hit) return hit;
  }
  return null;
}

/**
 * The home page's "Fresh Drops" rail: whatever the section links (series or
 * episode pages), one card per target, with its poster and label. Returns
 * [{title, slug, img, url, episode}] — episode is set when the card pointed
 * straight at an episode page (so the app can play that exact episode).
 */
function parseFreshDrops(html) {
  if (!html) return [];
  // The rail is announced by its own section heading ("Fresh Drop").
  const headingRe = /<h[1-6][^>]*>([\s\S]{0,300}?)<\/h[1-6]>/gi;
  let start = -1;
  for (const m of html.matchAll(headingRe)) {
    if (!/fresh\s*drops?/i.test(stripTags(m[1]))) continue;
    start = (m.index || 0) + m[0].length;
    break;
  }
  if (start === -1) return [];
  // Cards of the next sections must not leak in: the rail ends where the
  // following section title starts.
  const nextSection = html.indexOf('section-title', start);
  const end = nextSection > start ? nextSection : Math.min(html.length, start + 120000);
  const seg = html.slice(start, end);

  const decode = (v) =>
    stripTags(String(v || ''))
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');

  const items = [];
  const seen = new Set();
  // Live markup: <article class="post ..."> with the poster, "Season N"
  // (post-ql), "EP N" (year), the title (entry-title/alt) and a trailing
  // <a class="lnk-blk" href="/episode/<slug>-<S>x<E>/">.
  for (const m of seg.matchAll(/<article\b[\s\S]*?<\/article>/gi)) {
    const block = m[0];
    const hrefMatch = block.match(/href=["']([^"']*\/(?:episode|series)\/[^"']*)["']/i);
    if (!hrefMatch) continue;
    let href = decode(hrefMatch[1]).replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!href.startsWith('/')) {
      const abs = href.match(/^https?:\/\/toonstream\.us(\/[^?#]*)/i);
      if (!abs) continue;
      href = abs[1];
    }
    if (!/^\/(series|episode)\//.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const imgMatch = block.match(/<img\b[^>]*src=["']([^"']+)["']/i);
    const altMatch = block.match(/<img\b[^>]*alt=["']([^"']*)["']/i);
    const titleMatch = block.match(/class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const title = decode(titleMatch ? titleMatch[1] : altMatch ? altMatch[1] : '');
    const seasonMatch = block.match(/class=["'][^"']*post-ql[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const epMatch = block.match(/class=["'][^"']*year[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const season = seasonMatch ? parseInt(decode(seasonMatch[1]).replace(/\D+/g, ''), 10) || null : null;
    const ep = epMatch ? parseInt(decode(epMatch[1]).replace(/\D+/g, ''), 10) || null : null;
    let slug = '';
    let episode = '';
    const big = href.match(/^\/episode\/(.+?)-(\d+)x(\d+)$/);
    if (big) {
      slug = big[1];
      episode = `${BASE}${href}/`;
    } else if (href.startsWith('/series/')) {
      slug = href.slice('/series/'.length);
    } else {
      slug = href.slice('/episode/'.length);
    }
    items.push({
      title: title || slug.replace(/-/g, ' '),
      slug,
      ...(imgMatch ? { img: decode(imgMatch[1]) } : {}),
      url: `${BASE}${href}/`,
      ...(episode ? { episode } : {}),
      ...(season ? { season } : {}),
      ...(ep ? { ep } : {}),
    });
    // Owner: "toonstream mae abhi jitna anime fresh drop row mae hai wo sara
    // apne fresh drop row mae dikhna chiyea" — isliye koi 40-card cap nahi.
    // Sirf ek safety ceiling, taaki markup badal jaye to hazaaron cards na
    // bake ho jayein.
    if (items.length >= MAX_FRESH_DROPS) break;
  }
  if (items.length) return items;

  // Fallback: some layouts link series directly from anchors.
  const anchors = [...seg.matchAll(/<a\b[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)];
  const out = new Map();
  for (const m of anchors) {
    let href = decode(m[1] || m[2] || '');
    if (!href.startsWith('/')) {
      const abs = href.match(/^https?:\/\/toonstream\.us(\/[^?#]*)/i);
      if (!abs) continue;
      href = abs[1];
    }
    href = href.replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!/^\/(series|episode)\//.test(href)) continue;
    const inner = m[3];
    const imgMatch = inner.match(/<img\b[^>]*src=["']([^"']+)["']/i);
    const label = decode(inner);
    const cur = out.get(href) || { href, title: '', img: '' };
    if (imgMatch && !cur.img) cur.img = imgMatch[1].trim();
    if (label && label.length > cur.title.length) cur.title = label;
    out.set(href, cur);
  }
  for (const c of out.values()) {
    if (!c.title && !c.img) continue;
    let slug = '';
    let episode = '';
    let season = null;
    let ep = null;
    if (c.href.startsWith('/series/')) slug = c.href.slice('/series/'.length);
    else {
      episode = `${BASE}${c.href}/`;
      const big = c.href.match(/^\/episode\/(.+?)-(\d+)x(\d+)$/);
      if (big) {
        slug = big[1];
        season = Number(big[2]);
        ep = Number(big[3]);
      } else slug = c.href.slice('/episode/'.length);
    }
    items.push({
      title: c.title || slug.replace(/-/g, ' '),
      slug,
      ...(c.img ? { img: c.img } : {}),
      url: `${BASE}${c.href}/`,
      ...(episode ? { episode } : {}),
      ...(season ? { season, ep } : {}),
    });
    if (items.length >= MAX_FRESH_DROPS) break;
  }
  return items;
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
  // Probe both the plain slug and the colon-kept one — newer posts keep ':'
  // (mushoku-tensei:-jobless-reincarnation-3x1), older ones drop it.
  const exact = slug ? String(slug).trim().replace(/^\/+|\/+$/g, '') : '';
  // Every punctuation policy the site has shipped so far: strip it all
  // ("jojos-bizarre-adventure"), keep ':' ("mushoku-tensei:-..."), keep the
  // apostrophe ("jojo's-bizarre-adventure"), or keep both.
  const bases = [
    ...new Set(
      [
        exact,
        titleSlug(slug || title),
        titleSlug(title, ':'),
        titleSlug(title, "'"),
        titleSlug(title, ":'"),
      ].filter(Boolean),
    ),
  ];
  for (const base of bases) {
    const direct = `${BASE}/episode/${base}-${season}x${episode}/`;
    const page = await getText(direct, steps, 'episode-direct');
    if (page.status === 200) {
      return { episodeUrl: direct, html: page.text, via: 'direct', frameBlocked: !!page.frameBlocked };
    }
  }
  // Sequel seasons often live on "-season-N" (or "-3rd-season") series
  // pages, so probe the season-qualified slugs before searching.
  const ord = season === '1' ? 'st' : season === '2' ? 'nd' : season === '3' ? 'rd' : 'th';
  for (const suffix of [`-season-${season}`, `-${season}${ord}-season`]) {
    for (const sKey of [season, '1']) {
      const vu = `${BASE}/episode/${titleSlug(title)}${suffix}-${sKey}x${episode}/`;
      const vp = await getText(vu, steps, 'episode-variant');
      if (vp.status === 200) {
        return { episodeUrl: vu, html: vp.text, via: 'direct', frameBlocked: !!vp.frameBlocked };
      }
    }
  }

  const search = await getText(`${BASE}/s?q=${encodeURIComponent(title)}`, steps, 'search');
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
  // A single shared word is not a match: "Black Clover" must never fall through
  // to "Darker than Black" (which scores 0.5) just because that page happens to
  // host the requested season/episode. Require most of the query's tokens.
  const MIN_MATCH = 0.6;
  const viable = ranked.filter((c) => c.score >= MIN_MATCH);
  if (steps) {
    steps.push({
      step: 'series-ranked',
      top: ranked.slice(0, 4).map((c) => [c.slug, Math.round(c.score * 100) / 100]),
      min: MIN_MATCH,
    });
  }
  for (const candidate of viable.slice(0, 4)) {
    // The site's own search slug is the ground truth for this show — it beats
    // any guess from the display title ("Re:ZERO" lives on
    // /series/rezero-starting-life-in-another-world, not re-zero-...).
    const base = String(candidate.slug)
      .replace(/^\/series\//, '')
      .replace(/\/+$/, '');
    const seasonScoped = /-(season-\d+|\d+(?:st|nd|rd|th)-season|part-\d+)$/.test(base);
    const tried = new Set();
    for (const sKey of seasonScoped ? [season, '1'] : [season]) {
      const direct = `${BASE}/episode/${base}-${sKey}x${episode}/`;
      if (tried.has(direct)) continue;
      tried.add(direct);
      const dp = await getText(direct, steps, 'episode-from-series');
      if (dp.status === 200) {
        return { episodeUrl: direct, html: dp.text, via: 'series-slug', frameBlocked: !!dp.frameBlocked };
      }
    }
    const seriesPage = await getText(`${BASE}${candidate.slug}/`, steps, 'series');
    if (seriesPage.status !== 200) continue;
    let epLink = findEpisodeLink(seriesPage.text, season, episode);
    if (!epLink && seasonScoped) {
      // Season-scoped series pages number episodes relative to that season.
      epLink = findEpisodeLink(seriesPage.text, '1', episode);
    }
    if (epLink) {
      const epUrl = epLink.startsWith('http') ? epLink : `${BASE}${epLink}/`;
      const epPage = await getText(epUrl, steps, 'episode');
      if (epPage.status === 200) {
        return { episodeUrl: epUrl, html: epPage.text, via: 'search' };
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
  // Movie titles have no season/episode — they resolve through /movies/<slug>.
  const kind = String(req.query.type || 'tv').toLowerCase() === 'movie' ? 'movie' : 'tv';
  const season = String(Math.max(1, parseInt(String(req.query.s || '1'), 10) || 1));
  const episode = String(Math.max(1, parseInt(String(req.query.e || '1'), 10) || 1));
  const debug = req.query.debug === '1';
  if (String(req.query.home || '') === '1') {
    // Home-page Fresh Drops: the site's own new-episode rail, parsed into
    // plain cards so the app can mirror it. `homeVerbatim=1` also returns a
    // base64 window around the section so the parser can be verified against
    // whatever markup the site ships today.
    const home = await getText(`${BASE}/home`, [], 'home');
    const html = home.text || '';
    const items = parseFreshDrops(html);
    const payload = { ok: true, status: home.status, count: items.length, items };
    if (String(req.query.homeVerbatim || '') === '1') {
      const at = html.search(/fresh\s*drops?/i);
      const win = at === -1 ? html.slice(0, 6000) : html.slice(Math.max(0, at - 1200), at + 6000);
      payload.sample = Buffer.from(win).toString('base64');
      payload.marker = at;
    }
    res.status(200).json(payload);
    return;
  }
  if (String(req.query.audit || '') === '1') {
    // Catalog audit: resolve one episode for many titles in parallel and
    // report a compact pass/fail list. Used to find anime the site has but
    // our chain misses, so regressions show up as data instead of guesses.
    const list = String(req.query.titles || '')
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 40);
    if (!list.length) {
      res.status(400).json({ ok: false, error: 'missing-titles' });
      return;
    }
    const results = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const t = list[cursor++];
        try {
          const f = await resolveEpisode({ title: t, slug: '', season, episode }, []);
          if (!f) {
            results.push({ title: t, ok: false, error: 'no-episode' });
            continue;
          }
          const srv = extractSiteServers(f.html);
          results.push({
            title: t,
            ok: srv.length > 0,
            ...(srv.length ? { via: f.via, servers: srv.length } : { error: 'no-servers' }),
            ...(srv.length ? {} : { url: f.episodeUrl }),
          });
        } catch (err) {
          results.push({ title: t, ok: false, error: String((err && err.message) || 'failed').slice(0, 60) });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    results.sort((a, b) => list.indexOf(a.title) - list.indexOf(b.title));
    res.status(200).json({
      ok: true,
      s: Number(season),
      e: Number(episode),
      passed: results.filter((r) => r.ok).length,
      total: results.length,
      results,
    });
    return;
  }
  if (!title) {
    res.status(400).json({ ok: false, error: 'missing-title' });
    return;
  }

  const steps = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  try {
    if (Date.now() > deadline) throw new Error('budget-exhausted');

    if (kind === 'movie') {
      const movie = await resolveMovie({ title, slug }, steps);
      if (!movie) {
        res.status(200).json({
          ok: false,
          error: 'no-movie',
          ...(debug ? { steps, hint: `${title} is not on toonstream (or spelled differently)` } : {}),
        });
        return;
      }
      const serverList = movie.servers;
      const chosen = serverList[0].url;
      if (steps) steps.push({ step: 'movie-parsed', servers: serverList.length, url: movie.movieUrl });
      res.status(200).json({
        ok: true,
        type: 'movie',
        title,
        pageTitle: movie.title,
        movieUrl: movie.movieUrl,
        via: movie.via,
        embeds: serverList.map((server) => server.url),
        chosen,
        servers: serverList,
        ...(debug ? { steps } : {}),
      });
      return;
    }
    const found = await resolveEpisode({ title, slug, season, episode }, steps);
    if (!found) {
      if (String(req.query.raw || '') === '1') {
        // Debug: dump the episode links the series page actually exposes.
        const sp = await getText(`${BASE}/series/${titleSlug(slug || title)}/`, [], 'raw-series');
        const eps = [];
        for (const m of sp.text.matchAll(/\/episode\/[a-z0-9-]*/gi)) {
          if (!eps.includes(m[0])) eps.push(m[0]);
          if (eps.length >= 60) break;
        }
        return res.status(200).json({ ok: true, status: sp.status, eps });
      }
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
      const re = /iframe|player|data-litespeed|server-|epsdsnv| Watching |serverList|\/episode\//gi;
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
    // Trailers are never a playable server: a page shell with only a YouTube
    // embed means the site has not uploaded this episode yet (Mushoku S3E9+).
    const playable = embeds.filter((src) => !/(youtube|youtu\.be|dailymotion)/i.test(src));
    // Only the site's first three servers (SERVER 1/2/3 in the sidebar),
    // named from the page's own server list - everything else is dropped.
    let siteServers = extractSiteServers(found.html);
    if (!siteServers.length) {
      siteServers = playable.slice(0, 3).map((url, i) => ({ name: `S${i + 1}`, url }));
    }
    if (!siteServers.length) {
      if (steps) steps.push({ step: 'no-servers', iframes: embeds.length });
      res.status(200).json({
        ok: false,
        error: 'no-episode',
        episodeUrl: found.episodeUrl,
        ...(debug ? { steps, hint: `${title} S${season}E${episode}: page exists but has no player servers yet` } : {}),
      });
      return;
    }
    const chosen = siteServers[0].url;
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
export const _internal = { titleSlug, parseFreshDrops, extractSeriesLinks, extractEpisodeLinks, extractMovieLinks, moviePageTitle, resolveMovie, findEpisodeLink, extractIframes, extractPlayerSlots, extractServerNames, extractSiteServers, extractServers, matchScore, pickEmbed };
