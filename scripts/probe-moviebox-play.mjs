/**
 * Probe: MovieBox (M2Box) ke stream URLs — kya browser unhe seedha chala sakta
 * hai (bina kisi proxy ke)?
 * ========================================================================
 * Kyun: server 2 ka player cross-origin iframe hai, isliye phone par ±10s ka
 * koi rasta nahi. Agar stream URL seedha `<video>` me chal jaye to hamara apna
 * player (aur usme invisible double-tap) possible hai. Ye script har rasta
 * try karke sach batata hai:
 *
 *   A. /subject/play player-domain par (referer mzfi.me) + X-Play-Mode
 *   B. /subject/play h5-api par (referer moviebox.ph)
 *   C. /detail → resourceDetectors[].resolutionList[] (Oct 2026 ke baad asli
 *      links yahan aate hain)
 *   D. mobile BFF: api6.aoneroom.com/wefeed-mobile-bff/subject-api/play-info
 *   E. jo URL mile uspar CDN headers (ACAO) + referer test — browser `<video>`
 *      ke liye decisive
 *
 * GitHub Actions par chalta hai (runner ke paas internet hai), sirf manual
 * dispatch ya draft PR par. Kuch save nahi karta.
 *
 *   node scripts/probe-moviebox-play.mjs --title "Avatar"
 */

import { createHash } from 'node:crypto';

const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const MOBILE = 'https://api6.aoneroom.com/wefeed-mobile-bff';
const HOST = 'moviebox.ph';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const titleArg = process.argv.indexOf('--title');
const searchTitle = titleArg > -1 ? process.argv[titleArg + 1] || 'Avatar' : 'Avatar';

const log = (...args) => console.log(...args);

function clientToken(now = Date.now()) {
    const sec = String(Math.floor(now / 1000));
    return `${sec},${createHash('md5').update(sec.split('').reverse().join('')).digest('hex')}`;
}

