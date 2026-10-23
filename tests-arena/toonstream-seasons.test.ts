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

/**
 * Reads one of the page's baked `var X={...}` blocks back as JSON. Tests must
 * never hardcode a season/episode count: the daily harvest refreshes them from
 * ToonStream, so a hardcoded number goes stale the moment the site edits a
 * season (ToonStream dropped One Piece season 16, then MHA's row disappeared
 * from its season harvest).
 */
function bakedVar<T = any>(name: string): T {
    const html = readFileSync(HTML_PATH, 'utf8');
    const start = html.indexOf(`var ${name}=`);
    if (start === -1) throw new Error(`baked ${name} block not found`);
    const open = html.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < html.length; i += 1) {
        if (html[i] === '{') depth += 1;
        else if (html[i] === '}') {
            depth -= 1;
            if (!depth) return JSON.parse(html.slice(open, i + 1)) as T;
        }
    }
    throw new Error(`unbalanced ${name} block`);
}

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
        const { buildSeasonMap, compactPlan, parseSeasonEpisodes } = await import(${JSON.stringify(
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
        // Demon Slayer's ToonStream S2 (18) is Nxsha S2 (7) + S3 (11).
        const cross = buildSeasonMap(
          [{ n: 1, count: 26 }, { n: 2, count: 18 }, { n: 3, count: 11 }],
          [
            { season: { season_number: 1 }, count: 26 },
            { season: { season_number: 2 }, count: 7 },
            { season: { season_number: 3 }, count: 11 },
          ],
        );
        // One Piece's ToonStream S1 starts at absolute episode 6, so its first
        // card is Nxsha's episode 6 (base 5), not episode 1.
        const offset = buildSeasonMap(
          [{ n: 1, count: 56, start: 6 }, { n: 2, count: 16, start: 62 }],
          [{ season: { season_number: 1 }, count: 61 }, { season: { season_number: 2 }, count: 16 }],
        );
        // When a site season carries one extra card (Trigun: 12 vs Nxsha 11),
        // the next season still anchors to its own Nxsha season instead of
        // shifting every later episode by one.
        const anchored = buildSeasonMap(
          [{ n: 1, count: 12 }, { n: 2, count: 12 }],
          [{ season: { season_number: 1 }, count: 11 }, { season: { season_number: 2 }, count: 12 }],
        );
        // A Hindi-dub season numbers episodes absolutely: S2 starts at 33.
        const absolute = parseSeasonEpisodes(
          Array.from({ length: 21 }, (_, i) => '<a href="/episode/naruto-shippuden-hindi-dub-2x' + (33 + i) + '/">x</a>').join(''),
        );
        console.log(JSON.stringify({
          merged: { map: merged.map, flat: merged.flat.length },
          split: { map: split.map },
          cross: { map: cross.map, compact: compactPlan(cross.map['2']) },
          offset: offset.map,
          anchored: anchored.map,
          absolute,
        }));
    `;
    const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
    // JJK: ToonStream 24 + 23 + 12, Nxsha merged all 59 into season 1.
    expect(parsed.merged.map['2']).toMatchObject({ season: 1, base: 24, start: 24, count: 23 });
    expect(parsed.merged.map['3']).toMatchObject({ season: 1, base: 47, start: 47, count: 12 });
    // Apothecary/JJK-style split: S2 starts at the 25th Nxsha episode.
    expect(parsed.split.map['2']).toMatchObject({ season: 2, base: 0, start: 24, count: 24 });
    // A season crossing an Nxsha boundary keeps both segments.
    expect(parsed.cross.map['2'].segments).toEqual([
        { season: 2, from: 1, count: 7 },
        { season: 3, from: 1, count: 11 },
    ]);
    expect(parsed.cross.compact).toEqual({ seg: [[2, 1, 7], [3, 1, 11]] });
    expect(parsed.offset['1']).toMatchObject({ season: 1, base: 5, start: 5, count: 56 });
    expect(parsed.offset['2']).toMatchObject({ season: 2, base: 0, start: 61, count: 16 });
    expect(parsed.anchored['1'].segments).toEqual([{ season: 1, from: 1, count: 11 }]);
    expect(parsed.anchored['2']).toMatchObject({ season: 2, base: 0, start: 11, count: 12 });
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
        'in sync (2 shows',
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

function boot(htmlOverride?: string): Boot {
    const html = htmlOverride || readFileSync(HTML_PATH, 'utf8');
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
    // Naruto is also on today's Fresh Drop rail (ToonStream S17E368), so the
    // detail opens on the dropped season first — exactly like every other drop
    // card. Season 1 stays one click away, and its layout is still ToonStream's.
    expect(select.value).toBe('17');
    expect(select.options[0].textContent).toContain('Season 1 (');
    select.value = '2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(100);
    // Season 2 has 21 episodes, numbered 33..53 on the site.
    const list = doc.getElementById('episodeList')!;
    expect(list.querySelectorAll('.episode-card')).toHaveLength(21);
    // Nxsha numbers that season 33..53 too; the guide is re-keyed to 1..21.
    expect(list.textContent).toContain('The New Target');
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
    // Data-driven: every season ToonStream currently lists must be offered, and
    // nothing else. The list skips numbers the site has taken down (season 16
    // vanished from One Piece's ToonStream layout), so the option count follows
    // the bake instead of a hardcoded 22.
    const onePiece = bakedVar<Record<string, any>>('TS_SEASONS').onepiece.seasons as Record<string, number>;
    const seasonNumbers = Object.keys(onePiece).sort((a, b) => Number(a) - Number(b));
    expect(options).toHaveLength(seasonNumbers.length);
    expect(options[0]).toBe('Season 1 (56)');
    expect(options[seasonNumbers.length - 1]).toBe(
        `Season ${seasonNumbers[seasonNumbers.length - 1]} (${onePiece[seasonNumbers[seasonNumbers.length - 1]]})`,
    );
    const list = doc.getElementById('episodeList')!;
    expect(list.querySelectorAll('.episode-card')).toHaveLength(56);
    // ToonStream's S1 starts at absolute episode 6, so the first card is Nxsha's episode 6.
    expect(list.textContent).toContain('Desperate Situation! Beast Tamer Mohji vs Luffy!');
    // Season 2 starts at absolute episode 62 on the site and in Nxsha's guide.
    select.value = '2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(100);
    const season2 = doc.getElementById('episodeList')!;
    expect(season2.querySelectorAll('.episode-card')).toHaveLength(16);
    expect(season2.textContent).toContain('The First Line of Defense? The Giant Whale Laboon Appears!');
    select.value = '1';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(100);
    const thumb = doc.querySelector('#episodeList .episode-card img')!;
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

test('a ToonStream season that crosses an Nxsha boundary keeps every episode', async () => {
    const { dom } = boot();
    const doc = dom.window.document;
    await wait(300);
    await openCard(dom.window, 'demon');
    const select = doc.getElementById('seasonSelect') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(120);
    const cards = Array.from(doc.querySelectorAll('#episodeList .episode-card'));
    expect(cards).toHaveLength(18);
    // ToonStream S2E8 is Nxsha S3E1 (its S2 only has the 7 Mugen Train episodes).
    expect(cards[7].querySelector('strong')?.textContent).toBe('Sound Hashira: Tengen Uzui');
    expect(cards[7].querySelector('img')?.getAttribute('data-src')).toContain('image.tmdb.org');
    click(dom.window, cards[7]);
    await wait(150);
    click(dom.window, doc.getElementById('stagePoster'));
    await wait(250);
    expect(doc.getElementById('serverFrame')!.getAttribute('src')).toContain('/embed/tv/tt9335498/3/1?');
    dom.window.close();
});

test('a missing Nxsha still falls back to the ToonStream episode image', async () => {
    // ToonStream lists one more Trigun episode (12) than Nxsha has metadata for
    // (11), so that last card has no Nxsha still and must borrow the site's own
    // card image from TS_EP_IMAGES.
    const seasons = bakedVar<Record<string, any>>('TS_SEASONS').trigun.seasons as Record<string, number>;
    const lastEp = seasons['1'];
    expect(lastEp).toBeGreaterThan(11); // fixture guard: still ahead of Nxsha
    const baked = readFileSync(HTML_PATH, 'utf8').replace(
        /var TS_EP_IMAGES=\{.*?\};\n/,
        `var TS_EP_IMAGES={"trigun":{"1":{"${lastEp}":"https://image.tmdb.org/t/p/w780/toonstream-still.jpg"}}};\n`,
    );
    const { dom } = boot(baked);
    const doc = dom.window.document;
    await wait(300);
    await openCard(dom.window, 'trigun');
    const cards = Array.from(doc.querySelectorAll('#episodeList .episode-card'));
    expect(cards).toHaveLength(lastEp);
    expect(cards[lastEp - 1].querySelector('img')?.getAttribute('data-src')).toBe(
        'https://image.tmdb.org/t/p/w780/toonstream-still.jpg',
    );
    dom.window.close();
});
