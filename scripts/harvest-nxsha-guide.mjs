#!/usr/bin/env node
/**
 * Harvest the Nxsha season/episode guide (names, stills, synopsis, dates, runtimes).
 *
 * Add every Crunchyroll catalog key to data/nxsha-titles.json with its Nxsha page
 * ID and kind. This script discovers TV targets from that registry on every run,
 * syncs new entries into the verification plan, and updates the baked guide.
 *
 * Usage: node scripts/harvest-nxsha-guide.mjs [--check] [--only k1,k2] [--merge]
 *   --check   verify the harvest without writing any files.
 *   --only    refresh just the listed catalog keys (debugging a single show).
 *   --merge   keep guide entries that were not harvested this run.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TITLES_PATH = resolve(ROOT, 'data', 'nxsha-titles.json');
const PLAN_PATH = resolve(ROOT, 'data', 'nxsha-plan.json');
const CATALOG_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const EPISODES_PATH = resolve(ROOT, 'data', 'nxsha-episodes.json');
const REPORT_PATH = resolve(ROOT, 'data', 'nxsha-harvest-report.json');
const BASE_URL = 'https://nxsha.space';
const USER_AGENT = 'Mozilla/5.0 (compatible; NxshaEpisodeGuideHarvester/1.0)';
const REQUEST_TIMEOUT_MS = 25_000;
const REQUEST_DELAY_MS = 120;
const MAX_RETRIES = 4;
const MANIFEST_COMMENT = 'Nxsha route registry for the Crunchyroll catalog. When adding a title, add its catalog key here with the Nxsha page id, title, and kind; daily refresh discovers every TV entry, syncs the verification plan, and bakes episode metadata.';
const PLAN_COMMENT = 'Nxsha verification plan synchronized from data/nxsha-titles.json. New catalog routes are added automatically; TV season maps are sourced from Nxsha season API responses.';

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function decodeEntities(value) {
    return String(value || '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripMarkup(value) {
    return decodeEntities(String(value || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeTitle(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '');
}

function titlesMatch(actual, expected) {
    const actualTokens = normalizeTitle(actual).match(/[a-z0-9]+/g) || [];
    const expectedTokens = normalizeTitle(expected).match(/[a-z0-9]+/g) || [];
    if (!actualTokens.length || !expectedTokens.length) return false;
    const matches = expectedTokens.filter((token) => actualTokens.some((candidate) => (
        candidate === token || (token.length > 5 && candidate.startsWith(token.slice(0, 5)))
    )));
    return matches.length / expectedTokens.length >= 0.6;
}

/** Return all top-level titles in the Crunchyroll page's `shows` catalog. */
export function parseCrunchyrollCatalog(html) {
    const source = String(html || '');
    const start = source.indexOf('var shows={');
    const end = source.indexOf('\n      };', start);
    if (start === -1 || end === -1) throw new Error('Could not find the Crunchyroll shows catalog');
    const body = source.slice(start, end);
    const matches = [...body.matchAll(/^[ \t]{8}([A-Za-z_$][A-Za-z0-9_$]*):\{title:'((?:\\.|[^'\\])*)'/gm)];
    if (!matches.length) throw new Error('Could not parse any titles from the Crunchyroll shows catalog');
    return matches.map((match) => ({
        key: match[1],
        title: match[2].replace(/\\(['\\])/g, '$1'),
    }));
}

/** Fail instead of silently skipping a new catalog title without an Nxsha ID. */
export function assertCatalogRoutes(catalog, manifest) {
    const missing = catalog.filter(({ key }) => !manifest[key]);
    if (missing.length) {
        const list = missing.map(({ key, title }) => `${key} (${title})`).join(', ');
        throw new Error(`Crunchyroll catalog titles missing an Nxsha route in data/nxsha-titles.json: ${list}. Add each new title's Nxsha page id and kind so the daily harvester can refresh it.`);
    }
    return true;
}

/** Resolve title page metadata and the internal TMDB id used by Nxsha's API. */
export function parseNxshaSeriesPage(html, expectedTitle) {
    const source = String(html || '');
    const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
    const h1Tag = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source);
    const actualTitle = stripMarkup(h1Tag?.[1] || (titleTag?.[1] || '').replace(/\s*\([^)]*\).*$/, ''));
    const pageText = stripMarkup(source);
    const seasonMatch = /\b(\d{1,2})\s+seasons?\b/i.exec(pageText);
    const seasonCount = seasonMatch ? Number.parseInt(seasonMatch[1], 10) : 0;
    const playLink = /(?:href|data-href)\s*=\s*["'](?:https?:\/\/nxsha\.space)?\/watch\/tv\/(\d+)\/(\d+)\/(\d+)["']/i.exec(source);
    const tmdbId = playLink && Number(playLink[2]) === 1 && Number(playLink[3]) === 1
        ? playLink[1]
        : '';
    if (!actualTitle || !titlesMatch(actualTitle, expectedTitle)) {
        throw new Error(`Nxsha title mismatch: expected "${expectedTitle}", got "${actualTitle || 'unknown'}"`);
    }
    if (!tmdbId) throw new Error(`Could not resolve Nxsha TMDB id for "${expectedTitle}"`);
    if (!seasonCount || seasonCount > 50) {
        throw new Error(`Could not read a valid season count for "${expectedTitle}" (found ${seasonCount || 'none'})`);
    }
    return { title: actualTitle, tmdbId, seasonCount };
}

/** Normalize one response from Nxsha's /api/tv/{id}/season/{season} endpoint. */
export function parseNxshaSeason(response, requestedSeason) {
    if (!response || response.success !== true || !response.season || !Array.isArray(response.episodes)) {
        throw new Error(response?.message || `Nxsha season ${requestedSeason} was not returned`);
    }
    const seasonNumber = Number(response.season.season_number);
    if (seasonNumber !== Number(requestedSeason)) {
        throw new Error(`Nxsha returned season ${seasonNumber} for requested season ${requestedSeason}`);
    }
    const episodes = response.episodes
        .filter((episode) => Number.isInteger(Number(episode.episode_number)) && Number(episode.episode_number) > 0)
        .map((episode) => {
            const stillPath = String(episode.still_path || '').trim();
            const image = /^https?:\/\//i.test(stillPath)
                ? stillPath
                : stillPath
                    ? `https://image.tmdb.org/t/p/w780${stillPath.startsWith('/') ? '' : '/'}${stillPath}`
                    : '';
            return {
                season: seasonNumber,
                episode: Number(episode.episode_number),
                ...(episode.name ? { title: String(episode.name).trim() } : {}),
                ...(episode.overview ? { overview: stripMarkup(episode.overview) } : {}),
                ...(image ? { image } : {}),
                ...(episode.air_date ? { airDate: String(episode.air_date) } : {}),
                ...(Number.isFinite(Number(episode.runtime)) && Number(episode.runtime) > 0
                    ? { runtime: Number(episode.runtime) }
                    : {}),
            };
        })
        .sort((a, b) => a.episode - b.episode);
    const declaredCount = Number(response.season.episode_count) || episodes.length;
    if (!episodes.length && Number(response.season.episode_count) === 0) {
        return {
            season: seasonNumber,
            count: 0,
            name: String(response.season.name || `Season ${seasonNumber}`),
            overview: stripMarkup(response.season.overview || ''),
            episodes: [],
        };
    }
    if (!episodes.length) throw new Error(`Nxsha season ${seasonNumber} returned no episodes`);
    // Long-running shows often declare the TMDB count but return a slightly
    // different list; the returned episodes are the ones that exist.
    if (declaredCount !== episodes.length) {
        console.warn(`Nxsha season ${seasonNumber} declared ${declaredCount} episodes but returned ${episodes.length}; using the returned list`);
    }
    return {
        season: seasonNumber,
        count: episodes.length,
        name: String(response.season.name || `Season ${seasonNumber}`),
        overview: stripMarkup(response.season.overview || ''),
        episodes,
    };
}

async function get(url, expectJson = false) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                redirect: 'follow',
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: expectJson ? 'application/json,text/plain,*/*' : 'text/html,application/xhtml+xml,*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });
            const text = await response.text();
            if (response.ok) {
                clearTimeout(timeout);
                await sleep(REQUEST_DELAY_MS);
                return expectJson ? JSON.parse(text) : text;
            }
            lastError = new Error(`HTTP ${response.status} for ${url}`);
            if (response.status < 500 && response.status !== 429) break;
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timeout);
        }
        if (attempt < MAX_RETRIES) await sleep(350 * (attempt + 1));
    }
    throw lastError || new Error(`Request failed for ${url}`);
}

