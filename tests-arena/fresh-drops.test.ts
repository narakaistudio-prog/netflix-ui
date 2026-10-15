import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const SCRIPT = join(ROOT, 'scripts', 'build-crunchyroll-new-drops.mjs');
const DEADTOONS_SCRIPT = join(ROOT, 'scripts', 'harvest-deadtoons-drops.mjs');

const POSTER = 'https://image.tmdb.org/t/p/w500/poster.jpg';

// The harvester is an ES module; Jest here runs CommonJS, so the checks below
// evaluate it in a child Node process and read the JSON result back.
const DEADTOONS_URL = pathToFileURL(DEADTOONS_SCRIPT).href;
function callHarvester(expression: string): any {
    const code = `const m = await import(${JSON.stringify(DEADTOONS_URL)});\nconsole.log(JSON.stringify(await (${expression})));`;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
}

type RailItem = {
    key: string;
    source: string;
    title: string;
    firstSeen: string;
    fresh: boolean;
    img: string;
};

function nxshaCard(overrides: Record<string, unknown> = {}) {
    return {
        kind: 'tv', id: '1', title: 'Show', img: POSTER, rating: '8.1', year: '2021',
        firstSeen: '2026-10-14', baseline: true, ...overrides,
    };
}

function deadtoonsCard(overrides: Record<string, unknown> = {}) {
    return {
        slug: 'show', title: 'Show', kind: 'tv', url: 'https://deadtoons.sbs/show/', img: POSTER,
        year: '', tags: ['hindi'], firstSeen: '2026-10-14', baseline: true, ...overrides,
    };
}

/**
 * What the builder would put in the Fresh Drops row.
 *
 * The bake writes to a throwaway copy of the page, so the checked-in page is
 * never touched, and takes both state files as fixtures.
 */
function bakeFor(items: { nxsha?: Record<string, unknown>; deadtoons?: Record<string, unknown> }) {
    const dir = mkdtempSync(join(tmpdir(), 'cr-drops-'));
    const nxsha = join(dir, 'crunchyroll-new-drops.json');
    const deadtoons = join(dir, 'deadtoons-drops.json');
    const page = join(dir, 'page.html');
    writeFileSync(nxsha, JSON.stringify({ updated: '2026-10-15', items: items.nxsha ?? {} }));
    writeFileSync(deadtoons, JSON.stringify({ updated: '2026-10-15', source: 'https://deadtoons.sbs', items: items.deadtoons ?? {} }));
    copyFileSync(HTML_PATH, page);
    const env = {
        ...process.env,
        DROPS_STATE_FILE: nxsha,
        DROPS_DEADTOONS_FILE: deadtoons,
        DROPS_HTML_FILE: page,
    };

    const dry = execFileSync(process.execPath, [SCRIPT, '--from-state', '--dry-run'], { encoding: 'utf8', env, timeout: 30000 });
    const plan = JSON.parse(dry) as { mode: string; items: RailItem[] };
    execFileSync(process.execPath, [SCRIPT, '--from-state'], { encoding: 'utf8', env, timeout: 30000 });
    return { ...plan, page };
}

