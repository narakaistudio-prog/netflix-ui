#!/usr/bin/env node
/**
 * Bake the Nxsha playback table into the Crunchyroll demo page.
 *
 * Nxsha (nxsha.space) is THE player for the Crunchyroll section: every title
 * and episode embeds from https://nxsha.space/embed/{movie|tv}/{id}[/{s}/{e}].
 * The old AnimaHD (Server 1) + Drive (Server 2) tables and URL builders are
 * gone — nothing else is baked into the page.
 *
 * Reads data/nxsha-titles.json and rewrites the NX_DATA block between the
 * /*__NXSHA__*\/ … /*__END_NXSHA__*\/ markers in
 * assets/crunchyroll/crunchyroll.html.
 *
 * Usage: node scripts/bake-animahd-links.mjs [--check]
 *   --check   verify the HTML is already in sync (CI-friendly, no write)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NX_PATH = resolve(ROOT, 'data', 'nxsha-titles.json');
const NX_VERIFY_PATH = resolve(ROOT, 'data', 'nxsha-verify.json');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const NX_START = '/*__NXSHA__*/';
const NX_END = '/*__END_NXSHA__*/';

/**
 * Every title in the catalog is played through nxsha
 * (https://nxsha.space/embed/{movie|tv}/{id}[/{s}/{e}]). Ids live in
 * data/nxsha-titles.json and are verified against the live embed page before
 * they get baked (scripts/probe-nxsha.mjs).
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
            if (!Number.isInteger(count) || count <= 0) {
                throw new Error(`nxsha "${key}": season ${sn} count must be positive`);
            }
        }
        if (entry.kind === 'movie' && Object.keys(entry.seasons).length !== 1) {
            throw new Error(`nxsha "${key}": a movie needs exactly one season entry`);
        }
    }
    return data;
}

function main() {
    const checkOnly = process.argv.includes('--check');
    const nx = validateNxsha(JSON.parse(readFileSync(NX_PATH, 'utf8')));
    const html = readFileSync(HTML_PATH, 'utf8');
    const nxData = Object.fromEntries(Object.entries(nx).filter(([k]) => !k.startsWith('_')));

    // Every id should be confirmed against the live embed page. The probe runs
    // on a hosted runner (the workspace cannot reach nxsha), so anything
    // unverified is worth shouting about.
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
    const bakedNx = `${NX_START}var NX_DATA=${JSON.stringify(nxData)};${NX_END}`;
    const next = html.slice(0, nxStart) + bakedNx + html.slice(nxEnd + NX_END.length);

    const nxKeys = Object.keys(nxData).length;
    const nxEps = Object.values(nxData).reduce(
        (n, e) => n + Object.values(e.seasons).reduce((a, b) => a + b, 0),
        0,
    );
    const summary =
        `nxsha ${nxKeys} titles/${nxEps} episodes` +
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
