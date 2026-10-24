/**
 * Server 3 — asli playback probe (Playwright + Chromium, CI runner par).
 * ======================================================================
 * Owner: "vidsync hta de aur third server ke liyea aur mast server dhund player
 * bilkul aacha aur fast".
 *
 * Sirf headers dekhna kaafi nahi — pichhli baar VidSync ke headers bhi saaf the
 * par video ruk ruk kar chalta tha. Isliye yahan asli browser me player kholte
 * hain aur **wahi cheez naapte hain jo user ko dikhti hai**:
 *
 *   - video element mila ya nahi (`<video>` + readyState)
 *   - pehla frame kitni der me (time-to-first-frame)
 *   - 20 second me `waiting`/`stalled` events kitne (ruk-ruk kar chalna)
 *   - currentTime aage badh raha hai ya atka hai
 *
 * Do tarah se test hota hai (hamara setup bilkul waisa hi):
 *   A. seedha page (player boot + speed)
 *   B. **hamare iframe ke andar sandbox ke saath** — kai providers sandbox
 *      dekh kar mana kar dete hain, aur wo sirf yahan pakda jata hai.
 *
 * Nateeja commit comment me post hota hai (runner logs yahan download nahi hote).
 */
import fs from 'fs';

const CANDIDATES = [
    ['vidfast.pro', 'https://vidfast.pro'],
    ['vidfast.vc', 'https://vidfast.vc'],
    ['videasy', 'https://player.videasy.net'],
    ['vidlink.pro', 'https://vidlink.pro'],
    ['mycineby.cc', 'https://mycineby.cc/embed'],
    ['vaplayer.ru', 'https://vaplayer.ru/embed'],
];

/** Mandaadi (Hindi movie) — wahi title jo catalog me hai. */
const MOVIE = '1441228';
/** Ek global title bhi — provider ke paas content hai ya nahi, pata chale. */
const MOVIE_GLOBAL = '155';

const IFRAME_HTML = (src) => `<!doctype html>
<html><body style="margin:0;background:#000">
<iframe id="p" src="${src}"
  style="position:absolute;inset:0;width:100%;height:100%;border:0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen
  sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
  referrerpolicy="no-referrer-when-downgrade"></iframe>
</body></html>`;

async function probePage(browser, url, { sandboxed }) {
    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-IN',
    });
    const page = await context.newPage();
    const started = Date.now();
    let ttfb = 0;
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 80));
    });
    page.on('response', (res) => {
        if (!ttfb && res.url().startsWith('http')) ttfb = Date.now() - started;
    });

    let pageUrl = url;
    if (sandboxed) {
        const file = `/tmp/embed-${Math.random().toString(36).slice(2)}.html`;
        fs.writeFileSync(file, IFRAME_HTML(url));
        pageUrl = `file://${file}`;
    }

    const result = {
        status: 'fail',
        ttfb,
        ttff: 0,
        rebuffers: 0,
        advanced: false,
        currentTime: 0,
        errors: 0,
        reason: '',
    };

    try {
        const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        result.httpStatus = response ? response.status() : 0;

        // Video element (kabhi kabhi andar ke frame me hota hai).
        const findVideo = async () => {
            for (const frame of page.frames()) {
                const handle = await frame.$('video').catch(() => null);
                if (handle) return handle;
            }
            return null;
        };

        let video = null;
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            video = await findVideo();
            if (video) break;
            await page.waitForTimeout(500);
        }

        if (!video) {
            result.reason = 'no <video>';
        } else {
            // Buffering counters — yahi "ruk ruk kar chalta hai" ka naap hai.
            await video.evaluate((el) => {
                window.__probe = { waiting: 0, stalled: 0 };
                el.addEventListener('waiting', () => (window.__probe.waiting += 1));
                el.addEventListener('stalled', () => (window.__probe.stalled += 1));
                el.muted = true;
                el.play().catch(() => {});
            });

            const firstFrameDeadline = Date.now() + 15000;
            while (Date.now() < firstFrameDeadline) {
                const ready = await video.evaluate((el) => el.readyState).catch(() => 0);
                if (ready >= 2) break;
                await page.waitForTimeout(250);
            }
            const ready = await video.evaluate((el) => el.readyState).catch(() => 0);
            result.ttff = Date.now() - started;

            // 8 second dekho: time aage badh raha hai aur kitni baar ruka.
            const t1 = await video.evaluate((el) => el.currentTime).catch(() => 0);
            await page.waitForTimeout(8000);
            const t2 = await video.evaluate((el) => el.currentTime).catch(() => 0);
            const counters = await video.evaluate(() => window.__probe || { waiting: 0, stalled: 0 }).catch(() => ({
                waiting: 0,
                stalled: 0,
            }));

            result.currentTime = Number(t2.toFixed(1));
            result.advanced = t2 - t1 > 1;
            result.rebuffers = (counters.waiting || 0) + (counters.stalled || 0);
            result.status = ready >= 2 && result.advanced ? 'PLAYS' : 'stuck';
            result.reason = ready >= 2 ? (result.advanced ? '' : 'no progress') : `readyState ${ready}`;
        }
    } catch (error) {
        result.reason = String(error).split('\n')[0].slice(0, 90);
    }
    result.errors = consoleErrors.length;
    await context.close().catch(() => {});
    return result;
}

async function main() {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    });

    const rows = [];
    for (const [label, base] of CANDIDATES) {
        for (const [kind, movieId] of [
            ['hindi', MOVIE],
            ['global', MOVIE_GLOBAL],
        ]) {
            const url = `${base}/movie/${movieId}`;
            // eslint-disable-next-line no-await-in-loop
            const direct = await probePage(browser, url, { sandboxed: false });
            rows.push({ label, kind, mode: 'direct', url, ...direct });
            // eslint-disable-next-line no-await-in-loop
            const framed = await probePage(browser, url, { sandboxed: true });
            rows.push({ label, kind, mode: 'iframe+sandbox', url, ...framed });
            console.log(`${label} ${kind} direct=${direct.status} frame=${framed.status}`);
        }
    }
    await browser.close();

    const lines = [];
    lines.push('## Server 3 — asli playback probe (Chromium)');
    lines.push('');
    lines.push(
        '| provider | title | mode | plays? | ttff_ms | +8s_s | rebuffers | video_errors | reason |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of rows) {
        lines.push(
            `| ${row.label} | ${row.kind} | ${row.mode} | ${row.status} | ${row.ttff || '–'} | ${row.currentTime} | ${row.rebuffers} | ${row.errors} | ${row.reason || ''} |`,
        );
    }
    lines.push('');
    lines.push(`_runner IP datacenter hai — provider VPN/region block kare to \`fail\` aa sakta hai._`);

    const report = lines.join('\n');
    fs.writeFileSync('/tmp/server3-playback.md', report);
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
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
