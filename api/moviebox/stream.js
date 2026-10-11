const https = require('node:https');
const http = require('node:http');
const moviebox = require('../../server/moviebox-lib.cjs');
const lib = require('../../server/extract-lib.cjs');

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid JSON from ' + url));
        }
      });
      res.on('error', reject);
    });
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error('Timeout fetching ' + url));
      });
    }
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const query = req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  const title = (query.title || '').trim();
  let subjectId = (query.id || query.subject_id || query.subjectId || '').trim();
  let detailPath = (query.detailPath || query.detail_path || query.slug || '').trim();
  const se = parseInt(query.se || query.season || '1', 10) || 1;
  const ep = parseInt(query.ep || query.episode || '1', 10) || 1;
  const lang = (query.lang || 'hi').trim();

  const fallbackStream = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

  if (!title && !subjectId) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'missing-title-or-id' }));
  }

  try {
    // If subjectId is not provided, try to search MovieBox upstream
    if (!subjectId) {
      for (const host of moviebox.MOVIEBOX_DEFAULT_HOSTS) {
        try {
          const searchUrl = `${host}/subject/search`;
          const headers = moviebox.buildHeaders();
          const body = JSON.stringify({ query: title, page: 1, per_page: 10 });
          const data = await fetchJson(searchUrl, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body,
            timeoutMs: 4000,
          });
          const parsed = moviebox.parseSearchResults(data);
          if (parsed.ok && parsed.count > 0) {
            const best = moviebox.selectBestItem(parsed.results, title, lang);
            if (best) {
              subjectId = best.id;
              detailPath = best.detailPath;
              break;
            }
          }
        } catch (e) {
          // Continue to next host
        }
      }
    }

    if (subjectId) {
      for (const host of moviebox.MOVIEBOX_DEFAULT_HOSTS) {
        try {
          const playUrl = `${host}/subject/play?subject_id=${encodeURIComponent(subjectId)}&detail_path=${encodeURIComponent(detailPath)}&se=${se}&ep=${ep}`;
          const headers = moviebox.buildHeaders();
          const playData = await fetchJson(playUrl, { method: 'GET', headers, timeoutMs: 5000 });
          const streamInfo = moviebox.parsePlayResponse(playData, lang);
          if (streamInfo.ok && streamInfo.stream) {
            const hostHeader = (req.headers && req.headers.host) || 'localhost';
            const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
            const proxied = `${proto}://${hostHeader}/api/stream?u=${lib.b64uEncode(streamInfo.stream)}&r=${lib.b64uEncode('https://m2box.org/')}`;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
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
            }));
          }
        } catch (e) {
          // Continue to next host
        }
      }
    }
  } catch (err) {
    console.warn('MovieBox stream resolution error:', err);
  }

  // Graceful fallback so video always plays
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({
    ok: true,
    stream: fallbackStream,
    proxied: fallbackStream,
    rawStream: fallbackStream,
    title,
    subjectId: subjectId || 'fallback',
    detailPath: detailPath || '',
    season: se,
    episode: ep,
    format: 'hls',
    quality: '720P',
    isHindi: true,
    fallback: true,
    note: 'MovieBox upstream pending or offline; served fallback stream'
  }));
};
