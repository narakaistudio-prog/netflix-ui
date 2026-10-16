// Guards the "Fresh Drops" row on the Crunchyroll page: the DeadToons release
// schedule (today + upcoming, every card Nxsha-backed) leads the row, the nxsha
// drop state fills the rest, and the baked block in assets/crunchyroll/crunchyroll.html
// keeps working in a browser (JSDOM here, no network).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const SCRIPT = join(ROOT, 'scripts', 'build-crunchyroll-new-drops.mjs');
const SCHEDULE_SCRIPT = join(ROOT, 'scripts', 'harvest-deadtoons-schedule.mjs');
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'data', 'nxsha-titles.json'), 'utf8')) as Record<string, { id: string; kind: string; title: string }>;

const POSTER = 'https://image.tmdb.org/t/p/w300/poster.jpg';

type RailItem = {
    key: string;
    source: string;
    title: string;
    firstSeen: string;
    fresh: boolean;
    img: string;
    id: string;
    kind: string;
    seasons?: Record<string, number>;
    verb?: string;
    season?: number | null;
    episode?: number | null;
};

// The harvester is an ES module; Jest here runs CommonJS, so the checks below
// evaluate it in a child Node process and read the JSON result back.
const SCHEDULE_URL = pathToFileURL(SCHEDULE_SCRIPT).href;
function callHarvester(expression: string): any {
    const code = `const m = await import(${JSON.stringify(SCHEDULE_URL)});\nconsole.log(JSON.stringify(await (${expression})));`;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
}

// One still from Nxsha's episode API, baked for the guided card below.
const EPISODE_STILL = 'https://image.tmdb.org/t/p/w300/iPT7iMdv1W5ThQDgPhWpBTAkX3T.jpg';

function nxshaCard(overrides: Record<string, unknown> = {}) {
    return {
        kind: 'tv', id: '1', title: 'Show', img: POSTER, rating: '8.1', year: '2021',
        firstSeen: '2026-10-14', baseline: true, ...overrides,
    };
}

/** One entry of data/deadtoons-schedule.json, as the harvester writes it. */
function scheduleEntry(overrides: Record<string, unknown> = {}) {
    return {
        key: 'sch-show-season-1-2026',
        title: 'Show',
        slug: 'show-season-1-2026',
        url: 'https://deadtoons.sbs/posts/show-season-1-2026',
        img: POSTER,
        season: 1,
        episode: 3,
        audio: '',
        date: '2026-10-15',
        time: '1:30 PM',
        today: true,
        nx: { id: '12345', kind: 'tv', seasons: { 1: 12 }, from: 'tmdb' },
        ...overrides,
    };
}

/**
 * What the builder would put in the Fresh Drops row.
 *
 * The bake writes to a throwaway copy of the page, so the checked-in page is
 * never touched, and takes both state files as fixtures.
 */
function bakeFor(items: { nxsha?: Record<string, unknown>; schedule?: Record<string, unknown>[] }) {
    const dir = mkdtempSync(join(tmpdir(), 'cr-drops-'));
    const nxsha = join(dir, 'crunchyroll-new-drops.json');
    const schedule = join(dir, 'deadtoons-schedule.json');
    const page = join(dir, 'page.html');
    writeFileSync(nxsha, JSON.stringify({ updated: '2026-10-15', items: items.nxsha ?? {} }));
    writeFileSync(
        schedule,
        JSON.stringify({ updated: '2026-10-15', source: 'https://deadtoons.sbs/schedule', items: items.schedule ?? [] }),
    );
    copyFileSync(HTML_PATH, page);
    const env = {
        ...process.env,
        DROPS_STATE_FILE: nxsha,
        DROPS_SCHEDULE_FILE: schedule,
        DROPS_HTML_FILE: page,
    };

    const dry = execFileSync(process.execPath, [SCRIPT, '--from-state', '--dry-run'], { encoding: 'utf8', env, timeout: 30000 });
    const plan = JSON.parse(dry) as { mode: string; items: RailItem[] };
    execFileSync(process.execPath, [SCRIPT, '--from-state'], { encoding: 'utf8', env, timeout: 30000 });
    return { ...plan, page };
}

