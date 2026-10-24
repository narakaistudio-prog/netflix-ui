/**
 * /api/moviebox-play — dub subject ke **asli** stream URLs, server se
 * ====================================================================
 * Owner (24 Oct, chautha/paanchva round): *"netmirror par bas option aata hai
 * par koi audio milta hi nahi … sab me likhta hai audio nahi mila"*.
 *
 * Audio (dub) list `api/moviebox-audio` se aati hai — har bhasha ka apna
 * subject. Par us subject ke streams browser se maangne par kuch nahi milta:
 * h5 `subject/play` guest ko `streams: []` (`hasResource:false`) deta hai.
 *
 * Asli rasta MovieBox **app** ka hai (reference: Rust client `MovieBox-TUI` ka
 * protocol, jo `birdy1974/vu-movie` me 1:1 port hua hai):
 *
 *   1. `POST {apiN}/wefeed-mobile-bff/user-api/visitor-login`  body `{}`
 *      → guest JWT (`data.token`)
 *   2. `GET  {apiN}/wefeed-mobile-bff/subject-api/play-info/v2?subjectId&se&ep`
 *      → signed DASH/HLS/MP4 URLs
 *   3. `GET  {apiN}/wefeed-mobile-bff/subject-api/resource?subjectId&se&ep…`
 *      → direct mirrors (kuch titles par sirf yahan se aate hain)
 *
 * Har request par app-jaisa signature:
 *
 *   canonical = METHOD \n application/json \n application/json \n
 *               <body length> \n <epoch-ms> \n <md5(body)> \n path?sortedQuery
 *   x-tr-signature = `<epoch-ms>|2|` + base64(hmac-md5(SECRET_32B, canonical))
 *   x-client-token = `<epoch-ms>,` + md5(reverse(epoch-ms))
 *
 * (24 Oct ka pehla attempt 440 deta tha: galat host + base64 secret + charset
 *  wala content-type. Ab 32-byte secret, `application/json`, aur api* host
 *  pool — jaisa reference client karta hai.)
 *
 * Video ke **bytes kabhi hamare paas se nahi jaate** — sirf chhota JSON (URLs),
 * `api/netmirror` ki tarah. Playback CDN se seedha.
 *
 * GET /api/moviebox-play?subjectId=…&se=1&ep=1
 *      -> { ok:true, streams:[{url, quality, kind}], via, host }
 *      -> { ok:false, reason:'no-ref'|'no-token'|'no-streams'|'network', trace }
 * GET /api/moviebox-play?…&probe=1
 *      -> { ok, count, via, region, trace }   (URLs ke bina — debug)
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

const API_PREFIX = '/wefeed-mobile-bff';
/** App ke edge hosts — `api6` sabse pehle (reference client ka order). */
const HOST_POOL = [
  'https://api6.aoneroom.com',
  'https://api5.aoneroom.com',
  'https://api4.aoneroom.com',
  'https://api4sg.aoneroom.com',
  'https://api3.aoneroom.com',
  'https://api.inmoviebox.com',
];
/** 32-byte key baked into the app (MovieBox-TUI `crypto.rs`). */
const SECRET = Buffer.from([
  0xef, 0xa8, 0x91, 0x97, 0x4e, 0xec, 0xd3, 0x14, 0x8d, 0xf6, 0x3a, 0xa6,
  0x11, 0x60, 0x2d, 0xef, 0xd1, 0x01, 0x25, 0x9b, 0xa5, 0x21, 0x02, 0x2c,
  0x57, 0xae, 0x05, 0x66, 0xbd, 0x8e, 0x12,
]);
const SIGNATURE_BODY_MAX = 102_400;

/** H5 (web) fallback — sirf tab jab app ka rasta bilkul khaali ho. */
const H5_API = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const PLAYER_FALLBACK = 'https://mzfi.me/wefeed-h5api-bff';
const FRONT_HOST = 'moviebox.ph';

const CACHE_TTL_MS = 12 * 60 * 1000;
const CACHE_MAX = 300;
const REQUEST_TIMEOUT_MS = 9000;
const MAX_H5_ATTEMPTS = 6;
const SESSION_TTL_MS = 20 * 60 * 1000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

const md5 = (value) => createHash('md5').update(value).digest('hex');

/** `<epoch-ms>,md5(reverse(epoch-ms))`. */
export function clientToken(nowMs = Date.now()) {
  const stamp = String(nowMs);
  return `${stamp},${md5(stamp.split('').reverse().join(''))}`;
}

/** URL ke sorted query se `path?k=v&k=v` (canonical ka aakhri hissa). */
export function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    const params = [...parsed.searchParams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    return params ? `${parsed.pathname}?${params}` : parsed.pathname;
  } catch {
    return String(url);
  }
}

