/**
 * NetMirror API probe v2 — shape + TV routes + CORS
 * ================================================
 * v1 se pata chala: `net27.cc` / `net79.cc` par `GET /api/embed-tmdb/{tmdbId}`
 * JSON deta hai (Mandaadi 1465943 par 3 stream URLs), jabki `net77.cc` 404.
 *
 * Ye probe wahi shape poora dump karta hai (movie + TV episode), aur browser se
 * seedha call ho sakta hai ya nahi (CORS) — ye batata hai ki app me
 * `/api/netmirror` proxy chahiye ya nahi.
 */

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function hit(url, origin) {
    try {
        const res = await fetch(url, {
            headers: {
                'user-agent': UA,
                accept: 'application/json,*/*',
                referer: 'https://videodownloader.site/',
                ...(origin ? { origin } : {}),
            },
            signal: AbortSignal.timeout(20000),
        });
        const body = await res.text();
        return {
            status: res.status,
            acao: res.headers.get('access-control-allow-origin') || '-',
            acac: res.headers.get('access-control-allow-credentials') || '-',
            server: res.headers.get('server') || '-',
            body,
        };
    } catch (error) {
        return { status: 0, error: String(error?.message || error), body: '' };
    }
}

function show(label, res) {
    const head = `\n### ${label}\n${'#'.repeat(3)} status=${res.status} server=${res.server || '-'} ACAO=${res.acao} ACAC=${res.acac} bytes=${res.body.length}`;
    console.log(head);
    console.log(res.body.slice(0, 2400));
}

const ORIGIN = 'https://net-ki15.vercel.app';

show('net27 movie 1465943 (Mandaadi)', await hit('https://net27.cc/api/embed-tmdb/1465943', ORIGIN));
show('net27 movie 1441228 (jo nahi mila — khaali jawab)', await hit('https://net27.cc/api/embed-tmdb/1441228', ORIGIN));

// TV: kaun route chalta hai?
const tvRoutes = [
    'https://net27.cc/api/embed-tmdb/1396?type=tv&s=1&e=1',
    'https://net27.cc/api/embed-tmdb/1396?s=1&e=1',
    'https://net27.cc/api/embed-tmdb/1396/1/1',
    'https://net27.cc/api/embed-tv/1396/1/1',
];
for (const url of tvRoutes) {
    const res = await hit(url, ORIGIN);
    console.log(`\nTV route ${url} → ${res.status} bytes=${res.body.length} ${res.error || ''}`);
    if (res.status === 200) console.log(res.body.slice(0, 1600));
}

// NetMirror ka player page (agar API na chale to fallback iframe).
show('net27 embed page /embed/1465943', await hit('https://net27.cc/embed/1465943', ORIGIN));
