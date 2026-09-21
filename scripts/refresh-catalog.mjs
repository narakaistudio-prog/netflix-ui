#!/usr/bin/env node
/**
 * Daily Netflix India catalog refresh.
 *
 * Public discovery needs no key:
 *  1. Scrapes FlixPatrol's "TOP 10 on Netflix in India" (updated daily)
 *  2. Fetches each title's page for its poster (og:image) and description
 *  3. Optionally enriches discovered titles with OMDb metadata
 *  4. Rewrites data/movies.json so the bundled catalog never goes stale
 *
 * OMDb is an optional server-side enricher; the public discovery fallback
 * always remains available.
 *
 * Usage: node scripts/refresh-catalog.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const REQUEST_TIMEOUT_MS = 20_000;

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
    'WWE SmackDown': 1419,
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
    'WWE SmackDown': [19, 52, 52, 52, 52, 53, 52, 52, 52, 52, 52, 53, 52, 52, 52, 52, 53, 52, 52, 52, 52, 52, 53, 52, 52, 52, 52, 44],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const POSTERS_DIR = join(ROOT, 'assets', 'posters');

/**
 * Poster hosts (FlixPatrol cache, etc.) block browser hotlinking with 403s,
 * so poster art is downloaded into the repo and referenced as `local:<id>`.
 * The app bundles these files — posters can never break again.
 */
async function savePoster(item, fallbackImageUrl = '') {
    const src = item.imageUrl || '';
    if (!/^https?:\/\//.test(src) || !/^(fp|movie|tv)-/.test(item.id)) {
        if (fallbackImageUrl) item.imageUrl = fallbackImageUrl;
        return;
    }
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
            const posterFilename = `${item.id}.${ext}`;
            writeFileSync(join(POSTERS_DIR, posterFilename), buf);
            // Remove an older extension for this same title so the generated
            // poster index never contains duplicate keys with random ordering.
            for (const filename of readdirSync(POSTERS_DIR)) {
                if (filename.startsWith(`${item.id}.`) && filename !== posterFilename) {
                    unlinkSync(join(POSTERS_DIR, filename));
                }
            }
            item.imageUrl = `local:${item.id}`;
            return;
        } catch (e) {
            console.log(`poster attempt failed for ${item.id} (${e.message})`);
        }
    }
    const kept = existsSync(POSTERS_DIR)
        && readdirSync(POSTERS_DIR).some(f => f.startsWith(`${item.id}.`));
    if (kept) item.imageUrl = `local:${item.id}`;
    else if (fallbackImageUrl) item.imageUrl = fallbackImageUrl;
    else console.log(`poster download failed for ${item.id} — keeping remote URL`);
}