/** `METHOD \n accept \n content-type \n length \n ts \n md5(body) \n path?query`. */
export function canonicalString({ method, url, body, timestampMs }) {
  const hasBody = body !== undefined && body !== null;
  const raw = hasBody ? Buffer.from(String(body)) : null;
  return [
    String(method).toUpperCase(),
    'application/json',
    'application/json',
    raw ? String(raw.length) : '',
    String(timestampMs),
    raw ? md5(raw.subarray(0, SIGNATURE_BODY_MAX)) : '',
    canonicalUrl(url),
  ].join('\n');
}

/** `<ts>|2|<base64 hmac-md5>` — app ka `x-tr-signature`. */
export function trSignature({ method, url, body, timestampMs = Date.now() }) {
  const mac = createHmac('md5', SECRET)
    .update(canonicalString({ method, url, body, timestampMs }))
    .digest('base64');
  return `${timestampMs}|2|${mac}`;
}

/** App-jaisa device fingerprint (ek process me ek hi rehta hai). */
function makeIdentity() {
  const android = [['9', 'PQ3A.190605.03081104'], ['10', 'QP1A.191005.007.A3'], ['11', 'RP1A.200720.011'], ['12', 'S1B.220414.015'], ['13', 'TQ2A.230405.003']][
    Math.floor(Math.random() * 5)
  ];
  const device = ['23078RKD5C', '2201117TY', '2201117TG', '22101316G', '21121210G', 'M2012K11AG', 'M2007J20CG'][
    Math.floor(Math.random() * 7)
  ];
  const versionCode = [50020117, 50020118, 50020119, 50020120, 50020121][Math.floor(Math.random() * 5)];
  const hex = (len) => randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
  const uuid = `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  const userAgent = `com.community.oneroom/${versionCode} (Linux; U; Android ${android[0]}; en_US; ${device}; Build/${android[1]}; Cronet/135.0.7012.3)`;
  const clientInfo = JSON.stringify({
    package_name: 'com.community.oneroom',
    version_name: '4.0.01.0813.03',
    version_code: versionCode,
    os: 'android',
    os_version: android[0],
    install_ch: 'ps',
    device_id: hex(32),
    install_store: 'ps',
    gaid: uuid,
    brand: 'Redmi',
    model: device,
    system_language: 'en',
    net: 'NETWORK_WIFI',
    region: 'IN',
    timezone: 'Asia/Kolkata',
    sp_code: '40401',
    'X-Play-Mode': '2',
  });
  /** App apna IP spoof karta hai (APAC prefix) — reference client bhi karta hai. */
  const spoofedIp = `49.${36 + Math.floor(Math.random() * 40)}.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  return { userAgent, clientInfo, spoofedIp };
}

let identity = null;
function currentIdentity() {
  if (!identity) identity = makeIdentity();
  return identity;
}

