/**
 * Subtitle bridge — provider ke SRT ko browser ke VTT me
 * ======================================================
 * Owner: *"multilanguage hai to wo bhi do"*.
 *
 * NetMirror ke jawab me `captions[]` hota hai (`{lang, name, url}`), par:
 *   1. URL aksar relative hota hai (`/api/proxy/video?url=…`) — aur
 *   2. file **SRT** hoti hai, jabki `<track>` ko **WebVTT** chahiye.
 *   3. `net27.cc` par CORS header nahi (probe se verify) — browser seedha
 *      `track src` nahi laga sakta.
 *
 * Isliye ye chhota same-origin function: sirf subtitle file laata hai, SRT →
 * VTT badalta hai. **Video ka koi proxy nahi** — wahi seedha CDN se chalta hai.
 *
 * GET /api/netmirror-subtitle?url=<absolute subtitle url>
 *   -> 200 `text/vtt`  |  400 (galat host)  |  502 (upstream fail)
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
/** Sirf provider ke subtitle CDN / mirrors — koi khula proxy nahi. */
const ALLOWED_HOSTS = [
  'cacdn.hakunaymatata.com',
  'macdn.hakunaymatata.com',
  'pbcdn.aoneroom.com',
  'net27.cc',
  'net79.cc',
  'net77.cc',
];
const FETCH_TIMEOUT_MS = 12000;

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

/** `±HH:MM:SS,mmm` / `MM:SS,mmm` → WebVTT timestamp (`00:01:02.500`). */
export function srtTimestamp(line) {
  const match = String(line)
    .trim()
    .match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1].replace(':', '')) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, '0'));
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/**
 * SRT → WebVTT.
 *
 * SRT ka dhaancha:
 *   12
 *   00:00:32,600 --> 00:00:35,240
 *   Dialogue line
 *
 * VTT me index number nahi hota aur comma ki jagah dot. `.vtt` pehle se ho
 * (ya `WEBVTT` header) to waise hi lautate hain.
 */
export function srtToVtt(input) {
  const text = String(input || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(text)) return text;

  const blocks = text.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    if (!lines.length) continue;
    // Index line optional — pehli line sirf number ho to hata do.
    const start = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    const timing = lines[start];
    if (!timing || !timing.includes('-->')) continue;
    const [fromRaw, toRaw] = timing.split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const from = srtTimestamp(fromRaw);
    const to = srtTimestamp(toRaw);
    if (!from || !to) continue;
    const body = lines.slice(start + 1).join('\n');
    cues.push(`${from} --> ${to}\n${body}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export default async function handler(req, res) {
  const raw = req.query?.url;
  let target;
  try {
    target = new URL(String(Array.isArray(raw) ? raw[0] : raw || ''));
  } catch {
    res.status(400).json({ ok: false, error: 'url chahiye' });
    return;
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.includes(target.hostname.replace(/^www\./, ''))) {
    res.status(400).json({ ok: false, error: 'host allowed nahi' });
    return;
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' },
      signal: timeoutSignal(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!upstream.ok) {
      res.status(502).json({ ok: false, error: `upstream ${upstream.status}` });
      return;
    }
    const body = await upstream.text();
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.status(200).send(srtToVtt(body));
  } catch (error) {
    res.status(502).json({ ok: false, error: String(error?.message || error) });
  }
}
