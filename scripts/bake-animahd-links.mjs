#!/usr/bin/env node
/**
 * Bake episode-guide metadata and Nxsha provider ids into the Crunchyroll page.
 *
 * The legacy episode harvest remains useful for season counts and display
 * labels, but its external file ids are deliberately not shipped to the page.
 * Every playback URL is built from data/nxsha-titles.json and points to Nxsha.
 *
 * Usage: node scripts/bake-animahd-links.mjs [--check]
 *   --check   verify the HTML is already in sync (CI-friendly, no write)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = resolve(ROOT, 'data', 'animahd-episodes.json');
const NX_PATH = resolve(ROOT, 'data', 'nxsha-titles.json');
const NX_VERIFY_PATH = resolve(ROOT, 'data', 'nxsha-verify.json');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const START = '/*__ANIMAHDEP__*/';
const END = '/*__END_ANIMAHDEP__*/';
const NX_START = '/*__NXSHA__*/';
const NX_END = '/*__END_NXSHA__*/';

const FILEID_RE = /^[A-Za-z0-9_-]{10,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateEpisodes(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('episodes map must be a JSON object keyed by anime key');
    }
    for (const [key, entry] of Object.entries(data)) {
        if (!entry || typeof entry !== 'object') throw new Error(`"${key}": entry must be an object`);
        if (!Number.isInteger(entry.showId) || entry.showId <= 0) {
            throw new Error(`"${key}": showId must be a positive integer`);
        }
        if (entry.slug !== undefined && !SLUG_RE.test(entry.slug)) {
            throw new Error(`"${key}": bad slug "${entry.slug}"`);
        }
        if (!entry.seasons || typeof entry.seasons !== 'object' || Array.isArray(entry.seasons)) {
            throw new Error(`"${key}": seasons must be an object like {"1": 12, "2": 13}`);
        }
        let sum = 0;
        for (const [sn, count] of Object.entries(entry.seasons)) {
            if (!/^\d+$/.test(sn)) throw new Error(`"${key}": bad season "${sn}"`);
            if (!Number.isInteger(count) || count <= 0) {
                throw new Error(`"${key}": season ${sn} count must be a positive integer`);
            }
            sum += count;
        }
        if (!Array.isArray(entry.eps) || !entry.eps.length) {
            throw new Error(`"${key}": eps must be a non-empty array of Drive file_ids`);
        }
        entry.eps.forEach((f, i) => {
            if (typeof f !== 'string' || !FILEID_RE.test(f)) {
                throw new Error(`"${key}": eps[${i}] is not a Drive file_id`);
            }
        });
        if (sum !== entry.eps.length) {
            throw new Error(`"${key}": seasons sum ${sum} != ${entry.eps.length} eps`);
        }
    }
    return data;
}

/**
 * All Crunchyroll titles are played through Nxsha
 * (https://nxsha.space/embed/{movie|tv}/{id}[/{s}/{e}]). Ids live in
 * data/nxsha-titles.json; scripts/probe-nxsha.mjs checks them on a runner with
 * access to the provider.
 */
export function validateNxsha(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('nxsha titles must be a JSON object keyed by anime key');
    }
    const ID_RE = /^(tt\d{6,10}|\d{1,9})$/;
    for (const [key, entry] of Object.entries(data)) {
        if (key.startsWith('_')) continue;
        if (!entry || typeof entry !== 'object') throw new Error(`nxsha "${key}": entry must be an object`);
        if (!ID_RE.test(String(entry.id || ''))) throw new Error(`nxsha "${key}": bad id "${entry.id}"`);
        if (entry.kind !== 'tv' && entry.kind !== 'movie') throw new Error(`nxsha "${key}": kind must be tv|movie`);
        if (!entry.seasons || typeof entry.seasons !== 'object' || Array.isArray(entry.seasons)) {
            throw new Error(`nxsha "${key}": seasons must be an object like {"1": 24}`);
        }
        for (const [sn, count] of Object.entries(entry.seasons)) {
            if (!/^\d+$/.test(sn)) throw new Error(`nxsha "${key}": bad season "${sn}"`);
            if (!Number.isInteger(count) || count <= 0) throw new Error(`nxsha "${key}": season ${sn} count must be positive`);
        }
        if (entry.kind === 'movie' && Object.keys(entry.seasons).length !== 1) {
            throw new Error(`nxsha "${key}": a movie needs exactly one season entry`);
        }
    }
    return data;
}

