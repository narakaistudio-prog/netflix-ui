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

const titlesOf = (text) =>
    [...text.matchAll(/class="entry-title"[^>]*>\s*(?:<a[^>]*>)?\s*([^<]{1,120})</g)].map((m) => m[1].trim());

for (const n of [1, 2, 3, 4, 6]) {
    const page = await get(`${BASE}/series/jojos-bizarre-adventure/season/${n}/`);
    const text = page.text || '';
    out.seasons[n] = {
        status: page.status,
        titles: titlesOf(text).slice(0, 40),
        titleCount: titlesOf(text).length,
        articles: (text.match(/<article/gi) || []).length,
        rawArticle: (text.match(/<article[\s\S]{0,900}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 900),
    };
    await new Promise((done) => setTimeout(done, 150));
}

const episodePages = [
    '/episode/jojo&#39;s-bizarre-adventure-6x5/',
    '/episode/jojos-bizarre-adventure-6x1/',
    '/episode/jojo&#39;s-bizarre-adventure-3x1/',
];
out.episodes = {};
for (const path of episodePages) {
    const page = await get(BASE + path);
    const text = page.text || '';
    out.episodes[path] = {
        status: page.status,
        docTitle: (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '',
        titles: titlesOf(text).slice(0, 6),
        h1: (text.match(/<h1[^>]*>\s*([^<]{1,120})</) || [])[1] || '',
        breadcrumbs: [...text.matchAll(/itemprop="name"[^>]*>\s*([^<]{1,60})</g)].map((m) => m[1].trim()).slice(0, 6),
    };
    await new Promise((done) => setTimeout(done, 150));
}

writeFileSync('data/jojo-probe.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('probe written');