/** Rewrite assets/posters/index.ts so the bundle always ships every poster. */
function writePosterIndex() {
    if (!existsSync(POSTERS_DIR)) return;

    const files = [];
    const walk = (directory, relativeDirectory = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolute = join(directory, entry.name);
            const relative = join(relativeDirectory, entry.name).replaceAll('\\', '/');
            const isPoster = ['.jpg', '.jpeg', '.png', '.webp']
                .some(extension => entry.name.toLowerCase().endsWith(extension));
            if (entry.isDirectory()) walk(absolute, relative);
            else if (isPoster) files.push({ absolute, relative });
        }
    };
    walk(POSTERS_DIR);
    files.sort((a, b) => a.relative.localeCompare(b.relative));

    const aliases = new Map();
    for (const file of files) {
        const basename = file.relative
            .slice(file.relative.lastIndexOf('/') + 1)
            .replace(/\.[^.]+$/, '');
        // The catalog uses local:<filename-without-extension>. If two folders
        // ever contain the same basename, the first deterministic entry wins.
        if (!aliases.has(basename)) aliases.set(basename, file);
    }

    const uriEntries = [...aliases.entries()]
        .flatMap(([key, file]) => [
            `    ${JSON.stringify(key)}: ${JSON.stringify(`/assets/posters/${file.relative}`)},`,
            `    ${JSON.stringify(`local:${key}`)}: ${JSON.stringify(`/assets/posters/${file.relative}`)},`,
        ])
        .join('\n');
    const nativeEntries = [...aliases.entries()]
        .flatMap(([key, file]) => [
            `    ${JSON.stringify(key)}: require(${JSON.stringify(`./${file.relative}`)}),`,
            `    ${JSON.stringify(`local:${key}`)}: require(${JSON.stringify(`./${file.relative}`)}),`,
        ])
        .join('\n');

    const output = [
        '/**',
        ' * Poster art bundled with the app, keyed by catalog id.',
        ' *',
        ' * Catalog JSON references these via local:<id> imageUrl values so posters',
        ' * always load from the app bundle — third-party poster hosts block hotlinking',
        ' * and would render broken cards. The refresh script rewrites this map',
        ' * whenever it downloads fresh poster art.',
        ' */',
        "import { Platform, ImageSourcePropType } from 'react-native';",
        '',
        'export const LOCAL_POSTER_URIS: Record<string, string> = {',
        uriEntries,
        '};',
        '',
        'export const LOCAL_POSTERS: Record<string, ImageSourcePropType> = {',
        nativeEntries,
        '};',
        '',
        'export function getLocalPoster(key?: string | number): any {',
        '    if (!key) return undefined;',
        '    const strKey = String(key).trim();',
        "    const cleanKey = strKey.replace(/^local:/, '');",
        '',
        "    if (Platform.OS === 'web') {",
        '        const uri =',
        '            LOCAL_POSTER_URIS[strKey] ||',
        '            LOCAL_POSTER_URIS[cleanKey] ||',
        "            LOCAL_POSTER_URIS['real-' + cleanKey] ||",
        "            LOCAL_POSTER_URIS['movie-' + cleanKey] ||",
        "            LOCAL_POSTER_URIS['tv-' + cleanKey] ||",
        "            LOCAL_POSTER_URIS['billboard-' + cleanKey];",
        '        if (uri) return { uri };',
        '    }',
        '',
        '    return (',
        '        LOCAL_POSTERS[strKey] ||',
        '        LOCAL_POSTERS[cleanKey] ||',
        "        LOCAL_POSTERS['real-' + cleanKey] ||",
        "        LOCAL_POSTERS['movie-' + cleanKey] ||",
        "        LOCAL_POSTERS['tv-' + cleanKey] ||",
        "        LOCAL_POSTERS['billboard-' + cleanKey]",
        '    );',
        '}',
    ].join('\n');

    writeFileSync(join(POSTERS_DIR, 'index.ts'), `${output}\n`);
}

if (process.argv.includes('--rebuild-poster-index')) {
    writePosterIndex();
    console.log('Poster index rebuilt.');
    process.exit(0);
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function getHtml(url) {
    const res = await fetchWithTimeout(url, { headers: UA, redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.text();
}

const meta = (html, prop) => {
    const m = html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`))
        ?? html.match(new RegExp(`<meta[^>]+name="${prop}"[^>]+content="([^"]*)"`));
    return m ? m[1] : undefined;
};

const OMDB_API_KEY = process.env.OMDB_API_KEY || '';
const omdbCache = new Map();

/**
 * OMDb is used only to enrich titles already discovered from the public
 * Netflix/FlixPatrol source. It is never required for the key-less fallback.
 */
async function getOmdb(params) {
    if (!OMDB_API_KEY) return null;
    const cacheKey = JSON.stringify(params);
    if (omdbCache.has(cacheKey)) return omdbCache.get(cacheKey);

    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', OMDB_API_KEY);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`OMDb HTTP ${response.status}`);
    const payload = await response.json();
    const result = payload.Response === 'False' ? null : payload;
    omdbCache.set(cacheKey, result);
    return result;
}

const firstYear = (value) => {
    const match = String(value || '').match(/\d{4}/);
    return match ? match[0] : undefined;
};

const parseNumber = (value) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
};

