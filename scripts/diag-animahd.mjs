#!/usr/bin/env node
/**
 * Live diagnostics for animahd.com (the workspace sandbox cannot reach the
 * site; this runs on a hosted runner and commits its findings so they can be
 * read back through the GitHub API).
 *
 * Reports, per probe URL:
 *   - HTTP status, final URL, size
 *   - counts of interesting markers (p-tokens, file_id, drive, iframe, watch)
 *   - a frequency table of unique href *shapes* (digits collapsed)
 *   - contexts around `?p=` tokens (the old episode-token recipe)
 *   - which script/AJAX/JSON hooks the page uses for its episode list
 *
 * Outputs:
 *   data/animahd-diag.json   (compact, committed)
 *   data/diag/<name>.html    (raw, committed; deleted again after diagnosis)
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
    ['show-solo', 'https://animahd.com/solo-leveling/'],
    ['show-jjk', 'https://animahd.com/jujutsu-kaisen/'],
    ['wp-search-posts', 'https://animahd.com/wp-json/wp/v2/posts?search=solo%20leveling&per_page=3'],
    ['wp-search-api', 'https://animahd.com/wp-json/wp/v2/search?search=solo%20leveling&per_page=5'],
    ['wp-types', 'https://animahd.com/wp-json/wp/v2/types'],
];

const shape = (href) => {
    try {
        const u = new URL(href, 'https://animahd.com/');
        const path = u.pathname.replace(/\d+/g, 'N');
        const q = [...u.searchParams.keys()].sort().join('&');
        return `${path}${q ? `?${q}` : ''}`;
    } catch {
        return href;
    }
};

function analyse(html) {
    const out = {};
    out.ptokens = (html.match(/[?&]p=([A-Za-z0-9+/=]+)/g) || []).length;
    out.fileIdRefs = (html.match(/file_id=/g) || []).length;
    out.driveRefs = (html.match(/drive\.google\.com/g) || []).length;
    out.iframes = (html.match(/<iframe/gi) || []).length;
    out.watchLinks = (html.match(/\/watch\//g) || []).length;

    const hrefs = new Map();
    for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
        const s = shape(m[1]);
        hrefs.set(s, (hrefs.get(s) || 0) + 1);
    }
    out.hrefShapes = [...hrefs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);

    const tokenCtx = [];
    for (const m of html.matchAll(/[?&]p=[A-Za-z0-9+/=]+/g)) {
        tokenCtx.push(html.slice(Math.max(0, m.index - 400), m.index + 120).replace(/\s+/g, ' '));
        if (tokenCtx.length >= 3) break;
    }
    out.tokenContexts = tokenCtx;

    out.hooks = {
        adminAjax: (html.match(/admin-ajax\.php/g) || []).length,
        wpJson: (html.match(/\/wp-json\//g) || []).length,
        restRoute: (html.match(/wp-json\/[a-z0-9-]+\/v\d/g) || []).length,
        episodeWord: (html.match(/episode/gi) || []).length,
        seasonWord: (html.match(/season/gi) || []).length,
        dataEp: (html.match(/data-ep(isode)?=/gi) || []).length,
        m3u8: (html.match(/\.m3u8/g) || []).length,
        mp4: (html.match(/\.mp4/g) || []).length,
        base64Blobs: (html.match(/atob\(/g) || []).length,
        inlineJsonVars: (html.match(/var\s+\w*(episodes|player|links|data)\w*\s*=/gi) || []).length,
    };

    // Script src + inline script sizes (episode lists often arrive via JS).
    out.scriptSrcs = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))].slice(0, 20);
    out.inlineScriptSizes = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].length).sort((a, b) => b - a).slice(0, 10);

    // Any JSON-ish blob that mentions episodes.
    const blobs = [...html.matchAll(/<script[^>]*>([\s\S]{200,}?)<\/script>/gi)]
        .map((m) => m[1])
        .filter((s) => /episode|file_id|player|drive/i.test(s));
    out.blobSamples = blobs.slice(0, 3).map((s) => s.replace(/\s+/g, ' ').slice(0, 900));
    return out;
}

async function probe(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const text = await res.text();
        return {
            status: res.status,
            finalUrl: res.url,
            bytes: text.length,
            title: (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || '',
            snippet: text.replace(/\s+/g, ' ').slice(0, 400),
            ...analyse(text),
            html: text,
        };
    } catch (e) {
        return { error: String((e && e.message) || e) };
    } finally {
        clearTimeout(to);
    }
}

async function main() {
    mkdirSync(DIAG_DIR, { recursive: true });
    const report = { generatedAt: new Date().toISOString(), probes: [] };
    for (const [name, url] of PROBES) {
        const p = await probe(url);
        if (typeof p.html === 'string' && p.html.length > 0 && p.html.length < 4_000_000) {
            writeFileSync(resolve(DIAG_DIR, `${name}.html`), p.html);
        }
        const { html, ...meta } = p;
        report.probes.push({ name, url, ...meta });
        console.log(`${name}: ${meta.status ?? 'ERR'} ${meta.bytes ?? ''}B p=${meta.ptokens ?? '-'} iframes=${meta.iframes ?? '-'} watch=${meta.watchLinks ?? '-'} ajax=${meta.hooks?.adminAjax ?? '-'} wpjson=${meta.hooks?.wpJson ?? '-'}${meta.error ? ` ERR=${meta.error}` : ''}`);
        await new Promise((r) => setTimeout(r, 250));
    }
    writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${OUT}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((e) => {
        console.error(`diag-animahd: ${(e && e.message) || e}`);
        process.exitCode = 1;
    });
}
