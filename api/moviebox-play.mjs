/**
 * /api/moviebox-play — dub subject ke **asli** stream URLs, server se
 * ====================================================================
 * Owner (24 Oct, chautha round): *"netmirror par bas option aata hai par koi
 * audio milta hi nahi … sab me likhta hai audio nahi mila"*.
 *
 * Audio (dub) list `api/moviebox-audio` se aati hai — har bhasha ka apna
 * subject. Par us subject ke streams **browser se** maangne par kuch nahi
 * milta:
 *
 *   - h5 `subject/play` guest ko `streams: []` deta hai (`hasResource:false`),
 *     India ke browser me bhi;
 *   - mobile app ka rasta (`play-info/v2`) bina **visitor-login** token ke
 *     441/403 deta hai.
 *
 * Isliye ab ye kaam server par hota hai (CORS ka sawaal hi nahi):
 *
 *   1. `POST {APIG}/wefeed-mobile-bff/user-api/visitor-login`   → guest token
 *   2. `GET  {APIG}/wefeed-mobile-bff/subject-api/play-info/v2?subjectId&se&ep`
 *      (Android app ke headers + `x-tr-signature`)
 *   3. jawab me `streams`/`streamList`/`hls`/`dash` — ya `signCookie` ke andar
 *      chhupa `urlprefix=<base64>` CDN path (anti-piracy trap ke liye).
 *   4. fail ho to purana h5 `subject/play` (h5-api + player domain) try.
 *
 * Video ke **bytes kabhi hamare paas se nahi jaate** — sirf chhota JSON (URLs)
 * guzarta hai, `api/netmirror` ki tarah. Playback CDN se seedha.
 *
 * GET /api/moviebox-play?subjectId=…&detailPath=…&se=1&ep=1
 *      -> { ok:true, streams:[{url, quality, kind}], via:'play-info-v2'|'h5', playerHost }
 *      -> { ok:false, reason:'no-ref'|'no-token'|'no-streams'|'network', trace }
 * GET /api/moviebox-play?…&probe=1
 *      -> { ok, count, via, trace }        (URLs ke bina — debug)
 *
 * `regions: ["bom1"]` (vercel.json): app ka rasta India ka hai (`region: IN`),
 * aur mobile BFF bahar se "Service not available in current region" deta hai.
 */

import { createHash, createHmac } from 'node:crypto';

const APIG = 'https://apig.inmoviebox.com';
const H5_API = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const PLAYER_FALLBACK = 'https://mzfi.me/wefeed-h5api-bff';
const FRONT_HOST = 'moviebox.ph';
/** Gateway secret (app me base64 me rakha hota hai) — signature ke liye. */
const GATEWAY_SECRET = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';
const APP_UA = 'MovieBox/4.0.02 (Android 14; Pixel 6)';
const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 12 * 60 * 1000;
const CACHE_MAX = 300;
const REQUEST_TIMEOUT_MS = 9000;
const MAX_H5_ATTEMPTS = 8;
const BUDGET_MS = 22_000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

/** `<epoch-ms>,md5(reverse(epoch-ms))` — app ka `X-Client-Token`. */
export function clientToken(nowMs = Date.now()) {
  const stamp = String(nowMs);
  return `${stamp},${createHash('md5').update(stamp.split('').reverse().join('')).digest('hex')}`;
}

/**
 * `x-tr-signature` — `timestamp|2|<base64 hmac-md5>`.
 *
 * Canonical: METHOD \n Accept \n Content-Type \n Content-Length \n timestamp \n
 * bodyMD5 \n path?sortedQuery  (query values bina encode, keys sorted).
 */
export function trSignature({ method, path, query = '', body = '', timestamp = Date.now() }) {
  const resource = query ? `${path}?${query}` : path;
  const bodyMd5 = body ? createHash('md5').update(body.slice(0, 0x19000)).digest('hex') : '';
  const canonical = [
    String(method).toUpperCase(),
    'application/json',
    'application/json;charset=UTF-8',
    body ? String(Buffer.byteLength(body)) : '',
    String(timestamp),
    bodyMd5,
    resource,
  ].join('\n');
  const signature = createHmac('md5', Buffer.from(GATEWAY_SECRET, 'base64'))
    .update(canonical, 'utf8')
    .digest('base64');
  return `${timestamp}|2|${signature}`;
}

/** Query string jo signature me jaata hai — keys sorted, values bina encode. */
export function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
}

