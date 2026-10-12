#!/usr/bin/env node
/**
 * Harvest the Nxsha season/episode guide (names, stills, synopsis, dates, runtimes).
 *
 * Nxsha serves its season data from /api/tv/{tmdbId}/season/{season}. The page
 * URL in data/nxsha-titles.json may be an IMDb or TMDB id, so first resolve the
 * internal TMDB id from the show's Nxsha detail page. One Piece is deliberately
 * skipped and its existing season map is never rewritten.
 *
 * Usage: node scripts/harvest-nxsha-guide.mjs [--check]
 *   --check  verify that all non-One-Piece catalog shows were harvested without
 *            writing any files.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TITLES_PATH = resolve(ROOT, 'data', 'nxsha-titles.json');
const PLAN_PATH = resolve(ROOT, 'data', 'nxsha-plan.json');
const EPISODES_PATH = resolve(ROOT, 'data', 'nxsha-episodes.json');
const REPORT_PATH = resolve(ROOT, 'data', 'nxsha-harvest-report.json');
const BASE_URL = 'https://nxsha.space';
const USER_AGENT = 'Mozilla/5.0 (compatible; NxshaEpisodeGuideHarvester/1.0)';
const REQUEST_TIMEOUT_MS = 25_000;
const REQUEST_DELAY_MS = 120;
const MAX_RETRIES = 4;
const SKIP_KEYS = new Set(['onepiece']);

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
    if (!episodes.length) throw new Error(`Nxsha season ${seasonNumber} returned no episodes`);
    if (declaredCount !== episodes.length) {
        throw new Error(`Nxsha season ${seasonNumber} declared ${declaredCount} episodes but returned ${episodes.length}`);
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
    for (let seasonNumber = 1; seasonNumber <= show.seasonCount; seasonNumber += 1) {
        const response = await get(
            `${BASE_URL}/api/tv/${show.tmdbId}/season/${seasonNumber}`,
            true,
        );
        const season = parseNxshaSeason(response, seasonNumber);
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
    };
}

function syncPlan(plan, manifest) {
    for (const row of plan.titles || []) {
        if (SKIP_KEYS.has(row.key)) continue;
        const title = manifest[row.key];
        if (title?.kind === 'tv') row.seasons = title.seasons;
    }
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
    console.log('harvest-nxsha-guide self-tests passed');
}

async function main() {
    const checkOnly = process.argv.includes('--check');
    const manifest = JSON.parse(readFileSync(TITLES_PATH, 'utf8'));
    const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
    const shows = {};
    const results = [];
    const targetTitles = Object.entries(manifest)
        .filter(([key, entry]) => !key.startsWith('_') && entry.kind === 'tv' && !SKIP_KEYS.has(key));

    console.log(`Harvesting ${targetTitles.length} Nxsha series; One Piece is excluded.`);
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
                episodes: result.show.episodes.length,
                stills: result.show.episodes.filter((episode) => episode.image).length,
                overviews: result.show.episodes.filter((episode) => episode.overview).length,
                ok: true,
            });
            console.log(`OK   ${key.padEnd(12)} ${Object.keys(result.show.seasons).length} seasons / ${result.show.episodes.length} episodes / ${result.show.episodes.filter((episode) => episode.image).length} stills`);
        } catch (error) {
            const message = String(error?.message || error);
            results.push({ key, title: entry.title, ok: false, error: message });
            console.error(`FAIL ${key.padEnd(12)} ${message}`);
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        source: 'https://nxsha.space/api/tv/{tmdbId}/season/{season}',
        excludedKeys: ['onepiece'],
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
            excludedKeys: ['onepiece'],
        },
        shows,
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
