/**
 * /api/m2box-probe — **diagnostic only** (temporary).
 * ==================================================
 * Sawaal: MovieBox ki play API `/subject/play` `hasResource:false` deti hai.
 * Ye (a) geo block hai (US IP) ya (b) guest ko stream milti hi nahi?
 *
 * Ye function khud play call karta hai aur jawab waisa hi lauta deta hai.
 * Region **bom1 (Mumbai)** par pin hai — agar India se streams aati hain to
 * jawab me `streams` bhare honge, aur tab phone par seedha `<video>` (yaani
 * ±10s) sach me possible hai.
 *
 *   GET /api/m2box-probe?subjectId=4151920426815471968&detailPath=mandaadi-hindi-qxUx1r3QHW4
 *
 * Delete after diagnosis.
 */

export const config = { regions: ['bom1'] };

const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const PLAYER_FALLBACK = 'https://mzfi.me/wefeed-h5api-bff';
const HOST = 'moviebox.ph';

function headers(extra = {}) {
    return {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
        'X-Request-Lang': 'en',
        Referer: `https://${HOST}/`,
        ...extra,
    };
}

async function token() {
    const res = await fetch(`${H5}/home?host=${encodeURIComponent(HOST)}`, { headers: headers() });
    const raw = res.headers.get('x-user');
    try {
        return String(JSON.parse(raw || '{}')?.token || '');
    } catch {
        return '';
    }
}

export default async function handler(req, res) {
    const subjectId = String(req.query?.subjectId || '4151920426815471968');
    const detailPath = String(req.query?.detailPath || 'mandaadi-hindi-qxUx1r3QHW4');
    const se = Number(req.query?.se || 0);
    const ep = Number(req.query?.ep || 0);
    const out = { region: process.env.VERCEL_REGION || '', country: req.headers['x-vercel-ip-country'] || '' };

    try {
        const auth = await token();
        out.token = Boolean(auth);
        const query =
            `subjectId=${encodeURIComponent(subjectId)}&se=${se}&ep=${ep}` +
            `&detailPath=${encodeURIComponent(detailPath)}&streamSignType=1`;
        for (const [label, base] of [
            ['player', PLAYER_FALLBACK],
            ['h5', H5],
        ]) {
            try {
                const play = await fetch(`${base}/subject/play?${query}`, {
                    headers: headers(auth ? { Authorization: `Bearer ${auth}`, 'X-Play-Mode': '2' } : {}),
                });
                const body = await play.json().catch(() => null);
                const data = body?.data || {};
                out[label] = {
                    status: play.status,
                    streams: (data.streams || []).length,
                    hls: (data.hls || []).length,
                    hasResource: data.hasResource,
                    limitedCode: data.limitedCode,
                    first: (data.streams || [])[0]?.url ? String((data.streams || [])[0].url).slice(0, 120) : null,
                };
            } catch (error) {
                out[label] = { error: String(error?.message || error).slice(0, 100) };
            }
        }
    } catch (error) {
        out.error = String(error?.message || error).slice(0, 120);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(out);
}
