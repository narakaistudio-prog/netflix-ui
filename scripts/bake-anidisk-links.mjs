#!/usr/bin/env node
/**
 * AniDisk confirmed-links data check for the Crunchyroll demo page.
 *
 * The player is Nxsha-only now (every title embeds from https://nxsha.space/embed/…),
 * so the demo page carries NO AniDisk table anymore. This script still
 * validates data/anidisk-confirmed.json (curated by hand or by
 * scripts/harvest-deadtoons.mjs) and makes sure the page never grows the
 * ANIDISK_CONFIRMED block back.
 *
 * Usage: node scripts/bake-anidisk-links.mjs [--check]
 *   --check   verify the HTML is already in sync (CI-friendly, no write)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = resolve(ROOT, 'data', 'anidisk-confirmed.json');
const HTML_PATH = resolve(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const START = '/*__ANIDISK_CONFIRMED__*/';
const END = '/*__END_ANIDISK__*/';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EPKEY_RE = /^\d+:\d+$/;
const URL_RE = /^https:\/\/anidisk\.org\/watch\/[A-Za-z0-9\-_]+\/\d+\/\d+\/?$/;

export function validateConfirmed(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('confirmed map must be a JSON object keyed by anime key');
    }
    for (const [key, entry] of Object.entries(data)) {
        if (!entry || typeof entry !== 'object') throw new Error(`"${key}": entry must be an object`);
        if (entry.slug !== undefined && !SLUG_RE.test(entry.slug)) {
            throw new Error(`"${key}": bad slug "${entry.slug}"`);
        }
        if (entry.eps !== undefined) {
            if (!entry.eps || typeof entry.eps !== 'object' || Array.isArray(entry.eps)) {
                throw new Error(`"${key}": eps must be an object like {"1:1": "https://..."}`);
            }
            for (const [epKey, url] of Object.entries(entry.eps)) {
                if (!EPKEY_RE.test(epKey)) throw new Error(`"${key}": bad eps key "${epKey}" (want "season:episode")`);
                if (!URL_RE.test(url)) throw new Error(`"${key}": bad anidisk URL "${url}"`);
            }
        }
        if (entry.verified !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(entry.verified)) {
            throw new Error(`"${key}": verified must be YYYY-MM-DD`);
        }
    }
    return data;
}

function main() {
    const checkOnly = process.argv.includes('--check');
    const data = validateConfirmed(JSON.parse(readFileSync(JSON_PATH, 'utf8')));
    const html = readFileSync(HTML_PATH, 'utf8');
    const keys = Object.keys(data).length;
    const links = Object.values(data).reduce((n, e) => n + (e.eps ? Object.keys(e.eps).length : 0), 0);
    const summary = `anidisk links already in sync (${keys} titles, ${links} episode links, none baked — player is Nxsha-only)`;

    // The Nxsha-only player has no AniDisk table: nothing to bake. If an old
    // bake left one behind, strip it (or fail --check so CI notices).
    const si = html.indexOf(START);
    const ei = html.indexOf(END);
    const hasBlock = si !== -1 && ei !== -1 && ei >= si;
    const hasTable = html.includes('var ANIDISK_CONFIRMED=');
    if (!hasBlock && !hasTable) {
        console.log(summary);
        return;
    }
    if (checkOnly) {
        console.error('anidisk table found in demo HTML — player is Nxsha-only, run the bake to strip it.');
        process.exitCode = 1;
        return;
    }
    let next = html;
    if (hasBlock) next = next.slice(0, si) + next.slice(ei + END.length);
    next = next.replace(/\/\*__ANIDISK_CONFIRMED__\*\/[\s\S]*?\/\*__END_ANIDISK__\*\//g, '');
    writeFileSync(HTML_PATH, next);
    console.log(`Stripped leftover anidisk table from demo HTML (${summary}).`);
}

main();
