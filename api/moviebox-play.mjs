/**
 * /api/moviebox-play — kisi bhi **dub subject** ke stream URLs, server se
 * =========================================================================
 * Owner (24 Oct, chautha round): *"netmirror par bas option aata hai par koi
 * audio milta hi nahi ... sab me likhta hai audio nahi mila"*.
 *
 * Sach: audio (dub) list `api/moviebox-audio` se aa jaati hai (har bhasha ka
 * apna subject), par bhasha chunne par stream **browser se** maangi jaati thi
 * (`lib/movieboxDirect.ts`, h5-api/player-domain par). Us raste par browser
 * CORS/preflight par atak jaata hai — MovieBox par isliye kaam karta dikhta
 * tha ki wahan desktop par purana iframe (watch page) chalta hai, aur
 * NetMirror par sirf apna `<video>` hai. Isliye wahan har bhasha "nahi mila".
 *
 * Ab ye route wahi kaam **server par** karta hai (server-to-server par CORS
 * nahi hota):
 *
 *   1. guest token   `GET {H5}/home` → `x-user` header
 *   2. player host   `GET {H5}/media-player/get-domain` (fallback `mzfi.me`)
 *   3. streams       `GET {player}/wefeed-h5api-bff/subject/play?subjectId&se&ep&detailPath`
 *
 * Video ke **bytes kabhi hamare paas se nahi jaate** — sirf chhota JSON
 * (stream URLs) guzarta hai, `api/netmirror` ki tarah. Bytes CDN se seedha
 * browser tak.
 *
 * GET /api/moviebox-play?subjectId=4151920426815471968&detailPath=…&se=1&ep=1
 *      -> { ok:true, streams:[{url, quality, kind}], playerHost }
 *      -> { ok:false, reason:'no-ref'|'no-token'|'no-streams'|'network', trace }
 * GET /api/moviebox-play?...&probe=1
 *      -> { ok, count, playerHost, token, trace }   (URLs ke bina — debug)
 *
 * `regions: ["bom1"]` (vercel.json) — MovieBox play guest ko **US** se khaali
 * deta hai (`hasResource:false`, CI probe 24 Oct), India se deta hai. Isliye
 * ye function Mumbai me chalta hai.
 */

import { createHash } from 'node:crypto';

const H5_API = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const PLAYER_FALLBACK = 'https://mzfi.me/wefeed-h5api-bff';
const FRONT_HOST = 'moviebox.ph';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Signed URLs ghante bhar chalte hain — thoda kam par cache. */
const CACHE_TTL_MS = 12 * 60 * 1000;
const CACHE_MAX = 300;
/** Ek resolve ke andar kitne attempts (har ek 7s tak). */
const MAX_ATTEMPTS = 12;
const REQUEST_TIMEOUT_MS = 7000;
/** Poora handler itni der me jawab de de (Vercel `maxDuration` 30s). */
const BUDGET_MS = 22_000;

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

/** MovieBox ka `X-Client-Token`: `<unix-sec>,md5(reverse(sec))`. */
export function clientToken(nowMs = Date.now()) {
  const sec = String(Math.floor(nowMs / 1000));
  return `${sec},${createHash('md5').update(sec.split('').reverse().join('')).digest('hex')}`;
}

function headers(extra = {}) {
  return {
    'User-Agent': UA,
    Accept: 'application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
    'X-Request-Lang': 'en',
    'X-Client-Token': clientToken(),
    Referer: `https://${FRONT_HOST}/`,
    Origin: `https://${FRONT_HOST}`,
    ...extra,
  };
}

