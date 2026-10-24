/**
 * Probe: browser ke **nazariye** se MovieBox ka direct stream rasta chalega ya
 * nahi — CORS preflight ke saath.
 * ========================================================================
 * Kyun: `probe-moviebox-play.mjs` Node se chalta hai, aur Node CORS ka
 * preflight kabhi nahi bhejta. Isliye wahan sab "green" dikh sakta hai par
 * asli phone browser me `fetch` pehle hi OPTIONS par mar jata hai — aur player
 * chup-chaap purane cropped iframe par gir jata hai (owner: "button kaha hai
 * hi nahi laga hua", saath me "fallback: no-streams" wali line).
 *
 * Ye script wahi 5 sawaal poochta hai jo browser poochta hai:
 *
 *   [A] OPTIONS `/subject/play` — kya `authorization` + `x-client-token` jaise
 *       headers allowed hain? (`access-control-allow-headers`)
 *   [B] GET wahi URL, **hamare asli headers** ke saath → streams aate hain?
 *   [C] GET bina kisi custom header ke (sirf `Accept` — koi preflight nahi)
 *       → streams aate hain? Agar haan to browser me bhi ye rasta chalega.
 *   [D] `/home` se `x-user` padha ja sakta hai? (`expose-headers`)
 *   [E] mila hua media URL media element se chalta hai? (CDN status/type)
 *   [F] mobile BFF `play-info` — Origin reflect karta hai?
 *
 * Kuch save nahi karta, sirf print karta hai. GitHub Actions par chalta hai
 * (runner ke paas internet hai), ya kahin bhi:
 *
 *   node scripts/probe-moviebox-browser.mjs \
 *        --subject-id 4151920426815471968 \
 *        --detail-path mandaadi-hindi-qxUx1r3QHW4
 */

const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const MOBILE = 'https://api6.aoneroom.com/wefeed-mobile-bff';
const HOST = 'moviebox.ph';
/** Wahi origin jo asli app ka hai — API isi ko reflect karti hai. */
const BROWSER_ORIGIN = process.env.PROBE_ORIGIN || 'https://net-ki15.vercel.app';
const UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

function arg(name, fallback = '') {
    const at = process.argv.indexOf(`--${name}`);
    return at > -1 ? String(process.argv[at + 1] || fallback) : fallback;
}

const SUBJECT_ID = arg('subject-id', '4151920426815471968');
const DETAIL_PATH = arg('detail-path', 'mandaadi-hindi-qxUx1r3QHW4');
const SE = Number(arg('se', '0'));
const EP = Number(arg('ep', '0'));

const log = (...args) => console.log(...args);

function headers(extra = {}) {
    return {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
        'X-Request-Lang': 'en',
        /** Site har call par bhejti hai (`<sec>,md5(reverse(sec))`). */
        'X-Client-Token': `${Math.floor(Date.now() / 1000)},x`,
        Referer: `https://${HOST}/`,
        ...extra,
    };
}

const corsLine = (res) =>
    `ACAO ${res.headers.get('access-control-allow-origin') || '(none)'} | ` +
    `ACAM ${res.headers.get('access-control-allow-methods') || '(none)'} | ` +
    `ACAH ${res.headers.get('access-control-allow-headers') || '(none)'} | ` +
    `expose ${res.headers.get('access-control-expose-headers') || '(none)'} | ` +
    `creds ${res.headers.get('access-control-allow-credentials') || '(none)'}`;

const j = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

/** Published body count (streams/hls/dash) — sirf sach. */
function counts(body) {
    const data = j(body)?.data || {};
    return {
        streams: (data.streams || []).length,
        hls: (data.hls || []).length,
        dash: (data.dash || []).length,
        hasResource: data.hasResource,
        limitedCode: data.limitedCode,
        vipLocked: data.vipLocked,
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

function playUrl(base) {
    return (
        `${base}/subject/play?subjectId=${encodeURIComponent(SUBJECT_ID)}` +
        `&se=${SE}&ep=${EP}` +
        `&detailPath=${encodeURIComponent(DETAIL_PATH)}&streamSignType=1`
    );
}

function firstMedia(body) {
    const data = j(body)?.data || {};
    for (const list of [data.streams, data.hls, data.dash]) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            const url = typeof entry === 'string' ? entry : entry?.url || entry?.playUrl;
            if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
        }
    }
    return '';
}

