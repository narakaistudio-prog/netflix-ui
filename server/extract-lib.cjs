'use strict';
/* Pure extraction helpers (no I/O) — shared by server/extractor.mjs and unit tests.
 * CommonJS on purpose: jest requires it directly, Node ESM imports it fine. */

const KNOWN_HOSTS = [
  'streamwish', 'vidhide', 'vidmoly', 'filemoon', 'moonmov', 'filelions',
  'voe', 'mixdrop', 'doodstream', 'dood', 'uqload', 'lulustream',
  'streamtape', 'mp4upload', 'yourupload', 'swiftplayers', 'vidxstream'
];

function isHttpUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch (e) { return false; }
}

function resolveUrl(u, base) {
  try {
    const abs = new URL(String(u), base).href;
    return isHttpUrl(abs) ? abs : null;
  } catch (e) { return null; }
}

/* ---- Dean Edwards p.a.c.k.e.r unpack (single block) ----
 * Matches the canonical tail: }('PAYLOAD',RADIX,COUNT,'A|B|C'.split('|'),0,{}))
 * and re-applies the word table high -> low with word boundaries. */
function unpackPackerOnce(src) {
  const m = /\}\('((?:\\.|[^'\\])*?)',(\d+),(\d+),'((?:\\.|[^'\\])*?)'\.split\('\|'\),0,\{\}\)\)/.exec(String(src));
  if (!m) return null;
  let p = m[1];
  const radix = parseInt(m[2], 10);
  const count = parseInt(m[3], 10);
  if (!(radix >= 2 && radix <= 62) || !(count >= 0 && count <= 5000)) return null;
  const sym = m[4].split('|');
  const enc = (n) => n.toString(radix);
  for (let c = count - 1; c >= 0; c--) {
    const word = enc(c);
    const repl = sym[c] || word;
    p = p.replace(new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), repl);
  }
  p = p.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  return { unpacked: p, start: m.index, end: m.index + m[0].length };
}

function unpackAllPackers(html) {
  let out = String(html);
  for (let guard = 0; guard < 6; guard++) {
    const r = unpackPackerOnce(out);
    if (!r) break;
    out = out.slice(0, r.start) + r.unpacked + out.slice(r.end);
  }
  return out;
}

/* ---- stream URL discovery (m3u8 preferred over mp4) ---- */
function findStreamUrl(html) {
  const cands = [];
  const push = (u) => {
    if (!u) return;
    u = String(u).trim().replace(/\\\//g, '/');
    if (u.startsWith('//')) u = 'https:' + u;
    if (!/^https?:\/\//i.test(u)) return;
    cands.push(u);
  };
  let m;
  const re1 = /(?:file|source)\s*:\s*["']((?:https?:)?\/\/[^"']+)["']/gi;
  while ((m = re1.exec(html))) push(m[1]);
  const re2 = /<source[^>]+src\s*=\s*["']([^"']+)["']/gi;
  while ((m = re2.exec(html))) push(m[1]);
  const re3 = /((?:https?:)?\/\/[^\s"'<>()\\]+\.m3u8[^\s"'<>()\\]*)/gi;
  while ((m = re3.exec(html))) push(m[1]);
  const re4 = /((?:https?:)?\/\/[^\s"'<>()\\]+\.mp4[^\s"'<>()\\]*)/gi;
  while ((m = re4.exec(html))) push(m[1]);
  for (const u of cands) if (/\.m3u8(\?|#|$)/i.test(u)) return { url: u, kind: 'hls' };
  for (const u of cands) if (/\.mp4(\?|#|$)/i.test(u)) return { url: u, kind: 'mp4' };
  return { url: null, kind: null };
}

function extractStream(html) {
  return findStreamUrl(unpackAllPackers(html));
}

/* ---- embed discovery on episode pages ---- */
function findIframeSrcs(html, base) {
  const out = [];
  const seen = new Set();
  const re = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const abs = base ? resolveUrl(m[1], base) : (isHttpUrl(m[1]) ? m[1] : null);
    if (abs && !seen.has(abs)) { seen.add(abs); out.push(abs); }
  }
  return out;
}

function pickEmbedUrl(html, base) {
  const srcs = findIframeSrcs(html, base);
  for (const s of srcs) {
    let host = '';
    try { host = new URL(s).hostname.toLowerCase(); } catch (e) { /* skip */ }
    if (host && KNOWN_HOSTS.some((k) => host.includes(k))) return s;
  }
  return srcs.length ? srcs[0] : null;
}

/* ---- base64url (for /api/stream pointers) ---- */
function b64uEncode(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64').toString('utf8');
}

/* ---- SSRF guard: never fetch private/loopback/link-local targets ---- */
function isBlockedIp(ip) {
  if (!ip) return true;
  const v = String(ip).trim();
  if (v === '::1' || v === '::ffff:127.0.0.1' || v === '::') return true;
  const m4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (m4) {
    const o = m4.slice(1).map(Number);
    if (o.some((n) => n < 0 || n > 255)) return true;
    const [a, b] = o;
    if (a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0 || a >= 224) return true;
    return false;
  }
  const low = v.toLowerCase().replace(/^\[|\]$/g, '');
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('fe80:') || low.startsWith('fec0:')) return true;
  if (/^(fc|fd)[0-9a-f]{0,2}:/.test(low)) return true;
  return false;
}

async function hostAllowed(hostname, dnsLookup) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (/^(\d+\.){3}\d+$/.test(host) || host.includes(':')) return !isBlockedIp(host);
  const lookup = dnsLookup || require('dns').promises.lookup;
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch (e) { return false; }
  if (!addrs || !addrs.length) return false;
  return addrs.every((a) => !isBlockedIp(a.address));
}

/* ---- m3u8 playlist rewrite: route every URI through our proxy ---- */
function isLikelyPlaylistUrl(u) {
  return /\.m3u8(\?|#|$)/i.test(String(u || ''));
}

function rewritePlaylist(text, playlistUrl, makeProxy) {
  return String(text).split(/\r?\n/).map((ln) => {
    const line = ln.trim();
    if (!line) return ln;
    if (line.startsWith('#')) {
      return ln.replace(/URI="([^"]+)"/g, (mm, u) => {
        const abs = resolveUrl(u, playlistUrl);
        return abs ? 'URI="' + makeProxy(abs) + '"' : mm;
      });
    }
    const abs = resolveUrl(line, playlistUrl);
    return abs ? makeProxy(abs) : ln;
  }).join('\n');
}

module.exports = {
  KNOWN_HOSTS,
  isHttpUrl,
  resolveUrl,
  unpackPackerOnce,
  unpackAllPackers,
  findStreamUrl,
  extractStream,
  findIframeSrcs,
  pickEmbedUrl,
  b64uEncode,
  b64uDecode,
  isBlockedIp,
  hostAllowed,
  isLikelyPlaylistUrl,
  rewritePlaylist,
};