/** `/subject/play` ke jawab se **asli** media URLs. Kuch bana kar nahi jodte. */
export function pickPlayStreams(payload) {
  const out = [];
  const seen = new Set();
  const push = (url, quality) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (!/\.(mp4|m3u8|mpd)(\?|#|$)/i.test(url) && !/\/(hls|dash)\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    const kind = /\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url)
      ? 'hls'
      : /\.mpd(\?|#|$)/i.test(url) || /\/dash\//i.test(url)
        ? 'dash'
        : 'mp4';
    out.push({ url, quality: Number(quality) || String(quality || '').trim() || 'auto', kind });
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
  // MP4 pehle — media element ko CORS nahi chahiye, HLS/DASH ko chahiye.
  return out.sort((a, b) => (a.kind === 'mp4' ? 0 : 1) - (b.kind === 'mp4' ? 0 : 1));
}

/** Attempts ki tarteeb — pehle sabse sasta/sambhavit rasta. */
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

async function guestToken(trace) {
  try {
    const res = await fetch(`${H5_API}/home?host=${encodeURIComponent(FRONT_HOST)}`, {
      headers: headers(),
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
    trace.push(`token: header khaali (status ${res.status})`);
    return '';
  } catch (error) {
    trace.push(`token: ${String(error?.message || error)}`);
    return '';
  }
}

async function playerBase(token, trace) {
  try {
    const res = await fetch(`${H5_API}/media-player/get-domain`, {
      headers: headers(token ? { Authorization: `Bearer ${token}` } : {}),
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    const value = typeof json?.data === 'string' ? json.data : '';
    const host = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    if (host) return `https://${host}/wefeed-h5api-bff`;
    trace.push('get-domain: host khaali');
  } catch (error) {
    trace.push(`get-domain: ${String(error?.message || error)}`);
  }
  return PLAYER_FALLBACK;
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

/**
 * Ek subject ke streams (server se). Test se seedha bhi bulaya ja sakta hai.
 */
export async function resolvePlayStreams({ subjectId, detailPath, se, ep }) {
  const trace = [];
  const started = Date.now();
  const token = await guestToken(trace);
  if (!token) return { ok: false, reason: 'no-token', streams: [], trace, token: false };
  trace.push('token ok');

  const player = await playerBase(token, trace);
  const playerHost = player.replace(/^https:\/\//, '').split('/')[0];
  trace.push(`player: ${playerHost}`);

  const bases = player === H5_API ? [player] : [player, H5_API];
  const attempts = playAttempts(bases, { subjectId, detailPath, se, ep }).slice(0, MAX_ATTEMPTS);
  let lastReason = 'no-streams';

  for (const attempt of attempts) {
    if (Date.now() - started > BUDGET_MS) {
      trace.push('budget khatam');
      break;
    }
    try {
      const extra = { Authorization: `Bearer ${token}` };
      if (attempt.playMode) extra['X-Play-Mode'] = '2';
      const res = await fetch(`${attempt.base}/subject/play?${attempt.query}`, {
        headers: headers(extra),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastReason = 'network';
        trace.push(`${new URL(attempt.base).host} ${res.status}`);
        continue;
      }
      const payload = await res.json().catch(() => null);
      const streams = pickPlayStreams(payload);
      if (streams.length) {
        trace.push(`streams: ${streams.length}`);
        return { ok: true, streams, playerHost, trace, token: true };
      }
      const flags = payload?.data || {};
      trace.push(
        `${new URL(attempt.base).host} se=${attempt.query.match(/se=(-?\d+)/)?.[1]} ` +
          `ep=${attempt.query.match(/ep=(-?\d+)/)?.[1]} playMode=${attempt.playMode ? 1 : 0} ` +
          `hasResource=${flags.hasResource} streams=0`,
      );
    } catch (error) {
      lastReason = 'network';
      trace.push(`fetch: ${String(error?.message || error)}`);
    }
  }

  return { ok: false, reason: lastReason, streams: [], trace, token: true };
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
        playerHost: answer.playerHost,
        token: answer.token === true,
        trace: answer.trace,
      }
    : answer.ok
      ? { ok: true, streams: answer.streams, playerHost: answer.playerHost }
      : { ok: false, reason: answer.reason, trace: answer.trace };

  if (answer.ok && !probe) cacheSet(key, { ok: true, streams: answer.streams, playerHost: answer.playerHost });
  res.status(200).json(body);
}
