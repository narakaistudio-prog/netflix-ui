/* AniDisk extractor API — zero-dependency Node server.
 * GET /api/extract?url=<episode-or-embed-page> -> { ok, stream, kind, host, embed, proxied }
 * GET /api/stream?u=<b64u media url>&r=<b64u referer> -> proxied bytes (m3u8 rewritten)
 * GET /healthz -> { ok: true }
 * Run:  node extractor.mjs [--port 8787]   |   node extractor.mjs --self-test
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { pathToFileURL } from 'node:url';
import lib from './extract-lib.cjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
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

function doRequest(u, { method = 'GET', headers = {}, timeoutMs = FETCH_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, timeout: timeoutMs }, (res) => resolve({ res, req }));
    req.on('timeout', () => { req.destroy(new Error('upstream-timeout')); });
    req.on('error', reject);
    req.end();
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

/* ---------- nxsha direct-stream resolve ----------
 * GET /api/resolve?type=movie|tv&tmdb=&imdb=&s=&e= -> { ok, source, alternates }
 * Same protocol as api/resolve.js (Vercel copy) — this duplicate is kept
 * self-contained because Render deploys the server/ directory alone.
 */
const NXSHA_WEB_BASE = 'https://web.nxsha.app';
const NXSHA_PASSPHRASE = 'S8x!Jk4ZP1uG8$my';

function nxshaSeal(payload) {
  const salt = require('node:crypto').randomBytes(8);
  const { key, iv } = nxshaEvpBytesToKey(NXSHA_PASSPHRASE, salt);
  const cipher = require('node:crypto').createCipheriv('aes-256-cbc', key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
  return Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, body])
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function nxshaEvpBytesToKey(passphrase, salt) {
  const blocks = []; let prev = Buffer.alloc(0); let total = 0;
  while (total < 48) {
    prev = require('node:crypto').createHash('md5').update(Buffer.concat([prev, Buffer.from(passphrase, 'utf8'), salt])).digest();
    blocks.push(prev); total += prev.length;
  }
  const all = Buffer.concat(blocks);
  return { key: all.subarray(0, 32), iv: all.subarray(32, 48) };
}
function nxshaOpen(b64url) {
  if (typeof b64url !== 'string' || !b64url) return null;
  let text = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  let raw; try { raw = Buffer.from(text, 'base64'); } catch (e) { return null; }
  if (raw.length < 24 || raw.subarray(0, 8).toString('utf8') !== 'Salted__') return null;
  const { key, iv } = nxshaEvpBytesToKey(NXSHA_PASSPHRASE, raw.subarray(8, 16));
  try {
    const d = require('node:crypto').createDecipheriv('aes-256-cbc', key, iv);
    return JSON.parse(Buffer.concat([d.update(raw.subarray(16)), d.final()]).toString('utf8'));
  } catch (e) { return null; }
}

/* web.nxsha.app's WAF 403s some datacenter clients (fake-Chrome UA without
 * client hints was blocked from Vercel; plain clients pass), so every upstream
 * call walks the same profile ladder as api/nxsha-fetch.cjs: chrome ->
 * plain -> minimal -> two public relays. First profile that decrypts wins and
 * is cached for warm instances. */
function nxshaChromeHeaders() {
  return {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: NXSHA_WEB_BASE + '/',
  };
}
const NXSHA_PROFILES = [
  { id: 'chrome125', timeoutMs: 4000, wrap: (t) => t, headers: nxshaChromeHeaders },
  { id: 'plain', timeoutMs: 4000, wrap: (t) => t, headers: () => ({ 'User-Agent': 'Mozilla/5.0 (compatible; NxshaClient/1.0; +stream-resolve)', Accept: 'application/json, */*' }) },
  { id: 'minimal', timeoutMs: 4000, wrap: (t) => t, headers: () => ({ Accept: 'application/json, */*' }) },
  { id: 'allorigins', timeoutMs: 7000, wrap: (t) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(t), headers: () => ({ Accept: 'application/json, */*' }) },
  { id: 'corsproxy', timeoutMs: 7000, wrap: (t) => 'https://corsproxy.io/?url=' + encodeURIComponent(t), headers: () => ({ Accept: 'application/json, */*' }) },
  { id: 'codetabs', timeoutMs: 7000, wrap: (t) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(t), headers: () => ({ Accept: 'application/json, */*' }) },
];
let nxshaWinnerProfile = null;

