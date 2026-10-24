/**
 * PROBE (temporary) — production par wahi flow jo app chalta hai.
 * =============================================================
 * Owner: *"multiaudio sirf MovieBox me aa raha hai, NetMirror me nahi"*.
 *
 * Yahan sandbox se internet band hai, isliye ye probe **deployed** site ke
 * apne endpoints par chalti hai (GitHub runner se):
 *
 *   1. /api/netmirror   → `subjectId` aata hai ya nahi (audio list ki kunji)
 *   2. /api/moviebox-audio?subjectId=…  → us par dub list
 *   3. /api/netmirror-subtitle → subtitles (sanity)
 */
const BASE = process.env.PROD_BASE || 'https://net-ki15.vercel.app';

const log = (...args) => console.log(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

async function getJson(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { url, status: res.status, json, text };
}

for (const [label, tmdb, query] of [
  ['Mandaadi (movie)', '1465943', ''],
  ['Breaking Bad S1E1 (tv)', '1396', '&type=tv&s=1&e=1'],
]) {
  log(`\n## ${label}`);
  const nm = await getJson(`/api/netmirror?tmdb=${tmdb}${query}`);
  log(`   /api/netmirror ${nm.status} ok=${nm.json?.ok} streams=${(nm.json?.streams || []).length}`);
  log(`   subjectId=${nm.json?.subjectId || '(MISSING)'} detailPath=${nm.json?.detailPath || '(none)'}`);
  log(`   captions=${(nm.json?.captions || []).length} cached=${nm.json?.cached ?? '-'}`);

  const subjectId = nm.json?.subjectId;
  if (subjectId) {
    const detailPath = nm.json?.detailPath || '';
    const audio = await getJson(
      `/api/moviebox-audio?subjectId=${encodeURIComponent(subjectId)}${
        detailPath ? `&detailPath=${encodeURIComponent(detailPath)}` : ''
      }`,
    );
    log(
      `   /api/moviebox-audio ${audio.status} ok=${audio.json?.ok} reason=${audio.json?.reason || '-'} ` +
        `count=${(audio.json?.languages || []).length}`,
    );
    log(`   languages=${(audio.json?.languages || []).map((item) => `${item.name}/${item.lang}`).join(', ') || '-'}`);
    if (!audio.json?.languages?.length) log(`   raw=${audio.text.slice(0, 400)}`);
  } else {
    log('   !! subjectId nahi — audio list maangi hi nahi ja sakti (yahi bug hai)');
  }

  const caption = (nm.json?.captions || [])[0];
  if (caption) {
    const absolute = new URL(caption.url, 'https://net27.cc').toString();
    const sub = await fetch(`${BASE}/api/netmirror-subtitle?url=${encodeURIComponent(absolute)}`);
    const body = await sub.text();
    log(
      `   /api/netmirror-subtitle ${sub.status} ${sub.headers.get('content-type')} cues=${
        (body.match(/-->/g) || []).length
      }`,
    );
  }
}

log('\n# DONE');
