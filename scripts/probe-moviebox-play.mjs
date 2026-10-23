/**
 * Probe: MovieBox (M2Box) ke stream URLs asli hain ya nahi — aur browser unhe
 * seedha chala sakta hai ya nahi.
 * ==================================================================
 * Kyun: server 2 ka player cross-origin iframe hai, isliye phone par ±10s ka
 * koi rasta nahi. Agar stream URL seedha browser me chal jaye to hamara apna
 * `<video>` (aur usme invisible double-tap) possible hai — bina kisi proxy ke.
 * Ye script teen sawaalon ka jawab deta hai:
 *
 *   1. H5 API se guest token milta hai?
 *   2. `/subject/play` streams lauta raha hai? (player domain alag hota hai)
 *   3. CDN response me `Access-Control-Allow-Origin` hai? aur bina MovieBox
 *      referer ke kya hota hai? (browser `<video>` yahi depend karta hai)
 *
 * GitHub Actions par chalta hai (runner ke paas internet hai) — workflows me
 * sirf manual dispatch se. Kuch bhi save nahi karta, sirf log.
 *
 *   node scripts/probe-moviebox-play.mjs [subjectId] [detailPath] [se] [ep]
 */

import { createHash } from 'node:crypto';

const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const HOST = 'moviebox.ph';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const subjectId = process.argv[2] || '4151920426815471968';
const detailPath = process.argv[3] || 'mandaadi-hindi-qxUx1r3QHW4';
const se = process.argv[4] || '0';
const ep = process.argv[5] || '0';

const log = (...args) => console.log(...args);

function clientToken(now = Date.now()) {
    const sec = String(Math.floor(now / 1000));
    return `${sec},${createHash('md5').update(sec.split('').reverse().join('')).digest('hex')}`;
}

function headers(extra = {}) {
    return {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
        'X-Request-Lang': 'en',
        Referer: `https://${HOST}/`,
        Origin: `https://${HOST}`,
        ...extra,
    };
}

function tokenFrom(xUser, cookies) {
    if (xUser) {
        try {
            const token = JSON.parse(xUser)?.token;
            if (token) return String(token);
        } catch {
            /* header JSON nahi tha */
        }
    }
    const match = String(cookies || '').match(/token=([^;]+)/);
    return match ? match[1] : '';
}

async function main() {
    log('[1] guest token…');
    const home = await fetch(`${H5}/home?host=${encodeURIComponent(HOST)}`, { headers: headers() });
    let token = tokenFrom(home.headers.get('x-user'), home.headers.get('set-cookie'));
    log('    /home', home.status, 'token:', token ? 'yes' : 'no');
    if (!token) {
        const mint = await fetch(`${H5}/subject/search-suggest`, {
            method: 'POST',
            headers: headers({ 'Content-Type': 'application/json', 'X-Client-Token': clientToken() }),
            body: JSON.stringify({ keyword: 'a', perPage: 10 }),
        });
        token = tokenFrom(mint.headers.get('x-user'), mint.headers.get('set-cookie'));
        log('    search-suggest', mint.status, 'token:', token ? 'yes' : 'no');
    }
    const auth = token ? { Authorization: `Bearer ${token}` } : {};

    log('[2] player domain…');
    const domainRes = await fetch(`${H5}/media-player/get-domain`, { headers: headers(auth) });
    const domainText = await domainRes.text();
    let player = '';
    try {
        const json = JSON.parse(domainText);
        player = String(json?.data?.domain || json?.data?.url || json?.data || '').trim();
    } catch {
        player = domainText.trim();
    }
    if (player && !/^https?:\/\//.test(player)) player = `https://${player}`;
    log('    status', domainRes.status, 'player:', player || '(none)', '| body:', domainText.slice(0, 200));

    const playBase = player ? `${player.replace(/\/$/, '')}/wefeed-h5api-bff` : H5;
    const playUrl =
        `${playBase}/subject/play?subjectId=${encodeURIComponent(subjectId)}` +
        `&se=${encodeURIComponent(se)}&ep=${encodeURIComponent(ep)}` +
        `&detailPath=${encodeURIComponent(detailPath)}&streamSignType=1`;

    log('[3] /subject/play …', playUrl);
    const playRes = await fetch(playUrl, { headers: headers(auth) });
    const playText = await playRes.text();
    log('    status', playRes.status, 'bytes', playText.length);
    let streams = [];
    try {
        const json = JSON.parse(playText);
        streams = json?.data?.streams || json?.streams || [];
        log('    keys:', Object.keys(json?.data || {}).join(','));
    } catch {
        log('    body (not json):', playText.slice(0, 300));
    }
    log('    streams:', streams.length);
    streams.slice(0, 4).forEach((s, i) => {
        log(`    [${i}]`, JSON.stringify({
            url: String(s.url || '').slice(0, 160),
            resolutions: s.resolutions,
            size: s.size,
            format: s.format,
            vipLocked: s.vipLocked,
        }));
    });

    const first = streams[0]?.url;
    if (!first) {
        log('[4] koi stream nahi — CDN test skip');
        log('    raw body:', playText.slice(0, 400));
        return;
    }

    log('[4] CDN headers (browser <video> ke liye decisive)…');
    for (const [label, extra] of [
        ['moviebox referer', { Referer: `https://${HOST}/`, Origin: `https://${HOST}` }],
        ['our origin referer', { Referer: 'https://net-ki15.vercel.app/', Origin: 'https://net-ki15.vercel.app' }],
        ['no referer', {}],
    ]) {
        try {
            const res = await fetch(first, {
                headers: {
                    'User-Agent': UA,
                    Range: 'bytes=0-1023',
                    ...(extra.Referer ? { Referer: extra.Referer } : {}),
                    ...(extra.Origin ? { Origin: extra.Origin } : {}),
                },
            });
            log(
                `    ${label}: status ${res.status}`,
                '| ACAO:', res.headers.get('access-control-allow-origin') || '(none)',
                '| type:', res.headers.get('content-type') || '?',
                '| len:', res.headers.get('content-length') || '?',
            );
        } catch (error) {
            log(`    ${label}: failed`, String(error && error.message).slice(0, 120));
        }
    }
}

main().catch((error) => {
    console.error('probe failed:', error);
    process.exitCode = 1;
});
