import { writeFileSync } from 'node:fs';

const BASE = 'https://toonstream.us';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function get(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    return { status: res.status, text: await res.text() };
}

function seasons(html) {
    const out = [];
    const re = /<a\b[^>]*class="[^"]*season-btn[^"]*"[^>]*>/gi;
    const blocks = html.match(re) || [];
    for (const tag of blocks) {
        const n = /data-season="(\d+)"/i.exec(tag)?.[1] || /data-season='(\d+)'/i.exec(tag)?.[1];
        const url = /data-url="([^"]+)"/i.exec(tag)?.[1];
        if (n && url) out.push({ n: Number(n), url });
    }
    return out;
}

function cards(html) {
    const out = new Map();
    for (const block of html.match(/<article\b[\s\S]*?<\/article>/gi) || []) {
        const link = /\/episode\/[^"']*?-(\d+)x(\d+)\/?/i.exec(block);
        if (!link) continue;
        const src = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(block)?.[1]
            || /<img\b[^>]*\bdata-src="([^"]+)"/i.exec(block)?.[1];
        out.set(Number(link[2]), src || null);
    }
    return out;
}

function episodes(html) {
    const nums = new Set();
    for (const m of html.matchAll(/\/episode\/[^"'#]*?-(\d+)x(\d+)\/?(?=["'#])/g)) nums.add(Number(m[2]));
    const sorted = [...nums].filter((n) => n > 0).sort((a, b) => a - b);
    return { count: sorted.length, first: sorted[0], last: sorted[sorted.length - 1] };
}

const lines = [];
for (const [slug, target] of [['my-hero-academia', 8], ['trigun-stampede', 2]]) {
    const series = await get(`${BASE}/series/${slug}/`);
    const links = seasons(series.text);
    lines.push(`== ${slug} series ${series.status} seasonButtons=${links.length} articles=${(series.text.match(/<article\b/gi) || []).length}`);
    const link = links.find((l) => l.n === target);
    const page = await get(`${BASE}${link ? link.url : `/series/${slug}/season/${target}`}${link && link.url.endsWith('/') ? '' : '/'}`);
    const eps = episodes(page.text);
    const map = cards(page.text);
    const missing = [];
    for (let local = 1; local <= eps.count; local += 1) {
        const number = eps.first + local - 1;
        if (!map.get(number)) missing.push(local);
    }
    const imgs = [...map.values()].filter(Boolean);
    lines.push(`   S${target} page ${page.status} episodes=${JSON.stringify(eps)} cards=${map.size} withImg=${imgs.length} missingLocal=${JSON.stringify(missing)}`);
    lines.push(`   src=${JSON.stringify(imgs.slice(0, 2))}`);
    const cardBlocks = page.text.match(/<article\b[\s\S]*?<\/article>/gi) || [];
    lines.push(`   articles=${cardBlocks.length} firstArticle=${JSON.stringify((cardBlocks[0] || '').replace(/\s+/g, ' ').slice(0, 420))}`);
}
writeFileSync('probe-cards.txt', `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
