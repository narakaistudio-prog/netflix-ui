/**
 * PROBE 4 (temporary) — asli subtitle ab chalta hai? (fix ke baad ka sach)
 * ======================================================================
 * 429 ka ilaaj: bridge proxy URL ke andar se CDN nikaal kar seedha fetch karta
 * hai. Ye probe **hamare asli handler** ko asli provider ke `captions[]` par
 * chalata hai (jaisa Vercel par chalega) aur VTT cues ginta hai.
 *
 *   node scripts/probe-av4.mjs
 */
import handler from '../api/netmirror-subtitle.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const NM = 'https://net27.cc';

const log = (...args) => console.log(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

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
        resolve({ status: this.statusCode, body: String(payload), type: this.headers['Content-Type'] });
      },
    };
    handler(req, res).catch((error) => resolve({ status: 500, body: String(error) }));
  });
}

async function embed(id, query = '') {
  const res = await fetch(`${NM}/api/embed-tmdb/${id}${query}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json,*/*', Referer: 'https://videodownloader.site/' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null, text: text.slice(0, 200) };
  }
}

const countCues = (vtt) => (String(vtt).match(/-->/g) || []).length;

log('\n# Bridge — asli provider ke captions par (proxy → CDN unwrap)');
for (const [label, id, query] of [
  ['movie 1465943', '1465943', ''],
  ['tv 1396 S1E1', '1396', '?type=tv&s=1&e=1'],
]) {
  const res = await embed(id, query);
  const captions = res.json?.captions || [];
  log(`\n## ${label} → ${res.status}, captions=${captions.length}, subjectId=${res.json?.subjectId || '-'}`);
  const picks = captions.filter((c) => ['en', 'hi', 'ta', 'te'].includes(c.lang)).slice(0, 3);
  for (const cap of picks) {
    // Wahi URL jo app `<track>`/fetch me bhejta hai.
    const bridge = `/api/netmirror-subtitle?url=${encodeURIComponent(new URL(cap.url, NM).toString())}`;
    const answer = await callHandler({ url: decodeURIComponent(bridge.split('url=')[1]) });
    const body = String(answer.body);
    log(
      `   ${cap.lang} (${cap.name}) → ${answer.status} ${answer.type || ''} cues=${countCues(body)} ` +
        `startsWithWebVTT=${body.startsWith('WEBVTT')} sample=${JSON.stringify(body.split('\n').slice(2, 5).join(' | '))}`,
    );
  }
}

log('\n# Bridge — galat host (safety)');
const bad = await callHandler({ url: 'https://evil.example/a.srt' });
log(`   evil.example → ${bad.status} ${JSON.stringify(bad.body)}`);

log('\n# DONE');
