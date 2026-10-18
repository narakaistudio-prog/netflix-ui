/**
 * Vercel serverless stream proxy for the 1080p direct player.
 *
 * GET /api/stream?u=<b64url media url>&r=<b64url referer>
 *
 * When the nxsha CDN refuses browser requests (Referer check / CORS), the
 * player retries its m3u8 through this function. Every URL reference inside
 * a playlist (variant lines, EXT-X-KEY/MAP URIs) is rewritten to stay on the
 * proxy, so one proxied master playlist is enough — nothing else to configure.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_BYTES = 24 * 1024 * 1024;

export const config = { maxDuration: 60 };

export function b64uEncode(value) {
  return Buffer.from(String(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function b64uDecode(value) {
  let text = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  return Buffer.from(text, 'base64').toString('utf8');
}

/** True when the body is an HLS playlist (master or media). */
export function looksLikePlaylist(body) {
  return /^\s*#EXTM3U/.test(String(body).slice(0, 64));
}

function proxiedUrl(base, target, referer) {
  return `${base}/api/stream?u=${b64uEncode(target)}&r=${b64uEncode(referer)}`;
}

/**
 * Rewrite every URL reference in an HLS playlist to absolute proxy URLs so
 * playback never leaves the proxy after the first request.
 */
export function rewritePlaylist(body, playlistUrl, referer, proxyBase) {
  const lines = String(body).split('\n').map((line) => {
    const raw = line.replace(/\r$/, '');
    if (!raw.trim()) return raw;
    if (raw.startsWith('#')) {
      // Attribute lists may carry URIs: EXT-X-KEY / EXT-X-MAP.
      return raw.replace(/URI="([^"]+)"/g, (_m, uri) => {
        try {
          return `URI="${proxiedUrl(proxyBase, new URL(uri, playlistUrl).href, referer)}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
    }
    try {
      return proxiedUrl(proxyBase, new URL(raw, playlistUrl).href, referer);
    } catch {
      return raw;
    }
  });
  return lines.join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  const u = String(req.query?.u || '');
  const r = String(req.query?.r || '');
  if (!u) {
    res.status(400).json({ ok: false, error: 'missing-u' });
    return;
  }
  let target;
  try {
    target = new URL(b64uDecode(u));
  } catch {
    res.status(400).json({ ok: false, error: 'bad-u' });
    return;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    res.status(400).json({ ok: false, error: 'bad-scheme' });
    return;
  }
  let referer = '';
  try {
    referer = r ? b64uDecode(r) : '';
  } catch {
    referer = '';
  }

  const headers = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' };
  if (referer && /^https?:\/\//i.test(referer)) headers.Referer = referer;

  try {
    const upstream = await fetch(target.href, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(45000),
    });
    if (!upstream.ok) {
      res.status(502).json({ ok: false, error: `upstream-http-${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist =
      contentType.includes('mpegurl') ||
      contentType.includes('m3u') ||
      target.pathname.toLowerCase().endsWith('.m3u8');

    if (!isPlaylist) {
      // Media bytes (segments / mp4): pipe them straight through.
      res.setHeader('Content-Type', contentType || 'video/mp4');
      const length = upstream.headers.get('content-length');
      if (length) res.setHeader('Content-Length', length);
      res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
      const reader = upstream.body.getReader();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BYTES) {
          reader.cancel();
          break;
        }
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    const text = await upstream.text();
    const base = `${(req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim()}://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const finalUrl = upstream.url || target.href;
    const rewritten = looksLikePlaylist(text)
      ? rewritePlaylist(text, finalUrl, referer || `${finalUrl.origin}/`, base)
      : text;
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.status(200).send(rewritten);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: `upstream-${String(err && err.name ? err.name : 'error')}` });
    } else {
      res.end();
    }
  }
}
