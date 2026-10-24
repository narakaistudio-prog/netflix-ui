/**
 * NetMirror resolver — "NetMirror" naam ka naya playback server.
 * ==============================================================
 * Owner: *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale"*.
 *
 * NetMirror (net77.cc / net27.cc / net79.cc — ek hi backend ke mirrors) ka
 * apna REST route hai:
 *
 *   GET https://net27.cc/api/embed-tmdb/{tmdbId}                         (movie)
 *   GET https://net27.cc/api/embed-tmdb/{tmdbId}?type=tv&s=1&e=1         (tv)
 *      -> { ok, title, year, streams: [{ url, resolution: 360|480|720|1080,
 *           size }], captions: [{ lang, name, url }], mode, noSource? }
 *
 * Jo cheez ye route deta hai wo **seedha MP4** hai (`bcdnxw.hakunaymatata.com`),
 * HLS nahi — isliye app apne `<video>` me chalata hai: koi iframe nahi, koi ad
 * nahi, koi popup nahi. Bytes CDN se browser tak seedhe jaate hain (video ka
 * koi proxy nahi); sirf ye chhota JSON hamare function se guzarta hai, kyunki
 * upstream CORS header nahi bhejta (`ACAO` khaali — runner-probe se verify).
 *
 * GET /api/netmirror?tmdb=1465943&type=movie
 * GET /api/netmirror?tmdb=1396&type=tv&s=1&e=1
 *      -> { ok:true, mirror, title, streams:[{url, quality, kind}], captions }
 *      -> { ok:false, reason:'not-added' | 'bad-id' | 'network', error }
 * GET /api/netmirror?...&probe=1
 *      -> { ok:true, count } / { ok:false, reason }   (URLs ke bina)
 *
 * Sab kuch hard fail-soft: app ko hamesha 200 JSON milta hai.
 */

/** v1 probe (24 Oct): net27.cc + net79.cc par route zinda; net77.cc 404. */
const MIRRORS = ['https://net27.cc', 'https://net79.cc', 'https://net77.cc'];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 12000;
/** Signed stream URLs ghante bhar chalte hain — thoda kam par cache. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const PROBE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 300;

const RATE = new Map();
function rateOk(ip) {
  const now = Date.now();
  const entry = RATE.get(ip);
  if (!entry || now >= entry.reset) {
    RATE.set(ip, { count: 1, reset: now + 60000 });
    if (RATE.size > 5000) RATE.clear();
    return true;
  }
  entry.count += 1;
  return entry.count <= 60;
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

/** `tmdb:1465943` / `1465943` → 1465943. IMDb id (`tt…`) yahan kaam nahi karti. */
export function tmdbNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (/^tt\d+$/.test(lowered) || lowered.startsWith('imdb')) return null;
  const matches = raw.match(/\d+/g);
  if (!matches || !matches.length) return null;
  const value2 = Number(matches[matches.length - 1]);
  return Number.isFinite(value2) && value2 > 0 ? Math.trunc(value2) : null;
}

/** Upstream URL — TV par `type/s/e` query lazmi hai (warna wo movie samajh leta hai). */
export function buildUpstreamUrl(base, { tmdb, type = 'movie', season, episode }) {
  if (type === 'tv') {
    const s = Math.max(1, Math.trunc(Number(season) || 1));
    const e = Math.max(1, Math.trunc(Number(episode) || 1));
    return `${base}/api/embed-tmdb/${tmdb}?type=tv&s=${s}&e=${e}`;
  }
  return `${base}/api/embed-tmdb/${tmdb}`;
}

/**
 * Upstream JSON → app ka shape.
 *
 * `noSource: true` ka matlab NetMirror par wo title **abhi add nahi hua** — us
 * case me `ok:false, reason:'not-added'` (UI dead button nahi dikhata).
 */