function nxshaPreview(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 140) : undefined;
}

async function nxshaLadderJson(target, headers, timeoutMs, redirects = 0) {
  const u = new URL(target);
  const { res: upstream } = await doRequest(u, { headers, timeoutMs });
  const st = upstream.statusCode || 0;
  if ([301, 302, 303, 307, 308].includes(st) && upstream.headers.location) {
    upstream.resume();
    if (redirects >= 3) throw new Error('too-many-redirects');
    return nxshaLadderJson(new URL(upstream.headers.location, u).href, headers, timeoutMs, redirects + 1);
  }
  const chunks = [];
  await new Promise((resolve, reject) => {
    upstream.on('data', (c) => chunks.push(c));
    upstream.on('end', resolve);
    upstream.on('error', reject);
  });
  const text = Buffer.concat(chunks).toString('utf8');
  if (st < 200 || st >= 300) {
    const e = new Error('http-' + st);
    e.preview = nxshaPreview(text);
    throw e;
  }
  let body; try { body = JSON.parse(text); } catch (e) {
    const err = new Error('not-json');
    err.preview = nxshaPreview(text);
    throw err;
  }
  return { body, text };
}

async function nxshaApiGet(path, payload, steps, label, deadline) {
  const q = encodeURIComponent(nxshaSeal({ ...payload, _req_ts: Date.now(), _req_salt: Math.random().toString(36).slice(2, 12) }));
  const target = NXSHA_WEB_BASE + path + '?q=' + q;
  const profiles = nxshaWinnerProfile
    ? [nxshaWinnerProfile, ...NXSHA_PROFILES.filter((p) => p !== nxshaWinnerProfile)]
    : NXSHA_PROFILES;
  let lastErr = 'no-profiles';
  for (const profile of profiles) {
    if (deadline && Date.now() > deadline - 3000) { lastErr = 'budget-exhausted'; break; }
    const started = Date.now();
    try {
      const { body, text } = await nxshaLadderJson(profile.wrap(target), profile.headers(), profile.timeoutMs);
      const data = nxshaOpen(body && typeof body === 'object' ? body._hash : undefined);
      if (!data) {
        const err = new Error('undecryptable');
        err.preview = nxshaPreview(text.slice(0, 400));
        throw err;
      }
      nxshaWinnerProfile = profile;
      steps.push({ step: label, profile: profile.id, ms: Date.now() - started });
      return data;
    } catch (e) {
      lastErr = String((e && e.message) || e).slice(0, 80);
      const step = { step: label + '-attempt', profile: profile.id, error: lastErr, ms: Date.now() - started };
      if (e && e.preview) step.preview = e.preview;
      steps.push(step);
    }
  }
  throw httpErr(502, 'upstream-' + lastErr);
}

const nxshaNameOf = (server) => String((server && (server.name || server.scraper || server.id)) || '');