function clientInfo() {
  return JSON.stringify({
    package_name: 'com.community.oneroom',
    version_name: '4.0.02',
    version_code: 50020126,
    os: 'android',
    os_version: '14',
    install_ch: 'ps',
    device_id: '868203051234567',
    install_store: 'ps',
    gaid: '',
    brand: 'Google',
    model: 'Pixel 6',
    system_language: 'en',
    net: 'wifi',
    region: 'IN',
    timezone: 'Asia/Kolkata',
    sp_code: '404',
  });
}

/** App-jaisa signed request (apig gateway). */
async function appRequest(method, path, params = {}, body = '', token = '') {
  const timestamp = Date.now();
  const query = canonicalQuery(params);
  const url = `${APIG}${path}${query ? `?${query}` : ''}`;
  const headers = {
    'User-Agent': APP_UA,
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-M-Version': '4.0.02',
    'X-Sign-Version': '2.0',
    'X-Client-Token': clientToken(timestamp),
    'X-Client-Info': clientInfo(),
    'X-Client-Status': '0',
    'X-Play-Mode': '2',
    'X-Timestamp': String(timestamp),
    'x-tr-signature': trSignature({ method, path, query, body, timestamp }),
    appid: '4U01pxRu278GqCZKY9',
    region: 'IN',
    lang: 'en',
    os: 'android',
    Referer: `${APIG}/`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
  };
  return fetch(url, {
    method,
    headers,
    body: method === 'POST' ? body : undefined,
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    redirect: 'follow',
  });
}

/** Guest token — `visitor-login` (ya `x-user` header se). */
async function visitorToken(trace) {
  try {
    const res = await appRequest('POST', '/wefeed-mobile-bff/user-api/visitor-login', {}, '{}');
    const payload = await res.json().catch(() => null);
    const token = payload?.data?.token || payload?.data?.data?.token;
    if (token) {
      trace.push('visitor-login ok');
      return String(token);
    }
    const raw = res.headers.get('x-user');
    if (raw) {
      try {
        const headerToken = JSON.parse(raw)?.token;
        if (headerToken) {
          trace.push('visitor-login: token header se');
          return String(headerToken);
        }
      } catch {
        // header JSON nahi tha
      }
    }
    trace.push(`visitor-login: token nahi (status ${res.status}, code ${payload?.code ?? '?'})`);
    return '';
  } catch (error) {
    trace.push(`visitor-login: ${String(error?.message || error)}`);
    return '';
  }
}

function isMediaUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  return /\.(mp4|m3u8|mpd)(\?|#|$)/i.test(value) || /\/\/(hls|dash)\//i.test(value) || /\/dash\//i.test(value);
}