function signedHeaders({ method, url, body, token }) {
  const id = currentIdentity();
  const timestampMs = Date.now();
  return {
    'User-Agent': id.userAgent,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Connection: 'keep-alive',
    'x-client-token': clientToken(timestampMs),
    'x-tr-signature': trSignature({ method, url, body, timestampMs }),
    'x-client-info': id.clientInfo,
    'x-client-status': '0',
    'x-forwarded-for': id.spoofedIp,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

let session = null;

/** Guest JWT. Ek process me reuse hota hai (naya fingerprint + purana token = shak). */
async function visitorToken(trace) {
  if (session && Date.now() - session.at < SESSION_TTL_MS) return session.token;
  const body = '{}';
  for (const host of HOST_POOL) {
    const url = `${host}${API_PREFIX}/user-api/visitor-login`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: signedHeaders({ method: 'POST', url, body }),
        body,
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      const payload = await res.json().catch(() => null);
      const token = payload?.data?.token || payload?.data?.data?.token;
      if (token) {
        session = { token: String(token), at: Date.now(), host };
        trace.push(`visitor-login ok (${host.replace(/^https:\/\//, '')})`);
        return session.token;
      }
      trace.push(`visitor-login ${host.replace(/^https:\/\//, '')}: status ${res.status} code ${payload?.code ?? '?'}`);
    } catch (error) {
      trace.push(`visitor-login ${host.replace(/^https:\/\//, '')}: ${String(error?.message || error)}`);
    }
    await sleep(60);
  }
  return '';
}

async function apiGet(pathAndQuery, token, trace) {
  const hosts = session?.host ? [session.host, ...HOST_POOL.filter((host) => host !== session.host)] : HOST_POOL;
  let last = null;
  for (const host of hosts) {
    const url = `${host}${API_PREFIX}${pathAndQuery}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: signedHeaders({ method: 'GET', url, token }),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok && payload) return { payload, host, status: res.status };
      last = { status: res.status, code: payload?.code, host };
      trace.push(`GET ${pathAndQuery.split('?')[0]} ${host.replace(/^https:\/\//, '')}: ${res.status}/${payload?.code ?? '?'}`);
    } catch (error) {
      last = { status: 0, host, error: String(error?.message || error) };
      trace.push(`GET ${pathAndQuery.split('?')[0]} ${host.replace(/^https:\/\//, '')}: ${String(error?.message || error)}`);
    }
    await sleep(60);
  }
  return { payload: null, ...(last || {}) };
}

function isMediaUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  return /\.(mp4|m3u8|mpd)(\?|#|$)/i.test(value) || /\/dash\//i.test(value) || /\/hls\//i.test(value);
}

function kindOf(url) {
  if (/\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url)) return 'hls';
  if (/\.mpd(\?|#|$)/i.test(url) || /\/dash\//i.test(url)) return 'dash';
  return 'mp4';
}

/**
 * `signCookie` ke andar asli CDN path chhupa hota hai —
 * `urlprefix=<base64>` → decode → `…/dash/` → `index.mpd` asli manifest.
 */
export function streamsFromSignCookie(signCookie) {
  const out = [];
  if (typeof signCookie !== 'string' || !signCookie) return out;
  const match = signCookie.match(/urlprefix=([A-Za-z0-9_\-+/=]+)/);
  if (!match) return out;
  let base = '';
  try {
    base = Buffer.from(match[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return out;
  }
  if (!/^https?:\/\//i.test(base)) return out;
  const trimmed = base.endsWith('/') ? base : `${base}/`;
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

/** `/subject/play` (h5) ke jawab se URLs — aakhri fallback. */
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
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    Accept: 'application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Client-Info': currentIdentity().clientInfo,
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

async function h5Streams({ subjectId, detailPath, se, ep }, trace, started) {
  const token = await h5Token(trace);
  if (!token) return { streams: [], playerHost: '' };
  let player = PLAYER_FALLBACK;
  try {
    const res = await fetch(`${H5_API}/media-player/get-domain`, {
      headers: h5Headers({ Authorization: `Bearer ${token}` }),
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    const host = String(typeof json?.data === 'string' ? json.data : '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim();
    if (host) player = `https://${host}/wefeed-h5api-bff`;
  } catch {
    trace.push('h5 get-domain: fallback player');
  }
  const playerHost = player.replace(/^https:\/\//, '').split('/')[0];
  const attempts = playAttempts([player, H5_API], { subjectId, detailPath, se, ep }).slice(0, MAX_H5_ATTEMPTS);
  for (const attempt of attempts) {
    if (Date.now() - started > 22_000) {
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
      if (attempt === attempts[0]) trace.push(`h5 hasResource=${payload?.data?.hasResource} streams=0`);
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

function dedupe(streams) {
  const seen = new Set();
  const out = [];
  for (const item of streams) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

/** Ek subject ke streams (server se). Test se seedha bhi bulaya ja sakta hai. */
export async function resolvePlayStreams({ subjectId, detailPath, se, ep }) {
  const trace = [];
  const token = await visitorToken(trace);

  if (token) {
    const playQuery =
      `/subject-api/play-info/v2?subjectId=${encodeURIComponent(subjectId)}` +
      (se > 0 && ep > 0 ? `&se=${se}&ep=${ep}` : '');
    const play = await apiGet(playQuery, token, trace);
    if (play.payload) {
      const data = play.payload?.data ?? play.payload;
      const streams = [
        ...collectMediaUrls(data),
        ...streamsFromSignCookie(String(data?.signCookie || '')),
      ];
      if (streams.length) {
        trace.push(`play-info/v2: ${streams.length} streams`);
        return { ok: true, streams: dedupe(streams), via: 'play-info-v2', host: play.host, trace };
      }
      trace.push('play-info/v2: streams 0');
    }

    // `resource` — kabhi kabhi sirf yahan direct mirrors hote hain.
    const resourceQuery =
      `/subject-api/resource?subjectId=${encodeURIComponent(subjectId)}` +
      (se > 0 ? `&se=${se}` : '') +
      (ep > 0 ? `&ep=${ep}` : '') +
      '&page=1&perPage=20';
    const resource = await apiGet(resourceQuery, token, trace);
    if (resource.payload) {
      const streams = collectMediaUrls(resource.payload?.data ?? resource.payload);
      if (streams.length) {
        trace.push(`resource: ${streams.length} streams`);
        return { ok: true, streams: dedupe(streams), via: 'resource', host: resource.host, trace };
      }
      trace.push('resource: streams 0');
    }
  }

  const h5 = await h5Streams({ subjectId, detailPath, se, ep }, trace, Date.now());
  if (h5.streams.length) {
    trace.push(`h5: ${h5.streams.length} streams`);
    return { ok: true, streams: dedupe(h5.streams), via: 'h5', host: h5.playerHost, trace };
  }

  return { ok: false, reason: token ? 'no-streams' : 'no-token', streams: [], trace };
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
        region: process.env.VERCEL_REGION || 'local',
        trace: answer.trace,
      }
    : answer.ok
      ? { ok: true, streams: answer.streams, via: answer.via, host: answer.host }
      : { ok: false, reason: answer.reason, trace: answer.trace };

  if (answer.ok && !probe) cacheSet(key, { ok: true, streams: answer.streams, via: answer.via, host: answer.host });
  res.status(200).json(body);
}
