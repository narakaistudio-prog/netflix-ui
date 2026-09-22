#!/usr/bin/env node
/**
 * Daily Netflix India catalog refresh.
 *
 * Public discovery needs no key:
 *  1. Crawls a public Netflix availability sitemap and filters India rows
 *  2. Falls back to FlixPatrol's daily India TOP 10 if the broad source fails
 *  3. Reads each discovered title's poster, plot, rating and availability data
 *  4. Optionally enriches titles with OMDb metadata and episode details
 *  5. Rewrites data/movies.json so the bundled catalog never goes stale
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
// Jina's Cloudflare front door can reject a browser-shaped Chrome UA; use its
// neutral reader UA for proxy requests instead of reusing the source headers.
const JINA_HEADERS = { 'user-agent': 'Mozilla/5.0' };
const REQUEST_TIMEOUT_MS = 20_000;
const FULL_SOURCE = 'https://isitinmycountry.com';
// HTTPS-origin reads are more reliable than Jina's HTTP-origin route when the
// public site is behind Cloudflare; keep the HTTP form as a compatibility retry.
const FULL_PROXY_SOURCES = [
    'https://r.jina.ai/https://isitinmycountry.com',
    'https://r.jina.ai/http://isitinmycountry.com',
];
const FULL_PAGE_CONCURRENCY = 8;
const FULL_ROW_SIZE = 48;

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

/** IsItInMyCountry can reject GitHub-hosted IPs; Jina is a public reader fallback. */
function isUsableFullSourceResponse(url, body) {
    const content = String(body || '');
    if (url.endsWith('/sitemap.xml')) return /\/title\//i.test(content);
    // Cloudflare sometimes returns a successful challenge page instead of an
    // HTTP error. Treat that as unavailable so the Jina reader is attempted.
    return /availability by country/i.test(content)
        && !/please enable cookies|worker exceeded resource limits|error 1102/i.test(content);
}

async function getFullSourcePage(url) {
    let directError;
    try {
        const directBody = await getHtml(url);
        if (isUsableFullSourceResponse(url, directBody)) return directBody;
        directError = new Error('direct response was a challenge or empty page');
    } catch (error) {
        directError = error;
    }

    const path = url.replace(/^https?:\/\/isitinmycountry\.com/, '');
    let proxyError;
    for (const proxySource of FULL_PROXY_SOURCES) {
        const proxyUrl = `${proxySource}${path}`;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const response = await fetchWithTimeout(proxyUrl, { headers: JINA_HEADERS });
                if (!response.ok) throw new Error(`proxy HTTP ${response.status}`);
                const proxyBody = await response.text();
                if (isUsableFullSourceResponse(url, proxyBody)) return proxyBody;
                throw new Error('proxy returned a challenge or empty page');
            } catch (error) {
                proxyError = error;
                if (attempt < 2) await sleep(350 * (attempt + 1));
            }
        }
    }
    throw new Error(`direct ${directError.message}; proxy ${proxyError?.message || 'failed'}`);
}

const meta = (html, prop) => {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propertyMatch = html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'));
    const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'));
    return propertyMatch?.[1] ?? nameMatch?.[1];
};

const decodeHtml = (value) => String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

const htmlToText = (html) => decodeHtml(
    html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' '),
);

const OMDB_API_KEY = process.env.OMDB_API_KEY || '';
const OMDB_MAX_REQUESTS = Number.parseInt(process.env.OMDB_MAX_REQUESTS || '900', 10);
let omdbRequests = 0;
const omdbCache = new Map();

/**
 * OMDb is used only to enrich titles already discovered from a public
 * Netflix availability source. It is never required for the key-less fallback.
 */