async function getOmdbMetadata(item, kind) {
    if (!OMDB_API_KEY) return {};

    try {
        const detail = await getOmdb({
            t: item.title,
            type: kind === 'tv' ? 'series' : 'movie',
            plot: 'full',
        });
        if (!detail) return {};

        const metadata = {
            ...(detail.imdbID ? { imdb_id: detail.imdbID } : {}),
            ...(detail.Poster && detail.Poster !== 'N/A' ? { imageUrl: detail.Poster } : {}),
            ...(firstYear(detail.Year) ? { year: firstYear(detail.Year) } : {}),
            ...(detail.Plot && detail.Plot !== 'N/A' ? { description: detail.Plot } : {}),
            ...(detail.Actors && detail.Actors !== 'N/A'
                ? { cast: detail.Actors.split(',').map(value => value.trim()).filter(Boolean) }
                : {}),
            ...(detail.Director && detail.Director !== 'N/A' ? { director: detail.Director } : {}),
            ...(detail.imdbRating && detail.imdbRating !== 'N/A'
                ? { rating: detail.imdbRating }
                : detail.Rated && detail.Rated !== 'N/A'
                    ? { rating: detail.Rated }
                    : {}),
            ...(detail.Rated && detail.Rated !== 'N/A' ? { rated: detail.Rated } : {}),
        };

        if (kind === 'tv') {
            const totalSeasons = parseNumber(detail.totalSeasons);
            if (totalSeasons) {
                metadata.duration = `${totalSeasons} Season${totalSeasons === 1 ? '' : 's'}`;
            }
            if (detail.Runtime && detail.Runtime !== 'N/A') {
                metadata.runtime = detail.Runtime;
            }

            if (detail.imdbID && totalSeasons) {
                const seasonResults = await Promise.all(
                    Array.from({ length: totalSeasons }, (_, index) => (
                        getOmdb({ i: detail.imdbID, Season: index + 1 })
                    )),
                );
                const seasons = seasonResults.map((season, seasonIndex) => {
                    const episodes = Array.isArray(season?.Episodes)
                        ? season.Episodes.map((episode, episodeIndex) => ({
                            season: seasonIndex + 1,
                            episode: parseNumber(episode.Episode) ?? episodeIndex + 1,
                            name: episode.Title && episode.Title !== 'N/A'
                                ? episode.Title
                                : `Episode ${episodeIndex + 1}`,
                        }))
                        : [];
                    return {
                        season_number: seasonIndex + 1,
                        name: `Season ${seasonIndex + 1}`,
                        episode_count: episodes.length,
                        ...(episodes.length ? { episodes } : {}),
                    };
                });
                const seasonEpisodeCounts = seasons.map(season => season.episode_count);
                if (seasonEpisodeCounts.some(Boolean)) {
                    metadata.seasons = seasons.filter(season => season.episode_count > 0);
                    metadata.seasonEpisodeCounts = seasonEpisodeCounts;
                    metadata.episodeCount = seasonEpisodeCounts.reduce((sum, count) => sum + count, 0);
                }
            }
        } else if (detail.Runtime && detail.Runtime !== 'N/A') {
            metadata.duration = detail.Runtime;
        }

        return metadata;
    } catch (error) {
        console.log(`OMDb enrichment skipped for ${item.title} (${error.message})`);
        return {};
    }
}