async function harvestTitle(key, entry) {
    const page = await get(`${BASE_URL}/tv/${encodeURIComponent(String(entry.id))}`);
    const show = parseNxshaSeriesPage(page, entry.title);
    const seasons = {};
    const episodes = [];
    const seasonDetails = [];
    const emptySeasons = [];
    for (let seasonNumber = 1; seasonNumber <= show.seasonCount; seasonNumber += 1) {
        const response = await get(
            `${BASE_URL}/api/tv/${show.tmdbId}/season/${seasonNumber}`,
            true,
        );
        const season = parseNxshaSeason(response, seasonNumber);
        if (season.count === 0) {
            emptySeasons.push(seasonNumber);
            continue;
        }
        seasons[String(seasonNumber)] = season.count;
        seasonDetails.push({
            season: seasonNumber,
            name: season.name,
            count: season.count,
            ...(season.overview ? { overview: season.overview } : {}),
        });
        episodes.push(...season.episodes);
    }
    return {
        key,
        show: {
            id: show.tmdbId,
            title: show.title,
            seasons,
            seasonDetails,
            episodes,
        },
        emptySeasons,
    };
}

function syncPlan(plan, manifest) {
    const rows = Array.isArray(plan.titles) ? plan.titles : [];
    const rowsByKey = new Map(rows.map((row) => [row.key, row]));
    for (const [key, title] of Object.entries(manifest)) {
        if (key.startsWith('_') || !title || !['tv', 'movie'].includes(title.kind)) continue;
        let row = rowsByKey.get(key);
        if (!row) {
            row = { key };
            rows.push(row);
            rowsByKey.set(key, row);
        }
        row.title = title.title;
        row.kind = title.kind;
        row.id = title.id;
        if (title.seasons && Object.keys(title.seasons).length) row.seasons = title.seasons;
    }
    plan.titles = rows;
    return plan;
}

