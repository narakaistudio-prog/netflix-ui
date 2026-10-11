const https = require('node:https');
const http = require('node:http');
const moviebox = require('../../server/moviebox-lib.cjs');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const query = req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  const q = (query.q || query.query || '').trim();
  const page = parseInt(query.page || '1', 10) || 1;
  const perPage = parseInt(query.per_page || query.perPage || '15', 10) || 15;

  if (!q) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'missing-query' }));
  }

  let lastErr = null;
  for (const host of moviebox.MOVIEBOX_DEFAULT_HOSTS) {
    try {
      const targetUrl = `${host}/subject/search`;
      const headers = moviebox.buildHeaders();
      const body = JSON.stringify({ query: q, page, per_page: perPage });
      const data = await fetchJson(targetUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body,
        timeoutMs: 5000,
      });
      const parsed = moviebox.parseSearchResults(data);
      if (parsed.ok) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          ok: true,
          query: q,
          page,
          count: parsed.count,
          results: parsed.results,
        }));
      }
    } catch (err) {
      lastErr = err;
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({
    ok: true,
    query: q,
    page,
    count: 0,
    results: [],
  }));
};
