// TEMPORARY probe (delete with .github/workflows/probe-jojo.yml).
// Dumps what ToonStream's JoJo season pages actually contain, so the season
// parser can be fixed against real markup instead of guesses. The sandbox
// cannot reach toonstream.us, so this runs on the Actions runner.
import { writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const BASE = 'https://toonstream.us';

async function get(url) {
    try {
        const res = await fetch(url, {
            headers: { 'user-agent': UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(30000),
        });
        return { status: res.status, url: res.url, text: await res.text() };
    } catch (error) {
        return { status: 0, url, text: '', error: String(error?.message || error) };
    }
}

const unique = (list) => [...new Set(list)];

const out = { ranAt: new Date().toISOString(), seasons: {} };
for (const n of [1, 2, 3, 4, 5, 6]) {
    const page = await get(`${BASE}/series/jojos-bizarre-adventure/season/${n}/`);
    const text = page.text || '';
    const hrefs = unique([...text.matchAll(/href="(\/episode\/[^"]+)"/g)].map((m) => m[1]));
    const anyLinks = unique([...text.matchAll(/\/episode\/[^"'#\s<>]+/g)].map((m) => m[0]));
    const numbered = unique([...text.matchAll(/-(?:\d+)x(\d+)\//g)].map((m) => Number(m[1])));
    out.seasons[n] = {
        status: page.status,
        bytes: text.length,
        hrefs: hrefs.slice(0, 8),
        hrefCount: hrefs.length,
        anyLinks: anyLinks.slice(0, 8),
        anyLinkCount: anyLinks.length,
        numbered: numbered.slice(0, 8),
        numberedCount: numbered.length,
        article: (text.match(/<article[\s\S]{0,500}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 500),
        seasonButtons: unique([...text.matchAll(/data-url="([^"]*\/season\/(\d+))"/g)].map((m) => m[1])),
    };
    await new Promise((done) => setTimeout(done, 150));
}

const s6 = await get(`${BASE}/series/jojos-bizarre-adventure/season/6`);
out.season6NoSlash = {
    status: s6.status,
    hrefs: unique([...String(s6.text || '').matchAll(/href="(\/episode\/[^"]+)"/g)].map((m) => m[1])).slice(0, 10),
};

const stone = await get(`${BASE}/s?q=jojo`);
out.search = {
    status: stone.status,
    links: unique([...String(stone.text || '').matchAll(/href="(\/(?:series|episode)\/[^"]+)"/g)].map((m) => m[1])).slice(0, 20),
};

writeFileSync('data/jojo-probe.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('probe written');
