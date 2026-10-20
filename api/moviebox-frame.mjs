/**
 * /api/moviebox-frame — M2Box ka page apne server ke raaste iframe-able banao.
 * ============================================================================
 * Server 2 (M2Box) ka pehla rasta hamesha SEEDHA iframe hai: uska watch page
 * hi frame me khulta hai aur hum dikhne wala hissa kaat dete hain
 * (`components/MovieboxCroppedFrame.tsx`). MovieBox abhi framing nahi rokta.
 *
 * Jis din `X-Frame-Options` / CSP `frame-ancestors` laga de, seedha frame
 * khali aayega — us din ye route wahi HTML hamare hi origin se deta hai:
 * frame-rokne wale headers aage hi nahi bheje jate, aur page me
 * `<base href="https://m2box.org/">` ghusa diya jata hai taaki site ke saare
 * relative JS/CSS/image usi ke origin se load hon.
 *
 *   GET /api/moviebox-frame?url=<encoded m2box watch page URL>
 *
 * Ye jaan-boojh kar EK chhota HTML proxy hai, poori site ka reverse proxy
 * NAHI: sirf MovieBox ke watch pages (whitelist hosts / player-jaisi shakal)
 * ke liye. Page ke andar ke API calls browser khud m2box/h5-api se karta
 * hai. Best-effort fallback — pakka rasta seedha frame hi hai.
 */

const MOVIEBOX_HOSTS = [
  'm2box.org',
  'm2box.co',
  'm2box.app',
  'moviebox.ph',
  'movie-box.co',
  'movieboxonline.net',
  'movieboxhd.net',
  'moviebox.pk',
  'moviebox.ac',
  'officialmoviebox.com',
  'netnaija.film',
  'sflix.film',
  '123moviesfree.club',
  'h5.inmoviebox.com',
  'inmoviebox.com',
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20000;
const SUBJECT_ID_RE = /^\d{5,25}$/;

/** Simple per-IP rate limit (personal-use scale). */
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

/** Query param `url` se ek http(s) URL, warna null. */
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

/**
 * Sirf MovieBox pages. Jaane-maane mirrors ke alawa un rotated player domains
 * ko bhi allow karo jinki shakal player page jaisi hai (`/videoPlayPage/` ya
 * `type=/movie/detail` + numeric id + slug) — player domain badalta rehta hai.
 */
export function hostAllowed(url) {
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  const known = MOVIEBOX_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (known) return true;
  if (/videoPlayPage/i.test(url.pathname)) return true;
  const hasSlug = url.pathname.split('/').filter(Boolean).some((s) => /-/.test(s));
  return url.searchParams.get('type') === '/movie/detail' && SUBJECT_ID_RE.test(url.searchParams.get('id') || '') && hasSlug;
}

/** Frame-rokne wale <meta> tag hatao; headers to hum forward hi nahi karte. */
export function stripFrameGuards(html) {
  return String(html || '')
    .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
}

/** <head> ke seedha baad <base> daalo taaki relative assets asal site se aayein. */
export function injectBase(html, origin) {
  const source = String(html || '');
  const baseTag = `<base href="${origin}/">`;
  if (/<base\s[^>]*>/i.test(source)) return source.replace(/<base\s[^>]*>/i, baseTag);
  if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
  return `${baseTag}${source}`;
}

/** Poora response body: guards utre hue HTML + asal site ka <base>. */
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
    send(res, 400, 'url galat hai — sirf MovieBox/M2Box watch pages proxy hote hain (e.g. https://m2box.org/movies/…?id=…)', {
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
        // Khud ko ek aam top-level navigation ki tarah pesh karo; frame hone ka
        // dava karne se kuch sites alag (khali) page deti hain.
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
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
        `Upstream ne HTML nahi diya (HTTP ${upstream.status}, ${contentType || 'no content-type'}). Seedha frame try karo.`,
        { 'Content-Type': 'text/plain; charset=utf-8' },
      );
      return;
    }

    const finalUrl = new URL(upstream.url || target.href);
    const html = buildFrameDocument(await upstream.text(), finalUrl.origin);

    send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      // Apne hi app ke frame me khulne do, bahar walon ke liye band.
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    const message = String((error && error.message) || 'fetch-failed').slice(0, 160);
    send(res, 502, `M2Box page fetch nahi hua (${message}). Seedha frame ya /moviebox page try karo.`, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }
}

export const config = { maxDuration: 30 };

// Tests ke liye.
export const _internal = {
  MOVIEBOX_HOSTS,
  parseTarget,
  hostAllowed,
  stripFrameGuards,
  injectBase,
  buildFrameDocument,
};