export function normalizeNetmirror(json) {
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'network', error: 'empty payload' };
  }
  if (json.noSource || json.mode === 'none') {
    return {
      ok: false,
      reason: 'not-added',
      error: typeof json.error === 'string' ? json.error : 'Not on NetMirror yet',
      title: json.title,
    };
  }
  const streams = [];
  const seen = new Set();
  const push = (url, resolution) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    streams.push({
      url,
      quality: String(resolution || '').trim() || 'auto',
      kind: 'mp4',
    });
  };
  if (Array.isArray(json.streams)) {
    for (const item of json.streams) push(item?.url, item?.resolution);
  }
  // `mp4` field akela bhi aata hai (kuch titles par streams khaali hote hain).
  // Aksar wo `streams` ka default quality hi hota hai — tab dobara na jode.
  const qualityKnown = (value) =>
    streams.some((item) => String(item.quality) === String(value ?? '').trim());
  if (!qualityKnown(json.resolution)) push(json.mp4, json.resolution);

  if (!streams.length) {
    return { ok: false, reason: 'not-added', error: 'No playable source', title: json.title };
  }
  // Sabse acchi quality pehle (1080 → 720 → 480 → 360).
  streams.sort((a, b) => (Number(b.quality) || 0) - (Number(a.quality) || 0));

  const captions = Array.isArray(json.captions)
    ? json.captions
        .filter((item) => item && typeof item.url === 'string')
        .map((item) => ({ lang: String(item.lang || ''), name: String(item.name || ''), url: item.url }))
        .slice(0, 12)
    : [];

  // `subjectId`/`detailPath` MovieBox ke bhi wahi ids hote hain (NetMirror usi
  // backend ka front hai) — inse **dub (audio language)** list mil jati hai,
  // wo `api/moviebox-audio` se aati hai.
  return {
    ok: true,
    title: json.title,
    year: json.year,
    subjectId: typeof json.subjectId === 'string' ? json.subjectId : undefined,
    detailPath: typeof json.detailPath === 'string' ? json.detailPath : undefined,
    streams,
    captions,
  };
}

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.until) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttl) {
  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(key, { value, until: Date.now() + ttl });
}

async function askMirror(base, params, probe) {
  const url = buildUpstreamUrl(base, params);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,*/*',
      Referer: 'https://videodownloader.site/',
    },
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'network', error: `mirror ${base} ne JSON nahi diya`, status: res.status };
  }
  const normalized = normalizeNetmirror(json);
  if (!normalized.ok) return { ...normalized, status: res.status };
  if (probe) {
    return { ok: true, count: normalized.streams.length, title: normalized.title };
  }
  return { ...normalized, mirror: base };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');

  const ip =
    (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown';
  if (!rateOk(ip)) {
    res.status(429).json({ ok: false, reason: 'rate', error: 'Too many requests' });
    return;
  }

  const query = req.query || {};
  const params = {
    tmdb: tmdbNumber(query.tmdb ?? query.id),
    type: query.type === 'tv' ? 'tv' : 'movie',
    season: query.s ?? query.season,
    episode: query.e ?? query.episode,
  };
  const probe = query.probe === '1' || query.probe === 'true';

  if (!params.tmdb) {
    res.status(200).json({ ok: false, reason: 'bad-id', error: 'TMDB numeric id chahiye' });
    return;
  }

  const key = `${params.tmdb}|${params.type}|${params.season || 0}|${params.episode || 0}|${probe ? 'p' : 's'}`;
  const cached = cacheGet(key);
  if (cached) {
    res.status(200).json({ ...cached, cached: true });
    return;
  }

  let last = null;
  for (const base of MIRRORS) {
    try {
      const answer = await askMirror(base, params, probe);
      // `not-added` mirror-specific nahi hota (backend ek hi hai) — aage try
      // karna sirf waqt barbaad karega, seedha jawab de do.
      if (answer.ok || answer.reason === 'not-added') {
        cacheSet(key, answer, answer.ok ? (probe ? PROBE_TTL_MS : CACHE_TTL_MS) : PROBE_TTL_MS);
        res.status(200).json(answer);
        return;
      }
      last = answer;
    } catch (error) {
      last = { ok: false, reason: 'network', error: String(error?.message || error) };
    }
  }

  const fallback = last || { ok: false, reason: 'network', error: 'No mirror answered' };
  cacheSet(key, fallback, PROBE_TTL_MS);
  res.status(200).json(fallback);
}
