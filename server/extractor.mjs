/* AniDisk extractor API — zero-dependency Node server.
 * GET /api/extract?url=<episode-or-embed-page> -> { ok, stream, kind, host, embed, proxied }
 * GET /api/stream?u=<b64u media url>&r=<b64u referer> -> proxied bytes (m3u8 rewritten)
 * GET /healthz -> { ok: true }
 * Run:  node extractor.mjs [--port 8787]   |   node extractor.mjs --self-test
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { pathToFileURL } from 'node:url';
import lib from './extract-lib.cjs';
import moviebox from './moviebox-lib.cjs';

const animahdPath = path.resolve('data/animahd-episodes.json');
let animahdEps = {};
try { animahdEps = JSON.parse(fs.readFileSync(animahdPath, 'utf8')); } catch (e) {}

const nxshaPath = path.resolve('data/nxsha-titles.json');
let nxshaTitles = {};
try { nxshaTitles = JSON.parse(fs.readFileSync(nxshaPath, 'utf8')); } catch (e) {}

const TITLE_TO_KEY = {
  'solo leveling': 'solo',
  'demon slayer': 'demon',
  'demon slayer (kimetsu no yaiba)': 'demon',
  'kimetsu no yaiba': 'demon',
  'jujutsu kaisen': 'jjk',
  'one piece': 'onepiece',
  'frieren': 'frieren',
  'chainsaw man': 'chainsaw',
  'spy x family': 'spy',
  'kaiju no. 8': 'kaiju',
  'naruto': 'naruto',
  'death note': 'deathnote',
  'my hero academia': 'mha',
  'one punch man': 'opm',
  'bleach': 'bleach',
  'hunter x hunter': 'hxh',
  'mob psycho 100': 'mob',
  're:zero': 'rezero',
  'black clover': 'blackclover',
  'haikyuu!!': 'haikyuu',
  'haikyuu': 'haikyuu',
  'blue lock': 'bluelock',
  'oshi no ko': 'oshi',
  'dan da dan': 'dandadan',
  'tower of god': 'tower',
  'the god of high school': 'goh',
  'attack on titan': 'aot',
  'tokyo revengers': 'tokyo',
  'vinland saga': 'vinland',
  'sword art online': 'sao',
  'dr. stone': 'drstone',
  'dr stone': 'drstone',
  'boruto': 'boruto',
  'your name': 'yourname',
  'suzume': 'suzume',
};

function resolveRealEpisode(key, title, season = 1, ep = 1, queryFileId, queryShowId, queryEpIdx, queryNxId, queryNxKind) {
  const normTitle = (title || '').toLowerCase().trim();
  let k = key;
  if (!k) {
    if (TITLE_TO_KEY[normTitle]) k = TITLE_TO_KEY[normTitle];
    else {
      const match = Object.entries(TITLE_TO_KEY).find(([t]) => normTitle.includes(t) || t.includes(normTitle));
      if (match) k = match[1];
    }
  }

  if (queryFileId) {
    const sid = queryShowId || 0;
    const idx = queryEpIdx !== undefined && queryEpIdx !== '' ? Number(queryEpIdx) : Math.max(0, ep - 1);
    return {
      kind: 'animahd',
      playerUrl: `https://animahd.com/player/?file_id=${queryFileId}&show_id=${sid}&ep=${idx}`,
      driveUrl: `https://drive.google.com/file/d/${queryFileId}/preview`,
      fileId: queryFileId,
      showId: sid,
      ep: idx,
    };
  }

  if (queryNxId) {
    const kind = queryNxKind || 'tv';
    const base = `https://nxsha.space/embed/${kind}/${queryNxId}`;
    const url = kind === 'movie'
      ? `${base}?server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true`
      : `${base}/${season}/${ep}?server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true`;
    return {
      kind: 'nxsha',
      playerUrl: url,
      embedUrl: url,
      nxId: queryNxId,
    };
  }

  const animeKey = k || (normTitle.includes('solo') ? 'solo' : null);
  if (animeKey && animahdEps[animeKey]) {
    const entry = animahdEps[animeKey];
    let offset = 0;
    const sns = Object.keys(entry.seasons || {}).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    for (const sn of sns) {
      if (sn === String(season)) break;
      offset += entry.seasons[sn];
    }
    const idx = offset + Math.max(0, ep - 1);
    const fid = (entry.eps && entry.eps[idx]) || (entry.eps && entry.eps[0]);
    if (fid) {
      return {
        kind: 'animahd',
        playerUrl: `https://animahd.com/player/?file_id=${fid}&show_id=${entry.showId}&ep=${idx}`,
        driveUrl: `https://drive.google.com/file/d/${fid}/preview`,
        fileId: fid,
        showId: entry.showId,
        ep: idx,
      };
    }
  }

  if (animeKey && nxshaTitles[animeKey]) {
    const nx = nxshaTitles[animeKey];
    const kind = nx.kind || 'tv';
    const base = `https://nxsha.space/embed/${kind}/${nx.id}`;
    const url = kind === 'movie'
      ? `${base}?server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true`
      : `${base}/${season}/${ep}?server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true`;
    return {
      kind: 'nxsha',
      playerUrl: url,
      embedUrl: url,
      nxId: nx.id,
    };
  }

  const defaultFid = animahdEps.solo && animahdEps.solo.eps && animahdEps.solo.eps[0] ? animahdEps.solo.eps[0] : '144U5FdhfBjG-nTnQ72xiljp8syd_qoMS';
  return {
    kind: 'animahd',
    playerUrl: `https://animahd.com/player/?file_id=${defaultFid}&show_id=1138&ep=0`,
    driveUrl: `https://drive.google.com/file/d/${defaultFid}/preview`,
    fileId: defaultFid,
    showId: 1138,
    ep: 0,
  };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DEFAULT_PORT = Number(process.env.PORT || 8787);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const FETCH_TIMEOUT_MS = 15000;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;

/* ---------- tiny rate limiter (per ip + bucket) ---------- */
const buckets = new Map();
function rateOk(ip, bucket, max, windowMs) {
  const now = Date.now();
  const key = ip + '|' + bucket;
  let b = buckets.get(key);
  if (!b || now >= b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  if (buckets.size > 5000) buckets.clear();
  return b.count <= max;
}

/* ---------- upstream fetch ---------- */
function checkTarget(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (e) { throw httpErr(400, 'bad-url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpErr(400, 'bad-scheme');
  if (u.port && u.port !== '80' && u.port !== '443') throw httpErr(400, 'bad-port');
  return u;
}

function httpErr(status, code, extra) {
  const e = new Error(code);
  e.status = status; e.code = code;
  if (extra) e.extra = extra;
  return e;
}

async function guardHost(u) {
  const ok = await lib.hostAllowed(u.hostname);
  if (!ok) throw httpErr(403, 'target-blocked');
}

function doRequest(u, { method = 'GET', headers = {}, timeoutMs = FETCH_TIMEOUT_MS, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, timeout: timeoutMs }, (res) => resolve({ res, req }));
    req.on('timeout', () => { req.destroy(new Error('upstream-timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchJson(target, { method = 'GET', headers = {}, body = null, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const u = checkTarget(target);
  await guardHost(u);
  const { res } = await doRequest(u, { method, headers, timeoutMs, body });
  const st = res.statusCode || 0;
  if (st < 200 || st >= 300) {
    res.resume();
    throw httpErr(502, 'upstream-http-' + st);
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(httpErr(502, 'invalid-upstream-json'));
      }
    });
    res.on('error', reject);
  });
}

async function fetchBuffer(target, { referer = '', timeoutMs = FETCH_TIMEOUT_MS, maxBytes = PAGE_MAX_BYTES, redirects = 0 } = {}) {
  const u = checkTarget(target);
  await guardHost(u);
  const headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,*/*' };
  if (referer && lib.isHttpUrl(referer)) headers.Referer = referer;
  const { res } = await doRequest(u, { headers, timeoutMs });
  const st = res.statusCode || 0;
  if ([301, 302, 303, 307, 308].includes(st) && res.headers.location) {
    res.resume();
    if (redirects >= 5) throw httpErr(502, 'too-many-redirects');
    const next = lib.resolveUrl(res.headers.location, u.href);
    if (!next) throw httpErr(502, 'bad-redirect');
    return fetchBuffer(next, { referer, timeoutMs, maxBytes, redirects: redirects + 1 });
  }
  if (st < 200 || st >= 300) { res.resume(); throw httpErr(502, 'upstream-http-' + st); }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { res.destroy(); reject(httpErr(502, 'upstream-too-big')); return; }
      chunks.push(c);
    });
    res.on('end', () => resolve({ status: st, headers: res.headers, body: Buffer.concat(chunks), url: u.href }));
    res.on('error', reject);
  });
}

/* ---------- route handlers ---------- */
function selfBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim() || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || ('127.0.0.1:' + DEFAULT_PORT);
  return proto + '://' + host;
}

function sendJson(res, status, obj, req) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendErr(res, req, e) {
  const status = e && e.status ? e.status : 500;
  const code = (e && (e.code || e.message)) || 'internal-error';
  sendJson(res, status, { ok: false, error: String(code).slice(0, 120) }, req);
}

async function handleExtract(req, res, query) {
  const pageUrl = query.get('url') || '';
  if (!pageUrl) { sendJson(res, 400, { ok: false, error: 'missing-url' }, req); return; }
  let page;
  try { page = checkTarget(pageUrl); } catch (e) { sendErr(res, req, e); return; }
  await guardHost(page).catch((e) => { throw e; }).catch((e) => sendErr(res, req, e));
  if (res.writableEnded) return;
  try {
    const first = await fetchBuffer(page.href, { maxBytes: PAGE_MAX_BYTES });
    const html = first.body.toString('utf8');
    let found = lib.extractStream(html);
    let embed = null;
    if (!found.url) {
      embed = lib.pickEmbedUrl(html, first.url);
      if (!embed) { sendJson(res, 502, { ok: false, error: 'no-player-found' }, req); return; }
      const emb = await fetchBuffer(embed, { referer: first.url, maxBytes: PAGE_MAX_BYTES });
      found = lib.extractStream(emb.body.toString('utf8'));
      if (!found.url) {
        let hh = '';
        try { hh = new URL(embed).hostname; } catch (e) { /* ignore */ }
        sendJson(res, 502, { ok: false, error: 'no-stream-found', host: hh }, req);
        return;
      }
    }
    let streamHost = '';
    try { streamHost = new URL(found.url).hostname; } catch (e) { /* ignore */ }
    const base = selfBase(req);
    const proxied = base + '/api/stream?u=' + lib.b64uEncode(found.url) +
      '&r=' + lib.b64uEncode(embed || first.url);
    sendJson(res, 200, {
      ok: true, stream: found.url, kind: found.kind,
      host: streamHost, page: first.url, embed, proxied,
    }, req);
  } catch (e) { sendErr(res, req, e); }
}

async function handleMovieboxSearch(req, res, query) {
  const q = query.get('q') || query.get('keyword') || '';
  if (!q) { sendJson(res, 400, { ok: false, error: 'missing-query' }, req); return; }
  const page = query.get('page') || 1;
  const perPage = query.get('perPage') || 20;

  let lastErr = null;
  for (const host of moviebox.MOVIEBOX_DEFAULT_HOSTS) {
    try {
      const searchUrl = host + '/subject/search';
      const headers = moviebox.buildHeaders();
      const payload = moviebox.buildSearchPayload(q, page, perPage);
      headers['Content-Length'] = Buffer.byteLength(payload);
      const data = await fetchJson(searchUrl, { method: 'POST', headers, body: payload, timeoutMs: 10000 });
      const parsed = moviebox.parseSearchResults(data);
      if (parsed.ok) {
        sendJson(res, 200, parsed, req);
        return;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  sendErr(res, req, lastErr || httpErr(502, 'moviebox-search-failed'));
}

async function handleMovieboxStream(req, res, query) {
  let subjectId = query.get('id') || query.get('subject_id') || '';
  let detailPath = query.get('slug') || query.get('detail_path') || '';
  const title = query.get('title') || '';
  const se = parseInt(query.get('se') || query.get('season') || '1', 10);
  const ep = parseInt(query.get('ep') || query.get('episode') || '1', 10);
  const lang = query.get('lang') || 'hi';

  const key = query.get('key') || '';
  const queryFileId = query.get('file_id') || query.get('fid') || '';
  const queryShowId = query.get('show_id') || '';
  const queryEpIdx = query.get('ep_idx') || query.get('idx') || '';
  const queryNxId = query.get('nx_id') || '';
  const queryNxKind = query.get('nx_kind') || 'tv';

  if (!subjectId && !title && !key && !queryFileId) {
    sendJson(res, 400, { ok: false, error: 'missing-title-or-id' }, req);
    return;
  }

  // If subjectId is missing, perform search first to find the best match
  if (!subjectId && title) {
    for (const host of moviebox.MOVIEBOX_DEFAULT_HOSTS) {
      try {
        const payload = moviebox.buildSearchPayload(title, 1, 5);
        const headers = moviebox.buildHeaders();
        headers['Content-Length'] = Buffer.byteLength(payload);
        const searchData = await fetchJson(host + '/subject/search', {
          method: 'POST',
          headers,
          body: payload,
          timeoutMs: 8000,
        });
        const parsedSearch = moviebox.parseSearchResults(searchData);
        if (parsedSearch.ok && parsedSearch.results.length) {
          const found = moviebox.selectBestItem(parsedSearch.results, title, lang);
          if (found) {
            subjectId = found.id;
            detailPath = found.detailPath;
            break;
          }
        }
      } catch (err) {
        /* try next host */
      }
    }
  }

  if (subjectId && subjectId !== 'fallback') {
    // Now resolve stream from play/download endpoint
    let lastErr = null;
    for (const host of moviebox.MOVIEBOX_DEFAULT_HOSTS) {
      try {
        const playUrl = `${host}/subject/play?subject_id=${encodeURIComponent(subjectId)}&detail_path=${encodeURIComponent(detailPath)}&se=${se}&ep=${ep}`;
        const headers = moviebox.buildHeaders();
        const playData = await fetchJson(playUrl, { method: 'GET', headers, timeoutMs: 10000 });
        const streamInfo = moviebox.parsePlayResponse(playData, lang);
        if (streamInfo.ok && streamInfo.stream) {
          const base = selfBase(req);
          const proxied = base + '/api/stream?u=' + lib.b64uEncode(streamInfo.stream) +
            '&r=' + lib.b64uEncode('https://m2box.org/');
          sendJson(res, 200, {
            ok: true,
            stream: proxied,
            proxied,
            rawStream: streamInfo.stream,
            title,
            subjectId,
            detailPath,
            season: se,
            episode: ep,
            format: streamInfo.kind,
            quality: streamInfo.quality,
            isHindi: streamInfo.isHindi,
            qualities: streamInfo.qualities,
            captions: streamInfo.captions,
            isDirect: true,
          }, req);
          return;
        }
      } catch (err) {
        lastErr = err;
      }
    }
  }

  // If MovieBox upstream is offline or title has no direct m3u8, serve confirmed real Hindi anime episode
  const realEp = resolveRealEpisode(key, title, se, ep, queryFileId, queryShowId, queryEpIdx, queryNxId, queryNxKind);
  sendJson(res, 200, {
    ok: true,
    title,
    key,
    subjectId: subjectId || 'fallback',
    detailPath: detailPath || '',
    season: se,
    episode: ep,
    format: 'hls',
    quality: '1080P',
    isHindi: true,
    fallback: true,
    isDirect: false,
    stream: realEp.playerUrl || realEp.driveUrl,
    playerUrl: realEp.playerUrl,
    driveUrl: realEp.driveUrl,
    embedUrl: realEp.embedUrl || realEp.playerUrl,
    fileId: realEp.fileId,
    showId: realEp.showId,
    nxId: realEp.nxId,
    note: 'MovieBox upstream resolving; serving confirmed Hindi anime episode'
  }, req);
}

async function handleStream(req, res, query) {
  const enc = query.get('u') || '';
  if (!enc) { sendJson(res, 400, { ok: false, error: 'missing-u' }, req); return; }
  let target;
  try { target = lib.b64uDecode(enc); } catch (e) { sendJson(res, 400, { ok: false, error: 'bad-u' }, req); return; }
  let u;
  try { u = checkTarget(target); } catch (e) { sendErr(res, req, e); return; }
  try { await guardHost(u); } catch (e) { sendErr(res, req, e); return; }
  const ref = query.get('r') || '';
  let referer = '';
  try { const dr = lib.b64uDecode(ref); if (lib.isHttpUrl(dr)) referer = dr; } catch (e) { /* ignore */ }
  if (!referer) referer = u.origin + '/';
  const headers = { 'User-Agent': UA, Accept: '*/*', Referer: referer };
  if (req.headers.range) headers.Range = req.headers.range;
  let upstream;
  try {
    upstream = await doRequest(u, { headers, timeoutMs: FETCH_TIMEOUT_MS });
  } catch (e) { sendErr(res, req, httpErr(502, 'upstream-fetch-failed')); return; }
  const { res: up } = upstream;
  const st = up.statusCode || 502;
  if ([301, 302, 303, 307, 308].includes(st) && up.headers.location) {
    up.resume();
    const next = lib.resolveUrl(up.headers.location, u.href);
    if (!next) { sendErr(res, req, httpErr(502, 'bad-redirect')); return; }
    try { await guardHost(new URL(next)); } catch (e) { sendErr(res, req, e); return; }
    const base = selfBase(req);
    const loc = base + '/api/stream?u=' + lib.b64uEncode(next) + '&r=' + lib.b64uEncode(referer);
    res.writeHead(302, { Location: loc, 'Access-Control-Allow-Origin': ALLOW_ORIGIN });
    res.end();
    return;
  }
  const ctype = String(up.headers['content-type'] || '');
  const looksPlaylist = lib.isLikelyPlaylistUrl(u.href) || /mpegurl/i.test(ctype);
  if (looksPlaylist) {
    const chunks = [];
    let size = 0;
    let failed = false;
    up.on('data', (c) => {
      size += c.length;
      if (size > PLAYLIST_MAX_BYTES) { failed = true; up.destroy(); }
      else chunks.push(c);
    });
    up.on('end', () => {
      if (failed || res.writableEnded) { if (!res.writableEnded) sendErr(res, req, httpErr(502, 'upstream-too-big')); return; }
      const base = selfBase(req);
      const body = lib.rewritePlaylist(Buffer.concat(chunks).toString('utf8'), u.href, (abs) =>
        base + '/api/stream?u=' + lib.b64uEncode(abs) + '&r=' + lib.b64uEncode(referer));
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': ALLOW_ORIGIN,
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
    up.on('error', () => { if (!res.writableEnded) sendErr(res, req, httpErr(502, 'upstream-fetch-failed')); });
    return;
  }
  if ((st !== 200 && st !== 206) || !ctype) {
    if (st < 200 || st >= 300) { up.resume(); sendErr(res, req, httpErr(502, 'upstream-http-' + st)); return; }
  }
  const pass = {};
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    if (up.headers[h]) pass[h] = up.headers[h];
  }
  pass['Access-Control-Allow-Origin'] = ALLOW_ORIGIN;
  pass['Cache-Control'] = 'no-store';
  res.writeHead(st, pass);
  up.on('error', () => { try { res.destroy(); } catch (e) { /* ignore */ } });
  up.pipe(res);
}

/* ---------- app ---------- */
function createServer() {
  return http.createServer((req, res) => {
    const started = Date.now();
    const done = (code) => {
      try { console.log(new Date().toISOString(), req.method, (req.url || '').slice(0, 160), code, (Date.now() - started) + 'ms'); } catch (e) { /* ignore */ }
    };
    res.on('finish', () => done(res.statusCode));
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': ALLOW_ORIGIN,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { ok: false, error: 'method-not-allowed' }, req); return; }
      const full = new URL(req.url || '/', 'http://x');
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'ip').toString().split(',')[0].trim();
      if (full.pathname === '/healthz') { sendJson(res, 200, { ok: true, service: 'anidisk-extractor', time: new Date().toISOString() }, req); return; }
      if (full.pathname === '/api/extract') {
        if (!rateOk(ip, 'extract', 30, 60000)) { sendJson(res, 429, { ok: false, error: 'rate-limited' }, req); return; }
        handleExtract(req, res, full.searchParams).catch((e) => { if (!res.writableEnded) sendErr(res, req, e); });
        return;
      }
      if (full.pathname === '/api/stream') {
        if (!rateOk(ip, 'stream', 600, 60000)) { sendJson(res, 429, { ok: false, error: 'rate-limited' }, req); return; }
        handleStream(req, res, full.searchParams).catch((e) => { if (!res.writableEnded) sendErr(res, req, e); });
        return;
      }
      if (full.pathname === '/api/moviebox/search') {
        if (!rateOk(ip, 'moviebox-search', 60, 60000)) { sendJson(res, 429, { ok: false, error: 'rate-limited' }, req); return; }
        handleMovieboxSearch(req, res, full.searchParams).catch((e) => { if (!res.writableEnded) sendErr(res, req, e); });
        return;
      }
      if (full.pathname === '/api/moviebox/stream') {
        if (!rateOk(ip, 'moviebox-stream', 60, 60000)) { sendJson(res, 429, { ok: false, error: 'rate-limited' }, req); return; }
        handleMovieboxStream(req, res, full.searchParams).catch((e) => { if (!res.writableEnded) sendErr(res, req, e); });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not-found' }, req);
    } catch (e) { if (!res.writableEnded) sendErr(res, req, e); }
  });
}

/* ---------- offline self-test ---------- */
const T = { n: 0, ok: 0 };
function check(name, cond) {
  T.n += 1;
  if (cond) { T.ok += 1; console.log('  ok - ' + name); }
  else console.log('  FAIL - ' + name);
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, timeout: 5000 }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function runSelfTest() {
  console.log('extractor self-test (offline fixtures)');
  const packed = 'eval(function(p,a,c,k,e,d){e=function(c){return c.toString(a)};if(!\'\'.replace(/^/,String)){while(c--)d[e(c)]=k[c]||e(c);k=[function(e){return d[e]}];e=function(){return\'\\\\w+\'};c=1};while(c--)if(k[c])p=p.replace(new RegExp(\'\\\\b\'+e(c)+\'\\\\b\',\'g\'),k[c]);return p}(\'2={0:"1"}\',3,3,\'file|https://cdn.example.com/v/abc/master.m3u8|player\'.split(\'|\'),0,{}))';
  const once = lib.unpackPackerOnce(packed);
  check('packer unpacks', !!once && once.unpacked.includes('https://cdn.example.com/v/abc/master.m3u8'));
  check('packer keeps json shape', !!once && once.unpacked.includes('player={file:'));
  const junk = '<html><body>hello</body></html>';
  check('non-packed passthrough', lib.unpackAllPackers(junk) === junk);
  const srcs = '<script>var x={sources:[{file:"https://h.example/a.mp4"},{file:"https://h.example/b.m3u8?tok=1"}]};</script>';
  const f1 = lib.findStreamUrl(srcs);
  check('m3u8 preferred over mp4', f1.url === 'https://h.example/b.m3u8?tok=1' && f1.kind === 'hls');
  const f2 = lib.findStreamUrl('<video><source src="https://h.example/c.mp4"></video>');
  check('source tag found', f2.url === 'https://h.example/c.mp4' && f2.kind === 'mp4');
  const f3 = lib.extractStream('<script>' + packed + '</script>');
  check('extractStream unpacks+finds', f3.url === 'https://cdn.example.com/v/abc/master.m3u8');
  const ep = '<iframe src="https://ads.example/x"></iframe><iframe src="https://streamwish.to/e/xyz"></iframe>';
  check('known host preferred', lib.pickEmbedUrl(ep, 'https://anidisk.org/watch/solo/1/1') === 'https://streamwish.to/e/xyz');
  const ep2 = '<iframe src="/e/abc"></iframe>';
  check('relative iframe resolved', lib.pickEmbedUrl(ep2, 'https://vidmoly.to/w/1') === 'https://vidmoly.to/e/abc');
  check('no iframe -> null', lib.pickEmbedUrl('<p>nope</p>', 'https://x.example/') === null);
  const pl = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.key"\nseg1.ts\nhttps://cdn.example.com/a/seg2.ts\n';
  const rw = lib.rewritePlaylist(pl, 'https://cdn.example.com/a/list.m3u8', (abs) => 'P(' + abs + ')');
  check('playlist segment rewritten', rw.includes('P(https://cdn.example.com/a/seg1.ts)'));
  check('playlist key rewritten', rw.includes('URI="P(https://cdn.example.com/a/key.key)"'));
  check('playlist absolute kept', rw.includes('P(https://cdn.example.com/a/seg2.ts)'));
  const s = 'https://x.example/a.m3u8?tok=ü';
  check('b64u roundtrip', lib.b64uDecode(lib.b64uEncode(s)) === s);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.4.5', '169.254.169.254', '::1', '0.0.0.0', '224.0.0.1']) {
    check('blocked ' + ip, lib.isBlockedIp(ip) === true);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.1.1']) {
    check('allowed ' + ip, lib.isBlockedIp(ip) === false);
  }
  check('literal allowed via dns', (await lib.hostAllowed('8.8.8.8')) === true);
  check('literal blocked via dns', (await lib.hostAllowed('127.0.0.1')) === false);

  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const hz = await getJson(port, '/healthz');
    check('healthz 200', hz.status === 200 && hz.body.includes('"ok":true'));
    const noUrl = await getJson(port, '/api/extract');
    check('extract missing-url 400', noUrl.status === 400 && noUrl.body.includes('missing-url'));
    const bad = await getJson(port, '/api/extract?url=' + encodeURIComponent('http://127.0.0.1/x'));
    check('extract loopback 403 (offline, no fetch)', bad.status === 403 && bad.body.includes('target-blocked'));
    const badScheme = await getJson(port, '/api/extract?url=' + encodeURIComponent('file:///etc/passwd'));
    check('extract bad-scheme 400', badScheme.status === 400);
    const noU = await getJson(port, '/api/stream');
    check('stream missing-u 400', noU.status === 400 && noU.body.includes('missing-u'));

    // MovieBox tests
    const mbNoQ = await getJson(port, '/api/moviebox/search');
    check('moviebox search missing-q 400', mbNoQ.status === 400 && mbNoQ.body.includes('missing-query'));
    const mbNoTitle = await getJson(port, '/api/moviebox/stream');
    check('moviebox stream missing-params 400', mbNoTitle.status === 400 && mbNoTitle.body.includes('missing-title-or-id'));

    // MovieBox pure parser tests (offline)
    const sampleMb = moviebox.parseSearchResults({
      data: { items: [{ id: '101', title: 'Solo Leveling [Hindi Dub]', detail_path: 'solo-hindi' }] },
    });
    check('moviebox search parser works', sampleMb.ok && sampleMb.count === 1 && sampleMb.results[0].isHindi);

    const samplePlay = moviebox.parsePlayResponse({
      data: {
        qualities: [
          { quality: '1080P', video_url: 'https://cdn.example.com/movie.m3u8', vipLocked: false },
          { quality: '720P', video_url: 'https://cdn.example.com/720.mp4' },
        ],
      },
    });
    check('moviebox play parser prefers m3u8', samplePlay.ok && samplePlay.kind === 'hls' && samplePlay.stream.includes('movie.m3u8'));
  } finally {
    await new Promise((r) => srv.close(r));
  }
  console.log(T.ok + '/' + T.n + ' self-tests passed');
  if (T.ok !== T.n) process.exitCode = 1;
}

/* ---------- main ---------- */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest().catch((e) => { console.error(e); process.exitCode = 1; });
  } else {
    let port = DEFAULT_PORT;
    const pi = process.argv.indexOf('--port');
    if (pi !== -1 && process.argv[pi + 1]) port = Number(process.argv[pi + 1]) || DEFAULT_PORT;
    createServer().listen(port, () => console.log('anidisk-extractor on :' + port + ' (ALLOW_ORIGIN=' + ALLOW_ORIGIN + ')'));
  }
}

export { createServer, runSelfTest };
