/**
 * Full nxsha direct-stream resolve, server-side (same-origin for the app).
 *
 * GET /api/resolve?type=movie|tv&tmdb=<id>&imdb=<tt…>&s=<season>&e=<episode>[&debug=1]
 *   -> { ok: true, source: {name, kind, url, referer, quality}, alternates: [...] }
 *   -> { ok: false, error: '…', steps?: [...] }
 *
 * Why server-side: the browser cannot read web.nxsha.app (no CORS headers),
 * and one same-origin roundtrip beats three proxied hops. The protocol is the
 * one the open-source nxsha extractors use:
 *   /api/servers  {tmdbId, type, imdb_id, season, episode, method}  -> servers[]
 *   /api/sources  {provider, tmdbId, type, imdb_id, season, episode, method}
 *                 -> sources[] (direct m3u8/mp4, non-embed)
 * Everything is AES-sealed (see api/nxsha-crypto.cjs). Host and paths are
 * hardcoded — this is not a general proxy.
 */

const crypto = require('./nxsha-crypto.cjs');
const { nxshaApiGet } = require('./nxsha-fetch.cjs');

const TOTAL_BUDGET_MS = 14000;
const MAX_SERVERS = 4;

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

const nameOf = (server) => String((server && (server.name || server.scraper || server.id)) || '');
const isHindi = (server) => /hindi/i.test(nameOf(server));

// Seal the payload here; the shared ladder module handles profiles + retries.
const apiGet = (path, payload, steps, label, deadline) =>
  nxshaApiGet(path, crypto.seal(payload), steps, label, deadline);

export default async function handler(req, res) {
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

  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const tmdbId = String(req.query.tmdb || req.query.tmdbId || '');
  const imdbId = String(req.query.imdb || '');
  const season = String(Math.max(1, parseInt(String(req.query.s || '1'), 10) || 1));
  const episode = String(Math.max(1, parseInt(String(req.query.e || '1'), 10) || 1));
  const debug = req.query.debug === '1';

  if (!tmdbId && !imdbId) {
    res.status(400).json({ ok: false, error: 'missing-id' });
    return;
  }

  const steps = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  try {
    const serversData = await apiGet(
      '/api/servers',
      { tmdbId, type, imdb_id: imdbId, season, episode, method: 'stream' },
      steps,
      'servers',
      deadline,
    );
    const servers = Array.isArray(serversData && serversData.servers) ? serversData.servers : [];
    if (debug) {
      steps.push({
        step: 'servers-list',
        count: servers.length,
        names: servers.slice(0, 10).map(nameOf),
      });
    }

    // Hindi servers first (the catalog's default language), list order otherwise.
    const ordered = [...servers].sort((a, b) => Number(isHindi(b)) - Number(isHindi(a)));

    const alternates = [];
    let chosen = null;

    for (const server of ordered.slice(0, MAX_SERVERS)) {
      if (Date.now() > deadline) {
        steps.push({ step: 'budget', note: 'out of time' });
        break;
      }
      const provider = String((server && (server.scraper || server.id)) || '').trim();
      if (!provider) continue;

      let sourcesData;
      try {
        sourcesData = await apiGet(
          '/api/sources',
          { provider, tmdbId, imdb_id: imdbId, type, season, episode, method: 'stream' },
          steps,
          `sources:${provider}`,
          deadline,
        );
      } catch (err) {
        if (debug) {
          steps.push({ step: 'sources', provider, error: String((err && err.message) || err).slice(0, 80) });
        }
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

      // Prefer a direct m3u8 (HLS carries the 1080p level); any direct beats none.
      const first = alternates.find((s) => s.kind === 'm3u8') || alternates[0];
      if (first) {
        chosen = first;
        break;
      }
    }

    if (chosen) {
      res.status(200).json({ ok: true, source: chosen, alternates, ...(debug ? { steps } : {}) });
      return;
    }
    res.status(200).json({
      ok: false,
      error: 'no-stream',
      ...(debug
        ? {
            steps,
            servers: ordered.slice(0, MAX_SERVERS).map((s) => ({
              provider: String((s && (s.scraper || s.id)) || ''),
              name: nameOf(s),
            })),
          }
        : {}),
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      error: String((err && err.message) || 'resolve-failed').slice(0, 120),
      ...(debug ? { steps } : {}),
    });
  }
}
