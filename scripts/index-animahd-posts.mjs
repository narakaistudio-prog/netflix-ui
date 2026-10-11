#!/usr/bin/env node
/**
 * Index every post on animahd.com through the WordPress REST API.
 *
 * The site search is unreliable for the cruncher's needs (movie posts never
 * showed up in `?s=`), so we page through /wp-json/wp/v2/posts (100 per page)
 * and keep {id, slug, title} for offline title matching.
 *
 * Output: data/animahd-posts.json
 *
 * Usage: node scripts/index-animahd-posts.mjs [--base=https://animahd.com]
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', 'animahd-posts.json');
const DEFAULT_BASE = 'https://animahd.com';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
        const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'text/xml,*/*' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(to);
    }
}

async function fetchJson(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
        const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return { json: await res.json(), headers: res.headers };
    } finally {
        clearTimeout(to);
    }
}

async function main() {
    const baseArg = process.argv.find((a) => a.startsWith('--base='));
    const base = baseArg ? baseArg.slice(7).replace(/\/+$/, '') : DEFAULT_BASE;
    const posts = [];
    let page = 1;
    let totalPages = 1;
    for (; page <= 60; page += 1) {
        const url = `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&orderby=date&order=desc&_fields=id,slug,title,link`;
        let data;
        try {
            const res = await fetchJson(url);
            data = res.json;
            totalPages = Number.parseInt(res.headers.get('x-wp-totalpages') || '1', 10) || totalPages;
        } catch (e) {
            if (e.status === 400 && page > 1) break; // past the last page
            throw e;
        }
        if (!Array.isArray(data)) break;
        for (const p of data) {
            if (p && p.slug) posts.push({ id: p.id, slug: p.slug, title: (p.title && p.title.rendered) || '' });
        }
        console.log(`page ${page}/${totalPages}: ${data.length} posts (total ${posts.length})`);
        if (data.length < 100 || page >= totalPages) break;
        await sleep(200);
    }
    // Also index pages + sitemap URLs: some titles only show up there.
    const pages = [];
    try {
        for (let page = 1; page <= 10; page += 1) {
            const { json } = await fetchJson(`${base}/wp-json/wp/v2/pages?per_page=100&page=${page}&_fields=id,slug,title,link`);
            if (!Array.isArray(json) || !json.length) break;
            for (const p of json) if (p && p.slug) pages.push({ id: p.id, slug: p.slug, title: (p.title && p.title.rendered) || '' });
            if (json.length < 100) break;
            await sleep(200);
        }
    } catch (e) {
        console.log(`pages index skipped: ${(e && e.message) || e}`);
    }
    const sitemap = [];
    for (const path of ['/wp-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml']) {
        try {
            const xml = await fetchText(`${base}${path}`);
            const urls = [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
            if (urls.length) {
                sitemap.push(...urls);
                console.log(`sitemap ${path}: ${urls.length} urls`);
                // Follow one level of child sitemaps.
                for (const child of urls.filter((u) => /sitemap.*\.xml$/.test(u)).slice(0, 20)) {
                    if (child.includes(path.replace(/^\//, ''))) continue;
                    try {
                        const childXml = await fetchText(child);
                        const childUrls = [...String(childXml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
                        sitemap.push(...childUrls);
                        console.log(`  child sitemap ${child.split('/').pop()}: ${childUrls.length} urls`);
                    } catch {
                        /* ignore */
                    }
                    await sleep(150);
                }
            }
        } catch {
            /* sitemap optional */
        }
    }
    writeFileSync(
        OUT,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), base, count: posts.length, posts, pages, sitemap }, null, 2)}\n`,
    );
    console.log(`wrote ${OUT} (${posts.length} posts, ${pages.length} pages, ${sitemap.length} sitemap urls)`);
}

main().catch((e) => {
    console.error(`index-animahd-posts: ${(e && e.message) || e}`);
    process.exitCode = 1;
});