/** `site` = kis domain ka referer/origin bhejna hai (API aur player alag hote hain). */
function headers(site = HOST, extra = {}) {
    const origin = `https://${site.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
    return {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
        'X-Request-Lang': 'en',
        Referer: `${origin}/`,
        Origin: origin,
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

const j = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

/** Kisi bhi JSON se media URLs nikaalo (streams / hls / dash / resolutionList). */
function mediaUrls(node, out = [], depth = 0) {
    if (!node || depth > 8) return out;
    if (Array.isArray(node)) {
        node.forEach((item) => mediaUrls(item, out, depth + 1));
        return out;
    }
    if (typeof node !== 'object') return out;
    for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && /^https?:\/\//.test(value) && /\.(m3u8|mp4|mpd)(\?|$)/i.test(value)) {
            out.push({ key, url: value, resolution: node.resolution || node.resolutions || node.quality });
        } else if (value && typeof value === 'object') {
            mediaUrls(value, out, depth + 1);
        }
    }
    return out;
}

async function main() {
    log('[1] guest token…');
    const home = await fetch(`${H5}/home?host=${encodeURIComponent(HOST)}`, { headers: headers() });
    let token = tokenFrom(home.headers.get('x-user'), home.headers.get('set-cookie'));
    log('    /home', home.status, 'token:', token ? 'yes' : 'no');
    const auth = token ? { Authorization: `Bearer ${token}` } : {};

    log('[2] player domain…');
    const domainRes = await fetch(`${H5}/media-player/get-domain`, { headers: headers(HOST, auth) });
    const domainText = await domainRes.text();
    let playerHost = '';
    try {
        const json = JSON.parse(domainText);
        playerHost = String(json?.data?.domain || json?.data || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    } catch {
        /* ignore */
    }
    log('    status', domainRes.status, 'player:', playerHost || '(none)');

    log('[2b] search:', searchTitle);
    const found = await fetch(`${H5}/subject/search`, {
        method: 'POST',
        headers: headers(HOST, { 'Content-Type': 'application/json', ...auth }),
        body: JSON.stringify({ keyword: searchTitle, page: 1, perPage: 0, subjectType: 0 }),
    });
    const foundText = await found.text();
    const items = j(foundText)?.data?.items || [];
    log('    status', found.status, 'items', items.length);
    if (!items.length) log('    search body:', foundText.slice(0, 300));
    const item = items[0] || {};
    const subjectId = String(item.subjectId || '');
    const detailPath = String(item.detailPath || '');
    log('    picked:', subjectId, '|', item.title, '|', detailPath);
    if (!subjectId) {
        log('    kuch nahi mila — ruk gaya');
        return;
    }

    const bases = [
        ['player', playerHost ? `https://${playerHost}/wefeed-h5api-bff` : '', playerHost || HOST],
        ['h5-api', H5, HOST],
    ];

    for (const [label, base, site] of bases) {
        if (!base) continue;
        const url =
            `${base}/subject/play?subjectId=${encodeURIComponent(subjectId)}` +
            `&se=1&ep=1&detailPath=${encodeURIComponent(detailPath)}&streamSignType=1`;
        log(`[A/${label}] ${url}`);
        const res = await fetch(url, { headers: headers(site, { ...auth, 'X-Play-Mode': '2' }) });
        const body = await res.text();
        const json = j(body);
        log(
            '    status', res.status,
            '| streams', (json?.data?.streams || []).length,
            '| hls', (json?.data?.hls || []).length,
            '| dash', (json?.data?.dash || []).length,
            '| hasResource', json?.data?.hasResource,
            '| maxRes', json?.data?.playConfig?.maxResolution,
        );
        log('    body:', body.slice(0, 350));
    }

    log('[C] /detail → resourceDetectors…');
    const detailRes = await fetch(
        `${H5}/detail?subjectId=${encodeURIComponent(subjectId)}&detailPath=${encodeURIComponent(detailPath)}`,
        { headers: headers(HOST, auth) },
    );
    const detailText = await detailRes.text();
    const detailJson = j(detailText);
    const subject = detailJson?.data?.data?.subject || detailJson?.data?.subject || {};
    log('    status', detailRes.status, '| subject keys:', Object.keys(subject).join(','));
    const detectors = subject.resourceDetectors || [];
    log('    resourceDetectors:', Array.isArray(detectors) ? detectors.length : 0);
    if (Array.isArray(detectors)) {
        detectors.slice(0, 2).forEach((d, i) => {
            log(`    [${i}]`, JSON.stringify(d).slice(0, 700));
        });
    }
    const detailMedia = mediaUrls(subject);
    log('    media urls in detail:', detailMedia.length);
    detailMedia.slice(0, 3).forEach((m) => log('     ', m.key, m.resolution, '|', m.url.slice(0, 140)));

    log('[D] mobile BFF play-info…');
    const mobileUrl =
        `${MOBILE}/subject-api/play-info?subjectId=${encodeURIComponent(subjectId)}` +
        `&se=1&ep=1&detailPath=${encodeURIComponent(detailPath)}`;
    try {
        const res = await fetch(mobileUrl, { headers: headers(HOST, auth) });
        const body = await res.text();
        log('    status', res.status, '| body:', body.slice(0, 400));
    } catch (error) {
        log('    failed', String(error && error.message).slice(0, 120));
    }

    const candidate = detailMedia[0]?.url;
    if (!candidate) {
        log('[E] koi media URL nahi mila — CDN test skip');
        return;
    }

    log('[E] CDN headers (browser <video> ke liye decisive)…');
    for (const [label, extra] of [
        ['moviebox referer', { Referer: `https://${HOST}/`, Origin: `https://${HOST}` }],
        ['our origin referer', { Referer: 'https://net-ki15.vercel.app/', Origin: 'https://net-ki15.vercel.app' }],
        ['no referer', {}],
    ]) {
        try {
            const res = await fetch(candidate, {
                headers: { 'User-Agent': UA, Range: 'bytes=0-1023', ...extra },
            });
            log(
                `    ${label}: ${res.status}`,
                '| ACAO:', res.headers.get('access-control-allow-origin') || '(none)',
                '| type:', res.headers.get('content-type') || '?',
            );
        } catch (error) {
            log(`    ${label}: failed`, String(error && error.message).slice(0, 100));
        }
    }
}

main().catch((error) => {
    console.error('probe failed:', error);
    process.exitCode = 1;
});