function main() {
    const checkOnly = process.argv.includes('--check');
    const data = validateEpisodes(JSON.parse(readFileSync(JSON_PATH, 'utf8')));
    const nx = validateNxsha(JSON.parse(readFileSync(NX_PATH, 'utf8')));
    const html = readFileSync(HTML_PATH, 'utf8');
    const si = html.indexOf(START);
    const ei = html.indexOf(END);
    if (si === -1 || ei === -1 || ei < si) {
        throw new Error('ANIMAHDEP markers not found in demo HTML');
    }
    const nxData = Object.fromEntries(Object.entries(nx).filter(([k]) => !k.startsWith('_')));

    // Every id must be confirmed against the live embed page. The probe runs
    // before the bake in CI, so anything unverified is worth shouting about.
    let unverified = [];
    if (existsSync(NX_VERIFY_PATH)) {
        const verify = JSON.parse(readFileSync(NX_VERIFY_PATH, 'utf8'));
        const okIds = new Set();
        for (const row of verify.titles || []) if (row.ok) okIds.add(String(row.id));
        for (const row of verify.saoMovie || []) if (row.ok) okIds.add(String(row.id));
        unverified = Object.entries(nxData)
            .filter(([, e]) => !okIds.has(String(e.id)))
            .map(([k, e]) => `${k}=${e.id}`);
    } else {
        console.warn('nxsha-verify.json missing — ids are not verified against the live site.');
    }
    if (unverified.length) {
        console.warn(`WARNING: unverified nxsha ids: ${unverified.join(', ')}`);
    }
    const nxStart = html.indexOf(NX_START);
    const nxEnd = html.indexOf(NX_END);
    if (nxStart === -1 || nxEnd === -1 || nxEnd < nxStart) {
        throw new Error('NXSHA markers not found in demo HTML');
    }
    const episodeMeta = Object.fromEntries(
        Object.entries(data).map(([key, entry]) => [key, {
            slug: entry.slug,
            seasons: entry.seasons,
            ...(entry.seasonsSource ? { seasonsSource: entry.seasonsSource } : {}),
            labels: entry.labels || [],
        }]),
    );
    const baked = `${START}var EP_DATA=${JSON.stringify(episodeMeta)};${END}`;
    const bakedNx = `${NX_START}var NX_DATA=${JSON.stringify(nxData)};${NX_END}`;
    const next =
        html.slice(0, si) +
        baked +
        html.slice(ei + END.length, nxStart) +
        bakedNx +
        html.slice(nxEnd + NX_END.length);
    const keys = Object.keys(data).length;
    const eps = Object.values(data).reduce((n, e) => n + e.eps.length, 0);
    const nxKeys = Object.keys(nxData).length;
    const nxEps = Object.values(nxData).reduce(
        (n, e) => n + Object.values(e.seasons).reduce((a, b) => a + b, 0),
        0,
    );
    const summary =
        `episode guide ${keys} titles/${eps} labels + Nxsha ${nxKeys} titles/${nxEps} episodes` +
        (unverified.length ? ` (${unverified.length} unverified id(s)!)` : ' (all nxsha ids verified)');
    if (next === html) {
        console.log(`already in sync (${summary}).`);
        return;
    }
    if (checkOnly) {
        console.error(`OUT OF SYNC (${summary}) — run the bake.`);
        process.exitCode = 1;
        return;
    }
    writeFileSync(HTML_PATH, next);
    console.log(`Baked ${summary} into demo HTML.`);
}

main();
