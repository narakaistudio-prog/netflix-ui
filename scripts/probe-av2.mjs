/**
 * PROBE 2 (temporary) — subtitle asli me kaise chale, aur dub kahan se aaye.
 * ======================================================================
 * Probe 1 ka sach:
 *   - NetMirror ke `captions[].url` hamare `/api/proxy/video` se guzarte hain
 *     aur wo route **429** (Cloudflare) deta hai — isi liye subtitle nahi chala.
 *   - Har caption ke andar asli CDN URL hota hai
 *     (`cacdn.hakunaymatata.com/subtitle/<hash>.srt?Policy=…&Signature=…`).
 *
 * Ab do sawaal:
 *   A. Wo andar wala signed URL **seedha** chalta hai? (bina net27 ke)
 *      Aur hamara asli handler (`api/netmirror-subtitle.mjs`) us par 200 VTT
 *      deta hai?
 *   B. MovieBox par **dub** (audio language) kaise milta hai — kya har dub ka
 *      apna subject + stream hota hai?
 */
import { createHash } from 'node:crypto';
import handler from '../api/netmirror-subtitle.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const HOST = 'moviebox.ph';
const NM = 'https://net27.cc';

const log = (...args) => console.log(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

const unwrap = (absolute) => {
  try {
    const url = new URL(absolute);
    const inner = url.searchParams.get('url');
    return inner || null;
  } catch {
    return null;
  }
};

async function tryFetch(url, headers) {
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    return {
      status: res.status,
      type: res.headers.get('content-type') || '-',
      bytes: body.length,
      kind: /^WEBVTT/.test(body.slice(0, 8)) ? 'VTT' : /-->/.test(body) ? 'SRT' : 'html/other',
      head: JSON.stringify(body.slice(0, 120)),
      finalHost: new URL(res.url).host,
    };
  } catch (error) {
    return { status: 0, error: String(error?.message || error) };
  }
}

/** Asli handler ko in-process chalao (jaise Vercel par chalega). */
function callHandler(query) {
  return new Promise((resolve) => {
    const req = { query, headers: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
      },
      send(payload) {
        resolve({ status: this.statusCode, body: String(payload).slice(0, 200), type: this.headers['Content-Type'] });
      },
    };
    handler(req, res).catch((error) => resolve({ status: 500, body: String(error) }));
  });
}

/* ------------------------- A. subtitle direct ------------------------- */

log('\n# A. NetMirror captions — andar wala CDN URL seedha chalta hai?');
const embedRes = await fetch(`${NM}/api/embed-tmdb/1465943`, {
  headers: { 'User-Agent': UA, Accept: 'application/json,*/*', Referer: 'https://videodownloader.site/' },
  signal: AbortSignal.timeout(20000),
});
const embed = JSON.parse(await embedRes.text());
log(`   embed ${embedRes.status} captions=${(embed.captions || []).length}`);
const picks = (embed.captions || []).filter((c) => ['en', 'hi', 'ta'].includes(c.lang));
for (const cap of picks) {
  const inner = unwrap(new URL(cap.url, NM).toString());
  log(`\n   ${cap.lang} (${cap.name}) inner=${inner ? inner.slice(0, 100) : '(none)'}`);
  if (!inner) continue;
  const bare = await tryFetch(inner, { 'User-Agent': UA });
  log(`     direct plain: ${bare.status} ${bare.type} ${bare.bytes}B ${bare.kind} host=${bare.finalHost || '-'}`);
  log(`     head: ${bare.head}`);
  const withRef = await tryFetch(inner, { 'User-Agent': UA, Referer: 'https://net27.cc/' });
  log(`     direct referer: ${withRef.status} ${withRef.type} ${withRef.bytes}B ${withRef.kind}`);
  const viaHandler = await callHandler({ url: inner });
  log(`     our handler: ${viaHandler.status} ${viaHandler.type || ''} ${String(viaHandler.body).slice(0, 60).replace(/\n/g, ' ')}`);
}

/* ---------------------------- B. MovieBox dubs ---------------------------- */

log('\n# B. MovieBox — dub = alag subject?');
function clientToken(now = Date.now()) {
  const sec = String(Math.floor(now / 1000));
  return `${sec},${createHash('md5').update(sec.split('').reverse().join('')).digest('hex')}`;
}
const mbHeaders = (extra = {}) => ({
  'User-Agent': UA,
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
  'X-Request-Lang': 'en',
  Referer: `https://${HOST}/`,
  Origin: `https://${HOST}`,
  ...extra,
});

