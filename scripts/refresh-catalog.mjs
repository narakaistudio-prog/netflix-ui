#!/usr/bin/env node
/**
 * Key-less daily Netflix India catalog refresh.
 *
 * No API keys, no sign-ups:
 *  1. Scrapes FlixPatrol's "TOP 10 on Netflix in India" (updated daily)
 *  2. Fetches each title's page for its poster (og:image) and description
 *  3. Rewrites data/movies.json so the bundled catalog never goes stale
 *
 * If a TMDB_API_KEY happens to be available the richer TMDB catalog is used
 * instead, but it is completely optional.
 *
 * Usage: node scripts/refresh-catalog.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };

const SAMPLE_VIDEOS = [
    'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
];

// Netflix's daily chart scraper does not expose episode metadata, so retain
// known counts for recurring chart titles instead of falling back to a movie
// runtime in the series detail sheet.
const SERIES_EPISODE_COUNTS = {
    'Chumbak': 16,
    "India's Got Latent": 20,
    'Crew Girl': 8,
    'Monster: The Lizzie Borden Story': 8,
    'Operation Safed Sagar: The Untold Story of the Kargil War': 6,
    'Musafir Cafe': 8,
    'The Gentlemen': 16,
    'The Scandal': 8,
};

const SERIES_SEASON_EPISODES = {
    'Chumbak': [16],
    "India's Got Latent": [12, 8],
    'Crew Girl': [8],
    'Monster: The Lizzie Borden Story': [8],
    'Operation Safed Sagar: The Untold Story of the Kargil War': [6],
    'Musafir Cafe': [8],
    'The Gentlemen': [8, 8],
    'The Scandal': [8],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const POSTERS_DIR = join(ROOT, 'assets', 'posters');

/**
 * Poster hosts (FlixPatrol cache, etc.) block browser hotlinking with 403s,
 * so poster art is downloaded into the repo and referenced as `local:<id>`.
 * The app bundles these files — posters can never break again.
 */
