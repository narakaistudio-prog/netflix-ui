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

/** Solo Leveling E1 - exact live structure (11 slots, 8 named rows). */
const EPISODE_HTML = `
<html><body>
  <aside class="video-player" id="aa-options">
    <div id="options-0" class="video hdd on">
      <iframe src="https://rubystm.com/e/mvybg38ttztw.html" loading="eager"></iframe>
    </div>
    <div id="options-1" class="video hdd"><iframe data-src="https://filesforever.link/embed/hdoyuqt" loading="lazy"></iframe></div>
    <div id="options-2" class="video hdd"><iframe data-src="https://filesforever.link/embed/x7kv57a" loading="lazy"></iframe></div>
    <div id="options-3" class="video hdd"><iframe data-src="https://filesforever.link/embed/o4m5b3o" loading="lazy"></iframe></div>
    <div id="options-4" class="video hdd"><iframe data-src="https://cloudy.upns.one/#krga1o" loading="lazy"></iframe></div>
    <div id="options-5" class="video hdd"><iframe data-src="https://vidmoly.net/embed-c04lu1yyy8i3.html" loading="lazy"></iframe></div>
    <div id="options-6" class="video hdd"><iframe data-src="https://abyssplayer.com/LR0L1Adhn" loading="lazy"></iframe></div>
    <div id="options-7" class="video hdd"><iframe data-src="https://blakiteapi.xyz/embed/127532/1-1" loading="lazy"></iframe></div>
    <div id="options-8" class="video hdd"><iframe data-src="https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f" loading="lazy"></iframe></div>
    <div id="options-9" class="video hdd"><iframe data-src="https://strmup.to/PhZJCk0DRSitMN" loading="lazy"></iframe></div>
    <div id="options-10" class="video hdd"><iframe data-src="https://turbonewvid.com/t/68bfab1aa350e" loading="lazy"></iframe></div>
  </aside>
  <div class="server-row"><div class="hex-badge t-1"><span class="hex-number">01</span></div>
    <span class="server-name">Ruby</span><span class="tag1">1080p</span>
    <a href="https://rubystm.com/d/mvybg38ttztw.html">Download</a></div>
  <div class="server-row"><div class="hex-badge t-2"><span class="hex-number">02</span></div>
    <span class="server-name">filesforever</span><span class="tag1">480p</span>
    <a href="https://filesforever.link/file/hdoyuqt">Download</a></div>
  <div class="server-row"><div class="hex-badge t-3"><span class="hex-number">03</span></div>
    <span class="server-name">filesforever</span><span class="tag1">720p</span>
    <a href="https://filesforever.link/file/x7kv57a">Download</a></div>
  <div class="server-row"><div class="hex-badge t-4"><span class="hex-number">04</span></div>
    <span class="server-name">filesforever</span><span class="tag1">1080p</span>
    <a href="https://filesforever.link/file/o4m5b3o">Download</a></div>
  <div class="server-row"><div class="hex-badge t-5"><span class="hex-number">05</span></div>
    <span class="server-name">Cloudy</span><span class="tag1">1080p</span>
    <a href="https://cloudy.upns.one/#krga1o">Download</a></div>
  <div class="server-row"><div class="hex-badge t-6"><span class="hex-number">06</span></div>
    <span class="server-name">Moly</span><span class="tag1">720p</span>
    <a href="https://vidmoly.me/dl/c04lu1y">Download</a></div>
  <div class="server-row"><div class="hex-badge t-7"><span class="hex-number">07</span></div>
    <span class="server-name">Short</span><span class="tag1">1080p</span>
    <a href="https://abyssplayer.com/dl/LR0L1Adhn">Download</a></div>
  <div class="server-row"><div class="hex-badge t-8"><span class="hex-number">08</span></div>
    <span class="server-name">MultiQ</span><span class="tag1">1080p</span>
    <a href="https://blakiteapi.xyz/download/127532/1-1">Download</a></div>
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
            ['titleSlug', ['Mushoku Tensei: Jobless Reincarnation']],
            ['titleSlug', ['Mushoku Tensei: Jobless Reincarnation', true]],
        ],
    });
    expect(results).toEqual([
        'kaiju-no-8',
        'overgeared',
        'the-beginning-after-the-end',
        'ranma1-2',
        'jojos-bizarre-adventure',
        'frieren-beyond-journeys-end',
        'mushoku-tensei-jobless-reincarnation',
        'mushoku-tensei:-jobless-reincarnation',
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
        { slot: 0, url: 'https://rubystm.com/e/mvybg38ttztw.html' },
        { slot: 1, url: 'https://filesforever.link/embed/hdoyuqt' },
        { slot: 2, url: 'https://filesforever.link/embed/x7kv57a' },
        { slot: 3, url: 'https://filesforever.link/embed/o4m5b3o' },
        { slot: 4, url: 'https://cloudy.upns.one/#krga1o' },
        { slot: 5, url: 'https://vidmoly.net/embed-c04lu1yyy8i3.html' },
        { slot: 6, url: 'https://abyssplayer.com/LR0L1Adhn' },
        { slot: 7, url: 'https://blakiteapi.xyz/embed/127532/1-1' },
        { slot: 8, url: 'https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f' },
        { slot: 9, url: 'https://strmup.to/PhZJCk0DRSitMN' },
        { slot: 10, url: 'https://turbonewvid.com/t/68bfab1aa350e' },
    ]);
    expect(results[1]).toEqual({
        '1': 'Ruby', '2': 'filesforever', '3': 'filesforever', '4': 'filesforever',
        '5': 'Cloudy', '6': 'Moly', '7': 'Short', '8': 'MultiQ',
    });
});

test("returns exactly the sidebar trio: Play, Short, MultiQ", () => {
    const res = runScenario({
        query: { title: 'Overgeared', s: '1', e: '2' },
        mocks: [{ needle: '/episode/overgeared-1x2/', status: 200, body: EPISODE_HTML }],
    });
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('direct');
    expect(res.body.episodeUrl).toBe('https://toonstream.us/episode/overgeared-1x2/');
    // Exactly the sidebar's promoted three, by host (from /public/servers):
    // SERVER 1 Play = ravok.buzz, 2 Short = abyssplayer, 3 MultiQ = blakite.
    expect(res.body.servers).toEqual([
        { name: 'Play', url: 'https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f' },
        { name: 'Short', url: 'https://abyssplayer.com/LR0L1Adhn' },
        { name: 'MultiQ', url: 'https://blakiteapi.xyz/embed/127532/1-1' },
    ]);
    expect(res.body.embeds).toHaveLength(3);
    // StreamRuby must NEVER be the Play chip (it is server #14 on the site).
    expect(JSON.stringify(res.body.servers)).not.toContain('rubystm');
    expect(JSON.stringify(res.body.embeds)).not.toContain('youtube');
    // chosen = the site's own SERVER 1 PLAY player.
    expect(res.body.chosen).toBe('https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f');
});

test('colon-kept slugs resolve directly (Mushoku S3 live shape)', () => {
    // The site keeps ':' in newer posts:
    //   /episode/mushoku-tensei:-jobless-reincarnation-3x1/
    const res = runScenario({
        query: { title: 'Mushoku Tensei: Jobless Reincarnation', s: '3', e: '1', debug: '1' },
        mocks: [
            {
                needle: 'mushoku-tensei:-jobless-reincarnation-3x1',
                status: 200,
                body: EPISODE_HTML,
            },
        ],
    });
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('direct');
    expect(res.body.episodeUrl).toBe(
        'https://toonstream.us/episode/mushoku-tensei:-jobless-reincarnation-3x1/',
    );
    expect(res.body.servers).toHaveLength(3);
    // Both slug spellings are probed: plain first, then the colon-kept one.
    const directSteps = res.body.steps.filter((x: { step: string }) => x.step === 'episode-direct');
    expect(directSteps).toHaveLength(2);
});

test('trailer-only episode pages are not reported as servers', () => {
    // Live shape of ToonStream pages whose servers are not uploaded yet:
    // the page exists but only embeds the YouTube trailer (Mushoku S3E9+).
    const trailerOnly = `<html><body>
      <iframe src="https://www.youtube.com/embed/k5VxfJpzy1Q"></iframe>
    </body></html>`;
    const res = runScenario({
        query: { title: 'Mushoku Tensei: Jobless Reincarnation', s: '3', e: '9', debug: '1' },
        mocks: [
            {
                needle: 'mushoku-tensei:-jobless-reincarnation-3x9',
                status: 200,
                body: trailerOnly,
            },
        ],
    });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('no-episode');
    expect(JSON.stringify(res.body)).not.toContain('youtube');
    const stepNames = res.body.steps.map((x: { step: string }) => x.step);
    expect(stepNames).toContain('no-servers');
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
            { needle: '/s?q=Overgeared', status: 200, body: SEARCH_HTML },
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
