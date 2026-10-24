/**
 * PROBE (temporary) — subtitles kaise aate hain aur **dub (audio language)**
 * kahan se milega.
 * ======================================================================
 * Owner: *"subtitle kam nahi kar raha hai aur mujhe multilanguage dub chahiye
 * tha"*. Do sawaal, dono ka jawab sirf asli internet se:
 *
 *   A. NetMirror `captions[]` ke URL asli me khulte hain? Kya wahi host hai
 *      jo hamara `api/netmirror-subtitle.mjs` allow karta hai? SRT hai ya VTT?
 *      Referer chahiye ya nahi?
 *   B. NetMirror/MovieBox ke jawab me **audio languages** hain? MovieBox par
 *      har dub ka apna `subjectId` hota hai — kya us se alag stream milta hai?
 *
 * Kuch save nahi karta, sirf print (Actions log + PR comment).
 */
import { createHash } from 'node:crypto';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const HOST = 'moviebox.ph';
const NM = 'https://net27.cc';
const out = [];
const log = (...args) => {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  console.log(line);
  out.push(line);
};

function clientToken(now = Date.now()) {
  const sec = String(Math.floor(now / 1000));
  return `${sec},${createHash('md5').update(sec.split('').reverse().join('')).digest('hex')}`;
}

function mbHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
    'X-Request-Lang': 'en',
    Referer: `https://${HOST}/`,
    Origin: `https://${HOST}`,
    ...extra,
  };
}

function tokenFrom(xUser, cookies) {
  if (xUser) {
    try {
      const token = JSON.parse(xUser)?.token;
      if (token) return String(token);
    } catch {
      /* ignore */
    }
  }
  const match = String(cookies || '').match(/token=([^;]+)/);
  return match ? match[1] : '';
}

async function netmirror(id, extra = '') {
  const url = `${NM}/api/embed-tmdb/${id}${extra}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,*/*', Referer: 'https://videodownloader.site/' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { url, status: res.status, text, json };
}

/* ------------------------------ A. NetMirror ------------------------------ */

log('\n# A. NetMirror — subtitles + audio ke nishaan');
for (const [label, id, extra] of [
  ['movie 1465943', '1465943', ''],
  ['tv 1396 S1E1', '1396', '?type=tv&s=1&e=1'],
]) {
  const res = await netmirror(id, extra);
  log(`\n## ${label} → status ${res.status} bytes ${res.text.length}`);
  log(`   top-level keys: ${res.json ? Object.keys(res.json).join(',') : '(no json)'}`);
  if (res.json) {
    const { streams, captions, ...rest } = res.json;
    log(`   rest: ${JSON.stringify(rest).slice(0, 400)}`);
    log(`   streams: ${JSON.stringify((streams || []).map((s) => ({ q: s.resolution ?? s.quality, size: s.size })))}`);
    log(`   captions: ${JSON.stringify(captions || [])}`);
  }
  for (const cap of res.json?.captions || []) {
    let abs;
    try {
      abs = new URL(cap.url, NM).toString();
    } catch {
      log(`   ! ${cap.lang} url parse fail: ${cap.url}`);
      continue;
    }
    const variants = [
      ['plain', { 'User-Agent': UA }],
      ['referer', { 'User-Agent': UA, Referer: 'https://net27.cc/', Origin: 'https://net27.cc' }],
    ];
    for (const [name, headers] of variants) {
      try {
        const r = await fetch(abs, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        const body = await r.text();
        const kind = /^WEBVTT/.test(body.slice(0, 10)) ? 'VTT' : /-->/.test(body) ? 'SRT' : '??? ';
        log(
          `   [${name}] ${cap.lang} ${r.status} ${r.headers.get('content-type') || '-'} ${kind} ` +
            `final=${new URL(r.url).host}${new URL(r.url).pathname} bytes=${body.length}`,
        );
        if (name === 'plain') log(`      head: ${JSON.stringify(body.slice(0, 160))}`);
      } catch (error) {
        log(`   [${name}] ${cap.lang} FAIL ${error?.message || error}`);
      }
    }
    log(`      absolute url: ${abs.slice(0, 220)}`);
  }
}

/* ------------------------------ B. MovieBox dubs ------------------------------ */

log('\n# B. MovieBox — dubs (har language ka apna subject?)');
const home = await fetch(`${H5}/home?host=${encodeURIComponent(HOST)}`, { headers: mbHeaders() });
const token = tokenFrom(home.headers.get('x-user'), home.headers.get('set-cookie'));
log(`   /home ${home.status} token=${token ? 'yes' : 'no'}`);
const auth = token ? { Authorization: `Bearer ${token}` } : {};

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
log(`   player host: ${playerHost || '(none)'}`);

const searchRes = await fetch(`${H5}/subject/search`, {
  method: 'POST',
  headers: mbHeaders({ 'Content-Type': 'application/json', ...auth }),
  body: JSON.stringify({ keyword: 'Vishwanath', page: 1, perPage: 0, subjectType: 0 }),
});
const items = JSON.parse(await searchRes.text())?.data?.items || [];
log(`   search ${searchRes.status} items=${items.length}`);
const item = items[0] || {};
const subjectId = String(item.subjectId || '');
const detailPath = String(item.detailPath || '');
log(`   picked: ${subjectId} | ${item.title} | ${detailPath}`);

if (subjectId) {
  const detailRes = await fetch(
    `${H5}/detail?subjectId=${encodeURIComponent(subjectId)}&detailPath=${encodeURIComponent(detailPath)}`,
    { headers: mbHeaders(auth) },
  );
  const subject = JSON.parse(await detailRes.text())?.data?.data?.subject || {};
  log(`   detail ${detailRes.status} keys=${Object.keys(subject).join(',')}`);
  log(`   dubs: ${JSON.stringify(subject.dubs || [])}`);
  const dubs = Array.isArray(subject.dubs) ? subject.dubs : [];
  const candidates = [
    { lanName: 'original', lanCode: '-', subjectId, detailPath, original: true },
    ...dubs.slice(0, 4),
  ];
  const base = playerHost ? `https://${playerHost}/wefeed-h5api-bff` : H5;
  for (const dub of candidates) {
    const url =
      `${base}/subject/play?subjectId=${encodeURIComponent(dub.subjectId)}` +
      `&se=0&ep=0&detailPath=${encodeURIComponent(dub.detailPath)}&streamSignType=1`;
    let res;
    let body = '';
    try {
      res = await fetch(url, {
        headers: mbHeaders({ ...auth, 'X-Play-Mode': '2' }),
        signal: AbortSignal.timeout(20000),
      });
      body = await res.text();
    } catch (error) {
      log(`   [play ${dub.lanName}] FAIL ${error?.message || error}`);
      continue;
    }
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      /* ignore */
    }
    const data = json?.data || {};
    log(
      `   [play ${dub.lanName} ${dub.subjectId}] ${res.status} streams=${(data.streams || []).length} ` +
        `hls=${(data.hls || []).length} keys=${Object.keys(data).join(',')}`,
    );
    for (const stream of (data.streams || []).slice(0, 3)) {
      log(`      ${stream.resolutions || stream.resolution || '?'} ${String(stream.url || '').slice(0, 90)}`);
    }
    if (!Object.keys(data).length) log(`      body: ${body.slice(0, 200)}`);
  }
}

log('\n# DONE');