describe('Fresh Drops rail selection', () => {
    test("today's DeadToons episodes lead the row, in clock order, ahead of the pool fillers", () => {
        const rail = bakeFor({
            nxsha: { 'tv:9': nxshaCard({ id: '9', title: 'Pool Show', firstSeen: '2026-10-14' }) },
            schedule: [
                scheduleEntry({ key: 'sch-jojo', title: "JoJo's Bizarre Adventure", time: '1:30 PM', nx: { id: '45790', kind: 'tv', seasons: { 4: 28 } } }),
                scheduleEntry({ key: 'sch-ramparts', title: 'The Ramparts of Ice', slug: 'the-ramparts-of-ice-season-2-2026', time: '12:00 PM', season: 2, episode: 3, nx: { id: '273109', kind: 'tv', seasons: { 2: 3 } } }),
                scheduleEntry({ key: 'sch-apothecary', title: 'The Apothecary Diaries', today: false, date: '2026-10-23', time: '12:30 PM', season: 3, episode: 1, nx: { id: '220542', kind: 'tv', seasons: { 3: 1 } } }),
            ],
        });
        expect(rail.mode).toBe('today');
        expect(rail.items.map(i => i.title)).toEqual([
            'The Ramparts of Ice',
            "JoJo's Bizarre Adventure",
            'The Apothecary Diaries',
            'Pool Show',
        ]);
        // Only today's episodes get the NEW flag; the upcoming one says when it airs.
        expect(rail.items.filter(i => i.fresh).map(i => i.title)).toEqual(['The Ramparts of Ice', "JoJo's Bizarre Adventure"]);
        const upcoming = rail.items.find(i => i.title === 'The Apothecary Diaries');
        expect(upcoming?.verb).toBe('Airs');
        expect(upcoming?.firstSeen).toBe('2026-10-23');
        // Every card carries a real Nxsha id — that is what makes the row play.
        expect(rail.items.every(i => /^\d+$/.test(i.id))).toBe(true);
        expect(rail.items.map(i => i.source)).toEqual(['deadtoons', 'deadtoons', 'deadtoons', 'nxsha']);
    });

    test('the row only reaches 12 cards and keeps pool fillers last', () => {
        const schedule = Array.from({ length: 4 }, (_, i) =>
            scheduleEntry({ key: `sch-${i}`, title: `Schedule Show ${i}`, slug: `schedule-show-${i}`, time: `${1 + i}:00 PM`, nx: { id: `${900 + i}`, kind: 'tv', seasons: { 1: 12 } } }),
        );
        const nxsha = Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [`tv:${100 + i}`, nxshaCard({ id: `${100 + i}`, title: `Pool Show ${i}`, firstSeen: `2026-10-${String(10 + (i % 5)).padStart(2, '0')}` })]),
        );
        const rail = bakeFor({ nxsha, schedule });
        expect(rail.items).toHaveLength(12);
        expect(rail.items.slice(0, 4).every(i => i.source === 'deadtoons')).toBe(true);
        expect(rail.items[4].source).toBe('nxsha');
    });

    test('a schedule title the catalog carries reuses the catalog card key', () => {
        const aot = REGISTRY.aot;
        const rail = bakeFor({
            schedule: [scheduleEntry({ key: 'sch-aot', title: aot.title, nx: { id: aot.id, kind: aot.kind, seasons: { 4: 28 } } })],
        });
        expect(rail.items[0].key).toBe('aot');
        expect(rail.items[0].id).toBe(aot.id);
    });

    test('schedule entries without a verified Nxsha id never reach the row', () => {
        const rail = bakeFor({
            nxsha: { 'tv:9': nxshaCard({ id: '9', title: 'Pool Show' }) },
            schedule: [
                scheduleEntry({ key: 'sch-unknown', title: 'Unknown Show', nx: null }),
                scheduleEntry({ key: 'sch-known', title: 'Playable Show', nx: { id: '555', kind: 'tv', seasons: { 1: 5 } } }),
            ],
        });
        expect(rail.items.map(i => i.title)).toEqual(['Playable Show', 'Pool Show']);
    });

    test('nxsha-only state still fills the row from the newest pool titles', () => {
        const rail = bakeFor({
            nxsha: {
                'tv:1': nxshaCard({ title: 'Older Pool Title', firstSeen: '2026-10-12' }),
                'tv:2': nxshaCard({ id: '2', title: 'Newer Pool Title', firstSeen: '2026-10-14' }),
            },
        });
        expect(rail.mode).toBe('pool');
        expect(rail.items.map(i => i.title)).toEqual(['Newer Pool Title', 'Older Pool Title']);
        expect(rail.items.every(i => !i.fresh)).toBe(true);
    });

    test('adult listings, catalog titles and duplicates stay off the pool filler', () => {
        const rail = bakeFor({
            nxsha: {
                'tv:1': nxshaCard({ id: '1', title: 'Harem Camp!', stateKey: 'tv:207840' }),
                'tv:2': nxshaCard({ id: '2', title: 'Attack on Titan Movie' }),
                'tv:3': nxshaCard({ id: '3', title: REGISTRY.solo.title }),
                'tv:4': nxshaCard({ id: '4', title: 'Kagurabachi' }),
                'tv:5': nxshaCard({ id: '5', title: 'Kagurabachi' }),
            },
        });
        // Only the pool filler is filtered: the schedule may repeat a catalog title on purpose.
        expect(rail.items.map(i => i.title)).toEqual(['Kagurabachi']);
        expect(rail.items).toHaveLength(1);
    });

    test('an empty pool leaves the row out instead of rendering it blank', () => {
        const rail = bakeFor({ nxsha: { 'tv:1': nxshaCard({ title: 'Harem Camp!' }) } });
        expect(rail.items).toEqual([]);
    });
});

