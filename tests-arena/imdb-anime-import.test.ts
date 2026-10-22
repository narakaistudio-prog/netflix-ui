import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/**
 * IMDb list import (owner: "yaha ka sara anime crunchyroll par laga do ...
 * jo anime pehle se hai usse chod dena").
 *
 * Network sandbox me nahi hai, isliye yahan sirf wahi cheezein check hoti hain
 * jo bina internet ke ho sakti hain: parsers, marker-block merge (idempotent),
 * rows grouping, aur workflow ka shape. Asli fetch hosted runner par hota hai.
 */
test('importer ke self-tests pass hote hain (parsers + merge, network ke bina)', () => {
    const out = execFileSync(
        process.execPath,
        [join(ROOT, 'scripts', 'import-imdb-anime.mjs'), '--self-test'],
        { encoding: 'utf8', timeout: 30000 },
    );
    expect(out).toContain('import-imdb-anime self-tests passed');
});

test('asli Crunchyroll page par merge idempotent hai aur purane titles safe rehte hain', () => {
    const out = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', `
import { readFileSync } from 'node:fs';
import { catalogEntryLine, existingCatalogTitles, existingRowKeys, mergeCatalog, mergeRows, readMarkerEntries } from './scripts/import-imdb-anime.mjs';

const path = './assets/crunchyroll/crunchyroll.html';
const html = readFileSync(path, 'utf8');
const before = existingCatalogTitles(html);
// Import wale entries bhi state se aate hain — sirf naya line dene se purane
// imported titles ud jayenge, isliye seed + naya line dono dete hain.
const seeded = readMarkerEntries(html).map((entry) => catalogEntryLine(entry.key, entry));
const line = catalogEntryLine('__test_import__', { title: 'Test Anime', year: 2024, rating: '4.1', genres: ['action'], img: 'https://image.tmdb.org/t/p/w500/x.jpg', desc: "Kya baat" });
const lines = [...seeded, line];
const once = mergeCatalog(html, lines);
const twice = mergeCatalog(once, lines);
if (existingCatalogTitles(once).length !== before.length + 1) throw new Error('naya title catalog me nahi aaya');
if (existingCatalogTitles(twice).length !== before.length + 1) throw new Error('re-run par duplicate title');
if (once !== twice) throw new Error('mergeCatalog idempotent nahi hai');
for (const title of before) {
    if (!existingCatalogTitles(once).includes(title)) throw new Error('purana title gayab: ' + title);
}
const rows = mergeRows(once, [{ title: 'Test Row', keys: ['__test_import__'] }]);
if (rows !== mergeRows(rows, [{ title: 'Test Row', keys: ['__test_import__'] }])) throw new Error('mergeRows idempotent nahi hai');
if (!existingRowKeys(rows).has('__test_import__')) throw new Error('row key page me nahi mila');
if (!existingRowKeys(rows).has('solo')) throw new Error('purani row chhoot gayi');
console.log('OK ' + before.length);
`],
        { cwd: ROOT, encoding: 'utf8', timeout: 60000 },
    );
    expect(out).toContain('OK');
});

test('import workflow hosted runner par chalta hai aur guide + bake dono karta hai', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'import-imdb-anime.yml'), 'utf8');
    expect(workflow).toContain('node scripts/import-imdb-anime.mjs');
    expect(workflow).toContain('node scripts/harvest-nxsha-guide.mjs --merge --only');
    expect(workflow).toContain('node scripts/harvest-toonstream-seasons.mjs');
    expect(workflow).toContain('node scripts/bake-animahd-links.mjs --check');
    expect(workflow).toContain('assets/crunchyroll/crunchyroll.html');
    expect(workflow).toContain('data/nxsha-titles.json');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('permissions:\n  contents: write');
});

test('import script IMDb list ko titles + Nxsha routes me todta hai (fixture)', () => {
    const out = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', `
import { parseImdbList, buildRows, pickNxshaMatch, normTitle } from './scripts/import-imdb-anime.mjs';
const html = '<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"TVSeries","url":"https://www.imdb.com/title/tt1/","name":"Solo Leveling"}}]}</script>'
  + '<a href="/title/tt2/?x"><img alt="Frieren (2023)" src="p.jpg"></a>';
const items = parseImdbList(html);
if (items.length !== 2) throw new Error('items ' + items.length);
if (normTitle('Frieren: Beyond Journey\\'s End') !== 'frierenbeyondjourneysend') throw new Error('norm');
const rows = buildRows([{ key: 'a', genres: ['action'] }, { key: 'b', genres: ['action'] }], { minPerGenre: 5 });
if (rows[0].title !== 'Hindi Dub on Crunchyroll') throw new Error('leftover row ' + rows[0].title);
if (pickNxshaMatch([{ type: 'tv', id: '7', name: 'Frieren', year: '2023', poster: 'p.jpg' }], 'Frieren', { kind: 'tv', year: '2023' }).id !== '7') throw new Error('match');
console.log('OK');
`],
        { cwd: ROOT, encoding: 'utf8', timeout: 60000 },
    );
    expect(out).toContain('OK');
});
