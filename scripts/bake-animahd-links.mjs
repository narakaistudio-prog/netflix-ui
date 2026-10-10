#!/usr/bin/env node
/**
 * Bake AnimaHD episode file_ids into the Crunchyroll demo page.
 *
 * Reads data/animahd-episodes.json (seeded by hand or by
 * scripts/harvest-animahd.mjs) and rewrites the EP_DATA block
 * between the /*__ANIMAHDEP__*\/ … /*__END_ANIMAHDEP__*\/ markers in
 * assets/crunchyroll/crunchyroll.html.
 *
 * The player builds BOTH server URLs from this one table:
 *   Drive:          https://drive.google.com/file/d/{fileId}/preview
 *   AnimaHD Player: https://animahd.com/player/?file_id={fileId}&show_id={showId}&ep={index}
 * (ep index is 0-based and runs continuously across seasons.)
 *
 * Usage: node scripts/bake-animahd-links.mjs [--check]
 *   --check   verify the HTML is already in sync (CI-friendly, no write)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = resolve(ROOT, 'data', 'animahd-episodes.json');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const START = '/*__ANIMAHDEP__*/';
const END = '/*__END_ANIMAHDEP__*/';

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

function main() {
    const checkOnly = process.argv.includes('--check');
    const data = validateEpisodes(JSON.parse(readFileSync(JSON_PATH, 'utf8')));
    const html = readFileSync(HTML_PATH, 'utf8');
    const si = html.indexOf(START);
    const ei = html.indexOf(END);
    if (si === -1 || ei === -1 || ei < si) {
        throw new Error('ANIMAHDEP markers not found in demo HTML');
    }
    const baked = `${START}var EP_DATA=${JSON.stringify(data)};${END}`;
    const next = html.slice(0, si) + baked + html.slice(ei + END.length);
    const keys = Object.keys(data).length;
    const eps = Object.values(data).reduce((n, e) => n + e.eps.length, 0);
    if (next === html) {
        console.log(`animahd episodes already in sync (${keys} titles, ${eps} episodes).`);
        return;
    }
    if (checkOnly) {
        console.error(`animahd episodes OUT OF SYNC (${keys} titles, ${eps} episodes) — run the bake.`);
        process.exitCode = 1;
        return;
    }
    writeFileSync(HTML_PATH, next);
    console.log(`Baked animahd episodes (${keys} titles, ${eps} episodes) into demo HTML.`);
}

main();
