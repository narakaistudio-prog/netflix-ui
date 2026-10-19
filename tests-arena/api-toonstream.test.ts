// @ts-nocheck — the toonstream "server 2" resolver, driven through a
// child-process ESM harness (jest cannot import .mjs directly; the harness
// imports the module exactly like Vercel does). Fixtures mirror the live
// site: `id="options-N"` player divs (SERVER 1/2/3 = the sidebar's first
// three), hex-number/server-name rows, lazy data-src iframes.
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

/** Live page shape: options-0 eager (SERVER 1 "PLAY"), lazy slots after. */
const EPISODE_HTML = `
<html><body>
  <aside class="video-player" id="aa-options">
    <div id="options-0" class="video aa-tb hdd on">
      <iframe src="https://rubystm.com/e/lcwyoy23xi5n.html" frameborder="0" allowfullscreen loading="eager"></iframe>
    </div>
    <div id="options-1" class="video aa-tb hdd">
      <iframe data-src="https://filesforever.link/embed/lfer7w0" loading="lazy"></iframe>
    </div>
    <div id="options-2" class="video aa-tb hdd">
      <iframe data-src="https://filesforever.link/embed/ycuu3ma" loading="lazy"></iframe>
    </div>
    <div id="options-3" class="video aa-tb hdd">
      <iframe data-src="https://filesforever.link/embed/jba6kcn" loading="lazy"></iframe>
    </div>
  </aside>
  <div class="server-row"><div class="hex-badge t-1"><span class="hex-number">01</span></div>
    <span class="server-name">Play</span><span class="tag1">1080p</span>
    <a href="https://rubystm.com/d/lcwyoy23xi5n.html">Download</a></div>
  <div class="server-row"><div class="hex-badge t-2"><span class="hex-number">02</span></div>
    <span class="server-name">Short</span><span class="tag1">720p</span>
    <a href="https://download.openx.xyz/?v=zzz">Download</a></div>
  <div class="server-row"><div class="hex-badge t-3"><span class="hex-number">03</span></div>
    <span class="server-name">MultiQ</span><span class="tag1">1080p</span>
    <a href="https://blakiteapi.xyz/download/1/1-2">Download</a></div>
  <div class="server-row"><div class="hex-badge t-4"><span class="hex-number">04</span></div>
    <span class="server-name">Moly</span><span class="tag1">720p</span>
    <a href="https://vidmoly.me/dl/abc">Download</a></div>
  <a href="/episode/x-1x1/">prev</a> <a href="/episode/x-1x3/">next</a>
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
            ['titleSlug', ["JoJo's Bizarre Adventure"]],
            ['titleSlug', ['Frieren: Beyond Journey\u2019s End']],
        ],
    });
    expect(results).toEqual([
        'kaiju-no-8',
        'overgeared',
        'the-beginning-after-the-end',
        'ranma1-2',
        'jojos-bizarre-adventure',
        'frieren-beyond-journeys-end',
    ]);
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

test('player slots + sidebar names parse from the live markup shapes', () => {
    const { results } = runScenario({
        mode: 'unit',
        calls: [
            ['extractPlayerSlots', [EPISODE_HTML]],
            ['extractServerNames', [EPISODE_HTML]],
        ],
    });
    expect(results[0]).toEqual([
        { slot: 0, url: 'https://rubystm.com/e/lcwyoy23xi5n.html' },
        { slot: 1, url: 'https://filesforever.link/embed/lfer7w0' },
        { slot: 2, url: 'https://filesforever.link/embed/ycuu3ma' },
        { slot: 3, url: 'https://filesforever.link/embed/jba6kcn' },
    ]);
    expect(results[1]).toEqual({ '1': 'Play', '2': 'Short', '3': 'MultiQ', '4': 'Moly' });
});

test("returns ONLY the site's first three servers, named from the sidebar", () => {
    const res = runScenario({
        query: { title: 'Overgeared', s: '1', e: '2' },
        mocks: [{ needle: '/episode/overgeared-1x2/', status: 200, body: EPISODE_HTML }],
    });
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('direct');
    expect(res.body.episodeUrl).toBe('https://toonstream.us/episode/overgeared-1x2/');
    // Exactly three servers: SERVER 1/2/3 with the sidebar's own names.
    expect(res.body.servers).toEqual([
        { name: 'Play', url: 'https://rubystm.com/e/lcwyoy23xi5n.html' },
        { name: 'Short', url: 'https://filesforever.link/embed/lfer7w0' },
        { name: 'MultiQ', url: 'https://filesforever.link/embed/ycuu3ma' },
    ]);
    // Slot 3 (Moly's filesforever mirror) and the trailer must be gone.
    expect(res.body.embeds).toHaveLength(3);
    expect(JSON.stringify(res.body.embeds)).not.toContain('jba6kcn');
    expect(JSON.stringify(res.body.embeds)).not.toContain('youtube');
    // chosen = the site's own SERVER 1 player.
    expect(res.body.chosen).toBe('https://rubystm.com/e/lcwyoy23xi5n.html');
});

test('apostrophe titles now resolve directly (jojo/frieren site slugs)', () => {
    const jojoHtml = EPISODE_HTML.replace(/\/episode\/x-/g, '/episode/jojos-bizarre-adventure-');
    const res = runScenario({
        query: { title: "JoJo's Bizarre Adventure", s: '6', e: '1' },
        mocks: [{ needle: '/episode/jojos-bizarre-adventure-6x1/', status: 200, body: jojoHtml }],
    });
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('direct');
    expect(res.body.episodeUrl).toBe('https://toonstream.us/episode/jojos-bizarre-adventure-6x1/');
    expect(res.body.servers).toHaveLength(3);
});

test('EP_DATA slug param drives the direct URL even for odd titles', () => {
    const res = runScenario({
        query: { title: 'Totally Different Display Name', slug: 'jojos-bizarre-adventure', s: '6', e: '1' },
        mocks: [{ needle: '/episode/jojos-bizarre-adventure-6x1/', status: 200, body: EPISODE_HTML }],
    });
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('direct');
    expect(res.body.episodeUrl).toBe('https://toonstream.us/episode/jojos-bizarre-adventure-6x1/');
});

test('falls back to search -> series -> episode when the slug misses', () => {
    // Synthetic miss: direct 404s, search finds a series whose episode link
    // lives on a differently-slugged series page.
    const ogEpisode = EPISODE_HTML.replace(/\/episode\/x-/g, '/episode/og-hindi-');
    const seriesPage = SERIES_HTML
        .replace('/series/overgeared/', '/series/overgeared-hindi-dub/')
        .replace('/episode/overgeared-1x1/', '/episode/og-hindi-1x1/')
        .replace('/episode/overgeared-1x2/', '/episode/og-hindi-1x2/')
        .replace('/episode/overgeared-1x3/', '/episode/og-hindi-1x3/');
    const res = runScenario({
        query: { title: 'Overgeared Hindi', s: '1', e: '2', debug: '1' },
        mocks: [
            { needle: '?s=Overgeared', status: 200, body: SEARCH_HTML },
            { needle: '/series/overgeared-hindi-dub/', status: 200, body: seriesPage },
            { needle: '/episode/og-hindi-1x2/', status: 200, body: ogEpisode },
        ],
    });
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('search');
    const stepNames = res.body.steps.map((x) => x.step);
    expect(stepNames).toContain('search');
    expect(stepNames).toContain('series-candidates');
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
    const res = runScenario({
        query: { title: 'Overgeared', s: '1', e: '2' },
        crashFetch: true,
    });
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(false);
});

test("pickEmbed chooses the site's own Server 1 player, not a named host row", () => {
    const { results } = runScenario({
        mode: 'unit',
        calls: [
            ['pickEmbed', [['https://vidmoly.net/embed-a.html', 'https://rubystm.com/e/1.html']]],
            ['pickEmbed', [['https://www.youtube.com/embed/X', 'https://rubystm.com/e/1.html']]],
            ['pickEmbed', [['https://awish.click/embed-abc123.html']]],
        ],
    });
    expect(results).toEqual([
        'https://vidmoly.net/embed-a.html',
        'https://rubystm.com/e/1.html',
        'https://awish.click/embed-abc123.html',
    ]);
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