async function getOmdb(params) {
    if (!OMDB_API_KEY) return null;
    const cacheKey = JSON.stringify(params);
    if (omdbCache.has(cacheKey)) return omdbCache.get(cacheKey);
    if (omdbRequests >= OMDB_MAX_REQUESTS) return null;
    omdbRequests += 1;

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

async function mapConcurrent(items, concurrency, mapper, onProgress) {
    const results = new Array(items.length);
    let cursor = 0;
    let completed = 0;
    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
            completed += 1;
            if (onProgress && (completed % 100 === 0 || completed === items.length)) {
                onProgress(completed, items.length);
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
    );
    return results;
}

function parseFullCatalogTitle(slug, html) {
    const text = htmlToText(html);
    const availabilityStart = text.search(/Availability by Country/i);
    const header = text.slice(0, availabilityStart > 0 ? availabilityStart : 900);
    const indiaStart = text.search(/\bIndia\s+Seasons\b/i);
    if (indiaStart < 0) return null;
    const india = text.slice(indiaStart, indiaStart + 600);
    const details = header.match(/(\d{4})\s*(?:·\s*)?(Series|Movie)\s*(?:·\s*)?([0-9]+(?:\s*(?:min|m|h|hr|hrs|hour|hours)(?:\s+[0-9]+\s*(?:min|m|h|hr|hrs|hour|hours))?)?)/i);
    if (!details) return null;

    const type = details[2].toLowerCase() === 'series' ? 'tv' : 'movie';
    const seasonRange = india.match(/S\s*1\s*[–—-]\s*S?\s*(\d+)/i);
    const headerSeasonCount = header.match(/\b(\d+)\s+Seasons?\b/i)?.[1];
    const seasonCount = seasonRange
        ? Number.parseInt(seasonRange[1], 10)
        : Number.parseInt(headerSeasonCount || '1', 10);
    const episodeMatch = india.match(/([\d,]+)\s+ep\./i);
    const episodeCount = episodeMatch
        ? Number.parseInt(episodeMatch[1].replace(/,/g, ''), 10)
        : undefined;
    const titleFromHeading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
        || html.match(/^Title:\s*(.*?)\s+—/im)?.[1];
    const title = decodeHtml(titleFromHeading || meta(html, 'og:title') || slug.replace(/-/g, ' '))
        .replace(/\s*[|—]\s*Netflix.*$/i, '')
        .trim();
    const runtime = details[3].trim();
    const netflixId = html.match(/netflix\.com\/title\/(\d+)/i)?.[1];
    const markdownPoster = html.match(/!\[[^\]]*poster[^\]]*\]\(([^)]+)\)/i)?.[1]
        || html.match(/!\[Image 1[^\]]*\]\(([^)]+)\)/i)?.[1];
    const metadataLineIndex = html.split(/\r?\n/).findIndex(line => (
        line.includes(details[1]) && new RegExp(`\\b${details[2]}\\b`, 'i').test(line)
    ));
    const markdownDescription = metadataLineIndex >= 0
        ? html.split(/\r?\n/).slice(metadataLineIndex + 1)
            .map(line => line.trim())
            .find(line => line && !line.startsWith('#') && !line.startsWith('!['))
        : undefined;
    const item = {
        id: `iinm-${slug}`,
        title,
        type: type === 'tv' ? 'SERIES' : 'FILM',
        mediaType: type,
        imageUrl: meta(html, 'og:image') || markdownPoster || '',
        description: meta(html, 'og:description') || markdownDescription,
        year: details[1],
        rating: header.match(new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*·)?\\s+${details[1]}(?:\\s*·)?`))?.[1],
        duration: type === 'tv'
            ? `${Math.max(seasonCount || 1, 1)} Season${seasonCount === 1 ? '' : 's'}`
            : runtime,
        ...(type === 'tv' && runtime ? { runtime } : {}),
        ...(episodeCount ? { episodeCount } : {}),
        ...(type === 'tv' && seasonCount === 1 && episodeCount ? { seasonEpisodeCounts: [episodeCount] } : {}),
        ...(netflixId ? { netflix_id: netflixId } : {}),
        videoUrl: SAMPLE_VIDEOS[slug.length % SAMPLE_VIDEOS.length],
    };
    return item;
}

function fullCatalogRows(label, items) {
    return Array.from({ length: Math.ceil(items.length / FULL_ROW_SIZE) }, (_, index) => {
        const start = index * FULL_ROW_SIZE;
        const end = Math.min(start + FULL_ROW_SIZE, items.length);
        return {
            rowTitle: `${label} ${start + 1}–${end}`,
            type: 'normal',
            movies: items.slice(start, end),
        };
    });
}

/**
 * Broad public discovery path. IsItInMyCountry publishes a sitemap of title
 * pages and each page includes an India availability row. It is not an
 * official Netflix API, but it is materially broader than a Top 10 chart.
 */
async function scrapeFullPublicCatalog() {
    const sitemap = await getFullSourcePage(`${FULL_SOURCE}/sitemap.xml`);
    const xmlSlugs = [...sitemap.matchAll(/<loc>\s*https?:\/\/isitinmycountry\.com\/title\/([^<\s/]+)\/?\s*<\/loc>/gi)]
        .map(match => match[1]);
    const markdownSlugs = [...sitemap.matchAll(/\]\(https?:\/\/isitinmycountry\.com\/title\/([^)]*)\)/gi)]
        .map(match => match[1].replace(/\/$/, ''));
    const slugs = [...xmlSlugs, ...markdownSlugs]
        .filter((slug, index, all) => slug && all.indexOf(slug) === index);
    if (slugs.length < 500) throw new Error(`full sitemap too small (${slugs.length} titles)`);

    let pageFailures = 0;
    const pages = await mapConcurrent(
        slugs,
        FULL_PAGE_CONCURRENCY,
        async slug => {
            try {
                return { ok: true, item: parseFullCatalogTitle(slug, await getFullSourcePage(`${FULL_SOURCE}/title/${slug}`)) };
            } catch {
                pageFailures += 1;
                return { ok: false, item: null };
            }
        },
        (completed, total) => console.log(`Full catalog pages: ${completed}/${total}`),
    );
    const fetched = pages.length - pageFailures;
    const items = pages.map(page => page.item).filter(Boolean);
    const movies = items.filter(item => item.mediaType === 'movie');
    const shows = items.filter(item => item.mediaType === 'tv');
    console.log(`Full catalog source: ${slugs.length} sitemap titles, ${fetched} pages fetched, ${items.length} India titles parsed.`);
    if (fetched < slugs.length * 0.60 || movies.length < 100 || shows.length < 30) {
        throw new Error(`full catalog incomplete (${items.length} India titles, ${fetched}/${slugs.length} pages)`);
    }

    // The public page has title-level metadata. Spend the server-side OMDb
    // budget mainly on series so season/episode details can be filled in.
    let seriesEnriched = 0;
    const enriched = await mapConcurrent(
        items,
        6,
        async item => {
            const shouldEnrich = Boolean(OMDB_API_KEY)
                && (item.mediaType === 'tv' || !item.rating || !item.description)
                && (item.mediaType !== 'tv' || seriesEnriched++ < 300);
            if (!shouldEnrich) return item;
            const omdb = await getOmdbMetadata(item, item.mediaType);
            return {
                ...item,
                ...omdb,
                // Netflix artwork/plot is the discovery source of truth.
                imageUrl: item.imageUrl || omdb.imageUrl || '',
                description: item.description || omdb.description,
                rating: item.rating || omdb.rating,
            };
        },
        (completed, total) => console.log(`OMDb enrichment: ${completed}/${total}`),
    );
    const fullMovies = enriched.filter(item => item.mediaType === 'movie');
    const fullShows = enriched.filter(item => item.mediaType === 'tv');
    return {
        source: 'isitinmycountry',
        movieItems: fullMovies,
        showItems: fullShows,
        rows: [
            ...fullCatalogRows('Netflix India Movies', fullMovies),
            ...fullCatalogRows('Netflix India Series', fullShows),
        ],
        extra: [],
    };
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
const useFullSource = process.env.CATALOG_DISCOVERY !== 'top10';
if (useFullSource) {
    try {
        data = await scrapeFullPublicCatalog();
        console.log(`Discovered ${data.movieItems.length} movies and ${data.showItems.length} India titles from the public full catalog.`);
    } catch (error) {
        console.log(`Full public catalog unavailable (${error.message}) — trying the daily Top 10.`);
    }
}
if (!data) {
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
}

const {
    movieItems: discoveredMovies = [],
    showItems: discoveredShows = [],
    extra = [],
    rows: discoveredRows,
} = data;
const isFullCatalog = Array.isArray(discoveredRows);
const previousMovies = existing.movies.find(r => r.rowTitle === 'Top 10 Movies in India Today')?.movies ?? [];
const previousShows = existing.movies.find(r => r.rowTitle === 'Top 10 Series in India Today')?.movies ?? [];
const movieItems = isFullCatalog || discoveredMovies.length ? discoveredMovies : previousMovies;
const showItems = isFullCatalog || discoveredShows.length ? discoveredShows : previousShows;
if (!movieItems.length && !showItems.length) {
    console.log('Nothing fetched and no previous catalog exists — keeping files unchanged.');
    process.exit(0);
}
if (!isFullCatalog && (!discoveredMovies.length || !discoveredShows.length)) {
    console.log('Discovery returned only one chart; carrying forward the missing chart from the previous catalog.');
}

const REBUILT = new Set([
    'Top 10 Movies in India Today',
    'Top 10 Series in India Today',
    'Popular on Netflix',
]);
const isRebuiltRow = row => REBUILT.has(row.rowTitle)
    || /^Netflix India (Movies|Series) \d+[–-]\d+$/.test(row.rowTitle);
const evergreen = existing.movies.filter(
    r => r.type !== 'games' && r.type !== 'top_10' && !isRebuiltRow(r),
);
const sourceRows = discoveredRows ?? [
    { rowTitle: 'Top 10 Movies in India Today', type: 'top_10', movies: movieItems },
    { rowTitle: 'Top 10 Series in India Today', type: 'top_10', movies: showItems },
];

const rows = [
    ...sourceRows,
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
