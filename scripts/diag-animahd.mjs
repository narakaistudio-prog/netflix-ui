#!/usr/bin/env node
/**
 * One-shot live diagnostics for animahd.com (runs on a hosted runner —
 * the workspace sandbox cannot reach the site).
 *
 * Probes a fixed set of URLs, records HTTP status / size / token counts and
 * dumps the raw HTML into data/diag/ so the harvest parser can be fixed
 * against the real markup.
 *
 * Output: data/animahd-diag.json  +  data/diag/*.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAG_DIR = resolve(ROOT, 'data', 'diag');
const OUT = resolve(ROOT, 'data', 'animahd-diag.json');

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PROBES = [
    ['home', 'https://animahd.com/'],
    ['search-solo', 'https://animahd.com/?s=Solo+Leveling'],
    ['search-frieren', 'https://animahd.com/?s=Frieren'],
    ['show-solo-short', 'https://animahd.com/solo-leveling/'],
    ['show-solo-long', 'https://animahd.com/solo-leveling-season-episodes-hindi-multi-audio/'],
    ['show-jjk', 'https://animahd.com/jujutsu-kaisen/'],
    ['wp-search-posts', 'https://animahd.com/wp-json/wp/v2/posts?search=solo%20leveling&per_page=3'],
    ['wp-search-api', 'https://animahd.com/wp-json/wp/v2/search?search=solo%20leveling&per_page=5'],
    ['wp-types', 'https://animahd.com/wp-json/wp/v2/types'],
];

async function probe(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    const out = { url };
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const text = await res.text();
        out.status = res.status;
        out.finalUrl = res.url;
        out.bytes = text.length;
        out.ptokens = (text.match(/[?&]p=([A-Za-z0-9+/=]+)/g) || []).length;
        out.fileIdRefs = (text.match(/file_id=/g) || []).length;
        out.driveRefs = (text.match(/drive\.google\.com/g) || []).length;
        out.iframes = (text.match(/<iframe/gi) || []).length;
        out.watchLinks = (text.match(/\/watch\//g) || []).length;
        out.animeLinks = (text.match(/\/anime\//g) || []).length;
        out.title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || '';
        out.snippet = text.replace(/\s+/g, ' ').slice(0, 700);
        out.html = text;
    } catch (e) {
        out.error = String((e && e.message) || e);
    } finally {
        clearTimeout(to);
    }
    return out;
}

async function main() {
    mkdirSync(DIAG_DIR, { recursive: true });
    const report = { generatedAt: new Date().toISOString(), probes: [] };
    for (const [name, url] of PROBES) {
        const p = await probe(url);
        if (typeof p.html === 'string' && p.html.length > 0 && p.html.length < 3_000_000) {
            writeFileSync(resolve(DIAG_DIR, `${name}.html`), p.html);
        }
        const { html, ...meta } = p;
        report.probes.push({ name, ...meta });
        console.log(
            `${name}: ${meta.status ?? 'ERR'} ${meta.bytes ?? ''} pTokens=${meta.ptokens ?? ''} fileId=${meta.fileIdRefs ?? ''} iframes=${meta.iframes ?? ''} drive=${meta.driveRefs ?? ''} ${meta.title ? `title="${String(meta.title).slice(0, 60)}"` : ''}${meta.error ? ` error=${meta.error}` : ''}`,
        );
        await new Promise((r) => setTimeout(r, 200));
    }
    writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${OUT}`);
}

main().catch((e) => {
    console.error(`diag-animahd: ${(e && e.message) || e}`);
    process.exitCode = 1;
});
