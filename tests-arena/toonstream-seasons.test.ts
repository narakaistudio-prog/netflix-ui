// Guards scripts/harvest-toonstream-seasons.mjs: every anime card takes its
// season layout from ToonStream (24 + 23 + 12 for JJK, 24 + 24 for Apothecary
// Diaries) while Nxsha only supplies the episode metadata at the mapped
// coordinates. Also guards the DeadToons removal: the daily rail no longer has
// a DeadToons schedule builder or block.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'harvest-toonstream-seasons.mjs');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function run(args: string[], env: Record<string, string> = {}) {
    return execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
}

jest.setTimeout(60000);

test('the committed TS_SEASONS block matches the state file', () => {
    expect(run(['--from-state', '--check'])).toContain('in sync');
});

test('Nxsha is mapped by cumulative position, not by season number', () => {
    const code = `
        const { buildSeasonMap, parseSeasonEpisodes } = await import(${JSON.stringify(
            new URL(`file://${join(ROOT, 'scripts', 'lib', 'seasons.mjs')}`).href,
        )});
        const merged = buildSeasonMap(
          [{ n: 1, count: 24 }, { n: 2, count: 23 }, { n: 3, count: 12 }],
          [{ season: { season_number: 1 }, count: 59 }],
        );
        const split = buildSeasonMap(
          [{ n: 1, count: 24 }, { n: 2, count: 24 }],
          [{ season: { season_number: 1 }, count: 24 }, { season: { season_number: 2 }, count: 36 }],
        );
        // A Hindi-dub season numbers episodes absolutely: S2 starts at 33.
        const absolute = parseSeasonEpisodes(
          Array.from({ length: 21 }, (_, i) => '<a href="/episode/naruto-shippuden-hindi-dub-2x' + (33 + i) + '/">x</a>').join(''),
        );
        console.log(JSON.stringify({
          merged: { map: merged.map, flat: merged.flat.length },
          split: { map: split.map },
          absolute,
        }));
    `;
    const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
    // JJK: ToonStream 24 + 23 + 12, Nxsha merged all 59 into season 1.
    expect(parsed.merged.map['2']).toEqual({ season: 1, base: 24, start: 24, count: 23 });
    expect(parsed.merged.map['3']).toEqual({ season: 1, base: 47, start: 47, count: 12 });
    // Apothecary/JJK-style split: S2 starts at the 25th Nxsha episode.
    expect(parsed.split.map['2']).toEqual({ season: 2, base: 0, start: 24, count: 24 });
    // Absolute numbering: 21 episodes starting at 33, not 53.
    expect(parsed.absolute).toEqual({ count: 21, first: 33, last: 53, missing: [] });
});

test('the bake writes epStart and the Nxsha map for every found show', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-seasons-'));
    const state = join(dir, 'toonstream-seasons.json');
    const html = join(dir, 'crunchyroll.html');
    writeFileSync(
        state,
        JSON.stringify({
            updated: '2026-10-19',
            shows: {
                jjk: { slug: 'jujutsu-kaisen', seasons: { 1: 24, 2: 23 }, nxMap: { 1: { season: 1, base: 0 }, 2: { season: 1, base: 24 } } },
                naruto: {
                    slug: 'naruto-shippuden-hindi-dub',
                    seasons: { 1: 32, 2: 21 },
                    epStart: { 2: 33 },
                    nxMap: { 1: { season: 1, base: 0 }, 2: { season: 2, base: 0 } },
                },
            },
        }),
    );
    writeFileSync(html, readFileSync(HTML_PATH, 'utf8'));
    run(['--from-state'], { TS_SEASONS_STATE_FILE: state, TS_SEASONS_HTML_FILE: html });
    const baked = readFileSync(html, 'utf8');
    expect(baked).toContain('"jujutsu-kaisen"');
    expect(baked).toContain('"epStart":{"2":33}');
    expect(run(['--from-state', '--check'], { TS_SEASONS_STATE_FILE: state, TS_SEASONS_HTML_FILE: html })).toContain(
        'in sync (2 shows)',
    );
});

test('DeadToons is gone from the daily rail', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).not.toContain('/*CR_DROPS_START*/');
    expect(html).not.toContain('var CR_NEW_DROPS=');
    expect(existsSync(join(ROOT, 'scripts', 'build-crunchyroll-new-drops.mjs'))).toBe(false);
    expect(existsSync(join(ROOT, 'scripts', 'harvest-deadtoons-schedule.mjs'))).toBe(false);
    expect(existsSync(join(ROOT, 'data', 'deadtoons-schedule.json'))).toBe(false);
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'crunchyroll-daily-drops.yml'), 'utf8');
    expect(workflow).toContain('harvest-toonstream-seasons.mjs');
    expect(workflow).not.toContain('harvest-deadtoons-schedule.mjs');
    expect(workflow).not.toContain('build-crunchyroll-new-drops.mjs');
});

type Boot = { dom: JSDOM; calls: string[] };

function boot(): Boot {
    const html = readFileSync(HTML_PATH, 'utf8');
    const calls: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    virtualConsole.on('error', () => {});
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
        beforeParse(window) {
            (window as any).fetch = (input: any) => {
                calls.push(String(input));
                if (String(input).indexOf('/api/toonstream?') !== -1) {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                ok: true,
                                chosen: 'https://ravok.buzz/video/jjk',
                                servers: [{ name: 'Play', url: 'https://ravok.buzz/video/jjk' }],
                            }),
                    });
                }
                return Promise.reject(new Error('unexpected fetch ' + input));
            };
        },
    });
    return { dom, calls };
}

async function openCard(window: JSDOM['window'], key: string) {
    const doc = window.document;
    const card = doc.createElement('button');
    card.setAttribute('data-open', key);
    doc.body.appendChild(card);
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(150);
}

test('JJK and Apothecary Diaries show ToonStream seasons, not one merged season', async () => {
    const { dom } = boot();
    const doc = dom.window.document;
    await wait(300);

    await openCard(dom.window, 'jjk');
    let select = doc.getElementById('seasonSelect') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => (o.textContent || '').trim())).toEqual([
        'Season 1 (24)',
        'Season 2 (23)',
        'Season 3 (12)',
    ]);
    select.value = '2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(100);
    let list = doc.getElementById('episodeList')!;
    expect(list.querySelectorAll('.episode-card')).toHaveLength(23);
    // S2E1 is Nxsha's episode 25 (Nxsha merged both cours into season 1).
    expect(list.textContent).toContain('Hidden Inventory');

    await openCard(dom.window, 'apothecary');
    select = doc.getElementById('seasonSelect') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => (o.textContent || '').trim())).toEqual(['Season 1 (24)', 'Season 2 (24)']);
    select.value = '2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(100);
    list = doc.getElementById('episodeList')!;
    expect(list.querySelectorAll('.episode-card')).toHaveLength(24);
    expect(list.textContent).toContain('Maomao and Maomao');
    dom.window.close();
});

test('an absolutely numbered dub season plays the right ToonStream episode', async () => {
    const { dom, calls } = boot();
    const doc = dom.window.document;
    await wait(300);
    await openCard(dom.window, 'naruto');
    const select = doc.getElementById('seasonSelect') as HTMLSelectElement;
    expect(select.value).toBe('1');
    select.value = '2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(100);
    // Season 2 has 21 episodes, numbered 33..53 on the site.
    expect(doc.getElementById('episodeList')!.querySelectorAll('.episode-card')).toHaveLength(21);
    click(dom.window, doc.querySelector('#episodeList .episode-card'));
    await wait(200);
    click(dom.window, doc.getElementById('tsServerBtn'));
    const deadline = Date.now() + 5000;
    while (!calls.some((url) => url.indexOf('/api/toonstream?') !== -1) && Date.now() < deadline) await wait(60);
    const request = decodeURIComponent(calls.find((url) => url.indexOf('/api/toonstream?') !== -1) || '');
    expect(request).toContain('slug=naruto-shippuden-hindi-dub');
    expect(request).toContain('s=2&e=33');
    dom.window.close();
});

function click(window: JSDOM['window'], element: Element | null) {
    if (!element) throw new Error('missing element');
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

test('One Piece shows every ToonStream season and its own Nxsha guide', async () => {
    const { dom, calls } = boot();
    const doc = dom.window.document;
    await wait(300);
    await openCard(dom.window, 'onepiece');
    const select = doc.getElementById('seasonSelect') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => (option.textContent || '').trim());
    expect(options).toHaveLength(22);
    expect(options[0]).toBe('Season 1 (56)');
    expect(options[21]).toBe('Season 22 (64)');
    const list = doc.getElementById('episodeList')!;
    expect(list.querySelectorAll('.episode-card')).toHaveLength(56);
    // ToonStream's S1 starts at absolute episode 6, so the first card is Nxsha's episode 6.
    expect(list.textContent).toContain('Desperate Situation! Beast Tamer Mohji vs Luffy!');
    const thumb = list.querySelector('.episode-card img')!;
    expect(thumb.getAttribute('data-src') || thumb.innerHTML || '').toContain('image.tmdb.org');

    click(dom.window, doc.querySelector('#episodeList .episode-card'));
    await wait(120);
    click(dom.window, doc.getElementById('demoPlay'));
    await wait(80);
    click(dom.window, doc.getElementById('stagePoster'));
    await wait(250);
    expect(doc.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/37854/1/6?server=GbruHindi',
    );

    click(dom.window, doc.getElementById('tsServerBtn'));
    const deadline = Date.now() + 5000;
    while (!calls.some((url) => url.indexOf('/api/toonstream?') !== -1) && Date.now() < deadline) await wait(60);
    const request = decodeURIComponent(calls.find((url) => url.indexOf('/api/toonstream?') !== -1) || '');
    expect(request).toContain('slug=one-piece-dub-sub');
    expect(request).toContain('s=1&e=6');
    dom.window.close();
});