/** Scrape today's Netflix India top 10 (movies + TV shows). */
async function scrapeFlixPatrol() {
    const html = await getHtml('https://flixpatrol.com/top10/netflix/india/');
    const lowerHtml = html.toLowerCase();
    const decodeHtml = (value) => value
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();

    const parseSection = (headers) => {
        const starts = headers
            .map(header => lowerHtml.indexOf(header.toLowerCase()))
            .filter(index => index >= 0)
            .sort((a, b) => a - b);
        const start = starts[0];
        if (start === undefined) return [];

        const remaining = html.slice(start);
        const tableOffset = remaining.search(/<table\b/i);
        if (tableOffset < 0) return [];
        const tableStart = start + tableOffset;
        const tableEndOffset = html.slice(tableStart).search(/<\/table>/i);
        if (tableEndOffset < 0) return [];
        const table = html.slice(tableStart, tableStart + tableEndOffset);
        const rows = [...table.matchAll(/<a\b[^>]*href=["']\/title\/([^/"']+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi)];
        const seen = new Set();
        return rows
            .map(match => ({ slug: match[1], title: decodeHtml(match[2]) }))
            .filter(item => item.title && !seen.has(item.slug) && seen.add(item.slug))
            .slice(0, 10)
            .map((item, index) => ({ ...item, rank: index + 1 }));
    };

    const movies = parseSection(['TOP 10 Movies', 'TOP 10 Films']);
    const shows = parseSection(['TOP 10 TV Shows', 'TOP 10 Series']);
    if (!movies.length && !shows.length) throw new Error('no tables parsed');

    const enrich = async (item, kind) => {
        const omdb = await getOmdbMetadata(item, kind);
        const knownSeasonData = kind === 'tv' && SERIES_SEASON_EPISODES[item.title]
            ? { seasonEpisodeCounts: SERIES_SEASON_EPISODES[item.title] }
            : {};
        const knownEpisodeData = kind === 'tv' && SERIES_EPISODE_COUNTS[item.title]
            ? { episodeCount: SERIES_EPISODE_COUNTS[item.title] }
            : {};

        try {
            const page = await getHtml(`https://flixpatrol.com/title/${item.slug}/`);
            await sleep(300);
            return {
                id: `fp-${item.slug}`,
                title: item.title,
                type: kind === 'tv' ? 'SERIES' : 'FILM',
                mediaType: kind,
                ...omdb,
                // Curated mappings are the source of truth for audited series;
                // OMDb still fills every unknown title automatically.
                ...knownEpisodeData,
                ...knownSeasonData,
                imageUrl: meta(page, 'og:image') ?? omdb.imageUrl ?? '',
                description: meta(page, 'og:description') ?? omdb.description,
                ranking_text: `#${item.rank} in India Today`,
                youtubeId: TRAILERS[item.slug] || undefined,
                videoUrl: SAMPLE_VIDEOS[item.rank % SAMPLE_VIDEOS.length],
            };
        } catch {
            return {
                id: `fp-${item.slug}`,
                title: item.title,
                type: kind === 'tv' ? 'SERIES' : 'FILM',
                mediaType: kind,
                ...omdb,
                // Keep audited mappings ahead of external guesses.
                ...knownEpisodeData,
                ...knownSeasonData,
                imageUrl: omdb.imageUrl ?? '',
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

const existing = JSON.parse(readFileSync(join(ROOT, 'data/movies.json'), 'utf8'));
const TRAILERS = JSON.parse(readFileSync(join(ROOT, 'data/trailers.json'), 'utf8'));

let data;
try {
    data = await scrapeFlixPatrol();
    console.log('Scraped FlixPatrol Netflix India TOP 10 (no API key needed).');
} catch (error) {
    // A temporary block, DNS failure, or changed HTML must never erase the
    // last known-good catalog. Exiting successfully also keeps the daily
    // GitHub Action green while the next run retries discovery.
    console.log(`Public discovery unavailable (${error.message}) — keeping existing catalog.`);
    process.exit(0);
}

const {
    movieItems: discoveredMovies = [],
    showItems: discoveredShows = [],
    extra = [],
} = data;
const previousMovies = existing.movies.find(r => r.rowTitle === 'Top 10 Movies in India Today')?.movies ?? [];
const previousShows = existing.movies.find(r => r.rowTitle === 'Top 10 Series in India Today')?.movies ?? [];
const movieItems = discoveredMovies.length ? discoveredMovies : previousMovies;
const showItems = discoveredShows.length ? discoveredShows : previousShows;
if (!movieItems.length && !showItems.length) {
    console.log('Nothing fetched and no previous catalog exists — keeping files unchanged.');
    process.exit(0);
}
if (!discoveredMovies.length || !discoveredShows.length) {
    console.log('Discovery returned only one chart; carrying forward the missing chart from the previous catalog.');
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

// If today's source omits artwork or blocks a download, reuse a bundled poster
// from the last successful catalog for the same title before falling back to a
// remote URL. This keeps cards and episode thumbnails non-blank.
const normalizeTitle = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const previousArtwork = new Map();
for (const item of existing.movies.flatMap(r => r.movies ?? [])) {
    if (!item.title || !item.imageUrl) continue;
    const key = normalizeTitle(item.title);
    const oldImage = previousArtwork.get(key);
    // Prefer a bundled asset over an older remote URL when duplicates exist.
    if (!oldImage || String(item.imageUrl).startsWith('local:')) {
        previousArtwork.set(key, item.imageUrl);
    }
}
const allItems = rows.flatMap(r => r.movies);

// Bundle poster art locally (hotlink-proof), then persist the catalog.
await Promise.all(allItems.map(item => (
    savePoster(item, previousArtwork.get(normalizeTitle(item.title)))
)));
writePosterIndex();

writeFileSync(join(ROOT, 'data/movies.json'), JSON.stringify({ movies: rows }, null, 4));
console.log(`Catalog refreshed: ${rows.length} rows (${movieItems.length} movies, ${showItems.length} shows).`);
