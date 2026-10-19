import { writeFileSync } from 'node:fs';
import { parseSeasonCards, parseSeasonEpisodes, parseToonSeasons } from '../scripts/lib/seasons.mjs';

const BASE = 'https://toonstream.us';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function getText(url) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' } });
    return { status: res.status, text: await res.text() };
}

const lines = [];
for (const slug of ['my-hero-academia', 'trigun-stampede']) {
    const series = await getText(`${BASE}/series/${slug}/`);
    const links = parseToonSeasons(series.text);
    lines.push(`== ${slug} series ${series.status} links=${JSON.stringify(links)}`);
    for (const link of links) {
        const url = link.url.startsWith('http') ? link.url : `${BASE}${link.url}`;
        const body = await getText(url.endsWith('/') ? url : `${url}/`);
        const info = parseSeasonEpisodes(body.text || '');
        const map = parseSeasonCards(body.text || '');
        if (!info.count || (slug === 'my-hero-academia' ? link.n !== 8 : link.n !== 2)) {
            lines.push(`   S${link.n} ${body.status} eps=${info.count} first=${info.first} cards=${map.size}`);
            continue;
        }
        const local = [...map.entries()].map(([ep, url]) => [ep - info.first + 1, url.slice(0, 60)]);
        lines.push(`   S${link.n} ${body.status} eps=${JSON.stringify(info)} cards=${map.size} articles=${(body.text.match(/<article\b/gi) || []).length} imgs=${(body.text.match(/<img\b/gi) || []).length}`);
        lines.push(`   local=${JSON.stringify(local)}`);
    }
}
writeFileSync('probe-cards.txt', `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
