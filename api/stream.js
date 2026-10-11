const https = require('node:https');
const http = require('node:http');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', 'server', 'extract-lib.cjs'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function selfBase(req) {
  const host = (req.headers && req.headers.host) || 'localhost';
  const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const query = req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  const enc = query.u || '';
  if (!enc) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'missing-u' }));
  }

  let target;
  try {
    target = lib.b64uDecode(enc);
  } catch (e) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'bad-u' }));
  }

  let u;
  try {
    u = new URL(target);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'bad-scheme' }));
    }
  } catch (e) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: 'bad-target' }));
  }

  const ref = query.r || '';
  let referer = '';
  try {
    const dr = lib.b64uDecode(ref);
    if (lib.isHttpUrl(dr)) referer = dr;
  } catch (e) {}
  if (!referer) referer = u.origin + '/';

  const headers = { 'User-Agent': UA, Accept: '*/*', Referer: referer };
  if (req.headers && req.headers.range) headers.Range = req.headers.range;

  const isHttps = u.protocol === 'https:';
  const client = isHttps ? https : http;

  const requestOptions = {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
  };

  const proxyReq = client.request(u.href, requestOptions, (up) => {
    const st = up.statusCode || 502;
    if ([301, 302, 303, 307, 308].includes(st) && up.headers.location) {
      up.resume();
      const next = lib.resolveUrl(up.headers.location, u.href);
      const base = selfBase(req);
      const loc = `${base}/api/stream?u=${lib.b64uEncode(next)}&r=${lib.b64uEncode(referer)}`;
      res.writeHead(302, { Location: loc, 'Access-Control-Allow-Origin': '*' });
      return res.end();
    }

    const ctype = String(up.headers['content-type'] || '');
    const looksPlaylist = lib.isLikelyPlaylistUrl(u.href) || /mpegurl/i.test(ctype);

    if (looksPlaylist) {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const base = selfBase(req);
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = lib.rewritePlaylist(raw, u.href, (abs) =>
          `${base}/api/stream?u=${lib.b64uEncode(abs)}&r=${lib.b64uEncode(referer)}`
        );
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      });
      return;
    }

    const pass = {};
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      if (up.headers[h]) pass[h] = up.headers[h];
    }
    pass['Access-Control-Allow-Origin'] = '*';
    pass['Cache-Control'] = 'no-store';

    res.writeHead(st, pass);
    up.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'upstream-proxy-failed' }));
    }
  });

  proxyReq.end();
};
