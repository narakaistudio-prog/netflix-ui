// Guards the transcribed Netflix Anime page (data/netflix-anime-7424.txt) that
// scripts/build-netflix-genre-rows.mjs --preset=anime turns into the Anime section.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANIME_COLLECTION, ANIME_ROW_PREFIX, animeRowLabel, isAnimeRow } from '@/lib/anime';

const text = readFileSync(join(__dirname, '..', 'data', 'netflix-anime-7424.txt'), 'utf8');

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

test('the source has the 17 Netflix anime rows in page order', () => {
    expect(rows.map(r => r.rowTitle)).toEqual([
        'Your Next Watch',
        'Young Adult Movies & Shows',
        'Anime Series',
        'Bingeworthy TV Shows',
        "Kids' TV",
        'Dark Fantasy Anime',
        'Anime for Beginners',
        'Romantic TV Shows',
        'Exciting TV Shows',
        'In a Hurry? Try These 30-Minute Hits',
        'Action Movies',
        'Family Time TV',
        '30-Minute Laughs',
        'Suspenseful TV Shows',
        'Family Movies',
        'TV Shows Based on Books',
        'Watch in One Night',
    ]);
});

test('every entry has a title and a numeric Netflix id; no row is empty or repeats a title', () => {
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

test('the anime row prefix keeps "Your Next Watch" apart from the genre row of the same name', () => {
    expect(`${ANIME_ROW_PREFIX}Your Next Watch`).toBe('Anime: Your Next Watch');
    expect(animeRowLabel('Anime: Your Next Watch')).toBe('Your Next Watch');
    expect(animeRowLabel('Trending Now in India')).toBe('Trending Now in India');
});

test('anime rows are recognised by their collection and no genre row is', () => {
    const animeRow = {
        rowTitle: 'Anime: Anime Series',
        type: 'normal',
        movies: [{ id: 'netflix-anime-80179831', title: 'JoJo', catalogCollection: ANIME_COLLECTION }],
    } as any;
    const genreRow = {
        rowTitle: 'Your Next Watch',
        type: 'normal',
        movies: [{ id: 'netflix-genre-82034837', title: 'Vishwanath & Sons', catalogCollection: 'netflix-genre-100381' }],
    } as any;
    expect(isAnimeRow(animeRow)).toBe(true);
    expect(isAnimeRow(genreRow)).toBe(false);
});