describe('Fresh Drops rail selection', () => {
    test('daily DeadToons finds lead the row, newest first, ahead of the pool fillers', () => {
        const rail = bakeFor({
            nxsha: { 'tv:1': nxshaCard({ title: 'Pool Show' }) },
            deadtoons: {
                'wistoria-wand-and-sword': deadtoonsCard({ slug: 'wistoria-wand-and-sword', title: 'Wistoria: Wand and Sword', firstSeen: '2026-10-15', baseline: false }),
                kagurabachi: deadtoonsCard({ slug: 'kagurabachi', title: 'Kagurabachi', firstSeen: '2026-10-15', baseline: false }),
                'sakamoto-days': deadtoonsCard({ slug: 'sakamoto-days', title: 'Sakamoto Days', firstSeen: '2026-10-14', baseline: true }),
            },
        });
        expect(rail.mode).toBe('new');
        // Fresh finds first (DeadToons ahead), then the newest pool titles fill the row.
        expect(rail.items.map(i => i.title)).toEqual(['Kagurabachi', 'Wistoria: Wand and Sword', 'Sakamoto Days', 'Pool Show']);
        expect(rail.items.filter(i => i.fresh).map(i => i.title)).toEqual(['Kagurabachi', 'Wistoria: Wand and Sword']);
        expect(rail.items.map(i => i.key)).toEqual([
            'drop-dt-kagurabachi',
            'drop-dt-wistoria-wand-and-sword',
            'drop-dt-sakamoto-days',
            'drop-tv-1',
        ]);
        expect(rail.items.map(i => i.source)).toEqual(['deadtoons', 'deadtoons', 'deadtoons', 'nxsha']);
    });

    test("the listing's own update date breaks same-day ties", () => {
        const rail = bakeFor({
            deadtoons: {
                'older-post': deadtoonsCard({ slug: 'older-post', title: 'Older Post', firstSeen: '2026-10-15', siteUpdated: '2026-10-10', baseline: false }),
                'newer-post': deadtoonsCard({ slug: 'newer-post', title: 'Newer Post', firstSeen: '2026-10-15', siteUpdated: '2026-10-14', baseline: false }),
            },
        });
        expect(rail.items.map(i => i.title)).toEqual(['Newer Post', 'Older Post']);
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

    test('adult listings, catalog titles and duplicates stay off the rail', () => {
        const rail = bakeFor({
            nxsha: {
                'tv:1': nxshaCard({ title: 'Harem Camp!', firstSeen: '2026-10-14' }),
                'tv:2': nxshaCard({ id: '2', title: 'Overflow', firstSeen: '2026-10-14' }),
            },
            deadtoons: {
                // Already playable through the catalog (exact and substring matches).
                'solo-leveling-hindi': deadtoonsCard({ slug: 'solo-leveling-hindi', title: 'Solo Leveling', firstSeen: '2026-10-15', baseline: false }),
                'attack-on-titan-movie': deadtoonsCard({ slug: 'attack-on-titan-movie', title: 'Attack on Titan Movie', firstSeen: '2026-10-15', baseline: false }),
                // Two episode posts of one show collapse into a single card.
                doraemon: deadtoonsCard({ slug: 'doraemon', title: 'Doraemon', firstSeen: '2026-10-15', baseline: false }),
                'doraemon-hindi-dubbed': deadtoonsCard({ slug: 'doraemon-hindi-dubbed', title: 'Doraemon', firstSeen: '2026-10-15', baseline: false }),
                // Adult listing from the DeadToons side.
                'harem-camp-ova': deadtoonsCard({ slug: 'harem-camp-ova', title: 'Harem Camp OVA', firstSeen: '2026-10-15', baseline: false }),
                // A real drop with no artwork yet — the card falls back to placeholder art.
                kagurabachi: deadtoonsCard({ slug: 'kagurabachi', title: 'Kagurabachi', img: '', firstSeen: '2026-10-15', baseline: false }),
            },
        });
        expect(rail.items.map(i => i.title)).toEqual(['Doraemon', 'Kagurabachi']);
        expect(rail.items.every(i => i.source === 'deadtoons')).toBe(true);
        expect(rail.items.find(i => i.title === 'Kagurabachi')?.img).toBe('');
    });

    test('an empty pool leaves the row out instead of rendering it blank', () => {
        const rail = bakeFor({ nxsha: { 'tv:1': nxshaCard({ title: 'Harem Camp!' }) } });
        expect(rail.items).toEqual([]);
    });
});

describe('DeadToons drop harvester', () => {
    test('offline parser self-tests pass', () => {
        const out = execFileSync(process.execPath, [DEADTOONS_SCRIPT, '--self-test'], { encoding: 'utf8', timeout: 60000 });
        expect(out).toContain('All DeadToons drop self-tests passed');
    }, 60000);

    test('live DeadToons listing text is rewritten from the slug', () => {
        const cleaned = callHarvester(`(() => {
            const items = {
                're-zero': { slug: 're-zero-starting-life-in-another-world-season-4-episodes-multi-audio-hindi-english-japanese-480p-720p-1080p-hd-web-dl-10bit-hevc-esub', title: 'Re: Zero Starting Life in Another World &amp HD', year: '' },
                'liar-game': { slug: 'liar-game-season-1-multi-audio-hindi-tamil-telugu-eng-jap-480p-720p-1080p-hd-web-dl-10bit-hevc-esub', title: 'Liar Game &amp HD', year: '' },
                'grand-blue': { slug: 'grand-blue-dreaming-season-3-2026', title: 'Grand Blue Dreaming Anime Times AMZN DDP2.0', year: '' },
            };
            m.normalizeDropTitles(items);
            return { titles: Object.values(items).map((i) => i.title), rebaked: m.normalizeDropTitles(items).length };
        })()`);
        expect(cleaned.titles).toEqual([
            'Re Zero Starting Life in Another World',
            'Liar Game',
            'Grand Blue Dreaming',
        ]);
        // A second pass is a no-op, so the daily job does not churn titles.
        expect(cleaned.rebaked).toBe(0);
    });

    test('taxonomy pages stay out of the state, real posts stay in', () => {
        const verdicts = callHarvester(`[
            'https://deadtoons.sbs/posts/black-torch-season-1-2026',
            'https://deadtoons.sbs/posts/blue-box-season-2-2026',
            'https://deadtoons.sbs/genre/action',
            'https://deadtoons.sbs/category/ova',
            'https://deadtoons.sbs/ott/netflix',
            'https://deadtoons.sbs/privacy-policy',
        ].map((u) => m.isPostUrl(u, 'https://deadtoons.sbs'))`);
        expect(verdicts).toEqual([true, true, false, false, false, false]);
    });

    test('the daily job harvests DeadToons, then bakes the row', () => {
        const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'crunchyroll-daily-drops.yml'), 'utf8');
        expect(workflow).toContain('node scripts/harvest-deadtoons-drops.mjs');
        expect(workflow).toContain('continue-on-error: true');
        expect(workflow).toContain('node scripts/build-crunchyroll-new-drops.mjs --from-state');
        expect(workflow).toContain('data/deadtoons-drops.json');
        expect(workflow).toContain("cron: '0 4 * * *'");
        // Manual runs can probe the site without writing anything.
        expect(workflow).toContain('--probe');
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        expect(pkg.scripts['harvest:deadtoons-drops']).toContain('harvest-deadtoons-drops.mjs');
    });

    test('the harvester defaults to deadtoons.sbs and stays a listing-only source', () => {
        const script = readFileSync(DEADTOONS_SCRIPT, 'utf8');
        expect(script).toContain("'https://deadtoons.sbs'");
        expect(script).toContain('DEADTOONS_BASE');
        // No player may ever be built from this listing harvest.
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

    test('the baked row renders as the first rail, with NEW flags only on fresh finds', () => {
        const virtualConsole = new VirtualConsole();
        virtualConsole.on('jsdomError', () => {});
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            pretendToBeVisual: true,
            url: 'https://app.local/crunchyroll',
            virtualConsole,
        });
        const doc = dom.window.document;

        const baked = JSON.parse(
            html.slice(
                html.indexOf('var CR_NEW_DROPS=') + 'var CR_NEW_DROPS='.length,
                html.indexOf(';\nvar CR_NEW_DROPS_MODE'),
            ),
        ) as { key: string; title: string; fresh: boolean; src: string }[];
        expect(baked.length).toBeGreaterThan(0);

        const rails = doc.querySelectorAll('#homeRows .anime-rail');
        expect(rails.length).toBeGreaterThan(1);

        const freshRail = rails[0] as HTMLElement;
        expect(freshRail.classList.contains('fresh-rail')).toBe(true);
        expect(freshRail.querySelector('h2')?.textContent).toBe('Fresh Drops');
        expect(freshRail.querySelector('.rail-sub')?.textContent).toMatch(/catalog$/);

        const cards = freshRail.querySelectorAll('.rail-card');
        expect(cards).toHaveLength(baked.length);
        expect(freshRail.querySelectorAll('.fresh-flag')).toHaveLength(baked.filter(entry => entry.fresh).length);

        baked.forEach((entry, i) => {
            const node = cards[i] as HTMLElement;
            expect(node.dataset.open).toBe(entry.key);
            expect(node.querySelector('.rail-copy h3')?.textContent?.replace(/\s+/g, ' ')).toBe(entry.title.replace(/\s+/g, ' '));
            // Drop cards have no playable route yet, so they show when they landed.
            expect(node.querySelector('.rail-copy p')?.textContent).toMatch(/^Added \d{1,2} [A-Z][a-z]{2}( · New)? · (Series|Movie)$/);
            // DeadToons finds say where the listing came from; artwork always has a fallback.
            const meta = node.querySelector('.quick-meta')?.textContent ?? '';
            expect(meta).toMatch(/^Added \d{1,2} [A-Z][a-z]{2}/);
            if (entry.src === 'deadtoons') expect(meta).toContain('via DeadToons');
            expect(node.querySelector('.rail-poster img')?.getAttribute('onerror')).toBeTruthy();
        });

        // Drops have no Nxsha route yet, so they stay out of the browse grid —
        // that grid is exactly the playable catalog.
        const browse = new Set(
            Array.from(doc.querySelectorAll('#catalogGrid [data-open]')).map(node => node.getAttribute('data-open')),
        );
        baked.forEach((entry) => expect(browse.has(entry.key)).toBe(false));

        // The row is a real discoverable card: clicking one opens its detail page.
        const first = cards[0] as HTMLElement;
        first.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        expect(doc.getElementById('detailDialog')?.hasAttribute('open')).toBe(true);
        expect(doc.getElementById('detailTitle')?.textContent).toBe(baked[0].title);

        dom.window.close();
    }, 60000);
});
