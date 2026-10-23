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
 *   GET /api/moviebox-frame?url=<encoded m2box watch page URL>[&seek=1]
 *
 * `seek=1` par page ke andar ek chhota script bhi jaata hai — phone par video ke
 * baayein/daayein double-tap se ±10s (`movieboxSeekEnhancer`). MovieBox ka
 * player cross-origin iframe me hai, isliye wo `<video>` hamare page se chhua
 * hi nahi ja sakta; dawa kewal tab kaam karta hai jab page **hamare** origin se
 * aaye. Site ke visuals bilkul nahi badalte (koi button nahi).
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

/* ------------------------------------------------------------------ *
 * Phone par 10 second aage/peeche (invisible double-tap)
 * ------------------------------------------------------------------ *
 * Owner: "moviebox ke player mae 10 sec aage ya peeche karne ka koi tarika
 * nhi hai … invisible chiyea koi button nhi mainly ye phone ke liyea karna".
 *
 * MovieBox ka player **cross-origin iframe** me hai, isliye hamare page se uske
 * `<video>` tak pahunch hi nahi sakte. Isliye ye chhota script **frame ke andar
 * hi** bheja jata hai — par tabhi jab page hamare hi origin se aata hai
 * (yahi proxy ka kaam hai). Script site ke visuals ko chhedta hai hi nahi: koi
 * button nahi, sirf video ke baayein/daayein 34% par **double-tap** sunta hai
 * aur `video.currentTime` ±10s karta hai. Feedback ke liye 0.75s ka halka
 * badge (wo bhi button nahi, `pointer-events:none`).
 *
 * Parent ko teen khabar bhejta hai (`postMessage`, source = 'moviebox-seek'):
 *   { type: 'media' }     — video mil gaya, gestures live hain
 *   { type: 'no-media' }  — 11s tak koi <video> nahi mila
 *   { type: 'stalled' }   — video mila par stream hi nahi chali (CDN ne
 *                           hamare origin se referrer par rok diya, etc.)
 * Aakhri do ka matlab ek hi hai: proxy ka rasta is device par kaam nahi kar
 * raha — parent seedha frame khol deta hai.
 * Doosri khabar par player seedha (bina proxy) frame par wapas chala jata hai,
 * taaki proxy kisi din na chale to phone par player band na ho.
 *
 * Function ko `toString()` karke inline kiya jata hai — isliye ise **apne aap me
 * poora** rehna hai (bahar ka koi variable use nahi karna).
 */
