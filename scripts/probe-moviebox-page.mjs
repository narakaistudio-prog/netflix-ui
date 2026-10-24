/**
 * Probe: M2Box ke **watch page** ke andar stream ka koi rasta hai kya?
 * ==================================================================
 * Sach (24 Oct probe): `/subject/play` guest ko **kuch bhi nahi** deta —
 * `hasResource:false`, `streams:[]`, `maxResolution:480` (CORS bhi theek hai).
 * Isliye hamara `<video>` (aur uske ±10s buttons) kabhi nahi chalta; player
 * chup-chaap site ke iframe par gir jata hai.
 *
 * Ab sawaal: site ka apna player us video ko kahan se laata hai? Do raste:
 *
 *   [P] watch page ka HTML — koi signed `playUrl`/`.mp4`/`.m3u8` HTML me hi
 *       likha hai? (Agar haan: serverless resolve JSON de dega, video phir bhi
 *       CDN se seedha chalega — koi media proxy nahi.)
 *   [H] koi aur API host (m2box.org / api.m2box.org) jawab deta hai?
 *
 * Kuch save nahi karta.
 *
 *   node scripts/probe-moviebox-page.mjs --slug mandaadi-hindi-qxUx1r3QHW4 \
 *        --id 4151920426815471968
 */

const UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

function arg(name, fallback = '') {
    const at = process.argv.indexOf(`--${name}`);
    return at > -1 ? String(process.argv[at + 1] || fallback) : fallback;
}

const SLUG = arg('slug', 'mandaadi-hindi-qxUx1r3QHW4');
const SUBJECT = arg('id', '4151920426815471968');
const log = (...args) => console.log(...args);

const MEDIA_RE = /https?:\/\/[^"'\\\s]+?\.(?:mp4|m3u8|mpd)(?:\?[^"'\\\s]*)?/gi;

function uniq(list) {
    return [...new Set(list)];
}

async function main() {
    const pages = [
        `https://m2box.org/movies/${SLUG}?id=${SUBJECT}&type=/movie/detail&detailSe=&detailEp=&lang=en`,
        `https://moviebox.ph/movies/${SLUG}?id=${SUBJECT}&type=/movie/detail&lang=en`,
    ];
    for (const url of pages) {
        log(`\n[P] watch page → ${url}`);
        try {
            const res = await fetch(url, {
                redirect: 'follow',
                headers: {
                    'User-Agent': UA,
                    Accept: 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });
            const html = await res.text();
            log('    status', res.status, '| bytes', html.length, '| final', String(res.url).slice(0, 90));
            const media = uniq(html.match(MEDIA_RE) || []);
            log('    media urls in html:', media.length);
            media.slice(0, 5).forEach((m) => log('     ', m.slice(0, 150)));
            for (const key of ['playUrl', 'play_url', 'streamUrl', 'stream_url', 'hasResource', 'resolutionList', 'subjectId']) {
                const at = html.indexOf(key);
                log(`    "${key}":`, at > -1 ? html.slice(at, at + 160).replace(/\s+/g, ' ') : '(nahi mila)');
            }
            for (const tag of ['<video', '<iframe', 'iframe src', 'playerUrl', 'player_url', 'mzfi', 'aoneroom', 'openPlayer', 'videoUrl']) {
                const at = html.toLowerCase().indexOf(tag.toLowerCase());
                log(`    "${tag}":`, at > -1 ? html.slice(at, at + 180).replace(/\s+/g, ' ') : '(nahi mila)');
            }
            const scripts = uniq(html.match(/src="[^"]+\.js[^"]*"/g) || []);
            log('    scripts:', scripts.length, scripts.slice(0, 3).join(' ').slice(0, 220));
        } catch (error) {
            log('    failed:', String(error?.message || error).slice(0, 120));
        }
    }

    log('\n[H] doosre API hosts par /subject/play…');
    const hosts = [
        ['m2box.org', `https://m2box.org/wefeed-h5api-bff/subject/play`],
        ['api.m2box.org', `https://api.m2box.org/wefeed-h5api-bff/subject/play`],
        ['moviebox.ph', `https://moviebox.ph/wefeed-h5api-bff/subject/play`],
        ['h5-api', `https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/play`],
    ];
    for (const [label, base] of hosts) {
        const url =
            `${base}?subjectId=${SUBJECT}&se=0&ep=0` +
            `&detailPath=${SLUG}&streamSignType=1`;
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': UA,
                    Accept: 'application/json',
                    'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
                    'X-Request-Lang': 'en',
                    Referer: `https://${label}/`,
                    Origin: `https://${label}`,
                },
            });
            const body = await res.text();
            const data = (() => {
                try {
                    return JSON.parse(body)?.data || {};
                } catch {
                    return {};
                }
            })();
            log(
                `    ${label.padEnd(15)} ${res.status} · streams ${(data.streams || []).length}` +
                    ` · hls ${(data.hls || []).length} · hasResource ${data.hasResource}`,
            );
            if (!(data.streams || []).length) log('      body:', body.slice(0, 160).replace(/\s+/g, ' '));
        } catch (error) {
            log(`    ${label.padEnd(15)} failed:`, String(error?.message || error).slice(0, 100));
        }
    }
}

main().catch((error) => {
    console.error('probe failed:', error);
    process.exitCode = 1;
});