const home = await fetch(`${H5}/home?host=${encodeURIComponent(HOST)}`, { headers: mbHeaders() });
let token = '';
try {
  token = String(JSON.parse(home.headers.get('x-user') || '{}').token || '');
} catch {
  /* ignore */
}
const auth = token ? { Authorization: `Bearer ${token}` } : {};
log(`   /home ${home.status} token=${token ? 'yes' : 'no'}`);

const domainRes = await fetch(`${H5}/media-player/get-domain`, { headers: mbHeaders(auth) });
let playerHost = '';
try {
  const json = JSON.parse(await domainRes.text());
  playerHost = String(json?.data?.domain || json?.data || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
} catch {
  /* ignore */
}
log(`   player: ${playerHost || '(none)'}`);

/** `data/` me jo bake hai usi par test — Mandaadi (Hindi dub, known). */
const KNOWN = [
  {
    label: 'Mandaadi (baked)',
    subjectId: '4151920426815471968',
    detailPath: 'mandaadi-hindi-qxUx1r3QHW4',
  },
];
const searchRes = await fetch(`${H5}/subject/search`, {
  method: 'POST',
  headers: mbHeaders({ 'Content-Type': 'application/json', ...auth }),
  body: JSON.stringify({ keyword: 'Vishwanath', page: 1, perPage: 3, subjectType: 0 }),
});
const items = JSON.parse(await searchRes.text())?.data?.items || [];
log(`   search 'Vishwanath': ${items.map((i) => `${i.subjectId}|${i.title}|${i.detailPath}`).join(' , ')}`);
const vish = items.find((i) => /vishwanath/i.test(String(i.title || '')));
if (vish) {
  KNOWN.push({
    label: `search hit: ${vish.title}`,
    subjectId: String(vish.subjectId),
    detailPath: String(vish.detailPath || ''),
  });
}

for (const target of KNOWN) {
  log(`\n## ${target.label} ${target.subjectId} ${target.detailPath}`);
  const detailRes = await fetch(
    `${H5}/detail?subjectId=${encodeURIComponent(target.subjectId)}&detailPath=${encodeURIComponent(target.detailPath)}`,
    { headers: mbHeaders(auth) },
  );
  const detailText = await detailRes.text();
  let detailJson = null;
  try {
    detailJson = JSON.parse(detailText);
  } catch {
    /* ignore */
  }
  log(`   detail ${detailRes.status} top keys=${detailJson ? Object.keys(detailJson).join(',') : '-'}`);
  const subject =
    detailJson?.data?.data?.subject || detailJson?.data?.subject || detailJson?.data?.data || {};
  log(`   subject keys=${Object.keys(subject || {}).join(',')}`);
  const dubs = Array.isArray(subject?.dubs) ? subject.dubs : [];
  log(`   dubs (${dubs.length}): ${JSON.stringify(dubs.slice(0, 12))}`);
  const audioKeys = Object.keys(subject || {}).filter((k) => /audio|dub|lang|track/i.test(k));
  log(`   audio-ish keys: ${audioKeys.map((k) => `${k}=${JSON.stringify(subject[k]).slice(0, 120)}`).join(' | ') || '-'}`);

  const base = playerHost ? `https://${playerHost}/wefeed-h5api-bff` : H5;
  const plays = [
    { label: 'original', subjectId: target.subjectId, detailPath: target.detailPath },
    ...dubs.slice(0, 4).map((d) => ({
      label: `${d.lanName || d.lanCode} (${d.lanCode || '?'})${d.original ? ' *orig*' : ''}`,
      subjectId: String(d.subjectId || ''),
      detailPath: String(d.detailPath || ''),
    })),
  ];
  for (const play of plays) {
    if (!play.subjectId) continue;
    const url =
      `${base}/subject/play?subjectId=${encodeURIComponent(play.subjectId)}` +
      `&se=0&ep=0&detailPath=${encodeURIComponent(play.detailPath)}&streamSignType=1`;
    try {
      const res = await fetch(url, { headers: mbHeaders({ ...auth, 'X-Play-Mode': '2' }), signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      const data = JSON.parse(body)?.data || {};
      const streams = data.streams || [];
      log(
        `   [play ${play.label}] ${res.status} streams=${streams.length} hls=${(data.hls || []).length} ` +
          `res=${JSON.stringify(streams.map((s) => s.resolutions || s.resolution))}`,
      );
      log(`      keys=${Object.keys(data).join(',')}`);
      if (streams[0]) log(`      first url host=${new URL(streams[0].url).host}`);
    } catch (error) {
      log(`   [play ${play.label}] FAIL ${error?.message || error}`);
    }
  }
}

log('\n# DONE');
