#!/usr/bin/env node
/**
 * One-shot probe for nxsha.space (our fallback player) — runs on a hosted
 * runner because the workspace sandbox cannot reach the site.
 *
 * Goals:
 *   1. Learn the shape of /embed/movie/{id} and /embed/tv/{id}/{s}/{e}
 *      responses (title, episode list, player hints).
 *   2. Verify candidate TMDB / IMDb ids for the Crunchyroll titles that
 *      animahd.com does not carry, so NX_DATA is never baked with a guess.
 *
 * Output: data/nxsha-probe.json (+ raw HTML into data/nxsha-diag/ as an
 * artifact only).
 *
 * Usage: node scripts/probe-nxsha.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', 'nxsha-probe.json');
const DIAG = resolve(ROOT, 'data', 'nxsha-diag');

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true';

/** [label, kind, id, expected title tokens, season, episode] */
const CANDIDATES = [
    // ---- known-good controls (ids already used by the main catalog) ----
    ['control-movie-tmdb', 'movie', '1441228', [], 0, 0],
    ['control-tv-imdb-demon', 'tv', 'tt9335498', [], 1, 1],
    ['control-tv-imdb-vinland', 'tv', 'tt10233448', [], 1, 1],
    ['control-tv-imdb-drstone', 'tv', 'tt9679542', [], 1, 1],

    // ---- the 18 titles missing from animahd ----
    ['aot-tmdb', 'tv', '1429', ['attack', 'titan'], 1, 1],
    ['aot-imdb', 'tv', 'tt2560140', ['attack', 'titan'], 1, 1],
    ['tokyo-tmdb', 'tv', '105009', ['tokyo', 'revengers'], 1, 1],
    ['tokyo-imdb', 'tv', 'tt13103174', ['tokyo', 'revengers'], 1, 1],
    ['vinland-tv', 'tv', 'tt10233448', ['vinland', 'saga'], 1, 1],
    ['drstone-tv', 'tv', 'tt9679542', ['stone'], 1, 1],
    ['boruto-tmdb', 'tv', '80564', ['boruto'], 1, 1],
    ['boruto-imdb', 'tv', 'tt6342474', ['boruto'], 1, 1],
    ['sao-tmdb', 'tv', '45782', ['sword', 'art', 'online'], 1, 1],
    ['sao-imdb', 'tv', 'tt2250192', ['sword', 'art', 'online'], 1, 1],
    ['saoMovie-tmdb', 'movie', '374205', ['ordinal', 'sword', 'art'], 0, 0],
    ['saoMovie-imdb', 'movie', 'tt5923136', ['ordinal', 'sword', 'art'], 0, 0],
    ['mhaMovie-tmdb', 'movie', '505262', ['hero', 'academia', 'two'], 0, 0],
    ['mhaMovie-imdb', 'movie', 'tt7147616', ['hero', 'academia', 'two'], 0, 0],
    ['yourname-tmdb', 'movie', '372058', ['your', 'name'], 0, 0],
    ['yourname-imdb', 'movie', 'tt5311514', ['your', 'name'], 0, 0],
    ['suzume-tmdb', 'movie', '818647', ['suzume'], 0, 0],
    ['suzume-imdb', 'movie', 'tt16428256', ['suzume'], 0, 0],
    ['silentvoice-tmdb', 'movie', '378064', ['silent', 'voice'], 0, 0],
    ['silentvoice-imdb', 'movie', 'tt5323662', ['silent', 'voice'], 0, 0],
    ['spirited-tmdb', 'movie', '129', ['spirited', 'away'], 0, 0],
    ['spirited-imdb', 'movie', 'tt0245429', ['spirited', 'away'], 0, 0],
    ['weathering-tmdb', 'movie', '568160', ['weathering'], 0, 0],
    ['weathering-imdb', 'movie', 'tt9426210', ['weathering'], 0, 0],
    ['howl-tmdb', 'movie', '4935', ['howl'], 0, 0],
    ['howl-imdb', 'movie', 'tt0347149', ['howl'], 0, 0],
    ['mononoke-tmdb', 'movie', '128', ['mononoke'], 0, 0],
    ['mononoke-imdb', 'movie', 'tt0119698', ['mononoke'], 0, 0],
    ['akira-tmdb', 'movie', '149', ['akira'], 0, 0],
    ['akira-imdb', 'movie', 'tt0094625', ['akira'], 0, 0],
    ['jjk0-tmdb', 'movie', '810693', ['jujutsu', 'kaisen', '0'], 0, 0],
    ['jjk0-imdb', 'movie', 'tt14331144', ['jujutsu', 'kaisen'], 0, 0],
    ['demonMovie-tmdb', 'movie', '635302', ['demon', 'slayer'], 0, 0],
    ['demonMovie-imdb', 'movie', 'tt11032374', ['demon', 'slayer'], 0, 0],
];

