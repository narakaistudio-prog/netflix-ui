import { writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const get = async (url) => {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    return { status: res.status, text: await res.text() };
};
const epLinks = (html) => {
    const out = new Set();
    for (const m of html.matchAll(/href="((?:https?:\/\/toonstream\.us)?\/episode\/[^"#]+?)"/g)) out.add(m[1]);
    return [...out].map((h) => h.replace(/\/*$/, ''));
};
const seasonInfo = (links) => {
    const by = {};
    for (const link of links) {
        const m = link.match(/-(\d+)x(\d+)$/);
        if (!m) continue;
        (by[m[1]] ||= []).push(Number(m[2]));
    }
    const out = {};
    for (const [s, eps] of Object.entries(by)) {
        const sorted = eps.sort((a, b) => a - b);
        out[s] = { count: sorted.length, max: Math.max(...sorted), missing: sorted.filter((n, i) => n !== i + 1).slice(0, 6) };
    }
    return out;
};

const shows = [
    { title: 'Ranma1/2', base: 'ranma1-2', nx: '259140' },
    { title: 'Blue Box', base: 'blue-box', nx: '207347' },
    { title: 'The Elusive Samurai', base: 'the-elusive-samurai', nx: '222623' },
];
const report = {};
for (const show of shows) {
    const series = await get(`https://toonstream.us/series/${show.base}/`);
    const dataUrls = [...new Set([...series.text.matchAll(/data-url="(\/series\/[^"]+)"/g)].map((m) => m[1]))];
    const seasons = {};
    const base = epLinks(series.text);
    if (base.length) seasons.initial = seasonInfo(base);
    for (const du of dataUrls) {
        const page = await get(`https://toonstream.us${du}`);
        seasons[du.split('/').pop()] = { status: page.status, links: seasonInfo(epLinks(page.text)) };
        await new Promise((r) => setTimeout(r, 400));
    }
    const nx = {};
    for (const n of [1, 2, 3, 4, 5]) {
        const r = await get(`https://nxsha.space/api/tv/${show.nx}/season/${n}`);
        if (!r.text.includes('"success":true')) {
            nx[n] = r.text.slice(0, 80);
            continue;
        }
        const j = JSON.parse(r.text);
        const eps = j.episodes || [];
        nx[n] = {
            count: eps.length,
            declared: j.season?.episode_count,
            first: eps[0] && [eps[0].episode_number, eps[0].air_date, eps[0].name],
            last: eps.at(-1) && [eps.at(-1).episode_number, eps.at(-1).air_date, eps.at(-1).name],
        };
        await new Promise((r2) => setTimeout(r2, 400));
    }
    report[show.title] = { seriesStatus: series.status, dataUrls, seasons, nx };
}
const sample = await get('https://toonstream.us/series/ranma1-2/season/2');
const firstCard = [...sample.text.matchAll(/<a[^>]+href="(\/episode\/[^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/g)]
    .slice(0, 3)
    .map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim().slice(0, 160)]);
report.sampleSeasonPage = { status: sample.status, bytes: sample.text.length, cards: firstCard, hasSeasonBtns: /season-btn/.test(sample.text) };
writeFileSync('tmp-probe/summary.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1).slice(0, 12000));