function selfTest() {
    const page = `<!doctype html><html><head><title>JUJUTSU KAISEN (2020) - Watch TV Series Online Free | Nxsha</title></head><body><h1>JUJUTSU KAISEN</h1><div>Series 8.6 Oct 3, 2020 1 season Returning Series</div><a href="/watch/tv/95479/1/1">Play Episode 1</a></body></html>`;
    assert.deepEqual(parseNxshaSeriesPage(page, 'JUJUTSU KAISEN'), {
        title: 'JUJUTSU KAISEN',
        tmdbId: '95479',
        seasonCount: 1,
    });
    const season = parseNxshaSeason({
        success: true,
        season: { season_number: 1, episode_count: 1, name: 'Season 1', overview: '' },
        episodes: [{
            season_number: 1,
            episode_number: 1,
            name: 'Ryomen Sukuna',
            overview: 'Yuji &amp; his friends.',
            runtime: 24,
            air_date: '2020-10-03',
            still_path: '/abc123.jpg',
        }],
    }, 1);
    assert.equal(season.count, 1);
    assert.deepEqual(season.episodes[0], {
        season: 1,
        episode: 1,
        title: 'Ryomen Sukuna',
        overview: 'Yuji & his friends.',
        image: 'https://image.tmdb.org/t/p/w780/abc123.jpg',
        airDate: '2020-10-03',
        runtime: 24,
    });
    const emptySeason = parseNxshaSeason({
        success: true,
        season: { season_number: 2, episode_count: 0, name: 'Season 2', overview: '' },
        episodes: [],
    }, 2);
    assert.deepEqual(emptySeason, {
        season: 2,
        count: 0,
        name: 'Season 2',
        overview: '',
        episodes: [],
    });

    const catalog = parseCrunchyrollCatalog(`var shows={\n        future:{title:'Future Anime',year:2030},\n      };`);
    assert.deepEqual(catalog, [{ key: 'future', title: 'Future Anime' }]);
    assert.throws(() => assertCatalogRoutes(catalog, {}), /missing an Nxsha route.*future/i);
    assert.equal(assertCatalogRoutes(catalog, { future: { id: '12345' } }), true);

    const futurePlan = syncPlan({ titles: [{ key: 'legacy', seasons: { '1': 31 } }] }, {
        future: { id: '12345', kind: 'tv', title: 'Future Anime', seasons: { '1': 4 } },
        futureMovie: { id: '67890', kind: 'movie', title: 'Future Film', seasons: { '1': 1 } },
        onepiece: { id: '37854', kind: 'tv', title: 'One Piece', seasons: { '1': 55 } },
    });
    assert.deepEqual(futurePlan.titles, [
        { key: 'legacy', seasons: { '1': 31 } },
        { key: 'future', title: 'Future Anime', kind: 'tv', id: '12345', seasons: { '1': 4 } },
        { key: 'futureMovie', title: 'Future Film', kind: 'movie', id: '67890', seasons: { '1': 1 } },
        { key: 'onepiece', title: 'One Piece', kind: 'tv', id: '37854', seasons: { '1': 55 } },
    ]);
    console.log('harvest-nxsha-guide self-tests passed');
}

