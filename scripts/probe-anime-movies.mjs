#!/usr/bin/env node
/**
 * Do anime movies ka asli route dhoondhne wala ek-baar ka probe.
 *
 * Owner: "crunchyroll ke andar movie mae chainsaw man reze movie or demon
 * slayer infinity castle laga do" — page me naya card daalne se pehle ye
 * pata hona chahiye ki Nxsha aur ToonStream par wo movies **hain bhi** aur
 * kis id/slug par. Sandbox se dono sites reach nahi hoti (sirf GitHub ke
 * hosts), isliye ye script GitHub Actions me chalti hai aur apna output
 * `data/anime-movie-probe.json` me commit karti hai.
 *
 * Kuch bhi guess nahi hota:
 *   - Nxsha: `/search?q=` ke real results, phir har movie candidate ka
 *     `/movie/<id>` page (title/year/runtime/description/poster) aur
 *     `/embed/movie/<id>` ka status — wahi URL player iframe kholta hai.
 *   - ToonStream: `api/toonstream.mjs` ka apna resolveMovie() — search page,
 *     title match aur player slots, sab wahi code jo production me chalta hai.
 *
 * Chalane ke baad `data/anime-movie-probe.json` padh kar catalog entries
 * (shows + movieKeys + nxsha-titles route + TS_MOVIES) haath se likhi jaati
 * hain; ye script khud page ko chhooti nahi.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _internal } from '../api/toonstream.mjs';
import { parseMoviePage } from './build-trending-nxsha.mjs';
import { parseSearchResults } from './build-netflix-genre-rows.mjs';
import { normTitle, parseGenres, pickNxshaMatch } from './import-imdb-anime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'data', 'anime-movie-probe.json');

const NX_BASE = 'https://nxsha.space';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Wahi do movies jo owner ne maangi, plus unke search variants. */
const TARGETS = [
    {
        key: 'rezemovie',
        title: 'Chainsaw Man – The Movie: Reze Arc',
        // Nxsha/ToonStream dono par naam chhota likha hota hai — pehle poora
        // naam, phir bina subtitle wala, taaki search kuch na khaali na chhode.
        queries: ['Chainsaw Man The Movie Reze Arc', 'Chainsaw Man Reze Arc', 'Chainsaw Man'],
    },
    {
        key: 'infinitycastle',
        title: 'Demon Slayer: Kimetsu no Yaiba Infinity Castle',
        queries: ['Demon Slayer Kimetsu no Yaiba Infinity Castle', 'Demon Slayer Infinity Castle', 'Kimetsu no Yaiba Infinity Castle'],
    },
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function get(url, { json = false } = {}) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json,*/*' : 'text/html,*/*' } });
        const text = await res.text();
        return { status: res.status, text };
    } catch (error) {
        return { status: 0, text: '', error: String(error?.message || error) };
    }
}

/** Ek title ke liye: Nxsha search ke saare movie hits + unka verified page. */
async function probeNxsha(target, report) {
    const seen = new Map();
    for (const query of target.queries) {
        const res = await get(`${NX_BASE}/search?q=${encodeURIComponent(query)}`);
        const hits = res.status === 200 ? parseSearchResults(res.text) : [];
        report.searches.push({ query, status: res.status, hits: hits.length, movies: hits.filter((h) => h.type === 'movie').map((h) => `${h.id} ${h.name} (${h.year})`) });
        for (const hit of hits) {
            if (!hit?.id || seen.has(`${hit.type}:${hit.id}`)) continue;
            seen.set(`${hit.type}:${hit.id}`, hit);
        }
        await sleep(250);
    }

    const movies = [...seen.values()].filter((hit) => hit.type === 'movie');
    // pickNxshaMatch ka wahi rule jo import script use karta hai: exact naam,
    // warna subtitle-wala match — par sirf tab jab poster/type movie ho.
    const best = pickNxshaMatch(movies, target.title, { kind: 'movie', year: '2025' }) || pickNxshaMatch(movies, target.title, { kind: 'movie' });
    if (!best) return { picked: null, candidates: movies.map((hit) => `${hit.id} ${hit.name}`) };

    const page = await get(`${NX_BASE}/movie/${best.id}`);
    const info = page.status === 200 ? parseMoviePage(page.text) : {};
    const embed = await get(`${NX_BASE}/embed/movie/${best.id}`);
    await sleep(250);
    return {
        picked: {
            id: best.id,
            kind: 'movie',
            searchName: best.name,
            year: info.year || best.year || '',
            pageTitle: info.title || '',
            titleMatches: !!info.title && normTitle(info.title) === normTitle(best.name),
            runtime: info.duration || '',
            description: info.description || '',
            poster: best.poster || info.backdrop || '',
            genres: page.status === 200 ? parseGenres(page.text, best.id) : [],
            pageStatus: page.status,
            embedStatus: embed.status,
            embedLooksReal: /Watch |S1:E1|Stream/i.test(embed.text || ''),
        },
        candidates: movies.map((hit) => `${hit.id} ${hit.name}`),
    };
}

/** ToonStream: /movies/<slug> page, title match aur player slots. */
async function probeToonstream(target) {
    const steps = [];
    try {
        const found = await _internal.resolveMovie({ title: target.title, slug: '' }, steps);
        if (!found) return { found: false, steps };
        return {
            found: true,
            title: found.title,
            slug: found.movieUrl.replace(/^.*\/movies\//, ''),
            movieUrl: found.movieUrl,
            servers: found.servers.map((server) => server.name),
            steps,
        };
    } catch (error) {
        return { found: false, error: String(error?.message || error), steps };
    }
}

async function main() {
    const out = { ranAt: new Date().toISOString(), targets: {} };
    for (const target of TARGETS) {
        const nxsha = await probeNxsha(target, { searches: [] });
        const toonstream = await probeToonstream(target);
        out.targets[target.key] = { title: target.title, nxsha, toonstream };
        console.log(
            `${target.key.padEnd(16)} nxsha=${nxsha.picked?.id || '-'} embed=${nxsha.picked?.embedStatus ?? '-'} ` +
                `toonstream=${toonstream.slug || '-'} servers=${toonstream.servers?.length ?? 0}`,
        );
    }
    writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
    console.log(`wrote ${OUT_FILE}`);
}

main();