/** Search-ish endpoints worth learning about (ids for titles not yet known). */
const SEARCH_PROBES = [
    ['home', 'https://nxsha.space/'],
    ['search-page', 'https://nxsha.space/search?q=attack%20on%20titan'],
    ['search-api', 'https://nxsha.space/api/search?q=attack+on+titan'],
    ['search-json-api', 'https://nxsha.space/api/search?keyword=attack+on+titan'],
    ['search-wp', 'https://nxsha.space/?s=attack+on+titan'],
];

async function get(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const text = await res.text();
        return { status: res.status, finalUrl: res.url, text };
    } finally {
        clearTimeout(to);
    }
}

function analyse(text, want) {
    const docTitle = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || '';
    const h1 = [...text.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
        .map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 5);
    const lower = text.toLowerCase();
    const hits = want.filter((w) => lower.includes(w));
    const episodeLinks = (text.match(/\/embed\/tv\/[^"'\s]+/g) || []).length + (text.match(/\/watch\//g) || []).length;
    const seasonMatches = [...text.matchAll(/[Ss]eason\s*(\d{1,2})/g)].map((m) => Number.parseInt(m[1], 10));
    return {
        docTitle: String(docTitle).slice(0, 140),
        h1,
        wantHits: hits,
        wantHitRatio: want.length ? hits.length / want.length : null,
        notFound: /not\s*found|404|no results|unavailable/i.test(docTitle) || /not\s*found|no results/i.test(text.slice(0, 4000)),
        markers: {
            video: (lower.match(/<video/g) || []).length,
            iframes: (lower.match(/<iframe/g) || []).length,
            m3u8: (lower.match(/\.m3u8/g) || []).length,
            mp4: (lower.match(/\.mp4/g) || []).length,
            tmdbIds: [...new Set([...text.matchAll(/(?:tmdb|movie|tv)[-_ ]?id["'\s:=]+(\d{2,8})/gi)].map((m) => m[1]))].slice(0, 8),
            imdbIds: [...new Set([...text.matchAll(/tt\d{6,9}/g)].map((m) => m[0]))].slice(0, 8),
            episodeLinks,
            seasons: [...new Set(seasonMatches)].slice(0, 12),
        },
        snippet: text.replace(/\s+/g, ' ').slice(0, 600),
        bytes: text.length,
    };
}

async function main() {
    mkdirSync(DIAG, { recursive: true });
    const report = { generatedAt: new Date().toISOString(), embeds: [], search: [] };

    for (const [label, kind, id, want, season, episode] of CANDIDATES) {
        const url =
            kind === 'movie'
                ? `https://nxsha.space/embed/movie/${id}?${PARAMS}`
                : `https://nxsha.space/embed/tv/${id}/${season}/${episode}?${PARAMS}`;
        let row = { label, kind, id, url };
        try {
            const { status, finalUrl, text } = await get(url);
            row = { ...row, status, finalUrl, ...analyse(text, want) };
            if (text.length && text.length < 900_000) writeFileSync(resolve(DIAG, `${label}.html`), text);
        } catch (e) {
            row = { ...row, error: String((e && e.message) || e) };
        }
        report.embeds.push(row);
        console.log(
            `${label.padEnd(22)} ${row.status ?? 'ERR'} hits=${row.wantHits ? row.wantHits.join('+') : '-'} (${row.wantHitRatio ?? '-'}) title="${String(row.docTitle || row.error || '').slice(0, 60)}"`,
        );
        await new Promise((r) => setTimeout(r, 150));
    }

    for (const [label, url] of SEARCH_PROBES) {
        let row = { label, url };
        try {
            const { status, finalUrl, text } = await get(url);
            row = { ...row, status, finalUrl, ...analyse(text, ['attack', 'titan']) };
            if (text.length && text.length < 900_000) writeFileSync(resolve(DIAG, `search-${label}.html`), text);
        } catch (e) {
            row = { ...row, error: String((e && e.message) || e) };
        }
        report.search.push(row);
        console.log(`search ${label.padEnd(16)} ${row.status ?? 'ERR'} ${row.bytes ?? ''}B title="${String(row.docTitle || row.error || '').slice(0, 60)}"`);
        await new Promise((r) => setTimeout(r, 150));
    }

    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${OUT}`);
}

main().catch((e) => {
    console.error(`probe-nxsha: ${(e && e.message) || e}`);
    process.exitCode = 1;
});
