/**
 * Shared nxsha upstream fetch with a self-probing header-profile ladder.
 *
 * Why: web.nxsha.app sits behind a WAF that scores clients — from Vercel,
 * Chrome-impersonation (141 + client hints) and no-UA requests got http-403
 * while a plain non-browser UA got HTTP 200, and a public relay through a
 * different egress also passes. So every upstream call walks a ladder:
 *   1. chrome125 — the exact header set the open-source Decryptor extractor
 *                  ships (full Chrome/125 UA, Accept: Star, Referer), proven
 *                  in production against this API
 *   2. plain     — honest non-browser UA
 *   3. minimal   — library-default UA, Accept only
 *   4. allorigins— via https://api.allorigins.win/raw (different egress)
 *   5. corsproxy — via https://corsproxy.io (different egress)
 *   6. codetabs  — via https://api.codetabs.com/v1/proxy (different egress)
 * The first profile whose answer decrypts wins and is cached module-wide for
 * warm instances. Every attempt (including a truncated body preview on
 * failure) is reported for ?debug=1 step logging.
 *
 * Request payloads get `_req_ts` + `_req_salt` added before sealing — the
 * backend echoes both, mirroring the reference client.
 */

const crypto = require('./nxsha-crypto.cjs');

const NXSHA_WEB_BASE = 'https://web.nxsha.app';

const DIRECT_TIMEOUT_MS = 4000;
const RELAY_TIMEOUT_MS = 7000;

// AbortSignal.timeout exists on modern runtimes (Vercel Node 20); degrade to
// "no signal" where it is missing (jest/jsdom, older hosts).
function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const PLAIN_UA = 'Mozilla/5.0 (compatible; NxshaClient/1.0; +stream-resolve)';

const PROFILES = [
  {
    id: 'chrome125',
    timeoutMs: DIRECT_TIMEOUT_MS,
    url: (target) => target,
    headers: () => ({
      'User-Agent': CHROME_UA,
      Accept: '*/*',
      Referer: `${NXSHA_WEB_BASE}/`,
    }),
  },
  {
    id: 'plain',
    timeoutMs: DIRECT_TIMEOUT_MS,
    url: (target) => target,
    headers: () => ({
      'User-Agent': PLAIN_UA,
      Accept: 'application/json, */*',
    }),
  },
  {
    id: 'minimal',
    timeoutMs: DIRECT_TIMEOUT_MS,
    url: (target) => target,
    headers: () => ({ Accept: 'application/json, */*' }),
  },
  {
    id: 'allorigins',
    timeoutMs: RELAY_TIMEOUT_MS,
    url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    headers: () => ({ Accept: 'application/json, */*' }),
  },
  {
    id: 'corsproxy',
    timeoutMs: RELAY_TIMEOUT_MS,
    url: (target) => `https://corsproxy.io/?url=${encodeURIComponent(target)}`,
    headers: () => ({ Accept: 'application/json, */*' }),
  },
  {
    id: 'codetabs',
    timeoutMs: RELAY_TIMEOUT_MS,
    url: (target) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
    headers: () => ({ Accept: 'application/json, */*' }),
  },
];

// Warm-instance cache: the first profile that ever worked here.
let winnerId = null;

function orderedProfiles() {
  if (!winnerId) return PROFILES;
  const winner = PROFILES.find((p) => p.id === winnerId);
  if (!winner) {
    winnerId = null;
    return PROFILES;
  }
  return [winner, ...PROFILES.filter((p) => p.id !== winnerId)];
}

function previewOf(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 140) : undefined;
}

/**
 * Fetch one sealed nxsha API endpoint through the profile ladder.
 * @param {string} path     e.g. '/api/servers'
 * @param {object|string} payload  raw payload (sealed here, with _req_ts/
 *        _req_salt added) — or an already-sealed `q` string (passthrough)
 * @param {object[]} steps  debug step sink (optional)
 * @param {string} label    step label, e.g. 'servers' or 'sources:gbru'
 * @param {number} deadline wall-clock ms timestamp; stops before overrunning
 * @returns {Promise<object>} the decrypted JSON payload
 */
async function nxshaApiGet(path, payload, steps, label, deadline) {
  const q =
    typeof payload === 'string'
      ? payload
      : crypto.seal({
          ...payload,
          _req_ts: Date.now(),
          _req_salt: Math.random().toString(36).slice(2, 12),
        });
  const target = `${NXSHA_WEB_BASE}${path}?q=${encodeURIComponent(q)}`;
  let lastErr = 'no-profiles';
  for (const profile of orderedProfiles()) {
    if (deadline && Date.now() > deadline - 3000) {
      lastErr = 'budget-exhausted';
      break;
    }
    const started = Date.now();
    try {
      const res = await fetch(profile.url(target), {
        headers: profile.headers(),
        signal: timeoutSignal(profile.timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`http-${res.status}`);
        err.preview = previewOf(text);
        throw err;
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        const err = new Error('not-json');
        err.preview = previewOf(text);
        throw err;
      }
      const data = crypto.open(body && typeof body === 'object' ? body._hash : undefined);
      if (!data) {
        const err = new Error('undecryptable');
        err.preview = previewOf(text.slice(0, 400));
        throw err;
      }
      winnerId = profile.id;
      if (steps) steps.push({ step: label, profile: profile.id, ms: Date.now() - started });
      return data;
    } catch (err) {
      lastErr = String((err && err.message) || err).slice(0, 80);
      if (steps) {
        const step = {
          step: `${label}-attempt`,
          profile: profile.id,
          error: lastErr,
          ms: Date.now() - started,
        };
        if (err && err.preview) step.preview = err.preview;
        steps.push(step);
      }
    }
  }
  throw new Error(`${label} ${lastErr}`);
}

module.exports = { nxshaApiGet, NXSHA_WEB_BASE, PROFILES };