async function main() {
    log(`subject ${SUBJECT_ID} · ${DETAIL_PATH} · se=${SE} ep=${EP}`);
    log(`browser origin: ${BROWSER_ORIGIN}`);

    log('\n[D] guest token (/home, browser jaisa)…');
    const home = await fetch(`${H5}/home?host=${encodeURIComponent(HOST)}`, {
        headers: headers({ Origin: BROWSER_ORIGIN }),
    });
    const token = tokenFrom(home.headers.get('x-user'), home.headers.get('set-cookie'));
    log('    status', home.status, '| token:', token ? 'yes' : 'no');
    log('    CORS:', corsLine(home));
    const auth = token ? { Authorization: `Bearer ${token}` } : {};

    log('\n[2] player domain…');
    const domainRes = await fetch(`${H5}/media-player/get-domain`, { headers: headers(auth) });
    const domainText = await domainRes.text();
    const domainJson = j(domainText);
    const playerHost = String(domainJson?.data?.domain || domainJson?.data || '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
    log('    status', domainRes.status, '| player:', playerHost || '(none)');
    if (playerHost) log('    CORS:', corsLine(domainRes));

    const bases = playerHost ? [['player', `https://${playerHost}/wefeed-h5api-bff`], ['h5', H5]] : [['h5', H5]];

    for (const [label, base] of bases) {
        log(`\n[A/${label}] OPTIONS preflight → ${playUrl(base).slice(0, 110)}…`);
        try {
            const pre = await fetch(playUrl(base), {
                method: 'OPTIONS',
                headers: {
                    Origin: BROWSER_ORIGIN,
                    'Access-Control-Request-Method': 'GET',
                    'Access-Control-Request-Headers':
                        'authorization,x-client-token,x-client-info,x-request-lang,x-play-mode',
                    'User-Agent': UA,
                },
            });
            log('    status', pre.status);
            log('    CORS:', corsLine(pre));
        } catch (error) {
            log('    preflight failed:', String(error?.message || error).slice(0, 120));
        }

        log(`[B/${label}] GET + hamare asli headers (Authorization + X-Client-Token + X-Play-Mode)…`);
        try {
            const res = await fetch(playUrl(base), {
                headers: headers({ ...auth, 'X-Play-Mode': '2', Origin: BROWSER_ORIGIN }),
            });
            const body = await res.text();
            log('    status', res.status, '|', JSON.stringify(counts(body)));
            log('    CORS:', corsLine(res));
            if (counts(body).streams === 0) log('    body:', body.slice(0, 240));
            const media = firstMedia(body);
            if (media) log('    media:', media.slice(0, 130));
        } catch (error) {
            log('    failed:', String(error?.message || error).slice(0, 120));
        }

        log(`[C/${label}] GET bina custom headers (sirf Accept — browser me preflight nahi)…`);
        try {
            const res = await fetch(playUrl(base), {
                headers: { Accept: 'application/json', 'User-Agent': UA, Origin: BROWSER_ORIGIN },
            });
            const body = await res.text();
            log('    status', res.status, '|', JSON.stringify(counts(body)));
            log('    CORS:', corsLine(res));
        } catch (error) {
            log('    failed:', String(error?.message || error).slice(0, 120));
        }
    }

    log('\n[F] mobile BFF play-info (Origin reflect?)…');
    try {
        const res = await fetch(
            `${MOBILE}/subject-api/play-info?subjectId=${encodeURIComponent(SUBJECT_ID)}` +
                `&se=${SE}&ep=${EP}&detailPath=${encodeURIComponent(DETAIL_PATH)}`,
            { headers: headers({ ...auth, Origin: BROWSER_ORIGIN }) },
        );
        const body = await res.text();
        log('    status', res.status, '|', JSON.stringify(counts(body)));
        log('    CORS:', corsLine(res));
    } catch (error) {
        log('    failed:', String(error?.message || error).slice(0, 120));
    }
}

main().catch((error) => {
    console.error('probe failed:', error);
    process.exitCode = 1;
});
