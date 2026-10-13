// Guards the transcribed Netflix genre page (data/netflix-genre-100381.txt) that
// scripts/build-netflix-genre-rows.mjs turns into home rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const text = readFileSync(join(__dirname, '..', 'data', 'netflix-genre-100381.txt'), 'utf8');

function parse(src: string) {
    const rows: { rowTitle: string; titles: { title: string; netflixId: string }[] }[] = [];
    let current: (typeof rows)[number] | null = null;
    for (const raw of src.split('\n')) {
        const line = raw.replace(/\u200b/g, '').trim();
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

test('the source has the 17 Netflix genre rows in page order', () => {
    expect(rows.map((r) => r.rowTitle)).toEqual([
        'Your Next Watch',
        'Relentless Crime Dramas',
        'Comedy Movies',
        'TV Dramedies',
        'Reality, Variety & Talk Shows',
        'Action Movies',
        'Thriller Movies',
        'Critically Acclaimed Movies',
        'Crowd Pleasers',
        'Love & Obsession',
        'International Movies',
        'True Crime Documentary Series',
        'Gritty TV Dramas',
        'Animated TV',
        'Action Thriller Movies',
        'Emotional Movies',
        'Feel-good Movies',
    ]);
});

test('every entry has a title and a numeric Netflix id; no row is empty', () => {
    for (const r of rows) {
        expect(r.titles.length).toBeGreaterThan(0);
        for (const t of r.titles) {
            expect(t.title.length).toBeGreaterThan(0);
            expect(t.netflixId).toMatch(/^\d+$/);
        }
    }
});

test('no title repeats inside one row', () => {
    for (const r of rows) {
        const ids = r.titles.map((t) => t.netflixId);
        expect(new Set(ids).size).toBe(ids.length);
    }
});

test('the Trending row titles from the Tudum list are present in "Your Next Watch"', () => {
    const ids = new Set(rows[0].titles.map((t) => t.netflixId));
    for (const id of ['82034837', '83001420', '82811466', '83197638', '81950460']) {
        expect(ids.has(id)).toBe(true);
    }
});
