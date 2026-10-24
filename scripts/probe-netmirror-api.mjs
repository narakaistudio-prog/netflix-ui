/**
 * NetMirror (net77.cc family) — API probe
 * =======================================
 * Owner: *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale"*.
 *
 * Public reverse-engineering notes batate hain ki NetMirror ka app ek saaf REST
 * route use karta hai (`/api/embed-tmdb/{tmdbId}`) — WebView / Cloudflare
 * captcha ke bina. Ye probe un routes ko asli internet (GitHub runner) se
 * check karta hai: kaunse mirror zinda hain, kya lautta hai (HTML / JSON /
 * HLS), aur stream link nikalta hai ya nahi.
 *
 * Sirf padhta hai — kuch deploy nahi karta.
 */

const MIRRORS = ['net77.cc', 'net27.cc', 'net79.cc', 'net52.cc', 'net11.cc', 'netmirror.gg'];
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Mandaadi (movie), Avatar (movie), Breaking Bad (tv). */
const SAMPLES = [
    { type: 'movie', id: '1465943', label: 'Mandaadi' },
    { type: 'movie', id: '1441228', label: 'Avatar' },
    { type: 'tv', id: '1396', label: 'Breaking Bad' },
];

const ROUTES = [
    (m, s) => `/api/embed-tmdb/${s.id}`,
    (m, s) => `/api/embed-tmdb/${s.id}?type=${s.type}`,
    (m, s) => (s.type === 'movie' ? `/api/embed-tmdb/${s.id}` : `/api/embed-tmdb/${s.id}?s=1&e=1`),
];

async function hit(url) {
    const started = Date.now();
    try {
        const res = await fetch(url, {
            headers: {
                'user-agent': UA,
                accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
                referer: 'https://videodownloader.site/',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
        });
        const body = await res.text();
        return {
            status: res.status,
            ms: Date.now() - started,
            final: res.url,
            ctype: res.headers.get('content-type') || '',
            xfo: res.headers.get('x-frame-options') || '',
            csp: (res.headers.get('content-security-policy') || '').slice(0, 120),
            bytes: body.length,
            body,
        };
    } catch (error) {
        return { error: String(error?.message || error), ms: Date.now() - started };
    }
}

function summarize(body) {
    const urls = Array.from(
        new Set(
            (body.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?/gi) || []).map((u) =>
                u.replace(/\\u0026/g, '&'),
            ),
        ),
    );
    let keys = '';
    try {
        const json = JSON.parse(body);
        keys = Object.keys(json).slice(0, 12).join(',');
    } catch {
        keys = '';
    }
    const head = body.replace(/\s+/g, ' ').slice(0, 220);
    return { streams: urls.slice(0, 4), keys, head };
}

const out = [];
for (const mirror of MIRRORS) {
    for (const sample of SAMPLES.slice(0, 2)) {
        for (const route of ROUTES) {
            const path = route(mirror, sample);
            const url = `https://${mirror}${path}`;
            const res = await hit(url);
            if (res.error) {
                out.push(`${mirror.padEnd(14)} ${path.padEnd(40)} ERR ${res.error}`);
                continue;
            }
            const info = summarize(res.body);
            out.push(
                [
                    mirror.padEnd(14),
                    path.padEnd(40),
                    `${res.status}`.padEnd(4),
                    `${res.ms}ms`.padEnd(7),
                    `bytes=${res.bytes}`.padEnd(11),
                    res.ctype.split(';')[0].padEnd(17),
                    res.final !== url ? `→${res.final}` : '',
                    info.streams.length ? `STREAMS=${info.streams.length}` : 'STREAMS=0',
                    info.keys ? `json=[${info.keys}]` : '',
                    `xfo=${res.xfo || '-'}`,
                    info.head ? `"${info.head.slice(0, 90)}"` : '',
                ]
                    .filter(Boolean)
                    .join(' '),
            );
        }
    }
    out.push('');
}

// TV episode route sirf ek mirror par (shaadi-shuda sample).
const tv = await hit(`https://net77.cc/api/embed-tmdb/1396`);
out.push(`TV 1396 → ${tv.status || tv.error} ${JSON.stringify(summarize(tv.body || '')).slice(0, 400)}`);

console.log(out.join('\n'));