export function movieboxSeekEnhancer() {
  'use strict';
  var SOURCE = 'moviebox-seek';
  var STEP = 10; // seconds per double-tap
  var TAP_MS = 340; // do tap isi der me = double tap
  var ZONE = 0.34; // baayein/daayein itna hissa skip zone
  var PROBE_MS = 400;
  var NO_MEDIA_MS = 11000;
  var HINT_KEY = 'm2box-seek-hint-v1';

  if (window.__m2boxSeek) return;
  window.__m2boxSeek = true;

  var doc = document;
  var video = null;
  var saidMedia = false;
  var saidNoMedia = false;
  var lastTapAt = 0;
  var lastTapSide = '';
  var suppressUntil = 0;
  var startedAt = Date.now();
  var badge = null;
  var badgeTimer = null;
  var hintShown = false;

  function post(message) {
    try {
      if (window.parent && window.parent !== window) {
        message.source = SOURCE;
        window.parent.postMessage(message, '*');
      }
    } catch (e) {
      /* sandbox ne rok diya — gestures phir bhi chalte rahenge */
    }
  }

  /** Video ka screen par naap (sabse bada / pehle se chalu video jeetta hai). */
  function weightOf(el) {
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var w = (rect && rect.width) || el.clientWidth || el.videoWidth || 0;
    var h = (rect && rect.height) || el.clientHeight || el.videoHeight || 0;
    return w * h + (el.readyState > 0 ? 10000000 : 0);
  }

  function pickVideo() {
    var all;
    try {
      all = doc.querySelectorAll('video');
    } catch (e) {
      return null;
    }
    var best = null;
    var bestWeight = -1;
    for (var i = 0; i < all.length; i++) {
      var candidate = all[i];
      if (!candidate || candidate.isConnected === false) continue;
      var weight = weightOf(candidate);
      if (weight > bestWeight) {
        bestWeight = weight;
        best = candidate;
      }
    }
    return best;
  }

  function findVideo() {
    var found = pickVideo();
    if (found) {
      video = found;
      if (!saidMedia) {
        saidMedia = true;
        post({ type: 'media' });
        var hintRect = found.getBoundingClientRect ? found.getBoundingClientRect() : null;
        showHint(hintRect);
      }
    }
    return found;
  }

  function fmt(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function makeToast() {
    var el = doc.createElement('div');
    var style = el.style;
    style.position = 'fixed';
    style.zIndex = '2147483000';
    style.padding = '7px 12px';
    style.borderRadius = '10px';
    style.background = 'rgba(0,0,0,.62)';
    style.color = '#fff';
    style.font = '600 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    style.pointerEvents = 'none';
    style.whiteSpace = 'nowrap';
    style.transition = 'opacity .25s ease';
    style.opacity = '0';
    return el;
  }

  /**
   * Chhota badge: "-10s 01:23 / 45:10". Button nahi — pointer-events none.
   * Jagah **video ke rect se** nikalta hai (viewport ke 50% se nahi), warna
   * phone par crop ke bahar gir jata tha.
   */
  function flash(side, time, duration, rect) {
    try {
      if (!badge) {
        badge = makeToast();
        badge.setAttribute('data-m2box-seek-badge', '');
        doc.body.appendChild(badge);
      }
      if (rect) {
        var mid = rect.top + rect.height / 2;
        badge.style.top = Math.round(mid) + 'px';
        badge.style.transform = 'translateY(-50%)';
        badge.style.left = side === 'back' ? Math.round(rect.left + rect.width * 0.06) + 'px' : 'auto';
        badge.style.right =
          side === 'fwd' ? Math.round(doc.documentElement.clientWidth - rect.right + rect.width * 0.06) + 'px' : 'auto';
      }
      var text = (side === 'fwd' ? '+10s' : '-10s') + '  ' + fmt(time);
      if (isFinite(duration) && duration > 0) text += ' / ' + fmt(duration);
      badge.textContent = text;
      badge.style.opacity = '1';
      if (badgeTimer) clearTimeout(badgeTimer);
      badgeTimer = setTimeout(function () {
        if (badge) badge.style.opacity = '0';
      }, 750);
    } catch (e) {
      /* DOM ne mana kiya — seek to ho gaya */
    }
  }

  /** Pehli baar ek baar batata hai ki gesture hai (khud se pata nahi chalega). */
  function showHint(rect) {
    if (hintShown) return;
    hintShown = true;
    try {
      if (window.localStorage && localStorage.getItem(HINT_KEY)) return;
      localStorage.setItem(HINT_KEY, '1');
    } catch (e) {
      /* private mode */
    }
    try {
      var el = makeToast();
      el.setAttribute('data-m2box-seek-hint', '');
      el.textContent = 'Double-tap left / right to skip 10s';
      el.style.left = '50%';
      if (rect && rect.height) {
        el.style.top = Math.round(rect.top + rect.height * 0.78) + 'px';
      } else {
        el.style.bottom = '14%';
      }
      el.style.transform = 'translateX(-50%)';
      el.style.opacity = '1';
      doc.body.appendChild(el);
      setTimeout(function () {
        el.style.opacity = '0';
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 400);
      }, 3200);
    } catch (e) {
      /* ignore */
    }
  }

  function seek(target, side, rect) {
    var duration = target.duration;
    var next = (Number(target.currentTime) || 0) + (side === 'fwd' ? STEP : -STEP);
    if (isFinite(duration) && duration > 0) {
      next = Math.min(next, Math.max(0, duration - 0.3));
    }
    next = Math.max(0, next);
    try {
      target.currentTime = next;
    } catch (e) {
      /* kuch players property rok dete hain */
    }
    flash(side, next, duration, rect);
  }

  function onTap(x, y) {
    var target = findVideo() || video;
    if (!target) return;
    var rect = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
    if (!rect || !rect.width || !rect.height) return;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    var side = '';
    if (x < rect.left + rect.width * ZONE) side = 'back';
    else if (x > rect.right - rect.width * ZONE) side = 'fwd';
    if (!side) return; // beech ka hissa site ka hi raha (play/pause)
    var now = Date.now();
    if (lastTapSide === side && now - lastTapAt <= TAP_MS) {
      lastTapAt = 0;
      lastTapSide = '';
      seek(target, side, rect);
      // Site ka apna double-tap/zoom/controls na chale.
      suppressUntil = now + 600;
      return;
    }
    lastTapAt = now;
    lastTapSide = side;
  }

  function onDown(event) {
    var x = event.clientX;
    var y = event.clientY;
    if ((x === undefined || y === undefined) && event.touches && event.touches[0]) {
      x = event.touches[0].clientX;
      y = event.touches[0].clientY;
    }
    if (x === undefined || y === undefined) return;
    var before = lastTapSide;
    onTap(x, y);
    // Sirf wahi event rokna hai jo asli skip bana (doosra tap).
    if (before && !lastTapSide) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
    }
  }

  function swallow(event) {
    if (Date.now() < suppressUntil) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
    }
  }

  if (window.PointerEvent) {
    doc.addEventListener('pointerdown', onDown, true);
  } else {
    doc.addEventListener('touchstart', onDown, true);
    doc.addEventListener('mousedown', onDown, true);
  }
  doc.addEventListener('click', swallow, true);
  doc.addEventListener('pointerup', swallow, true);
  doc.addEventListener('touchend', swallow, true);

  /**
   * Proxy ka khatra: page hamare origin se aata hai, isliye media ka referrer
   * bhi hamara origin hota hai. Kabhi CDN use rok deta hai — tab `<video>` to
   * milta hai par chalta nahi. Us haalat me gestures bekaar hain, isliye
   * `stalled` bhej kar parent ko seedha frame par wapas bhej dete hain.
   */
  var saidPlaying = false;
  var saidStalled = false;
  var watchUntil = Date.now() + 60000;
  setInterval(function () {
    var target = video || pickVideo();
    if (!target) return;
    video = target;
    if (!saidPlaying && (target.readyState >= 3 || (Number(target.currentTime) || 0) > 0.5)) {
      saidPlaying = true;
    }
    if (!saidPlaying && !saidStalled && Date.now() < watchUntil && target.error) {
      saidStalled = true;
      post({ type: 'stalled' });
    }
  }, 2000);

  findVideo();
  var probe = setInterval(function () {
    if (findVideo()) {
      if (probe) {
        clearInterval(probe);
        probe = null;
      }
      return;
    }
    if (!saidNoMedia && Date.now() - startedAt > NO_MEDIA_MS) {
      saidNoMedia = true;
      post({ type: 'no-media' });
      if (probe) {
        clearInterval(probe);
        probe = null;
      }
    }
  }, PROBE_MS);
}

/** `<script>` block jo frame ke andar jaata hai. */
export function buildSeekScript() {
  return `<script data-m2box-seek="1">(${movieboxSeekEnhancer.toString()})();</script>`;
}

/**
 * Poora response body: guards utre hue HTML + asal site ka `<base>` (+ seek
 * script, jab `seek` maanga gaya ho).
 */
export function buildFrameDocument(html, origin, options = {}) {
  const withBase = injectBase(stripFrameGuards(html), origin);
  if (!options.seek) return withBase;
  const script = buildSeekScript();
  if (/<\/body>/i.test(withBase)) return withBase.replace(/<\/body>/i, `${script}</body>`);
  return `${withBase}${script}`;
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
    const wantsSeek = String((req.query && req.query.seek) || '').trim() === '1';
    const html = buildFrameDocument(await upstream.text(), finalUrl.origin, { seek: wantsSeek });

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
  buildSeekScript,
  movieboxSeekEnhancer,
  SEEK_STEP_SECONDS: 10,
};