function kindOf(url) {
  if (/\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url)) return 'hls';
  if (/\.mpd(\?|#|$)/i.test(url) || /\/dash\//i.test(url)) return 'dash';
  return 'mp4';
}

/**
 * `signCookie` ke andar asli CDN path chhupa hota hai —
 * `urlprefix=<base64>` → decode → `…/dash/`; usme `index.mpd`/`index.m3u8`
 * jodna asli manifest deta hai (fake 21-second trap clip se bachne ka rasta).
 */
export function streamsFromSignCookie(signCookie) {
  const out = [];
  if (typeof signCookie !== 'string' || !signCookie) return out;
  const match = signCookie.match(/urlprefix=([A-Za-z0-9+/=_-]+)/);
  if (!match) return out;
  let base = '';
  try {
    base = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return out;
  }
  if (!/^https?:\/\//i.test(base)) return out;
  const trimmed = base.replace(/\/?$/, '/');
  for (const file of ['index.mpd', 'index.m3u8']) {
    const url = `${trimmed}${file}`;
    if (!/\.(mp4|m3u8|mpd)(\?|#|$)/i.test(url)) continue;
    out.push({ url, quality: 'auto', kind: kindOf(url) });
  }
  return out;
}

/** JSON me jahan bhi asli media URL ho — nikaal lo (depth-limited). */
export function collectMediaUrls(payload, { maxDepth = 6, limit = 24 } = {}) {
  const out = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (out.length >= limit || depth > maxDepth || node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (isMediaUrl(node) && !seen.has(node)) {
        seen.add(node);
        out.push({ url: node, quality: 'auto', kind: kindOf(node) });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const value of Object.values(node)) walk(value, depth + 1);
    }
  };
  walk(payload, 0);
  return out;
}

/**
 * `/subject/play` (h5) ke jawab se URLs — purana rasta, fallback ke liye.
 * `vipLocked` entries chhod di jaati hain (wo sach me unlocked nahi hain).
 */
export function pickPlayStreams(payload) {
  const out = [];
  const seen = new Set();
  const push = (url, quality) => {
    if (!isMediaUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, quality: Number(quality) || String(quality || '').trim() || 'auto', kind: kindOf(url) });
  };
  const data = payload?.data ?? payload;
  if (!data || typeof data !== 'object') return out;
  for (const list of [data.streams, data.hls, data.dash, data.playUrls, data.playList]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === 'string') {
        push(entry, '');
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      if (entry.vipLocked === true) continue;
      push(entry.url || entry.playUrl || entry.streamUrl, entry.resolutions || entry.resolution || entry.quality);
    }
  }
  return out.sort((a, b) => (a.kind === 'mp4' ? 0 : 1) - (b.kind === 'mp4' ? 0 : 1));
}

async function playInfoV2({ subjectId, se, ep, token }) {
  const params = { host: 'apig.inmoviebox.com', subjectId };
  if (se > 0) params.se = se;
  if (ep > 0) params.ep = ep;
  const res = await appRequest('GET', '/wefeed-mobile-bff/subject-api/play-info/v2', params, '', token);
  const payload = await res.json().catch(() => null);
  const data = payload?.data ?? payload;
  const streams = [
    ...pickPlayStreams(payload?.data?.data ?? payload),
    ...collectMediaUrls(data),
    ...streamsFromSignCookie(String(data?.signCookie || payload?.signCookie || '')),
  ];
  return { status: res.status, code: payload?.code, streams };
}

export function playAttempts(bases, { subjectId, detailPath, se, ep }) {
  const seen = new Set();
  const coords = [];
  const addCoords = (a, b) => {
    const key = `${a}:${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    coords.push([a, b]);
  };
  addCoords(se, ep);
  if (!se || !ep) addCoords(1, 1);
  addCoords(0, 0);

  const list = [];
  const seenQuery = new Set();
  for (const base of bases) {
    for (const [a, b] of coords) {
      for (const sign of [true, false]) {
        for (const playMode of [false, true]) {
          const query =
            `subjectId=${encodeURIComponent(subjectId)}` +
            `&se=${a}&ep=${b}` +
            (detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : '') +
            (sign ? '&streamSignType=1' : '');
          const key = `${base}|${query}|${playMode ? 1 : 0}`;
          if (seenQuery.has(key)) continue;
          seenQuery.add(key);
          list.push({ base, query, playMode });
        }
      }
    }
  }
  return list;
}

function h5Headers(extra = {}) {
  return {
    'User-Agent': WEB_UA,
    Accept: 'application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Client-Info': clientInfo(),
    'X-Request-Lang': 'en',
    'X-Client-Token': clientToken(),
    Referer: `https://${FRONT_HOST}/`,
    Origin: `https://${FRONT_HOST}`,
    ...extra,
  };
}

async function h5Token(trace) {
  try {
    const res = await fetch(`${H5_API}/home?host=${encodeURIComponent(FRONT_HOST)}`, {
      headers: h5Headers(),
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });
    const raw = res.headers.get('x-user');
    if (raw) {
      try {
        const token = JSON.parse(raw)?.token;
        if (token) return String(token);
      } catch {
        // header JSON nahi tha
      }
    }
    const match = String(res.headers.get('set-cookie') || '').match(/token=([^;]+)/);
    if (match) return match[1];
    trace.push(`h5 token: khaali (status ${res.status})`);
    return '';
  } catch (error) {
    trace.push(`h5 token: ${String(error?.message || error)}`);
    return '';
  }
}

async function h5PlayerBase(token, trace) {
  try {
    const res = await fetch(`${H5_API}/media-player/get-domain`, {
      headers: h5Headers(token ? { Authorization: `Bearer ${token}` } : {}),
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    const host = String(typeof json?.data === 'string' ? json.data : '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim();
    if (host) return `https://${host}/wefeed-h5api-bff`;
  } catch {
    // fallback neeche
  }
  trace.push('h5 get-domain: fallback player');
  return PLAYER_FALLBACK;
}

async function h5Streams({ subjectId, detailPath, se, ep }, trace, started) {
  const token = await h5Token(trace);
  if (!token) return { streams: [], playerHost: '' };
  const player = await h5PlayerBase(token, trace);
  const playerHost = player.replace(/^https:\/\//, '').split('/')[0];
  const bases = [player, H5_API];
  const attempts = playAttempts(bases, { subjectId, detailPath, se, ep }).slice(0, MAX_H5_ATTEMPTS);
  for (const attempt of attempts) {
    if (Date.now() - started > BUDGET_MS) {
      trace.push('h5: budget khatam');
      break;
    }
    try {
      const extra = { Authorization: `Bearer ${token}` };
      if (attempt.playMode) extra['X-Play-Mode'] = '2';
      const res = await fetch(`${attempt.base}/subject/play?${attempt.query}`, {
        headers: h5Headers(extra),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        trace.push(`h5 ${res.status}`);
        continue;
      }
      const payload = await res.json().catch(() => null);
      const streams = pickPlayStreams(payload);
      if (streams.length) return { streams, playerHost };
      if (attempt === attempts[0]) {
        trace.push(`h5 hasResource=${payload?.data?.hasResource} streams=0`);
      }
    } catch (error) {
      trace.push(`h5 fetch: ${String(error?.message || error)}`);
    }
  }
  return { streams: [], playerHost };
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

function cacheSet(key, value) {
  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(key, { value, until: Date.now() + CACHE_TTL_MS });
}

/** Ek subject ke streams (server se). Test se seedha bhi bulaya ja sakta hai. */
export async function resolvePlayStreams({ subjectId, detailPath, se, ep }) {
  const trace = [];
  const started = Date.now();
  let via = '';

  const token = await visitorToken(trace);
  if (token) {
    for (const [season, episode] of [
      [se, ep],
      [1, 1],
      [0, 0],
    ]) {
      if (Date.now() - started > BUDGET_MS) break;
      try {
        const answer = await playInfoV2({ subjectId, se: season, ep: episode, token });
        if (answer.streams.length) {
          trace.push(`play-info/v2: ${answer.streams.length} streams (se=${season} ep=${episode})`);
          return { ok: true, streams: dedupe(answer.streams), playerHost: 'apig.inmoviebox.com', via: 'play-info-v2', trace };
        }
        trace.push(`play-info/v2: 0 streams (se=${season} ep=${episode}, status ${answer.status}, code ${answer.code ?? '?'})`);
        if (season === se && episode === ep) await sleep(120);
      } catch (error) {
        trace.push(`play-info/v2: ${String(error?.message || error)}`);
      }
    }
  }

  const h5 = await h5Streams({ subjectId, detailPath, se, ep }, trace, started);
  if (h5.streams.length) {
    via = 'h5';
    trace.push(`h5: ${h5.streams.length} streams`);
    return { ok: true, streams: dedupe(h5.streams), playerHost: h5.playerHost, via, trace };
  }

  return { ok: false, reason: token ? 'no-streams' : 'no-token', streams: [], trace };
}

function dedupe(streams) {
  const seen = new Set();
  const out = [];
  for (const item of streams) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600');

  const query = req.query || {};
  const subjectId = String(query.subjectId || query.id || '').trim();
  const detailPath = String(query.detailPath || '').trim();
  const se = Math.max(0, Math.trunc(Number(query.se) || 0));
  const ep = Math.max(0, Math.trunc(Number(query.ep) || 0));
  const probe = query.probe === '1' || query.probe === 'true';

  if (!/^\d+$/.test(subjectId)) {
    res.status(200).json({ ok: false, reason: 'no-ref', error: 'subjectId chahiye' });
    return;
  }

  const key = `${subjectId}|${detailPath}|${se}|${ep}`;
  if (!probe) {
    const cached = cacheGet(key);
    if (cached) {
      res.status(200).json({ ...cached, cached: true });
      return;
    }
  }

  const answer = await resolvePlayStreams({ subjectId, detailPath, se, ep });
  const body = probe
    ? {
        ok: answer.ok,
        count: answer.streams.length,
        via: answer.via,
        // Debug: function kis region me chala (bom1 = Mumbai).
        region: process.env.VERCEL_REGION || 'local',
        trace: answer.trace,
      }
    : answer.ok
      ? { ok: true, streams: answer.streams, via: answer.via, playerHost: answer.playerHost }
      : { ok: false, reason: answer.reason, trace: answer.trace };

  if (answer.ok && !probe) {
    cacheSet(key, { ok: true, streams: answer.streams, via: answer.via, playerHost: answer.playerHost });
  }
  res.status(200).json(body);
}