function cliList(flag, envName) {
    const at = process.argv.indexOf(flag);
    const raw = at !== -1 ? process.argv[at + 1] : process.env[envName];
    return String(raw || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

async function main() {
    const checkOnly = process.argv.includes('--check');
    const merge = process.argv.includes('--merge') || process.env.NX_GUIDE_MERGE === '1';
    const only = new Set(cliList('--only', 'NX_GUIDE_ONLY'));
    const manifest = JSON.parse(readFileSync(TITLES_PATH, 'utf8'));
    const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
    const catalog = parseCrunchyrollCatalog(readFileSync(CATALOG_PATH, 'utf8'));
    assertCatalogRoutes(catalog, manifest);
    manifest._comment = MANIFEST_COMMENT;
    plan._comment = PLAN_COMMENT;
    const previous = readFileSync(EPISODES_PATH, 'utf8');
    const previousShows = merge ? (JSON.parse(previous).shows || {}) : {};
    const shows = {};
    const results = [];
    const targetTitles = Object.entries(manifest)
        .filter(([key, entry]) => !key.startsWith('_') && entry.kind === 'tv' && (!only.size || only.has(key)));

    console.log(`Harvesting ${targetTitles.length} Nxsha series${only.size ? ` (${[...only].join(', ')})` : ''}.`);
    for (const [key, entry] of targetTitles) {
        try {
            const result = await harvestTitle(key, entry);
            shows[key] = result.show;
            manifest[key].seasons = result.show.seasons;
            results.push({
                key,
                title: result.show.title,
                id: result.show.id,
                seasons: result.show.seasons,
                ...(result.emptySeasons.length ? { emptySeasons: result.emptySeasons } : {}),
                episodes: result.show.episodes.length,
                stills: result.show.episodes.filter((episode) => episode.image).length,
                overviews: result.show.episodes.filter((episode) => episode.overview).length,
                ok: true,
            });
            const emptyNote = result.emptySeasons.length ? ` / ${result.emptySeasons.length} empty season placeholder(s) skipped` : '';
            console.log(`OK   ${key.padEnd(12)} ${Object.keys(result.show.seasons).length} seasons / ${result.show.episodes.length} episodes / ${result.show.episodes.filter((episode) => episode.image).length} stills${emptyNote}`);
        } catch (error) {
            const message = String(error?.message || error);
            results.push({ key, title: entry.title, ok: false, error: message });
            console.error(`FAIL ${key.padEnd(12)} ${message}`);
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        source: 'https://nxsha.space/api/tv/{tmdbId}/season/{season}',
        excludedKeys: Object.keys(previousShows).filter((key) => !shows[key]),
        summary: {
            requested: targetTitles.length,
            harvested: Object.keys(shows).length,
            failed: results.filter((row) => !row.ok).map((row) => row.key),
            episodes: Object.values(shows).reduce((total, show) => total + show.episodes.length, 0),
            stills: Object.values(shows).reduce((total, show) => total + show.episodes.filter((episode) => episode.image).length, 0),
            overviews: Object.values(shows).reduce((total, show) => total + show.episodes.filter((episode) => episode.overview).length, 0),
        },
        titles: results,
    };
    const episodeData = {
        _meta: {
            generatedAt: report.generatedAt,
            source: report.source,
            excludedKeys: Object.keys(previousShows).filter((key) => !shows[key]),
        },
        shows: { ...previousShows, ...shows },
    };

    if (!checkOnly) {
        writeFileSync(TITLES_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
        writeFileSync(PLAN_PATH, `${JSON.stringify(syncPlan(plan, manifest), null, 2)}\n`);
        writeFileSync(EPISODES_PATH, `${JSON.stringify(episodeData, null, 2)}\n`);
        writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(`Summary: ${JSON.stringify(report.summary)}`);
    if (report.summary.failed.length || report.summary.harvested !== report.summary.requested) {
        process.exitCode = 1;
    }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    if (process.argv.includes('--self-test')) {
        selfTest();
    } else {
        main().catch((error) => {
            console.error(`harvest-nxsha-guide: ${error?.message || error}`);
            process.exitCode = 1;
        });
    }
}
