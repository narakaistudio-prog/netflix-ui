// Guards the transcribed Netflix K-Dramas page (data/netflix-genre-2638104.txt) that
// scripts/build-netflix-genre-rows.mjs --preset=kdrama turns into the K-Dramas section.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KDRAMA_COLLECTION, KDRAMA_ROW_PREFIX, isKdramaRow, kdramaRowLabel } from '@/lib/kdrama';

const text = readFileSync(join(__dirname, '..', 'data', 'netflix-genre-2638104.txt'), 'utf8');

function parse(src: string) {
    const rows: { rowTitle: string; titles: { title: string; netflixId: string }[] }[] = [];
    let current: (typeof rows)[number] | null = null;
    for (const raw of src.split('\n')) {
        const line = raw.replace(/\u200b/g, '').trim();
        if (!line || (line.startsWith('#') && !line.startsWith('## '))) continue;
        if (line.startsWith('## ')) {
            current = { rowTitle: line.slice(3).trim(), titles: [] };
            rows.push(current);
            continue;
        }
        const m = /^(.+?)\s*\|\s*(\d+)$/.exec(line);
        if (m && current) current.titles.push({ title: m[1].trim(), netflixId: m[2] });
    }
    return rows;
}

const rows = parse(text);

test('the source has the 17 Netflix K-Dramas rows in page order', () => {
    expect(rows.map(r => r.rowTitle)).toEqual([
        'International TV Dramas',
        'New on Netflix',
        'Award-Winning TV Shows',
        'Your Next Watch',
        'Crime TV Dramas',
        'Fantasy TV Shows',
        'TV Dramas',
        'Get In on the Action',
        'Critically Acclaimed TV Shows',
        'Period Pieces',
        'Supernatural TV Shows',
        'Young Adult Movies & Shows',
        'TV War & Politics',
        'Romantic TV Shows',
        'International TV Shows',
        'Women Behind the Camera',
        'TV Comedies',
    ]);
});

test('every entry has a title and a numeric Netflix id; no row repeats a title', () => {
    for (const r of rows) {
        expect(r.titles.length).toBeGreaterThan(0);
        const ids = r.titles.map(t => t.netflixId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const t of r.titles) {
            expect(t.title.length).toBeGreaterThan(0);
            expect(t.netflixId).toMatch(/^\d+$/);
        }
    }
});

test('the page adds a large K-Drama catalog (200+ unique Netflix ids)', () => {
    const unique = new Set(rows.flatMap(r => r.titles.map(t => t.netflixId)));
    expect(unique.size).toBeGreaterThan(200);
});

test('the K-Dramas row prefix keeps "Your Next Watch" apart from the genre row of the same name', () => {
    expect(`${KDRAMA_ROW_PREFIX}Your Next Watch`).toBe('K-Dramas: Your Next Watch');
    expect(kdramaRowLabel('K-Dramas: Your Next Watch')).toBe('Your Next Watch');
    expect(kdramaRowLabel('Trending Now in India')).toBe('Trending Now in India');
});

test('K-Dramas rows are recognised by their collection and no genre or anime row is', () => {
    const item = (collection?: string) => ({
        id: `x-${collection}`,
        title: 'T',
        imageUrl: 'https://image.tmdb.org/t/p/w500/t.jpg',
        catalogCollection: collection,
    });
    const kdramaRow = {
        rowTitle: 'K-Dramas: TV Dramas',
        type: 'normal',
        movies: [item(KDRAMA_COLLECTION)],
    } as any;
    expect(isKdramaRow(kdramaRow)).toBe(true);
    expect(isKdramaRow({ rowTitle: 'Your Next Watch', type: 'normal', movies: [item('netflix-genre-100381')] } as any)).toBe(false);
    expect(isKdramaRow({ rowTitle: 'Anime: Anime Series', type: 'normal', movies: [item('netflix-anime-7424')] } as any)).toBe(false);
    expect(isKdramaRow({ rowTitle: 'Trending Now in India', type: 'normal', movies: [item()] } as any)).toBe(false);
});

test('the section screen, tab and navbar entries exist', () => {
    expect(require('node:fs').existsSync(join(__dirname, '..', 'app', '(tabs)', 'kdramas.tsx'))).toBe(true);
    expect(require('node:fs').existsSync(join(__dirname, '..', 'components', 'KdramaBrowseScreen.tsx'))).toBe(true);

    const tabs = readFileSync(join(__dirname, '..', 'app', '(tabs)', '_layout.tsx'), 'utf8');
    expect(tabs).toContain("name: 'kdramas'");
    expect(tabs).toContain("title: 'K-Dramas'");

    const nav = readFileSync(join(__dirname, '..', 'components', 'WebNavBar.tsx'), 'utf8');
    expect(nav).toContain("label: 'K-Dramas'");
    expect(nav).toContain("'/kdramas'");

    // Home and the Movies/TV browse screens must leave the K-Drama rows out.
    const home = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
    expect(home).toContain('isKdramaRow');
    const catalog = readFileSync(join(__dirname, '..', 'components', 'CatalogBrowseScreen.tsx'), 'utf8');
    expect(catalog).toContain('isKdramaRow');

    // The genre-rows workflow builds this preset on this branch.
    const workflow = readFileSync(
        join(__dirname, '..', '.github', 'workflows', 'netflix-genre-rows-nxsha.yml'),
        'utf8',
    );
    expect(workflow).toContain('--preset=kdrama');
    expect(workflow).toContain('data/netflix-genre-2638104.txt');
});
