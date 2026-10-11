#!/usr/bin/env node
/**
 * Verify nxsha.space (the fallback player) ids + season/episode numbering.
 *
 * Runs on a hosted runner (the workspace sandbox cannot reach nxsha).
 * Reads data/nxsha-plan.json and, for every title:
 *   - movies: fetches /embed/movie/{id} and checks the <title> names it
 *   - tv    : fetches /embed/tv/{id}/{s}/{e} for the first and last episode of
 *             every planned season and checks the <title> says S<s>:E<e>
 * Also hunts the still-unknown Sword Art Online: Ordinal Scale id through the
 * site's own pages/sitemap (data/nxsha-plan.json -> saoMovieCandidates).
 *
 * Output: data/nxsha-verify.json  (+ data/nxsha-diag/*.html artifact only)
 * Usage:  node scripts/probe-nxsha.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = resolve(ROOT, 'data', 'nxsha-plan.json');
const OUT = resolve(ROOT, 'data', 'nxsha-verify.json');
const DIAG = resolve(ROOT, 'data', 'nxsha-diag');

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Query string copied verbatim from lib/embeds.ts (verified provider defaults). */
const PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
        const res = await fetch(url, {
            signal: ctl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        return { status: res.status, finalUrl: res.url, text: await res.text() };
    } finally {
        clearTimeout(to);
    }
}

const docTitle = (text) => ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || '').replace(/\s+/g, ' ').trim();

/** "Watch Solo Leveling - S1:E1" -> { name, season, episode } */
export function parseEmbedTitle(title) {
    const m = /^Watch\s+(.+?)(?:\s*[-–]\s*S(\d+):E(\d+))?\s*$/i.exec(String(title || '').trim());
    if (!m) return { name: String(title || '').trim(), season: null, episode: null };
    return {
        name: m[1].trim(),
        season: m[2] ? Number.parseInt(m[2], 10) : null,
        episode: m[3] ? Number.parseInt(m[3], 10) : null,
    };
}

const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'movie', 'film', 'no', 'to', 'in', 'with', 'on']);
const tokens = (s) =>
    String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((t) => t && !STOP.has(t));

export function nameMatches(found, expected) {
    const want = tokens(expected);
    const got = tokens(found);
    if (!want.length) return false;
    const hit = want.filter((w) => got.some((g) => g === w || (w.length > 4 && g.startsWith(w.slice(0, 5))))).length;
    return hit / want.length >= 0.6;
}

async function checkMovie(t, report) {
    const url = `https://nxsha.space/embed/movie/${t.id}?${PARAMS}`;
    const row = { key: t.key, kind: 'movie', id: t.id, url };
    try {
        const { status, text } = await get(url);
        const title = docTitle(text);
        const parsed = parseEmbedTitle(title);
        row.status = status;
        row.embedTitle = title;
        row.ok = status === 200 && nameMatches(parsed.name, t.title);
        row.seasonList = extractSeasonInfo(text);
        if (!row.ok) row.hint = `expected "${t.title}"`;
    } catch (e) {
        row.error = String((e && e.message) || e);
    }
    report.titles.push(row);
    console.log(`movie ${t.key.padEnd(12)} ${row.status ?? 'ERR'} ${row.ok ? 'OK ' : 'BAD'} "${row.embedTitle || row.error || ''}"`);
    await sleep(150);
    return row;
}

async function checkTv(t, report) {
    const seasonMap = {};
    const checks = [];
    let seasonNumber = 0;
    for (const count of t.seasons) {
        seasonNumber += 1;
        const eps = [1, count]; // first + last of the season
        for (const ep of [...new Set(eps)]) {
            const url = `https://nxsha.space/embed/tv/${t.id}/${seasonNumber}/${ep}?${PARAMS}`;
            let row = { season: seasonNumber, episode: ep, url };
            try {
                const { status, text } = await get(url);
                const title = docTitle(text);
                const parsed = parseEmbedTitle(title);
                row = {
                    ...row,
                    status,
                    embedTitle: title,
                    ok:
                        status === 200 &&
                        parsed.season === seasonNumber &&
                        parsed.episode === ep &&
                        nameMatches(parsed.name, t.title),
                    foundName: parsed.name,
                    foundSeason: parsed.season,
                    foundEpisode: parsed.episode,
                };
                if (row.ok && ep === 1) Object.assign(seasonMap, extractSeasonInfo(text));
            } catch (e) {
                row.error = String((e && e.message) || e);
            }
            checks.push(row);
            await sleep(120);
        }
    }
    const okAll = checks.every((c) => c.ok);
    report.titles.push({ key: t.key, kind: 'tv', id: t.id, ok: okAll, checks, seasonList: seasonMap });
    console.log(
        `tv    ${t.key.padEnd(12)} ${okAll ? 'OK ' : 'BAD'} ` +
            checks.map((c) => `S${c.season}E${c.episode}:${c.ok ? '✓' : `✗(${c.foundSeason ?? '-'}:${c.foundEpisode ?? '-'} ${c.embedTitle || c.error || ''})`}`).join(' '),
    );
}

