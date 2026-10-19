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

function run(args: string[], env: Record<string, string> = {}) {
    return execFileSync(process.execPath, [SCRIPT, ...args], {
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

test('the whole Nxsha guide is baked when the season numbers disagree (Ranma case)', () => {
    const code = `
        const mod = await import(${JSON.stringify(new URL(`file://${join(ROOT, 'scripts', 'harvest-toonstream-drops.mjs')}`).href)});
        const season1 = {
          season: { season_number: 1, episode_count: 36, name: 'Season 1' },
          episodes: Array.from({ length: 36 }, (_, i) => ({
            episode_number: i + 1,
            name: i === 14 ? 'Chestnuts Roasting on an Open Fire' : 'Episode ' + (i + 1),
            overview: 'Over ' + (i + 1),
            still_path: '/still' + (i + 1) + '.jpg',
            air_date: i < 12 ? '2024-10-' + String(i + 1).padStart(2, '0') : '2025-10-' + String(i - 11).padStart(2, '0'),
            runtime: 23,
          })),
        };
        const season2 = { season: { season_number: 2, episode_count: 50, name: 'Season 2' }, episodes: Array.from({ length: 50 }, (_, i) => ({ episode_number: i + 1, name: 'B' + (i + 1), still_path: '/b' + i + '.jpg', air_date: '2022-01-01', runtime: 24 })) };
        // Ranma's ToonStream drop is "S3"; Nxsha only has one merged season.
        const ranma = mod.buildShowGuide([season1], mod.pickGuideSeason([season1], 3, 'Ranma1/2'));
        // A dub of a long-running show must not jump to its newest spin-off season.
        const dub = mod.buildShowGuide([season2, season1], mod.pickGuideSeason([season2, season1], 2, 'Bleach Dub'));
        console.log(JSON.stringify({
          variants: mod.titleVariants('Bleach Dub'),
          ranma,
          dubSeason: Object.keys(dub.guide || {}),
          ranmaEp15: ranma.guide['1']['15'],
          ranmaCount: ranma.seasons['1'],
        }));
    `;
    const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
    expect(parsed.variants).toEqual(['Bleach Dub', 'Bleach']);
    // The merged Nxsha season carries all 36 episodes, with the real stills.
    expect(parsed.ranmaCount).toBe(36);
    expect(parsed.ranma.mappedSeason).toBe(1);
    expect(parsed.ranmaEp15.title).toBe('Chestnuts Roasting on an Open Fire');
    expect(parsed.ranmaEp15.image).toContain('still15.jpg');
    // A "Dub" drop opens season 1 even though ToonStream calls it season 2.
    expect(parsed.dubSeason[0]).toBe('1');
    expect(parsed.dubSeason).toContain('2');
});
