// Guards scripts/harvest-toonstream-drops.mjs: the ToonStream home rail is
// resolved to Nxsha ids (catalog registry first, then Nxsha search), the
// dropped season's guide is baked, and the block in crunchyroll.html is kept
// in sync. Network is never touched — the bake runs from a state file.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'harvest-toonstream-drops.mjs');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const OFFLINE_STUB = join(__dirname, 'fixtures', 'toonstream-offline.mjs');
const NEW_EPISODE_STUB = join(__dirname, 'fixtures', 'toonstream-new-episode.mjs');

function run(args: string[], env: Record<string, string> = {}) {
    return execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
}

/** The real harvest, with `fetch` replaced by the offline stub fixture. */
function runOffline(args: string[], env: Record<string, string> = {}, stub = OFFLINE_STUB) {
    return execFileSync(process.execPath, ['--import', stub, SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
}

function stateFile(items: Record<string, any>, updated = '2026-10-19') {
    const dir = mkdtempSync(join(tmpdir(), 'ts-drops-'));
    const file = join(dir, 'toonstream-drops.json');
    writeFileSync(file, JSON.stringify({ updated, source: 'https://toonstream.us/home', items }));
    const html = join(dir, 'crunchyroll.html');
    writeFileSync(html, readFileSync(HTML_PATH, 'utf8'));
    return { dir, file, html };
}

function bakedItems(html: string) {
    const match = /var TS_DROPS=(\[.*?\]);/.exec(html);
    if (!match) throw new Error('TS_DROPS block is missing');
    return JSON.parse(match[1]);
}

jest.setTimeout(60000);

test('the committed block matches the state file', () => {
    const out = run(['--from-state', '--check']);
    expect(out).toContain('in sync');
});

test('bake writes every card once, with its Nxsha guide', () => {
    const { file, html } = stateFile({
        overgeared: {
            title: 'Overgeared',
            slug: 'overgeared',
            img: 'https://image.tmdb.org/t/p/w780/a.jpg',
            season: 1,
            episode: 4,
            episodeUrl: 'https://toonstream.us/episode/overgeared-1x4/',
            nxId: '324502',
            seasons: { 1: 12 },
            firstSeen: '2026-10-19',
            guide: {
                1: {
                    1: { title: 'Legendary Class', overview: 'Grid hopes to strike it rich.', image: 'https://image.tmdb.org/t/p/w300/e1.jpg', runtime: 24 },
                    4: { title: 'Item Crafting Face-Off', image: 'https://image.tmdb.org/t/p/w300/e4.jpg', runtime: 24 },
                },
            },
        },
        'jojo-bizarre': {
            title: "JoJo's Bizarre Adventure",
            slug: "jojo's-bizarre-adventure",
            season: 6,
            episode: 5,
            onSite: true,
            nxId: '45790',
            firstSeen: '2026-10-19',
        },
    });

    const out = run(['--from-state'], { TS_DROPS_STATE_FILE: file, TS_DROPS_HTML_FILE: html });
    expect(out).toContain('2 ToonStream Fresh Drop cards');

    const items = bakedItems(readFileSync(html, 'utf8'));
    expect(items).toHaveLength(2);
    // New-to-the-site titles lead; already-listed ones follow without a guide.
    expect(items[0].title).toBe('Overgeared');
    expect(items[0].guide['1']['4'].title).toBe('Item Crafting Face-Off');
    expect(items[0].episode).toBe(4);
    expect(items[1].onSite).toBe(true);
    expect(items[1].guide).toBeUndefined();

    // A second bake is stable, and --check agrees with it.
    run(['--from-state'], { TS_DROPS_STATE_FILE: file, TS_DROPS_HTML_FILE: html });
    expect(run(['--from-state', '--check'], { TS_DROPS_STATE_FILE: file, TS_DROPS_HTML_FILE: html })).toContain('in sync');
});

test('--check fails when the page block is stale', () => {
    const { file, html } = stateFile({
        overgeared: { title: 'Overgeared', slug: 'overgeared', season: 1, episode: 4, nxId: '324502' },
    });
    expect(() =>
        run(['--from-state', '--check'], { TS_DROPS_STATE_FILE: file, TS_DROPS_HTML_FILE: html }),
    ).toThrow();
    try {
        run(['--from-state', '--check'], { TS_DROPS_STATE_FILE: file, TS_DROPS_HTML_FILE: html });
    } catch (error: any) {
        expect(String(error.stderr)).toContain('out of sync');
    }
});

test('Nxsha search results parse and match by full title only', () => {
    const code = `
        const mod = await import(${JSON.stringify(new URL(`file://${join(ROOT, 'scripts', 'harvest-toonstream-drops.mjs')}`).href)});
        const html = [
          '<a href="/tv/45790"><img alt="JoJo&#39;s Bizarre Adventure"><span>8.5</span><span>2012</span></a>',
          '<a href="/tv/60862"><img alt="JoJo&#39;s Bizarre Adventure"><span>7.0</span><span>1993</span></a>',
          '<a href="/tv/999"><img alt="Darker than Black"><span>7.4</span><span>2007</span></a>',
        ].join('');
        const results = mod.parseNxshaSearchTv(html);
        console.log(JSON.stringify({
          results,
          exact: mod.pickSearchHit(results, "JoJo's Bizarre Adventure"),
          miss: mod.pickSearchHit(results, 'Overgeared'),
          block: mod.dropsBlock([{ title: 'X', slug: 'x', season: 2, episode: 3 }]),
        }));
    `;
    const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
    expect(parsed.results).toEqual([
        { id: '45790', title: "JoJo's Bizarre Adventure" },
        { id: '60862', title: "JoJo's Bizarre Adventure" },
        { id: '999', title: 'Darker than Black' },
    ]);
    // First exact hit wins (the 2012 series sits above the 1993 one on Nxsha).
    expect(parsed.exact.id).toBe('45790');
    // A title that is not in the results is never forced onto one of them.
    expect(parsed.miss).toBeNull();
    expect(parsed.block.startsWith('/*TS_DROPS_START*/')).toBe(true);
    expect(parsed.block).toContain('"season":2');
});

test('one broken series page cannot kill the day (the 2026-10-23 outage)', () => {
    // toonstream.us/series/naruto-shippūden/ answered 500 for days; getText
    // threw, harvest() died, and the row stayed on the 2026-10-19 state while
    // the workflow's continue-on-error hid it. Now a bad page is a warning:
    // every drop still lands in the state, with its own S/E from the rail.
    const dir = mkdtempSync(join(tmpdir(), 'ts-drops-offline-'));
    const state = join(dir, 'toonstream-drops.json');
    const html = join(dir, 'crunchyroll.html');
    writeFileSync(html, readFileSync(HTML_PATH, 'utf8'));

    const out = runOffline([], {
        TS_DROPS_STATE_FILE: state,
        TS_DROPS_HTML_FILE: html,
        TS_DROPS_DATE: '2026-10-23',
    });
    expect(out).toContain('2 fresh drops');

    const baked = JSON.parse(readFileSync(state, 'utf8'));
    expect(baked.updated).toBe('2026-10-23');
    expect(Object.keys(baked.items).sort()).toEqual(['broken-show', 'the-ramparts-of-ice']);

    // The drop whose series page 500'd keeps its rail S/E and stays playable.
    const ramparts = baked.items['the-ramparts-of-ice'];
    expect(ramparts.season).toBe(2);
    expect(ramparts.episode).toBe(4);
    expect(ramparts.episodeUrl).toBe('https://toonstream.us/episode/the-ramparts-of-ice-2x4/');
    // …and its Nxsha guide still gets built from the rail's own S/E fallback.
    expect(ramparts.guide).toBeTruthy();

    // No Nxsha show → no guide, but the card is still baked.
    const broken = baked.items['broken-show'];
    expect(broken.season).toBe(1);
    expect(broken.episode).toBe(3);
    expect(broken.guide).toBeUndefined();

    const items = bakedItems(readFileSync(html, 'utf8'));
    expect(items.map((item: any) => item.slug).sort()).toEqual(['broken-show', 'the-ramparts-of-ice']);
});

test('ToonStream decides the seasons; Nxsha only fills the metadata', () => {
    const code = `
        const mod = await import(${JSON.stringify(new URL(`file://${join(ROOT, 'scripts', 'harvest-toonstream-drops.mjs')}`).href)});
        const seriesHtml = [
          '<a class="season-btn active" data-season="1" data-url="/series/ranma1-2/season/1">Season 1</a>',
          '<a class="season-btn" data-season="2" data-url="/series/ranma1-2/season/2">Season 2</a>',
          '<a class="season-btn" data-season="3" data-url="/series/ranma1-2/season/3">Season 3</a>',
        ].join('');
        const seasonPage = Array.from({ length: 12 }, (_, i) => '<a href="/episode/ranma1-2-2x' + (i + 1) + '/">x</a>').join('');
        const nxMerged = {
          season: { season_number: 1, episode_count: 36 },
          episodes: Array.from({ length: 36 }, (_, i) => ({
            episode_number: i + 1,
            name: i === 24 ? 'Kunoichi and the Pig' : 'Episode ' + (i + 1),
            overview: 'Over ' + (i + 1),
            still_path: '/still' + (i + 1) + '.jpg',
            air_date: '2025-10-' + String((i % 28) + 1).padStart(2, '0'),
            runtime: 23,
          })),
        };
        const nxSplit = [
          { season: { season_number: 1 }, episodes: Array.from({ length: 12 }, (_, i) => ({ episode_number: i + 1, name: 'S1E' + (i + 1) })) },
          { season: { season_number: 2 }, episodes: Array.from({ length: 12 }, (_, i) => ({ episode_number: i + 1, name: 'S2E' + (i + 1) })) },
        ];
        // Ranma: ToonStream 12 + 12 + 3, Nxsha one merged 36-episode season.
        const merged = mod.buildShowGuide([{ n: 1, count: 12 }, { n: 2, count: 12 }, { n: 3, count: 3 }], [nxMerged]);
        // Elusive Samurai: both carry real seasons with matching counts.
        const split = mod.buildShowGuide([{ n: 1, count: 12 }, { n: 2, count: 11 }], nxSplit);
        console.log(JSON.stringify({
          slug: mod.seriesSlugFromEpisode('https://toonstream.us/episode/ranma1-2-3x3/'),
          jojo: mod.seriesSlugFromEpisode("https://toonstream.us/episode/jojo's-bizarre-adventure-6x5/"),
          seasons: mod.parseToonSeasons(seriesHtml),
          eps: mod.parseSeasonEpisodes(seasonPage),
          merged,
          split,
        }));
    `;
    const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
    expect(parsed.slug).toBe('ranma1-2');
    expect(parsed.jojo).toBe("jojo's-bizarre-adventure");
    expect(parsed.seasons.map((s: any) => s.n)).toEqual([1, 2, 3]);
    expect(parsed.eps).toEqual({ count: 12, first: 1, last: 12, missing: [] });

    // ToonStream's own counts, never Nxsha's merged 36.
    expect(parsed.merged.seasons).toEqual({ 1: 12, 2: 12, 3: 3 });
    // S3 of ToonStream starts at Nxsha episode 25 (12 + 12 offset).
    expect(parsed.merged.nxMap['3']).toEqual({ season: 1, base: 24 });
    expect(parsed.merged.guide['3']['1'].title).toBe('Kunoichi and the Pig');
    expect(parsed.merged.guide['3']['1'].image).toContain('still25.jpg');
    expect(parsed.merged.guide['2']['12'].title).toBe('Episode 24');

    // When Nxsha carries the same seasons, the numbers map one-to-one.
    expect(parsed.split.nxMap['2']).toEqual({ season: 2, base: 0 });
    expect(parsed.split.guide['2']['11'].title).toBe('S2E11');
});

test('home rail purana ho to series page se naya episode card par chadhta hai', () => {
    // Owner: "crunchyroll par toonstream se new episode fetch nhi kiya hai" —
    // ToonStream ka home rail din me ek baar banta hai (wahan S2E4 pada tha),
    // par series page S2 me E6 tak dikhata hai. Card par E6 hi jana chahiye,
    // aur wo naya episode "New" bhi dikhna chahiye (firstSeen = aaj).
    const dir = mkdtempSync(join(tmpdir(), 'ts-drops-new-ep-'));
    const state = join(dir, 'toonstream-drops.json');
    const html = join(dir, 'crunchyroll.html');
    writeFileSync(html, readFileSync(HTML_PATH, 'utf8'));

    const out = runOffline(
        [],
        {
            TS_DROPS_STATE_FILE: state,
            TS_DROPS_HTML_FILE: html,
            TS_DROPS_DATE: '2026-10-24',
        },
        NEW_EPISODE_STUB,
    );
    expect(out).toContain('1 fresh drops');

    const baked = JSON.parse(readFileSync(state, 'utf8'));
    const item = baked.items['the-ramparts-of-ice'];
    expect(item.season).toBe(2);
    expect(item.episode).toBe(6);
    expect(item.episodeUrl).toBe('https://toonstream.us/episode/the-ramparts-of-ice-2x6/');
    expect(item.episodeSeen).toBe('2026-10-24');
    // Naya episode = naya drop → row us din "New" dikhati hai.
    expect(item.firstSeen).toBe('2026-10-24');

    const items = bakedItems(readFileSync(html, 'utf8'));
    expect(items[0].episode).toBe(6);
    expect(items[0].episodeSeen).toBe('2026-10-24');
});

test('newestEpisode/isNewerEpisode — season pehle, phir episode', () => {
    const code = `
        const mod = await import(${JSON.stringify(new URL(`file://${join(ROOT, 'scripts', 'harvest-toonstream-drops.mjs')}`).href)});
        const newest = (seasons) => mod.newestEpisode(seasons);
        const newer = (a, b) => mod.isNewerEpisode(a, b);
        console.log(JSON.stringify({
            pick: newest([{ n: 1, count: 12 }, { n: 2, count: 6, first: 1, last: 6 }, { n: 3, count: 2 }]),
            same: newer({ season: 2, episode: 6 }, { season: 2, episode: 6 }),
            older: newer({ season: 2, episode: 5 }, { season: 2, episode: 6 }),
            nextSeason: newer({ season: 3, episode: 1 }, { season: 2, episode: 12 }),
            railAhead: newer({ season: 2, episode: 4 }, { season: 2, episode: 6 }),
            empty: newest([]),
            missingEpisode: newest([{ n: 4, count: 3 }]),
        }));
    `;
    const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
    expect(parsed.pick).toEqual({ season: 3, episode: 2 });
    expect(parsed.same).toBe(false);
    expect(parsed.older).toBe(false);
    expect(parsed.nextSeason).toBe(true);
    expect(parsed.railAhead).toBe(false);
    expect(parsed.empty).toBeNull();
    expect(parsed.missingEpisode).toEqual({ season: 4, episode: 3 });
});