describe('DeadToons schedule harvester', () => {
    test('offline parser self-tests pass', () => {
        const out = execFileSync(process.execPath, [SCHEDULE_SCRIPT, '--self-test'], { encoding: 'utf8', timeout: 60000 });
        expect(out).toContain('All DeadToons schedule self-tests passed');
    }, 60000);

    test('the schedule page becomes dated, playable entries', () => {
        const parsed = callHarvester(`(() => {
            const html = \`<section class="days"><button>Thu15 Today 6</button></div>
                <a href="https://deadtoons.sbs/posts/jojo-s-bizarre-adventure-season-4-2018">
                  <img src="https://image.tmdb.org/t/p/w154/cMF.jpg" alt="JoJo's Bizarre Adventure">
                  <div>JoJo's Bizarre Adventure</div><span>S4 · Episode 5</span><time>1:30 PM</time>
                </a>
                <section class="upcoming"><h2>Upcoming</h2>
                  <article><img src="https://image.tmdb.org/t/p/w154/apo.jpg" alt="The Apothecary Diaries">
                    <strong>The Apothecary Diaries</strong><span>S3 · Episode 1 · Hin-Tam-Tel-Eng-Jap</span><span>Fri, Oct 23 12:30 PM</span></article>
                </section></section>\`;
            return m.parseSchedule(html, { today: '2026-10-15' }).items.map((i) => ({
                title: i.title, season: i.season, episode: i.episode, today: i.today, date: i.date, time: i.time,
                slug: i.slug, img: i.img, audio: i.audio,
            }));
        })()`);
        expect(parsed).toEqual([
            { title: "JoJo's Bizarre Adventure", season: 4, episode: 5, today: true, date: '2026-10-15', time: '1:30 PM', slug: 'jojo-s-bizarre-adventure-season-4-2018', img: 'https://image.tmdb.org/t/p/w300/cMF.jpg', audio: '' },
            { title: 'The Apothecary Diaries', season: 3, episode: 1, today: false, date: '2026-10-23', time: '12:30 PM', slug: '', img: 'https://image.tmdb.org/t/p/w300/apo.jpg', audio: 'Hin-Tam-Tel-Eng-Jap' },
        ]);
    });

    test('an escaped schedule title still finds its catalog id', () => {
        const registryPath = join(ROOT, 'data', 'nxsha-titles.json');
        const card = callHarvester(`(async () => {
            const fs = await import('node:fs');
            const html = \`<a href="/posts/jojo-s-bizarre-adventure-season-4-2018"><img src="https://image.tmdb.org/t/p/w154/cMF.jpg" alt="JoJo&#x27;s Bizarre Adventure"><span>S4 · Episode 5</span><time>1:30 PM</time></a>\`;
            const entry = m.parseSchedule(html, { today: '2026-10-15' }).items[0];
            const byTitle = m.registryIndex(JSON.parse(fs.readFileSync(${JSON.stringify(registryPath)}, 'utf8')));
            const catalog = byTitle.get(m.titleKey(entry.title));
            return {
                title: entry.title, season: entry.season, episode: entry.episode,
                catalog: catalog ? { id: catalog.id, kind: catalog.kind } : null,
            };
        })()`);
        // The page escapes titles (`JoJo&#x27;s …`); left escaped they key nothing
        // and the card is dropped even though the catalog already has the show.
        expect(card.title).toBe("JoJo's Bizarre Adventure");
        expect(card.season).toBe(4);
        expect(card.episode).toBe(5);
        expect(card.catalog).toEqual({ id: '45790', kind: 'tv' });
    });

    test('a card whose poster has not loaded is still a card', () => {
        const parsed = callHarvester(`(() => {
            const html = \`<section class="schedule">
                <a href="/posts/link-click-season-3-multi-audio-hindi-1080p"><span>LINK CLICK</span><span>S3E11</span><time>11:20 PM</time></a>
                <a href="/posts/trending-now">Trending now</a>
              </section>\`;
            const result = m.parseSchedule(html, { today: '2026-10-15' });
            return {
                items: result.items.map((i) => ({ title: i.title, season: i.season, episode: i.episode, time: i.time, img: i.img })),
                skipped: result.skipped.map((s) => s.title),
                cards: result.cards.map((c) => ({ title: c.title, reason: c.reason })),
            };
        })()`);
        // No <img> on the card means no alt text: the slug has to name it, and the
        // compact "S3E11" has to parse. A plain nav link is not a schedule card.
        expect(parsed.items).toEqual([
            { title: 'Link Click', season: 3, episode: 11, time: '11:20 PM', img: '' },
        ]);
        expect(parsed.skipped).toEqual([]);
        // Every card the page offered is accounted for in the report.
        expect(parsed.cards).toEqual([{ title: 'Link Click', reason: 'ok' }]);
    });

    test('a card the parser cannot read is reported, not dropped in silence', () => {
        const parsed = callHarvester(`(() => {
            const html = \`<section><a href="/posts/link-clink-season-3-2026"><span>LINK CLICK</span><time>11:20 PM</time></a></section>\`;
            const result = m.parseSchedule(html, { today: '2026-10-15' });
            return {
                items: result.items.length,
                card: result.cards.find((c) => /LINK/i.test(c.text || '')) || null,
            };
        })()`);
        // No episode line on the card means no season/episode: it cannot resolve,
        // but the report has to say so or the next markup change is invisible.
        expect(parsed.items).toBe(0);
        expect(parsed.card).toMatchObject({ refused: true, reason: 'episode line unreadable' });
    });

    test('a resolved title gets its episode art and details from Nxsha', () => {
        const guided = callHarvester(`(() => {
            const guide = m.buildSeasonGuide({
                success: true,
                season: { season_number: 4, name: 'Golden Wind' },
                episodes: [
                    { episode_number: 1, name: 'Golden Wind', overview: '<b>Koichi</b> lands in Italy', still_path: '/iPT7.jpg', air_date: '2018-10-06', runtime: 24 },
                ],
            }, 4);
            return {
                guide,
                // A season Nxsha does not carry (or an id it does not know) has none.
                empty: m.buildSeasonGuide({ success: false, message: 'Season not found' }, 5),
            };
        })()`);
        expect(guided.guide).toEqual({
            '4': {
                '1': {
                    title: 'Golden Wind',
                    // Markup out, and the still is a rail-sized TMDB image.
                    overview: 'Koichi lands in Italy',
                    image: 'https://image.tmdb.org/t/p/w300/iPT7.jpg',
                    airDate: '2018-10-06',
                    runtime: 24,
                },
            },
        });
        expect(guided.empty).toBeNull();
    });

    test('an id is accepted only when Nxsha names the same show', () => {
        const verdicts = callHarvester(`(() => {
            const good = m.parseEmbedTitle(m.embedTitle('<title>Watch JoJo\\'s Bizarre Adventure - S4:E1</title>'));
            const other = m.parseEmbedTitle(m.embedTitle('<title>Watch The Fighter - S1:E1</title>'));
            return {
                match: good.name === "JoJo's Bizarre Adventure" && good.season === 4,
                mismatch: other.name === 'Fighter',
                url: m.nxshaVerifyUrl('tv', '45790', 4, 5),
                catalog: [...m.registryIndex({ jojo: { id: '45790', kind: 'tv', title: "JoJo's Bizarre Adventure", seasons: { 4: 28 } } }).values()][0],
            };
        })()`);
        expect(verdicts.match).toBe(true);
        // "Fighter" must never accept "The Fighter".
        expect(verdicts.mismatch).toBe(false);
        expect(verdicts.url).toContain('https://nxsha.space/embed/tv/45790/4/5');
        expect(verdicts.catalog).toEqual({ id: '45790', kind: 'tv', seasons: { 4: 28 } });
    });

    test('the daily job harvests the schedule, then bakes the row', () => {
        const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'crunchyroll-daily-drops.yml'), 'utf8');
        expect(workflow).toContain('node scripts/harvest-deadtoons-schedule.mjs');
        expect(workflow).toContain('continue-on-error: true');
        expect(workflow).toContain('node scripts/build-crunchyroll-new-drops.mjs --from-state');
        expect(workflow).toContain('data/deadtoons-schedule.json');
        expect(workflow).toContain("cron: '0 4 * * *'");
        // Manual runs can probe the site without touching the state.
        expect(workflow).toContain('--probe');
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        expect(pkg.scripts['harvest:deadtoons-schedule']).toContain('harvest-deadtoons-schedule.mjs');
    });

    test('the harvester reads the schedule and writes nothing without a verified id', () => {
        const script = readFileSync(SCHEDULE_SCRIPT, 'utf8');
        expect(script).toContain("const DEFAULT_BASE = 'https://deadtoons.sbs'");
        expect(script).toContain('/schedule');
        expect(script).toContain('DEADTOONS_BASE');
        expect(script).toContain('nxsha: no verified id');
        // The site renders its clocks per requester zone; the harvest says so.
        expect(script).toContain("requester's zone");
        expect(script).toContain('payloadKeys');
        // Hex escapes (`&#x27;`) have to be decoded, not just decimal ones.
        expect(script).toContain('&#x');
        // Listing-only: the player itself stays on the page.
        expect(script).not.toContain('serverUrl');
        expect(script).not.toContain('iframe');
    });
});

