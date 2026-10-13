#!/usr/bin/env node
// PROBE (temporary): structure of nxsha's season API. Output goes to data/probe-nxsha-tv.txt via the workflow.
const BASE = 'https://nxsha.space';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function raw(url) {
    try {
        const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'application/json,text/html,*/*' } });
        return { status: res.status, text: await res.text() };
    } catch (e) {
        return { status: `ERR ${e.message}`, text: '' };
    }
}

function shape(v, depth = 0) {
    if (Array.isArray(v)) return v.length ? [`array(${v.length})`, shape(v[0], depth + 1)] : 'array(0)';
    if (v && typeof v === 'object') {
        if (depth > 3) return '{...}';
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
    }
    return typeof v === 'string' ? `str:${v.slice(0, 40)}` : typeof v === 'number' ? `num:${v}` : typeof v;
}

for (const [id, season] of [['247769', 2], ['247769', 1], ['285147', 1], ['284753', 1]]) {
    const r = await raw(`${BASE}/api/tv/${id}/season/${season}`);
    console.log(`PROBE api ${id} s${season}: status=${r.status} len=${r.text.length}`);
    if (r.status !== 200) continue;
    let j;
    try { j = JSON.parse(r.text); } catch (e) { console.log(`PROBE not json: ${r.text.slice(0, 200)}`); continue; }
    console.log(`PROBE   shape: ${JSON.stringify(shape(j)).slice(0, 1500)}`);
    const eps = j.season?.episodes || j.episodes || j.season?.episode_list || [];
    console.log(`PROBE   episodes: ${eps.length}`);
    if (eps[0]) console.log(`PROBE   ep0: ${JSON.stringify(eps[0]).slice(0, 900)}`);
    if (eps[1]) console.log(`PROBE   ep1: ${JSON.stringify(eps[1]).slice(0, 500)}`);
}

// Where a season does not exist.
for (const season of [9, 0]) {
    const r = await raw(`${BASE}/api/tv/247769/season/${season}`);
    console.log(`PROBE api 247769 s${season}: status=${r.status} len=${r.text.length} ${r.text.slice(0, 160).replace(/\s+/g, ' ')}`);
}

// Season 1 episode data inside the page payload (Next flight data), to see runtime/overview/still fields.
const page = await raw(`${BASE}/tv/247769`);
const m = /\\"episodes\\":\[(.{0,1200})/.exec(page.text) || /"episodes":\[(.{0,1200})/.exec(page.text);
console.log(`PROBE page episodes payload: ${m ? m[0].slice(0, 1000).replace(/\\"/g, '"') : 'none'}`);
const runtimeHits = page.text.match(/runtime\\?"?:\s*\d+/g) || [];
console.log(`PROBE page runtime fields: ${runtimeHits.length} ${JSON.stringify(runtimeHits.slice(0, 5))}`);
