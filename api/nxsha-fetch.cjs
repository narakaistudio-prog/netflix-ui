/**
 * Shared nxsha upstream fetch with a self-probing header-profile ladder.
 *
 * Why: web.nxsha.app sits behind a WAF (Cloudflare-style) that answers 403 to
 * some datacenter clients — the fake-Chrome UA without client hints was
 * blocked from Vercel while a plain non-browser client got HTTP 200. Instead
 * of guessing, every upstream call walks a ladder of request profiles:
 *   1. chrome    — current Chrome UA + client hints + sec-fetch + Referer
 *   2. plain     — honest non-browser UA, no Referer/Origin
 *   3. minimal   — library-default UA, Accept only
 *   4. allorigins— via https://api.allorigins.win/raw (different egress)
 *   5. codetabs  — via https://api.codetabs.com/v1/proxy (different egress)
 * The first profile that yields a decryptable sealed JSON wins and is cached
 * module-wide, so warm serverless instances try it first on later calls.
 * Every attempt is reported back for ?debug=1 step logging.
 */

const crypto = require('./nxsha-crypto.cjs');

const NXSHA_WEB_BASE = 'https://web.nxsha.app';

const UPSTREAM_TIMEOUT_MS = 4000;
const PROXY_TIMEOUT_MS = 6000;

// AbortSignal.timeout exists on modern runtimes (Vercel Node 20); degrade to
// "no signal" where it is missing (jest/jsdom, older hosts).
function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CHROME_VERSION = '141';

const PROFILES = [
  {
    id: 'chrome',
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    url: (target) => target,
    headers: () => ({
      'User-Agent': CHROME_UA,
      Accept: 'application/json, */*',
      'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
      Referer: `${NXSHA_WEB_BASE}/`,
      'sec-ch-ua': `"Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    }),
  },
  {
    id: 'plain',
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    url: (target) => target,
    headers: () => ({
      'User-Agent': 'Mozilla/5.0 (compatible; NxshaClient/1.0; +stream-resolve)',
      Accept: 'application/json, */*',
    }),
  },
  {
    id: 'minimal',
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    url: (target) => target,
    headers: () => ({ Accept: 'application/json, */*' }),
  },
  {
    id: 'allorigins',
    timeoutMs: PROXY_TIMEOUT_MS,
    // Different egress + plain client: wraps the target as a raw passthrough.
    url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    headers: () => ({ Accept: 'application/json, */*' }),
  },
  {
    id: 'codetabs',
    timeoutMs: PROXY_TIMEOUT_MS,
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

/**
 * Fetch one sealed nxsha API endpoint through the profile ladder.
 * @param {string} path   e.g. '/api/servers'
 * @param {string} q      sealed `q=` value (already encoded if needed)
 * @param {object[]} steps debug step sink (optional)
 * @param {string} label  step label, e.g. 'servers' or 'sources:gbru'
 * @param {number} deadline  wall-clock ms timestamp; stops before overrunning
 * @returns {Promise<object>} the decrypted JSON payload
 */
async function nxshaApiGet(path, q, steps, label, deadline) {
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
      if (!res.ok) throw new Error(`http-${res.status}`);
      const body = await res.json();
      const text = body && typeof body === 'object' ? body._hash : undefined;
      const data = crypto.open(text);
      if (!data) throw new Error('undecryptable');
      winnerId = profile.id;
      if (steps) steps.push({ step: label, profile: profile.id, ms: Date.now() - started });
      return data;
    } catch (err) {
      lastErr = String((err && err.message) || err).slice(0, 80);
      if (steps) {
        steps.push({
          step: `${label}-attempt`,
          profile: profile.id,
          error: lastErr,
          ms: Date.now() - started,
        });
      }
      if (/budget-exhausted/.test(lastErr)) break;
    }
  }
  throw new Error(`${label} ${lastErr}`);
}

module.exports = { nxshaApiGet, NXSHA_WEB_BASE, PROFILES };
