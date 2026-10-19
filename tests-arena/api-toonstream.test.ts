// @ts-nocheck — the toonstream "server 2" resolver, driven through a
// child-process ESM harness (jest cannot import .mjs directly; the harness
// imports the module exactly like Vercel does). Fixtures mirror the live
// site: episode slug `<title>-<s>x<e>`, series pages, player rows with
// quality-labelled download links.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MODULE_PATH = join(process.cwd(), 'api', 'toonstream.mjs');
const HARNESS = join(process.cwd(), 'tests-arena', 'helpers', 'toonstream-harness.mjs');

function runScenario(scenario) {
    const res = spawnSync('node', [HARNESS], {
        encoding: 'utf8',
        timeout: 45000,
        env: { ...process.env, TS_SCENARIO: JSON.stringify(scenario), TS_MODULE_PATH: MODULE_PATH },
    });
    const out = String(res.stdout || '');
    const marker = out.lastIndexOf('__RESULT__');
    if (marker === -1) throw new Error(`harness failed: ${res.stderr || out}`);
    return JSON.parse(out.slice(marker + '__RESULT__'.length));
}

/** The live episode page shape: player iframes + quality-labelled rows. */
const EPISODE_HTML = `
<html><body>
  <div class="player"><iframe src="https://awish.click/embed-abc123.html" allowfullscreen></iframe></div>
  <div class="server-row"><b>01</b> <span>Ruby</span> <span>Multi Audio</span> <span>1080p</span>
    <a href="https://rubystm.com/d/lcwyoy23xi5n.html">Download</a></div>
  <div class="server-row"><b>05</b> <span>vidc</span> <span>Multi Audio</span> <span>1080p</span>
    <a href="https://vidc.upns.pro/#u3rzj5">Download</a></div>
  <div class="server-row"><b>06</b> <span>Moly</span> <span>Multi Audio</span> <span>720p</span>
    <a href="https://vidmoly.me/dl/l0933jnjbn3y">Download</a></div>
  <a href="/episode/overgeared-1x1/">prev</a> <a href="/episode/overgeared-1x3/">next</a>
</body></html>`;

const SERIES_HTML = `
<html><body>
  <a href="/series/overgeared/">Overgeared</a>
  <a href="/episode/overgeared-1x1/">E1</a>
  <a href="/episode/overgeared-1x2/">E2</a>
  <a href="/episode/overgeared-1x3/">E3</a>
</body></html>`;

const SEARCH_HTML = `
<html><body>
  <a href="/series/overgeared/">Overgeared (2026)</a>
  <a href="/series/overgeared-hindi-dub/">Overgeared Hindi Dub</a>
</body></html>`;

test('titleSlug follows the site rule (verified against live URLs)', () => {
    const { results } = runScenario({
        mode: 'unit',
        calls: [
            ['titleSlug', ['Kaiju No. 8']],
            ['titleSlug', ['Overgeared']],
            ['titleSlug', ['The Beginning After the End']],
            ['titleSlug', ['Ranma1/2']],
        ],
    });
    expect(results).toEqual(['kaiju-no-8', 'overgeared', 'the-beginning-after-the-end', 'ranma1-2']);
});

test('matchScore ranks the right series first', () => {
    const { results } = runScenario({
        mode: 'unit',
        calls: [
            ['matchScore', [['kaiju', 'no', '8'], 'Kaiju No. 8']],
            ['matchScore', [['kaiju', 'no', '8'], 'Kaiju No. 8 Hindi Dub']],
            ['matchScore', [['overgeared'], 'Overgeared (2026)']],
            ['matchScore', [['overgeared'], 'Totally Different Show']],
        ],
    });
    expect(results).toEqual([1, 1, 1, 0]);
});

test('resolves the episode directly from the deterministic slug and picks the embed', () => {
    const res = runScenario({
        query: { title: 'Overgeared', s: '1', e: '2' },
        mocks: [{ needle: '/episode/overgeared-1x2/', status: 200, body: EPISODE_HTML }],
    });
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('direct');
    expect(res.body.episodeUrl).toBe('https://toonstream.us/episode/overgeared-1x2/');
    // Inline iframe wins as the chosen embed.
    expect(res.body.chosen).toBe('https://awish.click/embed-abc123.html');
    expect(res.body.embeds).toContain('https://awish.click/embed-abc123.html');
    // Player rows come back with their quality labels.
    const ruby = res.body.servers.find((s) => s.url.includes('rubystm'));
    expect(ruby).toMatchObject({ quality: '1080p', name: 'rubystm' });
    const moly = res.body.servers.find((s) => s.url.includes('vidmoly'));
    expect(moly.quality).toBe('720p');
});

test('falls back to search -> series -> episode when the slug misses', () => {
    // Realistic miss: our slug rule dashes the apostrophe, the site drops it —
    // so the direct URL 404s and the search chain takes over.
    const frieren = (s) => String(s).replace(/overgeared/g, 'frieren-beyond-journeys-end').replace(/Overgeared/g, 'Frieren: Beyond Journey');
    const res = runScenario({
        query: { title: 'Frieren: Beyond Journey\'s End', s: '1', e: '2', debug: '1' },
        mocks: [
            { needle: '/episode/frieren-beyond-journey-s-end-1x2/', status: 404, body: 'nope' },
            { needle: '?s=Frieren', status: 200, body: frieren(SEARCH_HTML) },
            { needle: '/series/frieren-beyond-journeys-end/', status: 200, body: frieren(SERIES_HTML) },
            { needle: '/episode/frieren-beyond-journeys-end-1x2/', status: 200, body: frieren(EPISODE_HTML) },
        ],
    });
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('search');
    expect(res.body.chosen).toBe('https://awish.click/embed-abc123.html');
    const stepNames = res.body.steps.map((s) => s.step);
    expect(stepNames).toContain('episode-direct');
    expect(stepNames).toContain('search');
    expect(stepNames).toContain('series-candidates');
    expect(stepNames).toContain('series');
    expect(stepNames).toContain('episode');
});

test('no episode anywhere -> ok:false with a helpful hint, still a 200', () => {
    const res = runScenario({
        query: { title: 'Made Up Show', s: '3', e: '9', debug: '1' },
        mocks: [],
    });
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('no-episode');
    expect(res.body.hint).toContain('Made Up Show');
});

test('an unreachable site stays ok:false, never a 5xx', () => {
    // A fetch that throws (network/CF block) must surface as ok:false.
    const res = runScenario({
        query: { title: 'Overgeared', s: '1', e: '2' },
        crashFetch: true,
    });
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(false);
});

test('parsing helpers are conservative (only real player hosts, no site frames)', () => {
    const { results } = runScenario({
        mode: 'unit',
        calls: [
            ['extractIframes', ['<iframe src="https://toonstream.us/x"></iframe><iframe src="https://a-ads.com/f"></iframe><iframe src="https://awish.click/e1"></iframe>']],
            ['findEpisodeLink', [SERIES_HTML, '1', '2']],
            ['findEpisodeLink', [SERIES_HTML, '2', '9']],
        ],
    });
    expect(results[0]).toEqual(['https://awish.click/e1']);
    expect(results[1]).toBe('/episode/overgeared-1x2');
    expect(results[2]).toBe(null);
});
