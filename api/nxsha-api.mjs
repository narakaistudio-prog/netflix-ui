/**
 * Vercel serverless proxy for the sealed nxsha API (same-origin for the app).
 *
 * GET /api/nxsha-api?p=/api/servers|/api/sources&q=<sealed query>
 *
 * The browser cannot read web.nxsha.app directly (no CORS headers), so this
 * function fetches upstream through the shared header-profile ladder (see
 * api/nxsha-fetch.cjs — web.nxsha.app's WAF 403s some datacenter clients),
 * decrypts the sealed response and returns plain JSON to the same-origin app.
 * Host and path whitelist are hardcoded — this is not a general proxy.
 */

import { nxshaApiGet } from './nxsha-fetch.cjs';

const NXSHA_API_PATHS = new Set(['/api/servers', '/api/sources']);

const rateBuckets = new Map();
function rateOk(ip) {
  const now = Date.now();
  const entry = rateBuckets.get(ip);
  if (!entry || now >= entry.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + 60000 });
    return true;
  }
  entry.count += 1;
  if (rateBuckets.size > 5000) rateBuckets.clear();
  return entry.count <= 120;
}

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
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

  const p = String(req.query?.p || '');
  const q = String(req.query?.q || '');
  if (!NXSHA_API_PATHS.has(p)) {
    res.status(400).json({ ok: false, error: 'bad-path' });
    return;
  }
  if (!q || q.length > 4096) {
    res.status(400).json({ ok: false, error: 'bad-q' });
    return;
  }

  try {
    const data = await nxshaApiGet(p, q, undefined, `passthrough:${p}`, Date.now() + 20000);
    res.status(200).json({ ok: true, data });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: String((err && err.message) || 'upstream-error').slice(0, 120),
    });
  }
}