describe('Fresh Drops row on the Crunchyroll page', () => {
    const html = readFileSync(HTML_PATH, 'utf8');

    test('the page inline script parses (a syntax error would blank the whole page)', () => {
        const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/);
        expect(script).not.toBeNull();
        expect(() => {
            // eslint-disable-next-line no-new-func
            new Function((script as RegExpMatchArray)[1]);
        }).not.toThrow();
    });

    test('the page ships a baked row that matches the drop state', () => {
        expect(html).toContain('/*CR_DROPS_START*/');
        expect(html).toContain('/*CR_DROPS_END*/');
        expect(html).toContain('var CR_NEW_DROPS=[');
        expect(html).not.toContain('var CR_NEW_DROPS=[];');
        expect(html).toContain("rows.unshift({title:'Fresh Drops'");
        expect(html).toContain('fresh:true');
        expect(html).toContain('dropPlaceholderImage');
        // Stays in sync with the drop states — the bake is checked in.
        expect(() =>
            execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', timeout: 30000 }),
        ).not.toThrow();
    });

    test('the rail is rebuilt on every web export', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        expect(pkg.scripts['build:web']).toContain('build-crunchyroll-new-drops.mjs --from-state');
        expect(pkg.scripts['bake:crunchyroll-drops']).toBe('node scripts/build-crunchyroll-new-drops.mjs --from-state');
    });

    test('the baked row renders as the first rail, with NEW flags only on today’s drops', async () => {
        const { items: baked, page } = bakeFor({
            nxsha: { 'tv:9': nxshaCard({ id: '9', title: 'Pool Show' }) },
            schedule: [
                scheduleEntry({
                    key: 'sch-jojo', title: "JoJo's Bizarre Adventure", season: 4, episode: 5,
                    nx: { id: '45790', kind: 'tv', seasons: { 4: 28 } },
                }),
                scheduleEntry({
                    // Not a catalog title: its episode list is drawn from the drop's own
                    // Nxsha episode guide, which is where the art and details come from.
                    key: 'sch-chainsmoker', title: 'Chainsmoker Cat', time: '5:00 PM', season: 1, episode: 12,
                    nx: { id: '312949', kind: 'tv', seasons: { 1: 12 }, from: 'wikidata-tmdb' },
                    guide: {
                        1: {
                            1: { title: 'The Cat Comes Home', image: EPISODE_STILL, overview: 'A stray cat moves in and takes over the flat.', airDate: '2026-07-24', runtime: 24 },
                            12: { title: 'One More Cigarette', image: EPISODE_STILL, airDate: '2026-10-09', runtime: 24 },
                        },
                    },
                }),
                scheduleEntry({ key: 'sch-apothecary', title: 'The Apothecary Diaries', img: '', today: false, date: '2026-10-23', time: '4:30 PM', nx: { id: '220542', kind: 'tv', seasons: { 3: 1 } } }),
            ],
        });

        const virtualConsole = new VirtualConsole();
        virtualConsole.on('jsdomError', (error: Error) => {
            // jsdom has no layout: scrollTo (and similar) are expected no-ops.
            if (/Not implemented/.test(error.message)) return;
            throw error;
        });
        const dom = new JSDOM(readFileSync(page, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
        const doc = dom.window.document;

        // The row rendered at the top of the home rails.
        const railHead = doc.querySelector('#homeRows .anime-rail .rail-head h2');
        expect(railHead?.textContent).toBe('Fresh Drops');

        const cards = Array.from(doc.querySelectorAll('#homeRows .anime-rail:first-child .rail-card')) as HTMLElement[];
        expect(cards.length).toBe(baked.length);
        expect(cards.length).toBeGreaterThan(0);

        baked.forEach((entry, i) => {
            const node = cards[i] as HTMLElement;
            expect(node.dataset.open).toBe(entry.key);
            expect(node.querySelector('.rail-copy h3')?.textContent?.replace(/\s+/g, ' ')).toBe(entry.title.replace(/\s+/g, ' '));
            // The copy line says when it landed (or airs) and what it is.
            expect(node.querySelector('.rail-copy p')?.textContent).toMatch(/^(S\d+ · E\d+ · )?(Added|Airs) \d{1,2} [A-Z][a-z]{2}( · New)? · (Series|Movie)$/);
            const meta = node.querySelector('.quick-meta')?.textContent ?? '';
            expect(meta).toMatch(/^(Added|Airs) \d{1,2} [A-Z][a-z]{2}/);
            if (entry.source === 'deadtoons') expect(meta).toContain('via DeadToons');
            // Artwork always has a fallback, so a poster-less drop still shows a card.
            expect(node.querySelector('.rail-poster img')?.getAttribute('onerror')).toBeTruthy();
            // A poster-less entry falls back to the generated placeholder art.
            if (entry.img === '') expect(decodeURIComponent(node.querySelector('.rail-poster img')?.getAttribute('onerror') ?? '')).toContain('svg');
        });

        // NEW is on today's episode only, never on the upcoming one or the pool filler.
        expect(cards.map((c) => !!c.querySelector('.fresh-flag'))).toEqual(baked.map((entry) => entry.fresh));
        expect(baked.map((entry) => entry.fresh)).toEqual([true, true, false, false]);

        // Drops have no Nxsha route of their own yet, so they stay out of the browse grid —
        // that grid is exactly the playable catalog.
        const browse = new Set(
            Array.from(doc.querySelectorAll('#catalogGrid [data-open]')).map(node => node.getAttribute('data-open')),
        );
        // Rail-only drops stay out of the browse grid; a schedule title the catalog
        // already carries is that catalog card (it is in the grid by definition).
        baked.filter((entry) => entry.key.startsWith('drop-')).forEach((entry) => expect(browse.has(entry.key)).toBe(false));
        baked.filter((entry) => !entry.key.startsWith('drop-')).forEach((entry) => expect(browse.has(entry.key)).toBe(true));

        // Clicking a schedule card opens its detail page, and Play starts the
        // Nxsha player for the verified id and the episode that just aired —
        // this is what used to 404 with the old slug-shaped ids.
        const click = (el: Element | null) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        click(cards[0]);
        expect(doc.getElementById('detailDialog')?.hasAttribute('open')).toBe(true);
        expect(doc.getElementById('detailTitle')?.textContent).toBe(baked[0].title);

        click(doc.getElementById('demoPlay'));
        expect(doc.getElementById('stagePosterText')?.textContent).toContain('S4 EP5');

        // The old server bar (episode stepper, server pill, hints) is gone —
        // episode switching lives in the next/previous cards and the episode list.
        expect(doc.getElementById('serverBar')).toBeNull();
        expect(doc.getElementById('epPrev')).toBeNull();
        expect(doc.getElementById('watchShow')?.textContent).toBe("JoJo's Bizarre Adventure");
        expect(doc.getElementById('watchEpTitle')?.textContent).toMatch(/^E5 – .+/);
        expect(doc.getElementById('watchReleased')?.textContent).toMatch(/^Released on [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
        const nextCard = doc.getElementById('watchNextCard') as HTMLElement;
        expect(nextCard.hidden).toBe(false);
        expect(nextCard.querySelector('.up-info b')?.textContent).toMatch(/^E6 – .+/);
        expect(nextCard.querySelector('.up-badge')?.textContent).toMatch(/^\d+m$/);
        expect(nextCard.querySelector('.up-info span')?.textContent).toMatch(/^(Subtitled|Sub \| Dub)$/);
        // The next-episode still is rendered eagerly, so the card shows its
        // picture right away (a lazy loader never runs inside the player).
        // The still comes from the guide — here the catalog's own.
        expect(nextCard.querySelector('img')?.getAttribute('src')).toMatch(/^https:\/\/image\.tmdb\.org\//);
        expect(nextCard.querySelector('img')?.getAttribute('data-src')).toBeNull();
        const prevCard = doc.getElementById('watchPrevCard') as HTMLElement;
        expect(prevCard.hidden).toBe(false);
        expect(prevCard.querySelector('.up-info b')?.textContent).toMatch(/^E4 – .+/);
        click(doc.getElementById('stagePlay'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        const frame = doc.querySelector('#serverFrame') as HTMLIFrameElement | null;
        expect(frame?.getAttribute('src')).toContain('https://nxsha.space/embed/tv/45790/4/5');

        // A schedule title the catalog does not carry carries its own episode art
        // and details: the guided episode shows its still, title, overview and air
        // date, and an episode outside the guide falls back to placeholder art.
        click(cards[1]);
        expect(doc.getElementById('detailTitle')?.textContent).toBe(baked[1].title);
        const episodes = Array.from(doc.querySelectorAll('#episodeList .episode-card')) as HTMLElement[];
        expect(episodes.length).toBe(12);
        const firstEpisode = episodes[0] as HTMLElement;
        expect(firstEpisode.querySelector('.episode-copy strong')?.textContent).toBe('The Cat Comes Home');
        expect(firstEpisode.querySelector('.episode-desc')?.textContent).toContain('A stray cat moves in');
        expect(firstEpisode.querySelector('.episode-air-date')?.textContent).toContain('2026');
        expect(firstEpisode.querySelector('img')?.getAttribute('data-src')).toBe(EPISODE_STILL);
        const lastEpisode = episodes[11] as HTMLElement;
        expect(lastEpisode.querySelector('.episode-copy strong')?.textContent).toBe('One More Cigarette');
        const unguided = episodes[1] as HTMLElement;
        expect(unguided.querySelector('.episode-copy strong')?.textContent).toBe('Episode 2');
        expect(unguided.querySelector('img')?.getAttribute('data-src')).toContain('data:image/svg+xml');

        // Playing the newest episode opens the watch page with this episode's
        // details; the season's last episode has no NEXT card and the PREVIOUS
        // card falls back to placeholder art for the unguided episode.
        click(doc.getElementById('demoPlay'));
        expect(doc.getElementById('watchShow')?.textContent).toBe('Chainsmoker Cat');
        expect(doc.getElementById('watchEpTitle')?.textContent).toBe('E12 – One More Cigarette');
        expect(doc.getElementById('watchReleased')?.textContent).toBe('Released on Oct 9, 2026');
        expect((doc.getElementById('watchNextCard') as HTMLElement).hidden).toBe(true);
        expect((doc.getElementById('watchNextHead') as HTMLElement).hidden).toBe(true);
        const dropPrev = doc.getElementById('watchPrevCard') as HTMLElement;
        expect(dropPrev.hidden).toBe(false);
        expect(dropPrev.querySelector('.up-info b')?.textContent).toBe('E11 – Episode 11');
        expect(dropPrev.querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml');

        // "See More Episodes" returns to the detail view and its episode list.
        click(doc.getElementById('watchSeeMore'));
        expect(doc.getElementById('playerShell')?.hasAttribute('hidden')).toBe(true);
        expect(doc.getElementById('detailDialog')?.hasAttribute('open')).toBe(true);

        // The pool filler keeps playing the catalog entry it already had.
        click(cards[baked.length - 1]);
        click(doc.getElementById('demoPlay'));
        click(doc.getElementById('stagePlay'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(frame?.getAttribute('src')).toContain('https://nxsha.space/embed/tv/9/');

        dom.window.close();
    }, 60000);
});
