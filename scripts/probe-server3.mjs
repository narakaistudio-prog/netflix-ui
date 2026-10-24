/**
 * Server 3 candidates ka probe (CI runner par chalta hai).
 * ======================================================================
 * Owner: "vidsync hta de aur third server ke liyea aur mast server dhund player
 * bilkul aacha aur fast". Isliye har candidate ke liye wahi cheezein naapte hain
 * jo sach me farak daalti hain:
 *
 *   1. HTTP status — page khulta hai ya nahi.
 *   2. TTFB + total time — "fast" ka asli naap (runner se, India se nahi).
 *   3. `X-Frame-Options` / CSP `frame-ancestors` — hamare site me iframe me
 *      chalega ya block hoga.
 *   4. Body me player ke markers (postMessage API, hls, sandbox-ref) — matlab
 *      wo asli player hai ya khaali SPA.
 *
 * Jise comment me post kiya jata hai (runner logs yahan se download nahi hote).
 */
import fs from 'fs';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REFERER = 'https://net-ki15.vercel.app/';
const ORIGIN = 'https://net-ki15.vercel.app';

const CANDIDATES = [
    ['vidfast.pro', 'https://vidfast.pro/{p}'],
    ['vidfast.vc', 'https://vidfast.vc/{p}'],
    ['vixsrc.to', 'https://vixsrc.to/{p}'],
    ['vidlink.pro', 'https://vidlink.pro/{p}'],
    ['vidcore.org', 'https://vidcore.org/embed/{p}'],
    ['embedwave.cc', 'https://embedwave.cc/embed/{p}'],
    ['2embed.cc', 'https://www.2embed.cc/embed/{p}'],
    ['vidsrc.pro', 'https://vidsrc.pro/embed/{p}'],
    ['moviesapi.club', 'https://moviesapi.club/{p}'],
    ['videasy', 'https://player.videasy.net/{p}'],
    ['vidora.su', 'https://vidora.su/embed/{p}'],
    ['mycineby.cc', 'https://mycineby.cc/embed/{p}'],
    ['vidnest.pro', 'https://vidnest.pro/{p}'],
    ['vaplayer.ru', 'https://vaplayer.ru/embed/{p}'],
];

const PATHS = [
    ['movie', 'movie/1441228'],
    ['tv', 'tv/66732/1/1'],
];

async function probe(label, url) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let status = 0;
    let body = '';
    let headers = {};
    let ttfb = 0;
    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'user-agent': UA,
                accept: 'text/html,application/xhtml+xml',
                'accept-language': 'en-IN,en;q=0.9',
                referer: REFERER,
                origin: ORIGIN,
            },
        });
        status = res.status;
        ttfb = Date.now() - started;
        for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
        body = (await res.text()).slice(0, 200000);
    } catch (error) {
        body = '';
        headers = {};
    } finally {
        clearTimeout(timer);
    }
    const total = Date.now() - started;
    const csp = headers['content-security-policy'] || '';
    const frameAncestors = /frame-ancestors[^;]*/i.exec(csp)?.[0] ?? '';
    const notes = [];
    if (/player_event|player_info|postMessage/i.test(body)) notes.push('msg-api');
    if (/\.m3u8|hls/i.test(body)) notes.push('hls');
    if (/just a moment|cf-challenge|checking your browser/i.test(body)) notes.push('cf-challenge');
    if (/sandbox/i.test(body)) notes.push('sandbox-ref');
    if (/vpn|proxy detected|datacenter/i.test(body)) notes.push('vpn-nag');
    return {
        label,
        url,
        status,
        ttfb,
        total,
        bytes: body.length,
        xfo: headers['x-frame-options'] || '–',
        frameAncestors: frameAncestors || 'none',
        server: (headers['server'] || '–').slice(0, 18),
        notes: notes.join(' ') || '–',
    };
}

const rows = [];
for (const [kind, path] of PATHS) {
    rows.push({ kind, header: true });
    for (const [label, template] of CANDIDATES) {
        // eslint-disable-next-line no-await-in-loop
        const result = await probe(label, template.replace('{p}', path));
        rows.push(result);
        console.log(`${kind} ${label} ${result.status} ${result.ttfb}ms ${result.bytes}B`);
    }
}

const lines = [];
lines.push('## Server 3 candidate probe');
lines.push('');
lines.push('| kind | provider | code | ttfb_ms | total_ms | bytes | XFO | CSP frame-ancestors | notes |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) {
    if (row.header) {
        lines.push(`| **${row.kind}** | | | | | | | | |`);
        continue;
    }
    lines.push(
        `| ${row.kind} | ${row.label} | ${row.status} | ${row.ttfb} | ${row.total} | ${row.bytes} | ${row.xfo} | ${row.frameAncestors} | ${row.notes} |`,
    );
}
lines.push('');
lines.push(`_runner: ${process.env.GITHUB_SHA?.slice(0, 7) || 'local'}_`);

const report = lines.join('\n');
fs.writeFileSync('/tmp/server3-report.md', report);
console.log(report);

const token = process.env.GH_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
if (token && repo && sha) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/comments`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
        },
        body: JSON.stringify({ body: report }),
    });
    console.log('comment status:', res.status);
}
