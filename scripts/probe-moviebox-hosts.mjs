/**
 * Kaunse MovieBox hosts (aur unke "copy" domains) abhi zinda hain?
 * =================================================================
 * Owner: *"koi aacha server moviebox ka copy dhundo"*.
 *
 * MovieBox ka koi naya brand nahi hota — ek hi backend
 * (`h5-api.aoneroom.com/wefeed-h5api-bff`) par kai front domains chalte hain
 * (moviebox.gd .ph, m2box.org, movieboxonline.net, netnaija.film …). Ye probe
 * dono cheezein check karta hai:
 *
 *   1. front page — domain khulta hai ya nahi (status, final URL, title, bytes)
 *   2. BFF API   — us host ke liye token/rows milte hain ya nahi (`x-user`)
 *
 * Network sirf GitHub runner se chalta hai (sandbox ka egress band hai),
 * isliye result PR comment me post hota hai. Deploy kuch nahi karta.
 */

const HOSTS = [
    'moviebox.gd',
    'moviebox.ph',
    'm2box.org',
    'm2box.co',
    'movieboxonline.net',
    'netnaija.film',
    'officialmoviebox.com',
    'moviebox.pk',
    'moviebox.ke',
    'moviebox.id',
    'mzfi.me',
    'h5.aoneroom.com',
];

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BFF = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';

async function timed(fn) {
    const started = Date.now();
    try {
        const value = await fn();
        return { ok: true, value, ms: Date.now() - started };
    } catch (error) {
        return { ok: false, error: String(error?.message || error), ms: Date.now() - started };
    }
}

async function probeFront(host) {
    return timed(async () => {
        const res = await fetch(`https://${host}/`, {
            redirect: 'follow',
            headers: { 'user-agent': UA, accept: 'text/html' },
            signal: AbortSignal.timeout(15000),
        });
        const html = await res.text();
        const title = (html.match(/<title[^>]*>([^<]{0,90})/i)?.[1] || '').trim();
        return {
            status: res.status,
            final: new URL(res.url).host,
            bytes: html.length,
            title,
            bffMarker: /wefeed-h5api-bff|aoneroom/i.test(html),
        };
    });
}

async function probeApi(host) {
    return timed(async () => {
        const res = await fetch(`${BFF}/home?host=${encodeURIComponent(host)}`, {
            headers: {
                'user-agent': UA,
                origin: `https://${host}`,
                referer: `https://${host}/`,
                accept: 'application/json',
            },
            signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        let rows = 0;
        try {
            const json = JSON.parse(text);
            const data = json?.data;
            rows = Array.isArray(data) ? data.length : data && typeof data === 'object' ? 1 : 0;
        } catch {
            // non-JSON (Cloudflare page etc.)
        }
        return {
            status: res.status,
            token: Boolean(res.headers.get('x-user')),
            rows,
            json: /^\s*[{[]/.test(text),
        };
    });
}

const lines = [];
for (const host of HOSTS) {
    const front = await probeFront(host);
    const api = await probeApi(host);
    const frontText = front.ok
        ? `${front.value.status} ${front.value.final} ${front.value.bytes}B title="${front.value.title}" bff=${front.value.bffMarker ? 'yes' : 'no'}`
        : `dead (${front.error})`;
    const apiText = api.ok
        ? `${api.value.status} token=${api.value.token ? 'yes' : 'no'} rows=${api.value.rows} json=${api.value.json ? 'yes' : 'no'}`
        : `dead (${api.error})`;
    lines.push(`${host.padEnd(22)} front ${frontText.padEnd(64)} api ${apiText}`);
    console.log(lines[lines.length - 1]);
}

console.log('\n--- summary ---');
console.log(lines.join('\n'));
