// Guards the Tudum Top 10 India updater (scripts/update-tudum-top10.mjs). The HTML
// fixture follows the order of the Tudum page: poster (alt = title), watch link,
// then "#N in Movies". The live page is not reachable from the test run.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The updater is an ES module run by Node; Jest here is CommonJS, so each call runs the
// module in a child Node process and reads the JSON result back.
const MODULE_URL = pathToFileURL(join(__dirname, '..', 'scripts', 'update-tudum-top10.mjs')).href;
function call(expression: string): any {
    const code = `const m = await import(${JSON.stringify(MODULE_URL)});\nconsole.log(JSON.stringify(await (${expression})));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    return JSON.parse(out);
}

function entry(rank: number, title: string, id: string) {
    return `
        <div class="item">
            <img src="https://dnm.nflximg.net/api/v6/x/${id}.png" alt="${title}" />
            <a class="btn" href="https://www.netflix.com/login?nextpage=https%3A%2F%2Fwww.netflix.com%2Fwatch%2F${id}%3FtrackId%3D1">My List</a>
            <span class="badge"><img src="https://occ.a.nflxso.net/rank.svg" alt="" /></span>
            <span>#${rank} in Movies</span>
        </div>`;
}

const ENTRIES: [string, string][] = [
    ['Vishwanath & Sons', '82034837'],
    ['Irumudi', '83001420'],
    ['Modha Rathri', '82811466'],
    ['Baby Do Die Do', '83195142'],
    ['Romanchakam', '82969780'],
    ['Demon Slayer: Kimetsu no Yaiba Infinity Castle I', '82723106'],
    ['Lust Stories 3', '81734814'],
    ['UNABOMBER', '82010386'],
    ['Ohh My Dog', '83197638'],
    ['Dhamaal 4', '81950460'],
];

const FIXTURE = `
<html><body>
<div class="weeks"><select><option selected>9/28/26 - 10/4/26</option><option>9/21/26 - 9/27/26</option></select></div>
<img src="logo.svg" alt="Netflix" />
<h2>Top 10 Movies in India</h2>
${ENTRIES.map(([t, id], i) => entry(i + 1, t, id)).join('\n')}
<h2>Top 10 Shows in India</h2>
<div><img src="s.png" alt="Some Show" /><a href="/watch/99999999">Watch</a><span>#1 in Shows</span></div>
</body></html>`;

test('parses the ranked movie list in order, with the week label', () => {
    const { week, movies } = call(`m.parseTudumTop10(${JSON.stringify(FIXTURE)})`);
    expect(week).toBe('9/28/26 - 10/4/26');
    expect(movies).toEqual(
        ENTRIES.map(([title, netflixId], i) => ({ rank: i + 1, title, netflixId })),
    );
});

test('a repeated list (mobile and desktop) and the Shows section do not change the result', () => {
    const doubled = FIXTURE.replace('<h2>Top 10 Shows', `${ENTRIES.map(([t, id], i) => entry(i + 1, t, id)).join('\n')}<h2>Top 10 Shows`);
    const ids = call(`m.parseTudumTop10(${JSON.stringify(doubled)}).movies.map(x => x.netflixId)`);
    expect(ids).toEqual(ENTRIES.map(([, id]) => id));
});

test('an incomplete page is an error, so the previous row is kept', () => {
    const partial = FIXTURE.replace(entry(10, 'Dhamaal 4', '81950460'), '');
    const message = (() => {
        try {
            call(`m.parseTudumTop10(${JSON.stringify(partial)})`);
            return '';
        } catch (e) {
            return String((e as any).stderr || e);
        }
    })();
    expect(message).toMatch(/rank 10/);
});

test('mergeHistory adds a new week once and keeps the first-seen date', () => {
    const base = { source: 'x', weeks: [{ week: 'a', firstSeen: '2026-10-01', movies: [] }] };
    const movies = [{ rank: 1, title: 'T', netflixId: '1' }];
    const added = call(`m.mergeHistory(${JSON.stringify(base)}, 'b', ${JSON.stringify(movies)}, '2026-10-13')`);
    expect(added.changed).toBe(true);
    expect(added.weeks.map((w: any) => [w.week, w.firstSeen])).toEqual([['a', '2026-10-01'], ['b', '2026-10-13']]);

    const again = call(`m.mergeHistory(${JSON.stringify(added)}, 'b', ${JSON.stringify(movies)}, '2026-10-14')`);
    expect(again.changed).toBe(false);
    expect(again.weeks[1].firstSeen).toBe('2026-10-13');
});

test('buildRowItems keeps the nxsha data of a title already in the row and adds new titles as Netflix-only items', () => {
    const previous = [
        { id: 'tudum-top10-india-irumudi', netflixId: '83001420', title: 'Irumudi', tmdb_id: '1441228', imageUrl: 'p.jpg', ranking_text: '#2 in Movies' },
    ];
    const ranked = [
        { rank: 1, title: 'Vishwanath & Sons', netflixId: '82034837' },
        { rank: 2, title: 'Irumudi', netflixId: '83001420' },
    ];
    const items = call(`m.buildRowItems(${JSON.stringify(previous)}, ${JSON.stringify(ranked)})`);
    expect(items[1]).toMatchObject({ tmdb_id: '1441228', imageUrl: 'p.jpg', ranking_text: '#2 in Movies' });
    expect(items[0]).toMatchObject({
        id: 'tudum-top10-india-vishwanath-and-sons',
        netflixId: '82034837',
        netflixUrl: 'https://www.netflix.com/in/title/82034837',
        ranking_text: '#1 in Movies',
        catalogSource: 'tudum-top10-india',
    });
    expect(items[0].tmdb_id).toBeUndefined();
});

test('usableItems drops titles without an nxsha id or an image', () => {
    const items = [
        { id: 'a', tmdb_id: '1', imageUrl: 'x.jpg' },
        { id: 'b', imageUrl: 'x.jpg' },
        { id: 'c', tmdb_id: '3', imageUrl: '' },
    ];
    expect(call(`m.usableItems(${JSON.stringify(items)}).map(i => i.id)`)).toEqual(['a']);
});

test('a rank card with only its data-entity-id gives the Netflix id and an empty title', () => {
    const card = `<li data-entity-id="top10-4hB3vzDf6ZuX1ToDt7bAL9-82723106"><div data-uia="top10-card"></div><span>#6 in Movies</span></li>`;
    const page = FIXTURE.replace(entry(6, 'Demon Slayer: Kimetsu no Yaiba Infinity Castle I', '82723106'), card);
    const movie = call(`m.parseTudumTop10(${JSON.stringify(page)}).movies[5]`);
    expect(movie).toEqual({ rank: 6, title: '', netflixId: '82723106' });
});

test('resolveTitles uses the title the page gave, then the row, and only then the title page', async () => {
    const ranked = [
        { rank: 1, title: 'From Page', netflixId: '1' },
        { rank: 2, title: '', netflixId: '2' },
    ];
    const known = { '2': 'From Row' };
    const out = call(`m.resolveTitles(${JSON.stringify(ranked)}, new Map(${JSON.stringify(Object.entries(known))}))`);
    expect(out.map((m: any) => m.title)).toEqual(['From Page', 'From Row']);
});

test('titleFromNetflixPage reads og:title or <title> and drops the site name', () => {
    const og = '<meta property="og:title" content="Romanchakam | Netflix Official Site"/>';
    expect(call(`m.titleFromNetflixPage(${JSON.stringify(og)})`)).toBe('Romanchakam');
    const tag = '<title>Watch Romanchakam | Netflix</title>';
    expect(call(`m.titleFromNetflixPage(${JSON.stringify(tag)})`)).toBe('Romanchakam');
    expect(call(`m.titleFromNetflixPage(${JSON.stringify('<title>Netflix</title>')})`)).toBe('');
});
