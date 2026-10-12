#!/usr/bin/env node
/**
 * Find the nxsha `color=` values that give the player an orange theme.
 *
 * The embed page ships its theme colours inline, so we fetch the same movie
 * embed with several `color` values and diff the colours that actually appear
 * in the response. Runs on a hosted runner (the sandbox cannot reach nxsha).
 *
 * Output: data/nxsha-color.json
 * Usage:  node scripts/probe-nxsha-color.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', 'nxsha-color.json');

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const BASE = 'https://nxsha.space/embed/movie/1441228';
const REST = 'server=GbruHindi&lang=hi&sub=hi&disable_app_ad=true&disable_dl_button=true';

/** Design tokens from the app/OTT page (Crunchyroll orange). */
const CRUNCHYROLL = '#f47521';

const CANDIDATES = [
    'netflix',
    'orange',
    'crunchyroll',
    'orange-500',
    'amber',
    'yellow',
    'gold',
    'f47521',
    'F47521',
    'ff7a1a',
    'ff8a3d',
    'red',
    'netflix-red',
    'hotstar',
    'prime',
    'hulu',
    'disney',
    'crunchy',
    'aniroll',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchEmbed(color) {
    const url = color ? `${BASE}?${REST}&color=${encodeURIComponent(color)}` : `${BASE}?${REST}`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
        });
        const text = await res.text();
        return { url, status: res.status, text };
    } catch (e) {
        return { url, error: String((e && e.message) || e) };
    } finally {
        clearTimeout(to);
    }
}

/** Every colour-ish token in the page + the CSS custom properties. */
export function extractColors(html) {
    const text = String(html || '');
    const hex = [...new Set([...text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => m[0].toLowerCase()))];
    const rgb = [...new Set([...text.matchAll(/rgba?\([\d,\s.]+\)/g)].map((m) => m[0].replace(/\s+/g, '')))];
    const vars = [...new Set([...text.matchAll(/--[a-zA-Z0-9-]*(?:primary|accent|brand|theme)[a-zA-Z0-9-]*:\s*([^;\"']+)/g)].map((m) => m[1].trim()))];
    return { hex: hex.slice(0, 40), rgb: rgb.slice(0, 20), vars: vars.slice(0, 20) };
}

/** Distance helper: does a colour read as orange? */
export function orangeScore(hex) {
    const m = /^#([0-9a-f]{6})$/.exec(hex.toLowerCase());
    if (!m) return 0;
    const r = Number.parseInt(m[1].slice(0, 2), 16);
    const g = Number.parseInt(m[1].slice(2, 4), 16);
    const b = Number.parseInt(m[1].slice(4, 6), 16);
    // orange: strong red, mid green, low blue
    if (r < 150 || g < 40 || b > 120) return 0;
    const balance = 1 - Math.abs(g - r * 0.55) / 255;
    return Math.max(0, Math.min(1, balance)) * (1 - b / 255);
}

async function main() {
    const report = { generatedAt: new Date().toISOString(), target: CRUNCHYROLL, probes: [] };
    const baseline = await fetchEmbed('');
    const baseColors = baseline.text ? extractColors(baseline.text) : { hex: [], rgb: [], vars: [] };
    report.baseline = { url: baseline.url, status: baseline.status, bytes: baseline.text ? baseline.text.length : 0, colors: baseColors };
    console.log(`baseline (no color param): ${baseline.status} hex=${baseColors.hex.slice(0, 8).join(' ')} vars=${baseColors.vars.join(' ')}`);

    for (const value of CANDIDATES) {
        const res = await fetchEmbed(value);
        const colors = res.text ? extractColors(res.text) : { hex: [], rgb: [], vars: [] };
        const newHex = colors.hex.filter((h) => !baseColors.hex.includes(h));
        const best = [...colors.hex].map((h) => ({ hex: h, score: orangeScore(h) })).sort((a, b) => b.score - a.score)[0] || null;
        report.probes.push({
            value,
            status: res.status,
            error: res.error,
            bytes: res.text ? res.text.length : 0,
            newHex,
            vars: colors.vars,
            bestOrange: best,
            changed: newHex.length > 0 || colors.vars.join('|') !== baseColors.vars.join('|'),
        });
        console.log(
            `${value.padEnd(12)} ${res.status ?? 'ERR'} new=${newHex.slice(0, 5).join(',') || '-'} best=${best ? `${best.hex}(${best.score.toFixed(2)})` : '-'} vars=${colors.vars.slice(0, 3).join(',') || '-'}`,
        );
        await sleep(150);
    }

    const withNew = report.probes.filter((p) => p.changed);
    const best = report.probes
        .filter((p) => p.status === 200 && p.newHex.length)
        .map((p) => ({ value: p.value, best: p.bestOrange, newHex: p.newHex }))
        .sort((a, b) => (b.best?.score || 0) - (a.best?.score || 0))
        .slice(0, 6);
    report.summary = { anyChange: withNew.length, best };
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`changed=${withNew.length} best=${JSON.stringify(best[0] || null)}`);
    console.log(`wrote ${OUT}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((e) => {
        console.error(`probe-nxsha-color: ${(e && e.message) || e}`);
        process.exitCode = 1;
    });
}
