/**
 * PROBE 3 (temporary) — NetMirror par **audio/dub** ka koi rasta hai kya, aur
 * MovieBox ka `subtitles` field kaisa hai.
 * ======================================================================
 * Ab tak: subtitles ka andar wala CDN URL seedha chalta hai (200 SRT) aur
 * hamara bridge usko VTT bana deta hai — isliye fix sirf unwrap ka hai.
 *
 * Ab: "multilanguage **dub**" ke liye provider kya deta hai?
 *   A. NetMirror: `?audio=`, `?dub=`, `?lang=` — stream badalta hai ya nahi?
 *      Poora JSON (audio-ish keys) — TV aur movie dono.
 *   B. MovieBox: `/detail` ka `subtitles` — bhashayein + URL chalte hain?
 *      `dubs[]` to mil gaya (har dub ka apna subject) — play 0 tha, kya se=1
 *      se farq padta hai?
 */
import { createHash } from 'node:crypto';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const HOST = 'moviebox.ph';
const NM = 'https://net27.cc';

const log = (...args) => console.log(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

async function embed(id, query = '') {
  const url = `${NM}/api/embed-tmdb/${id}${query}`;
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
  return { status: res.status, json, text };
}

log('\n# A. NetMirror — audio/dub ke raste');
const base = await embed('1465943');
log(`   base ${base.status} keys=${base.json ? Object.keys(base.json).join(',') : '-'}`);
log(`   full: ${JSON.stringify(base.json).slice(0, 1200)}`);
const variants = ['?audio=hi', '?dub=hi', '?lang=hi', '?a=hi', '?audio=1'];
const baseFirst = String(base.json?.streams?.[0]?.url || '').slice(0, 120);
for (const query of variants) {
  const res = await embed('1465943', query);
  const first = String(res.json?.streams?.[0]?.url || '').slice(0, 120);
  log(
    `   ${query} → ${res.status} streams=${(res.json?.streams || []).length} sameAsBase=${first === baseFirst}` +
      ` captions=${(res.json?.captions || []).length} error=${res.json?.error || '-'}`,
  );
}
const audioish = (node, path = '') => {
  const hits = [];
  if (!node || typeof node !== 'object') return hits;
  for (const [key, value] of Object.entries(node)) {
    if (/audio|dub|lang|track|sound|voice/i.test(key)) {
      hits.push(`${path}${key}=${JSON.stringify(value).slice(0, 200)}`);
    } else if (value && typeof value === 'object') {
      hits.push(...audioish(value, `${path}${key}.`));
    }
  }
  return hits;
};
log(`   audio-ish keys (movie): ${audioish(base.json).join(' | ') || '-'}`);
const tv = await embed('1396', '?type=tv&s=1&e=1');
log(`   tv ${tv.status} streams=${(tv.json?.streams || []).length} captions=${(tv.json?.captions || []).length}`);
log(`   audio-ish keys (tv): ${audioish(tv.json).join(' | ') || '-'}`);
log(`   tv full: ${JSON.stringify(tv.json).slice(0, 700)}`);

log('\n# B. MovieBox — subtitles + dubs');
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

const DETAILS = [
  ['Mandaadi (movie)', '4151920426815471968', 'mandaadi-hindi-qxUx1r3QHW4', 0, 0],
  ['Vishwanath? -> known TV', '1236000050961386000', '', 1, 1],
];
// Vishwanath search dhoondo (perPage 0 = site jaisa full list)
const searchRes = await fetch(`${H5}/subject/search`, {
  method: 'POST',
  headers: mbHeaders({ 'Content-Type': 'application/json', ...auth, 'X-Client-Token': clientToken() }),
  body: JSON.stringify({ keyword: 'Vishwanath', page: 1, perPage: 0, subjectType: 0 }),
});
const searchJson = JSON.parse(await searchRes.text());
const items = searchJson?.data?.items || [];
log(`   search Vishwanath ${searchRes.status} items=${items.length}: ${items.map((i) => `${i.subjectId}|${i.title}`).join(' , ')}`);
const vish = items.find((i) => /vishwanath/i.test(String(i.title || '')));
if (vish) DETAILS.push([`Vishwanath (${vish.title})`, String(vish.subjectId), String(vish.detailPath || ''), 0, 0]);

for (const [label, subjectId, detailPath, se, ep] of DETAILS) {
  if (!subjectId) continue;
  log(`\n## ${label} ${subjectId} ${detailPath}`);
  const detailRes = await fetch(
    `${H5}/detail?subjectId=${encodeURIComponent(subjectId)}${detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : ''}`,
    { headers: mbHeaders(auth) },
  );
  const detailText = await detailRes.text();
  let subject = {};
  try {
    subject = JSON.parse(detailText)?.data?.data?.subject || {};
  } catch {
    /* ignore */
  }
  log(`   detail ${detailRes.status} keys=${Object.keys(subject).join(',')}`);
  log(`   subtitles: ${JSON.stringify(subject.subtitles).slice(0, 900)}`);
  const subs = Array.isArray(subject.subtitles) ? subject.subtitles : [];
  for (const sub of subs.slice(0, 2)) {
    const url = String(sub?.url || sub?.src || '');
    if (!url) continue;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      log(
        `      sub ${sub.lanName || sub.lan || '?'} ${res.status} ${res.headers.get('content-type') || '-'} ` +
          `bytes=${body.length} kind=${/^WEBVTT/.test(body.slice(0, 8)) ? 'VTT' : /-->/.test(body) ? 'SRT' : 'other'} ` +
          `ACAO=${res.headers.get('access-control-allow-origin') || '-'}`,
      );
    } catch (error) {
      log(`      sub FAIL ${error?.message || error}`);
    }
  }
  log(`   dubs (${(subject.dubs || []).length}): ${JSON.stringify((subject.dubs || []).map((d) => `${d.lanName}/${d.lanCode}/${d.subjectId}`))}`);

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
  const base2 = playerHost ? `https://${playerHost}/wefeed-h5api-bff` : H5;
  for (const [name, sid, dp] of [
    ['original', subjectId, detailPath],
    ...(subject.dubs || []).slice(0, 2).map((d) => [d.lanName || d.lanCode, String(d.subjectId || ''), String(d.detailPath || '')]),
  ]) {
    const url =
      `${base2}/subject/play?subjectId=${encodeURIComponent(sid)}` +
      `&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(dp)}&streamSignType=1`;
    try {
      const res = await fetch(url, { headers: mbHeaders({ ...auth, 'X-Play-Mode': '2' }), signal: AbortSignal.timeout(20000) });
      const data = JSON.parse(await res.text())?.data || {};
      log(
        `   [play ${name}] ${res.status} streams=${(data.streams || []).length} hls=${(data.hls || []).length} ` +
          `hasResource=${data.hasResource} maxRes=${data.playConfig?.maxResolution}`,
      );
    } catch (error) {
      log(`   [play ${name}] FAIL ${error?.message || error}`);
    }
  }
}

log('\n# DONE');