/** Pull any season/episode structure the embed page exposes. */
export function extractSeasonInfo(html) {
    const text = String(html || '');
    const seasons = [...new Set([...text.matchAll(/[Ss]eason\s*(\d{1,2})/g)].map((m) => Number.parseInt(m[1], 10)))].sort((a, b) => a - b);
    const epPairs = [...new Set([...text.matchAll(/S(\d{1,2}):E(\d{1,4})/g)].map((m) => `${m[1]}:${m[2]}`))].slice(0, 40);
    const total = /(\d{1,4})\s*Episodes?/i.exec(text);
    return { seasonNumbers: seasons.slice(0, 20), epPairs, totalEpisodes: total ? Number.parseInt(total[1], 10) : null };
}

/** TMDB's own site is a keyless way to turn a title into candidate ids. */
export function extractTmdbCandidates(html) {
    const out = new Map();
    for (const m of String(html).matchAll(/href="\/(movie|tv)\/(\d+)(?:-([a-z0-9-]+))?"/g)) {
        const id = m[2];
        if (out.has(id)) continue;
        out.set(id, { id, kind: m[1], slug: m[3] || '' });
        if (out.size >= 12) break;
    }
    return [...out.values()];
}

async function tmdbSearch(title, report) {
    const rows = [];
    for (const url of [
        `https://www.themoviedb.org/search?query=${encodeURIComponent(title)}`,
        `https://www.themoviedb.org/search/movie?query=${encodeURIComponent(title)}`,
    ]) {
        let row = { url };
        try {
            const { status, text } = await get(url);
            row = { ...row, status, bytes: text.length, candidates: extractTmdbCandidates(text) };
        } catch (e) {
            row.error = String((e && e.message) || e);
        }
        rows.push(row);
        console.log(`tmdb search ${row.status ?? 'ERR'} ${row.bytes ?? ''}B candidates=${(row.candidates || []).length}`);
        await sleep(150);
    }
    report.tmdbSearch = rows;
    return rows.flatMap((r) => r.candidates || []);
}

async function huntSaoMovie(plan, report) {
    report.saoMovie = [];
    const fromTmdb = await tmdbSearch('Sword Art Online Ordinal Scale', report).catch(() => []);
    const extra = fromTmdb.filter((c) => c.kind === 'movie').map((c) => c.id);
    const all = [...new Set([...(plan.saoMovieCandidates || []), ...extra])];
    for (const cand of all) {
        const url = `https://nxsha.space/embed/movie/${cand}?${PARAMS}`;
        let row = { id: cand, url };
        try {
            const { status, text } = await get(url);
            const title = docTitle(text);
            const parsed = parseEmbedTitle(title);
            row = {
                ...row,
                status,
                embedTitle: title,
                ok: status === 200 && nameMatches(parsed.name, 'Sword Art Online Ordinal Scale'),
            };
        } catch (e) {
            row.error = String((e && e.message) || e);
        }
        report.saoMovie.push(row);
        console.log(`saoMovie cand ${String(cand).padEnd(12)} ${row.status ?? 'ERR'} ${row.ok ? 'MATCH ' : '      '}"${row.embedTitle || row.error || ''}"`);
        await sleep(150);
    }
}

async function siteProbes(plan, report) {
    report.site = [];
    for (const [label, url] of plan.siteProbes || []) {
        let row = { label, url };
        try {
            const { status, text } = await get(url);
            const urls = [...String(text).matchAll(/https?:\/\/[^<\s"']+/g)].map((m) => m[0]);
            const ordinals = urls.filter((u) => /ordinal/i.test(u)).slice(0, 10);
            row = {
                ...row,
                status,
                bytes: text.length,
                docTitle: docTitle(text).slice(0, 120),
                sample: urls.filter((u) => /(movie|tv|watch|embed)/i.test(u)).slice(0, 12),
                ordinals,
                snippet: text.replace(/\s+/g, ' ').slice(0, 300),
            };
            if (label.startsWith('sitemap') && text.length < 900_000) writeFileSync(resolve(DIAG, `${label}.xml`), text);
        } catch (e) {
            row.error = String((e && e.message) || e);
        }
        report.site.push(row);
        console.log(`site ${label.padEnd(18)} ${row.status ?? 'ERR'} ${row.bytes ?? ''}B ordinal-hits=${row.ordinals ? row.ordinals.length : 0}`);
        await sleep(150);
    }
}

async function main() {
    mkdirSync(DIAG, { recursive: true });
    const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
    const report = { generatedAt: new Date().toISOString(), titles: [] };
    for (const t of plan.titles) {
        if (!t.id) continue; // saoMovie hunted separately
        if (t.kind === 'movie') await checkMovie(t, report);
        else await checkTv(t, report);
    }
    await huntSaoMovie(plan, report);
    await siteProbes(plan, report);
    const bad = report.titles.filter((r) => !r.ok);
    report.summary = {
        titles: report.titles.length,
        ok: report.titles.length - bad.length,
        bad: bad.map((r) => r.key),
        saoMovieMatch: (report.saoMovie || []).filter((r) => r.ok).map((r) => r.id),
    };
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`summary: ${JSON.stringify(report.summary)}`);
    console.log(`wrote ${OUT}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((e) => {
        console.error(`probe-nxsha: ${(e && e.message) || e}`);
        process.exitCode = 1;
    });
}
