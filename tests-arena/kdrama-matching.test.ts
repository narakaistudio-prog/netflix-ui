// Guards the K-Dramas matching fixes: nxsha search cards carry the TMDB rating,
// the kdrama preset prefers TV results and breaks same-name ties by rating, and
// the shows that still kept matching wrong content are pinned by id.
//
// The builder is an .mjs the Jest transform does not handle, so the matching
// itself runs through `node -e` and hands back JSON (the repo's usual pattern).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'build-netflix-genre-rows.mjs');

/** Run the builder's parsers in node and return the result as JSON. */
function callMatcher(expr: string): any {
    return JSON.parse(
        execFileSync(
            process.execPath,
            ['--input-type=module', '-e', `import { parseSearchResults, pickMatch } from ${JSON.stringify(SCRIPT)};${expr}`],
            { encoding: 'utf8', timeout: 30000 },
        ),
    );
}

const html = (pairs: [string, string, string, string, string][]) =>
    pairs
        .map(
            ([type, id, rating, name, date]) =>
                // Real nxsha cards put the rating, name and date on separate lines.
                `<a href="/${type}/${id}"><img src="https://image.tmdb.org/t/p/w500/x.jpg">\n${rating}\n${name}\n${date}</a>`,
        )
        .join('');

test('search cards expose the TMDB rating (or none for NR)', () => {
    const out = callMatcher(
        `const html = ${JSON.stringify(
            html([
                ['tv', '215720', '8.4', 'Queen of Tears', 'Mar 9, 2024'],
                ['tv', '298792', '4.0', 'Queen of Tears', 'Sep 19, 2025'],
                ['movie', '1463453', 'NR', 'My Demon', 'Apr 16, 2024'],
            ]),
        )};console.log(JSON.stringify(parseSearchResults(html).map((r) => r.rating)));`,
    );
    expect(out).toEqual(['8.4', '4.0', '']);
});

test('the real Queen of Tears (8.4, TV) beats the 2025 low-rated namesake', () => {
    const out = callMatcher(
        `const html = ${JSON.stringify(
            html([
                ['tv', '215720', '8.4', 'Queen of Tears', 'Mar 9, 2024'],
                ['tv', '298792', '4.0', 'Queen of Tears', 'Sep 19, 2025'],
            ]),
        )};const hit = pickMatch(parseSearchResults(html), 'Queen of Tears', { preferType: 'tv' });console.log(JSON.stringify(hit.id));`,
    );
    expect(out).toBe('215720');
});

test('the real My Demon (2023 series) beats the newer movie namesake', () => {
    const out = callMatcher(
        `const html = ${JSON.stringify(
            html([
                ['movie', '1144468', '5.0', 'My Demon', 'May 3, 2009'],
                ['movie', '1463453', '', 'My Demon', 'Apr 16, 2024'],
                ['tv', '218539', '8.5', 'My Demon', 'Nov 24, 2023'],
            ]),
        )};const hit = pickMatch(parseSearchResults(html), 'My Demon', { preferType: 'tv' });console.log(JSON.stringify({ id: hit.id, type: hit.type }));`,
    );
    expect(out).toEqual({ id: '218539', type: 'tv' });
});

test('without preferType the newest year still wins (other presets keep their behaviour)', () => {
    const out = callMatcher(
        `const html = ${JSON.stringify(
            html([
                ['tv', '215720', '8.4', 'Queen of Tears', 'Mar 9, 2024'],
                ['tv', '298792', '4.0', 'Queen of Tears', 'Sep 19, 2025'],
            ]),
        )};console.log(JSON.stringify(pickMatch(parseSearchResults(html), 'Queen of Tears').id));`,
    );
    expect(out).toBe('298792');
});

test('the kdrama preset prefers TV and pins the two stubborn shows to verified ids', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'build-netflix-genre-rows.mjs'), 'utf8');
    expect(script).toContain("preferType: 'tv'");
    expect(script).toContain("'81707950': 'tv/215720'"); // Queen of Tears (2024)
    expect(script).toContain("'81716080': 'tv/218539'"); // My Demon (2023)
    expect(script).toContain("'81754357': 'tv/138251'"); // Eve (2022)
    expect(script).toContain("'81087764': 'tv/86640'"); // Possessed (2019)
    expect(script).toContain("'81033645': 'tv/71347'"); // My Sassy Girl (2017)
    // Netflix names nxsha lists differently:
    expect(script).toContain("'Inheritors': 'The Heirs'");
    expect(script).toContain("'The Privileged': 'High Society'");
    expect(script).toContain("'You are Beautiful': \"You're Beautiful\"");
});

test('the K-Dramas screen paints black (no white gaps between rows)', () => {
    const screen = readFileSync(join(ROOT, 'components', 'KdramaBrowseScreen.tsx'), 'utf8');
    expect(screen).toContain("backgroundColor: '#000'");
});

test('the episode-guide job runs where the kdrama rows land (this branch and main)', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'tv-episodes-nxsha.yml'), 'utf8');
    expect(workflow).toContain('- main');
    expect(workflow).toContain('- arena/11455542-netflix-ui');
    expect(workflow).toContain('data/movies.json');
});