async function savePoster(item) {
    const src = item.imageUrl || '';
    if (!/^https?:\/\//.test(src) || !/^(fp|movie|tv)-/.test(item.id)) return;
    const ext = (src.match(/\.(jpe?g|png|webp)/i)?.[1] || 'jpg').replace('jpeg', 'jpg');
    const attempts = [
        { ...UA, referer: `${new URL(src).origin}/` },
        UA,
        { 'user-agent': UA['user-agent'], accept: 'image/avif,image/webp,image/*,*/*' },
    ];
    for (const headers of attempts) {
        try {
            const res = await fetch(src, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 2000) throw new Error('suspiciously small');
            mkdirSync(POSTERS_DIR, { recursive: true });
            writeFileSync(join(POSTERS_DIR, `${item.id}.${ext}`), buf);
            item.imageUrl = `local:${item.id}`;
            return;
        } catch (e) {
            console.log(`poster attempt failed for ${item.id} (${e.message})`);
        }
    }
    const kept = existsSync(POSTERS_DIR)
        && readdirSync(POSTERS_DIR).some(f => f.startsWith(`${item.id}.`));
    if (kept) item.imageUrl = `local:${item.id}`;
    else console.log(`poster download failed for ${item.id} — keeping remote URL`);
}

/** Rewrite assets/posters/index.ts so the bundle always ships every poster. */
function writePosterIndex() {
    if (!existsSync(POSTERS_DIR)) return;
    const entries = readdirSync(POSTERS_DIR)
        .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
        .sort()
        .map(f => `    '${f.replace(/\.[^.]+$/, '')}': require('./${f}'),`)
        .join('\n');
    writeFileSync(
        join(POSTERS_DIR, 'index.ts'),
        `/**\n * Poster art bundled with the app, keyed by catalog id.\n *\n * Catalog JSON references these via \`local:<id>\` imageUrl values so posters\n * always load from the app bundle — third-party poster hosts block hotlinking\n * and would render broken cards. \`scripts/refresh-catalog.mjs\` rewrites this\n * map whenever it downloads fresh poster art.\n */\nexport const LOCAL_POSTERS: Record<string, any> = {\n${entries}\n};\n`,
    );
}

async function getHtml(url) {
    const res = await fetch(url, { headers: UA, redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.text();
}

const meta = (html, prop) => {
    const m = html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`))
        ?? html.match(new RegExp(`<meta[^>]+name="${prop}"[^>]+content="([^"]*)"`));
    return m ? m[1] : undefined;
};

/** Scrape today's Netflix India top 10 (movies + TV shows). */
async function scrapeFlixPatrol() {
    const html = await getHtml('https://flixpatrol.com/top10/netflix/india/');

    const parseSection = (header) => {
        const start = html.indexOf(header);
        if (start === -1) return [];
        const tableStart = html.indexOf('<table', start);
        const tableEnd = html.indexOf('</table>', tableStart);
        if (tableStart === -1 || tableEnd === -1) return [];
        const table = html.slice(tableStart, tableEnd);
        const rows = [...table.matchAll(/<a href="\/title\/([^/]+)\/"[^>]*>([^<]+)<\/a>/g)];
        return rows.slice(0, 10).map((m, i) => ({ slug: m[1], title: m[2].trim(), rank: i + 1 }));
    };

    const movies = parseSection('TOP 10 Movies');
    const shows = parseSection('TOP 10 TV Shows');
    if (!movies.length && !shows.length) throw new Error('no tables parsed');

    const enrich = async (item, kind) => {
        try {
            const page = await getHtml(`https://flixpatrol.com/title/${item.slug}/`);
            await sleep(300);
            return {
                id: `fp-${item.slug}`,
                imageUrl: meta(page, 'og:image') ?? '',
                title: item.title,
                type: kind === 'tv' ? 'SERIES' : 'FILM',
                ...(kind === 'tv' && SERIES_EPISODE_COUNTS[item.title]
                    ? { episodeCount: SERIES_EPISODE_COUNTS[item.title] }
                    : {}),
                ...(kind === 'tv' && SERIES_SEASON_EPISODES[item.title]
                    ? { seasonEpisodeCounts: SERIES_SEASON_EPISODES[item.title] }
                    : {}),
                description: meta(page, 'og:description'),
                ranking_text: `#${item.rank} in India Today`,
                youtubeId: TRAILERS[item.slug] || undefined,
                videoUrl: SAMPLE_VIDEOS[item.rank % SAMPLE_VIDEOS.length],
            };
        } catch {
            return {
                id: `fp-${item.slug}`,
                imageUrl: '',
                title: item.title,
                type: kind === 'tv' ? 'SERIES' : 'FILM',
                ...(kind === 'tv' && SERIES_EPISODE_COUNTS[item.title]
                    ? { episodeCount: SERIES_EPISODE_COUNTS[item.title] }
                    : {}),
                ...(kind === 'tv' && SERIES_SEASON_EPISODES[item.title]
                    ? { seasonEpisodeCounts: SERIES_SEASON_EPISODES[item.title] }
                    : {}),
                ranking_text: `#${item.rank} in India Today`,
                videoUrl: SAMPLE_VIDEOS[item.rank % SAMPLE_VIDEOS.length],
            };
        }
    };

    const [movieItems, showItems] = await Promise.all([
        Promise.all(movies.map(m => enrich(m, 'movie'))),
        Promise.all(shows.map(s => enrich(s, 'tv'))),
    ]);

    return {
        movieItems,
        showItems,
        extra: [
            {
                rowTitle: 'Popular on Netflix',
                type: 'normal',
                movies: [...movieItems.slice(3), ...showItems.slice(3)],
            },
        ],
    };
}

/** Optional richer path when somebody provides a free TMDB key. */
async function fetchTmdb() {
    const KEY = process.env.TMDB_API_KEY || process.env.EXPO_PUBLIC_TMDB_API_KEY;
    if (!KEY) return null;
    const base = 'https://api.themoviedb.org/3';
    const get = async (path, params = {}) => {
        const url = new URL(`${base}${path}`);
        url.searchParams.set('api_key', KEY);
        url.searchParams.set('language', 'hi-IN');
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TMDB ${res.status}`);
        return res.json();
    };
    const img = (p, s = 'w342') => (p ? `https://image.tmdb.org/t/p/${s}${p}` : '');
    const toMovie = (raw, kind, i = -1) => ({
        id: `${kind}-${raw.id}`,
        imageUrl: img(raw.poster_path) || img(raw.backdrop_path, 'w500'),
        title: raw.title ?? raw.name ?? '',
        type: kind === 'tv' ? 'SERIES' : 'FILM',
        description: raw.overview || undefined,
        year: (raw.release_date ?? raw.first_air_date ?? '').slice(0, 4) || undefined,
        videoUrl: SAMPLE_VIDEOS[raw.id % SAMPLE_VIDEOS.length],
        ...(i >= 0 ? { ranking_text: `#${i + 1} in India Today` } : {}),
    });
    const discover = (kind) => get(`/discover/${kind}`, {
        with_watch_providers: '8', watch_region: 'IN', region: 'IN',
        sort_by: 'popularity.desc', 'vote_count.gte': '50',
    });
    const [m, tv] = await Promise.all([discover('movie'), discover('tv')]);
    if (!(m.results ?? []).length) return null;
    return {
        movieItems: (m.results ?? []).slice(0, 10).map((x, i) => toMovie(x, 'movie', i)),
        showItems: (tv.results ?? []).slice(0, 10).map((x, i) => toMovie(x, 'tv', i)),
        extra: [
            {
                rowTitle: 'Popular on Netflix',
                type: 'normal',
                movies: [
                    ...(m.results ?? []).slice(10, 16).map(x => toMovie(x, 'movie')),
                    ...(tv.results ?? []).slice(10, 16).map(x => toMovie(x, 'tv')),
                ],
            },
        ],
    };
}

const existing = JSON.parse(readFileSync(join(ROOT, 'data/movies.json'), 'utf8'));
const TRAILERS = JSON.parse(readFileSync(join(ROOT, 'data/trailers.json'), 'utf8'));

let data;
try {
    data = await fetchTmdb();
    if (data) console.log('Using TMDB catalog (key found).');
} catch (e) {
    console.log(`TMDB path failed (${e.message}) — falling back to scraping.`);
}

if (!data) {
    data = await scrapeFlixPatrol();
    console.log('Scraped FlixPatrol Netflix India TOP 10 (no API key needed).');
}

const { movieItems, showItems, extra = [] } = data;
if (!movieItems.length && !showItems.length) {
    console.log('Nothing fetched — keeping existing catalog.');
    process.exit(0);
}

const REBUILT = new Set([
    'Top 10 Movies in India Today',
    'Top 10 Series in India Today',
    'Popular on Netflix',
]);
const evergreen = existing.movies.filter(
    r => r.type !== 'games' && r.type !== 'top_10' && !REBUILT.has(r.rowTitle),
);

const rows = [
    { rowTitle: 'Top 10 Movies in India Today', type: 'top_10', movies: movieItems },
    { rowTitle: 'Top 10 Series in India Today', type: 'top_10', movies: showItems },
    ...extra,
    ...evergreen,
].filter(r => r && r.movies?.length);

// Bundle poster art locally (hotlink-proof), then persist the catalog.
await Promise.all(rows.flatMap(r => r.movies).map(savePoster));
writePosterIndex();

writeFileSync(join(ROOT, 'data/movies.json'), JSON.stringify({ movies: rows }, null, 4));
console.log(`Catalog refreshed: ${rows.length} rows (${movieItems.length} movies, ${showItems.length} shows).`);
