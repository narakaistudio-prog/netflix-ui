/**
 * `api/netmirror.mjs` ko asli upstream ke saath chalata hai (runner par).
 * ======================================================================
 * Jest me handler ki pure logic test hoti hai (mock payload); ye script asli
 * `net27.cc` par wahi raasta chalti hai jo Vercel par chalega:
 *
 *   handler(req, res)  →  MIRRORS → /api/embed-tmdb/…  →  normalized JSON
 *
 * Vercel par deploy karke dekhne se pehle ye ek sach-check hai.
 */
import handler from '../api/netmirror.mjs';

function call(query) {
  return new Promise((resolve) => {
    const req = { query, headers: { 'x-forwarded-for': '203.0.113.9' }, socket: {} };
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
        resolve({ status: this.statusCode, payload });
      },
    };
    handler(req, res).catch((error) => resolve({ status: 500, payload: { error: String(error) } }));
  });
}

const cases = [
  { label: 'movie Mandaadi (tmdb 1465943)', query: { tmdb: 'tmdb:1465943', type: 'movie' } },
  { label: 'tv Breaking Bad S1E1 (tmdb 1396)', query: { tmdb: '1396', type: 'tv', s: '1', e: '1' } },
  { label: 'movie jo NetMirror par nahi (tmdb 1441228)', query: { tmdb: '1441228', type: 'movie' } },
  { label: 'probe (sirf availability)', query: { tmdb: '1465943', type: 'movie', probe: '1' } },
  { label: 'IMDb id (reject hona chahiye)', query: { tmdb: 'tt0903747', type: 'movie' } },
];

for (const item of cases) {
  const { status, payload } = await call(item.query);
  const summary = {
    status,
    ok: payload.ok,
    reason: payload.reason,
    title: payload.title,
    mirror: payload.mirror,
    count: payload.count ?? payload.streams?.length,
    qualities: payload.streams?.map((s) => s.quality),
    firstHost: payload.streams?.[0]?.url ? new URL(payload.streams[0].url).host : undefined,
    error: payload.error,
  };
  console.log(`\n### ${item.label}\n${JSON.stringify(summary)}`);
}
