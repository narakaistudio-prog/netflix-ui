import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const SCRIPT = join(ROOT, 'scripts', 'build-crunchyroll-new-drops.mjs');

const POSTER = 'https://image.tmdb.org/t/p/w500/poster.jpg';

function card(overrides: Partial<Record<string, unknown>> = {}) {
    return { kind: 'tv', id: '1', title: 'Show', img: POSTER, rating: '8.1', year: '2021', firstSeen: '2026-10-14', baseline: true, ...overrides };
}

/** What the builder would put in the Fresh Drops row for a given state file. */
function railFor(items: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'cr-drops-'));
    const state = join(dir, 'crunchyroll-new-drops.json');
    writeFileSync(state, JSON.stringify({ updated: '2026-10-15', items }));
    const out = execFileSync(process.execPath, [SCRIPT, '--from-state', '--dry-run'], {
        encoding: 'utf8',
        env: { ...process.env, DROPS_STATE_FILE: state },
        timeout: 30000,
    });
    return JSON.parse(out) as { mode: string; items: { title: string; key: string }[] };
}

describe('Fresh Drops rail selection', () => {
    test('titles first seen after the baseline run fill the row, newest first', () => {
        const rail = railFor({
            'tv:1': card({ title: 'Baseline Show' }),
            'tv:2': card({ id: '2', title: 'Yesterday Show', firstSeen: '2026-10-14', baseline: false }),
            'tv:3': card({ id: '3', title: 'Today Show', firstSeen: '2026-10-15', baseline: false }),
        });
        expect(rail.mode).toBe('new');
        expect(rail.items.map(i => i.title)).toEqual(['Today Show', 'Yesterday Show']);
        expect(rail.items.map(i => i.key)).toEqual(['drop-tv-3', 'drop-tv-2']);
    });

    test('with nothing new yet the newest pool titles still fill the row', () => {
        const rail = railFor({
            'tv:1': card({ title: 'Older Pool Title', firstSeen: '2026-10-12' }),
            'tv:2': card({ id: '2', title: 'Newer Pool Title', firstSeen: '2026-10-14' }),
        });
        expect(rail.mode).toBe('pool');
        expect(rail.items.map(i => i.title)).toEqual(['Newer Pool Title', 'Older Pool Title']);
    });

    test('adult listings, titles the app already routes, and duplicates stay off the rail', () => {
        const rail = railFor({
            'tv:1': card({ title: 'Harem Camp!', firstSeen: '2026-10-14' }),
            'tv:2': card({ id: '2', title: 'Solo Leveling', firstSeen: '2026-10-13' }),
            'tv:3': card({ id: '3', title: "Atashin'chi", firstSeen: '2026-10-14' }),
            'tv:4': card({ id: '4', title: 'Atashin&#x27;chi', firstSeen: '2026-10-12' }),
            'tv:5': card({ id: '5', title: 'No Artwork', img: '', firstSeen: '2026-10-14' }),
            'tv:6': card({ id: '6', title: 'Pokémon', firstSeen: '2026-10-11' }),
        });
        // Solo Leveling already has a playable card in the catalog, and the
        // entity-encoded listing is the same show as the plain one.
        expect(rail.items.map(i => i.title)).toEqual(["Atashin'chi", 'Pokémon']);
    });

    test('an empty pool leaves the row out instead of rendering it blank', () => {
        const rail = railFor({ 'tv:1': card({ title: 'Harem Camp!' }) });
        expect(rail.items).toEqual([]);
    });
});

describe('Fresh Drops row on the Crunchyroll page', () => {
    const html = readFileSync(HTML_PATH, 'utf8');

    test('the page ships a baked row that matches the drop state', () => {
        expect(html).toContain('/*CR_DROPS_START*/');
        expect(html).toContain('/*CR_DROPS_END*/');
        expect(html).toContain('var CR_NEW_DROPS=[');
        expect(html).not.toContain('var CR_NEW_DROPS=[];');
        expect(html).toContain("rows.unshift({title:'Fresh Drops'");
        expect(html).toContain('fresh:true');
        // Stays in sync with data/crunchyroll-new-drops.json — the bake is checked in.
        expect(() =>
            execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', timeout: 30000 }),
        ).not.toThrow();
    });

    test('the rail is rebuilt on every web export', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        expect(pkg.scripts['build:web']).toContain('build-crunchyroll-new-drops.mjs --from-state');
        expect(pkg.scripts['bake:crunchyroll-drops']).toBe('node scripts/build-crunchyroll-new-drops.mjs --from-state');
        // The daily job keeps baking it from the live listings.
        const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'crunchyroll-daily-drops.yml'), 'utf8');
        expect(workflow).toContain('node scripts/build-crunchyroll-new-drops.mjs');
    });

    test('the baked row renders as the first rail, with NEW flags and drop dates', () => {
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
        ) as { key: string; title: string; firstSeen: string }[];
        expect(baked.length).toBeGreaterThan(0);

        const rails = doc.querySelectorAll('#homeRows .anime-rail');
        expect(rails.length).toBeGreaterThan(1);

        const freshRail = rails[0] as HTMLElement;
        expect(freshRail.classList.contains('fresh-rail')).toBe(true);
        expect(freshRail.querySelector('h2')?.textContent).toBe('Fresh Drops');
        expect(freshRail.querySelector('.rail-sub')?.textContent).toMatch(/catalog$/);

        const cards = freshRail.querySelectorAll('.rail-card');
        expect(cards).toHaveLength(baked.length);
        expect(freshRail.querySelectorAll('.fresh-flag')).toHaveLength(baked.length);
        baked.forEach((entry, i) => {
            const node = cards[i] as HTMLElement;
            expect(node.dataset.open).toBe(entry.key);
            expect(node.querySelector('.rail-copy h3')?.textContent).toBe(entry.title);
            // Drop cards have no playable route yet, so they show when they landed.
            expect(node.querySelector('.rail-copy p')?.textContent).toMatch(/^Added \d{1,2} [A-Z][a-z]{2} · (Series|Movie)$/);
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
