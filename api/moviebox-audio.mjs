/**
 * Audio languages (dub) — provider ke apne `dubs[]` se
 * ====================================================
 * Owner: *"mujhe multilanguage dub chahiye tha"*.
 *
 * Sach (24 Oct runner probe): provider par **har dub apna alag subject** hota
 * hai —
 *
 *   GET /detail?subjectId=…  →  data.subject.dubs = [
 *     { subjectId, detailPath, lanName: "Hindi dub", lanCode: "hi",
 *       original: false }, …                                        ]
 *
 * Aur NetMirror ke jawab me wahi `subjectId`/`detailPath` aate hain (wo bhi
 * isi backend ka front hai) — isliye NetMirror par chal rahe title ke liye bhi
 * dub list mil jati hai. Jo title provider par nahi hai, uske liye khaali list
 * (jhoothe options nahi).
 *
 * Ye function sirf **list** deta hai; stream chunne par `lib/movieboxDirect`
 * us dub ke subject se naye streams laata hai.
 *
 * GET /api/moviebox-audio?subjectId=…&detailPath=…
 *   -> { ok:true, languages:[{ lang, name, subjectId, detailPath, original }] }
 *   -> { ok:false, reason:'not-found' | 'network', error }
 *
 * 30 min cache — provider ki detail response badalti nahi.
 */

const H5_API = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const FRONT_HOST = 'moviebox.ph';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;

/** BCP-47 / ISO kod jo `<option>` me kaam aaye. */
function normalizeLangCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, '');
}

/** Sirf subtitle wali entry (`Arabic sub`, `Spanish subtitles`) — audio nahi. */
const SUBTITLE_ONLY = /\b(sub|subs|subtitle|subtitles|srt)\b/i;

/**
 * `lanName` ko saaf label banao: `Hindi dub` → `Hindi`, `Original Audio` →
 * `Original` (original ka apna code alag se aata hai).
 */
export function audioLabel(dub) {
  const name = String(dub?.lanName || '').trim();
  if (!name) return String(dub?.lanCode || '').toUpperCase() || 'Audio';
  if (/^original\s*(audio)?$/i.test(name)) return 'Original';
  return name.replace(/\s*(dub|audio)$/i, '').trim() || name;
}

/**
 * Provider ka `dubs[]` → app ka shape.
 *
 * Provider apni **subtitle** bhashayein bhi isi list me bhejta hai
 * (`Arabic sub`, `Spanish subtitles`) — wo audio nahi hain, isliye hata dete
 * hain. Ek hi bhasha ke do option (jaise `Original` (ta) aur `Tamil dub` (ta))
 * ho to original bacha rehta hai.
 */
export function normalizeDubs(dubs) {
  const list = Array.isArray(dubs) ? dubs : [];
  const seenSentence = new Set();
  const seenLang = new Set();
  const out = [];
  const sorted = [...list].sort(
    (a, b) => Number(b?.original === true) - Number(a?.original === true),
  );
  for (const dub of sorted) {
    const subjectId = String(dub?.subjectId || '').trim();
    const rawName = String(dub?.lanName || '');
    if (SUBTITLE_ONLY.test(rawName)) continue;
    if (!subjectId || seenSentence.has(subjectId)) continue;
    const lang = normalizeLangCode(dub?.lanCode) || subjectId;
    if (seenLang.has(lang)) continue;
    seenSentence.add(subjectId);
    seenLang.add(lang);
    out.push({
      lang,
      name: audioLabel(dub),
      subjectId,
      detailPath: String(dub?.detailPath || '').trim(),
      original: dub?.original === true,
    });
  }
  return out;
}

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.until) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(key, { value, until: Date.now() + CACHE_TTL_MS });
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

function headers(token) {
  return {
    'User-Agent': UA,
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
    'X-Request-Lang': 'en',
    Referer: `https://${FRONT_HOST}/`,
    Origin: `https://${FRONT_HOST}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Guest token — `/home` ke `x-user` header se. */
async function guestToken() {
  try {
    const res = await fetch(`${H5_API}/home?host=${encodeURIComponent(FRONT_HOST)}`, {
      headers: headers(''),
      signal: timeoutSignal(12000),
    });
    const raw = res.headers.get('x-user');
    if (raw) {
      try {
        const token = JSON.parse(raw)?.token;
        if (token) return String(token);
      } catch {
        // header JSON nahi tha
      }
    }
    const cookie = res.headers.get('set-cookie') || '';
    const match = cookie.match(/token=([^;]+)/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  const query = req.query || {};
  const subjectId = String(query.subjectId || query.id || '').trim();
  const detailPath = String(query.detailPath || '').trim();

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');

  if (!/^\d+$/.test(subjectId)) {
    res.status(200).json({ ok: false, reason: 'not-found', error: 'subjectId chahiye' });
    return;
  }

  const key = `${subjectId}|${detailPath}`;
  const cached = cacheGet(key);
  if (cached) {
    res.status(200).json({ ...cached, cached: true });
    return;
  }

  const token = await guestToken();
  const params = new URLSearchParams({ subjectId });
  if (detailPath) params.set('detailPath', detailPath);

  try {
    const upstream = await fetch(`${H5_API}/detail?${params.toString()}`, {
      headers: headers(token),
      signal: timeoutSignal(12000),
      redirect: 'follow',
    });
    if (!upstream.ok) {
      res.status(200).json({ ok: false, reason: 'network', error: `upstream ${upstream.status}` });
      return;
    }
    const payload = await upstream.json().catch(() => null);
    const subject =
      payload?.data?.data?.subject || payload?.data?.subject || null;
    const languages = normalizeDubs(subject?.dubs);
    const answer = languages.length
      ? { ok: true, languages }
      : { ok: false, reason: 'not-found', error: 'Provider ne audio list nahi di' };
    cacheSet(key, answer);
    res.status(200).json(answer);
  } catch (error) {
    res.status(200).json({ ok: false, reason: 'network', error: String(error?.message || error) });
  }
}