async function handleNxshaResolve(req, res, query) {
  const type = query.get('type') === 'tv' ? 'tv' : 'movie';
  const tmdbId = String(query.get('tmdb') || query.get('tmdbId') || '');
  const imdbId = String(query.get('imdb') || '');
  const season = String(Math.max(1, parseInt(query.get('s') || '1', 10) || 1));
  const episode = String(Math.max(1, parseInt(query.get('e') || '1', 10) || 1));
  const debug = query.get('debug') === '1';
  if (!tmdbId && !imdbId) { sendJson(res, 400, { ok: false, error: 'missing-id' }, req); return; }
  const steps = [];
  const deadline = Date.now() + 20000;
  try {
    const serversData = await nxshaApiGet('/api/servers', { tmdbId, type, imdb_id: imdbId, season, episode, method: 'stream' }, steps, 'servers', deadline);
    const servers = Array.isArray(serversData && serversData.servers) ? serversData.servers : [];
    if (debug) steps.push({ step: 'servers-list', count: servers.length, names: servers.slice(0, 10).map(nxshaNameOf) });
    const ordered = [...servers].sort((a, b) => Number(/hindi/i.test(nxshaNameOf(b))) - Number(/hindi/i.test(nxshaNameOf(a))));
    const alternates = [];
    let chosen = null;
    for (const server of ordered.slice(0, 4)) {
      if (Date.now() > deadline) break;
      const provider = String((server && (server.scraper || server.id)) || '').trim();
      if (!provider) continue;
      let sourcesData;
      try {
        sourcesData = await nxshaApiGet('/api/sources', { provider, tmdbId, imdb_id: imdbId, type, season, episode, method: 'stream' }, steps, 'sources:' + provider, deadline);
      } catch (e) {
        if (debug) steps.push({ step: 'sources', provider, error: String((e && e.message) || e).slice(0, 80) });
        continue;
      }
      const list = Array.isArray(sourcesData && sourcesData.sources) ? sourcesData.sources : [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const url = String(item.url || '');
        const kind = String(item.type || '').toLowerCase();
        if (!url || item.isEmbed) continue;
        if (kind !== 'm3u8' && kind !== 'mp4') continue;
        const headers = item.headers && typeof item.headers === 'object' ? item.headers : {};
        alternates.push({
          name: String(server.name || provider),
          kind: kind === 'm3u8' ? 'm3u8' : 'mp4',
          url,
          referer: String(headers.Referer || headers.referer || '') || undefined,
          quality: String(item.quality || item.label || '') || undefined,
        });
      }
      if (debug) steps.push({ step: 'sources-list', provider, direct: alternates.length });
      const first = alternates.find((s) => s.kind === 'm3u8') || alternates[0];
      if (first) { chosen = first; break; }
    }
    if (chosen) { sendJson(res, 200, { ok: true, source: chosen, alternates, ...(debug ? { steps } : {}) }, req); return; }
    sendJson(res, 200, { ok: false, error: 'no-stream', ...(debug ? { steps } : {}) }, req);
  } catch (e) {
    sendJson(res, 200, { ok: false, error: String((e && e.message) || 'resolve-failed').slice(0, 120), ...(debug ? { steps } : {}) }, req);
  }
}

/* ---------- nxsha API passthrough ----------
 * GET /api/nxsha-api?p=/api/servers|/api/sources&q=<encrypted query>
 * Forwards the app's encrypted nxsha API call with the Referer + UA the API
 * expects (browsers cannot send a Referer for a cross-origin fetch). The host
 * and the path are hardcoded — this endpoint is not a general proxy.
 */
const NXSHA_PASSTHROUGH_BASE = 'https://web.nxsha.app';
const NXSHA_API_PATHS = new Set(['/api/servers', '/api/sources']);

async function handleNxshaApi(req, res, query) {
  const p = query.get('p') || '';
  const q = query.get('q') || '';
  if (!NXSHA_API_PATHS.has(p)) { sendJson(res, 400, { ok: false, error: 'bad-path' }, req); return; }
  if (!q || q.length > 4096) { sendJson(res, 400, { ok: false, error: 'bad-q' }, req); return; }
  let u;
  try { u = checkTarget(NXSHA_PASSTHROUGH_BASE + p + '?q=' + encodeURIComponent(q)); } catch (e) { sendErr(res, req, e); return; }
  const { res: upstream } = await doRequest(u, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, */*',
      Referer: NXSHA_PASSTHROUGH_BASE + '/',
      Origin: NXSHA_PASSTHROUGH_BASE,
    },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  const st = upstream.statusCode || 0;
  if (st < 200 || st >= 300) { upstream.resume(); sendJson(res, 502, { ok: false, error: 'upstream-http-' + st }, req); return; }
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    upstream.on('data', (c) => { size += c.length; if (size > PAGE_MAX_BYTES) { upstream.destroy(); reject(httpErr(502, 'upstream-too-big')); return; } chunks.push(c); });
    upstream.on('end', resolve);
    upstream.on('error', reject);
  });
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { sendJson(res, 502, { ok: false, error: 'upstream-not-json' }, req); return; }
  sendJson(res, 200, { ok: true, data: body }, req);
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
      if (full.pathname === '/api/resolve') {
        if (!rateOk(ip, 'nxsha', 60, 60000)) { sendJson(res, 429, { ok: false, error: 'rate-limited' }, req); return; }
        handleNxshaResolve(req, res, full.searchParams).catch((e) => { if (!res.writableEnded) sendErr(res, req, e); });
        return;
      }
      if (full.pathname === '/api/nxsha-api') {
        if (!rateOk(ip, 'nxsha', 120, 60000)) { sendJson(res, 429, { ok: false, error: 'rate-limited' }, req); return; }
        handleNxshaApi(req, res, full.searchParams).catch((e) => { if (!res.writableEnded) sendErr(res, req, e); });
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
