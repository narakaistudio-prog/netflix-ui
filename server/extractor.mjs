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
