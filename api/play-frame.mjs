/**
 * /api/play-frame — ToonStream ke "Play" server (ravok) ko bot-free chalao.
 * ==========================================================================
 * Problem (owner, Samsung Tizen TV): ToonStream ka SERVER 1 "Play"
 * (ravok.buzz / uske as-cdn mirror) TV browser ko dekhte hi
 * "Confirm you're not a robot — scan the QR code with your phone" wala
 * verification page serve kar deta hai. Wo faisla ravok apne server par,
 * page mangwane wale browser ko dekh kar leta hai — TV ka purana Tizen
 * browser wahan fail ho jata hai.
 *
 * Fix: Play ka page TV seedha ravok se NAHI mangta. Ye route wahi Play page
 * hamare server se, ek aam desktop browser ki pehchan ke saath mangwakar,
 * apne hi origin se iframe me deta hai:
 *
 *   GET /api/play-frame?url=<encoded ravok Play embed URL>
 *
 * Isiliye ravok ko kabhi TV browser dikhta hi nahi, aur QR verification
 * trigger hi nahi hoti. Player WAHI Play server hai — koi dusra server
 * nahi; sirf uska page laane ka rasta badla hai. Page ke relative JS/CSS
 * <base href> ki wajah se asal ravok origin se hi load hote hain.
 *
 * Sirf Play hosts whitelist hain (ravok.buzz + as-cdn mirrors). Aur kuch
 * proxy nahi hota.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20000;

const RATE = new Map();
function rateOk(ip) {
  const now = Date.now();
  const entry = RATE.get(ip);
  if (!entry || now >= entry.reset) {
    RATE.set(ip, { count: 1, reset: now + 60000 });
    return true;
  }
  entry.count += 1;
  if (RATE.size > 5000) RATE.clear();
  return entry.count <= 60;
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

export function parseTarget(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/** Sirf Play server ke hosts: ravok.buzz (+subdomains) aur uske as-cdn mirrors. */
export function hostAllowed(url) {
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'ravok.buzz' ||
    host.endsWith('.ravok.buzz') ||
    /^as-cdn\d+\.(top|xyz|site|online)$/.test(host)
  );
}

export function stripFrameGuards(html) {
  return String(html || '')
    .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
}

export function injectBase(html, origin) {
  const source = String(html || '');
  const baseTag = `<base href="${origin}/">`;
  if (/<base\s[^>]*>/i.test(source)) return source.replace(/<base\s[^>]*>/i, baseTag);
  if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
  return `${baseTag}${source}`;
}

export function buildFrameDocument(html, origin) {
  return injectBase(stripFrameGuards(html), origin);
}

function send(res, status, body, headers = {}) {
  res.status(status);
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.send(body);
}

export default async function handler(req, res) {
  const query = req.query && typeof req.query === 'object' ? req.query : {};
  const rawUrl = Array.isArray(query.url) ? query.url[0] : query.url
    || (() => {
      try {
        return new URL(String(req.url || ''), 'http://localhost').searchParams.get('url');
      } catch {
        return null;
      }
    })();

  const target = parseTarget(rawUrl);
  if (!target || !hostAllowed(target)) {
    send(res, 400, 'url galat hai — sirf Play (ravok) embed pages proxy hote hain.', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return;
  }

  const ip =
    String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '') ||
    'unknown';
  if (!rateOk(ip.split(',')[0].trim())) {
    send(res, 429, 'Bahut zyada requests — thoda ruk kar try karo.', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return;
  }

  try {
    const upstream = await fetch(target.href, {
      headers: {
        'User-Agent': UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://toonstream.us/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
      signal: timeoutSignal(FETCH_TIMEOUT_MS),
    });

    const contentType = upstream.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      send(
        res,
        502,
        `Play server ne HTML nahi diya (HTTP ${upstream.status}, ${contentType || 'no content-type'}).`,
        { 'Content-Type': 'text/plain; charset=utf-8' },
      );
      return;
    }

    const finalUrl = new URL(upstream.url || target.href);
    const html = buildFrameDocument(await upstream.text(), finalUrl.origin);

    send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    const message = String((error && error.message) || 'fetch-failed').slice(0, 160);
    send(res, 502, `Play page fetch nahi hua (${message}). Thodi der baad phir Play dabao.`, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }
}

export const config = { maxDuration: 30 };

export const _internal = {
  parseTarget,
  hostAllowed,
  stripFrameGuards,
  injectBase,
  buildFrameDocument,
};
