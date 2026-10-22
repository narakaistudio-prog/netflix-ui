// Movies ka ToonStream (Server 2) route: /movies/<slug> page se resolves,
// series ke /episode/... chain se nahi. Owner: "jo movies jitna hai na humne
// unka toonstream server nhi lagya hai unka laga do jisse movie ka na mile
// usse rehne dena" — isliye movie na mile to uske liye koi baked slug nahi
// hona chahiye.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MODULE_PATH = join(ROOT, 'api', 'toonstream.mjs');
const HARNESS = join(ROOT, 'tests-arena', 'helpers', 'toonstream-harness.mjs');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const STATE_PATH = join(ROOT, 'data', 'toonstream-movies.json');
const SCRIPT = join(ROOT, 'scripts', 'harvest-toonstream-movies.mjs');

jest.setTimeout(60000);

function runScenario(scenario: Record<string, unknown>) {
    const res = spawnSync('node', [HARNESS], {
        encoding: 'utf8',
        timeout: 45000,
        env: { ...process.env, TS_SCENARIO: JSON.stringify(scenario), TS_MODULE_PATH: MODULE_PATH },
    });
    const out = String(res.stdout || '');
    const at = out.lastIndexOf('__RESULT__');
    if (at === -1) throw new Error(`harness failed: ${res.stderr || out}`);
    return JSON.parse(out.slice(at + '__RESULT__'.length));
}

/** Live movie page shape: sidebar servers as `options-N` slots, no episode. */
const MOVIE_HTML = `
<html><head><title>Spirited Away - Movie - ToonStream</title></head><body>
  <h1>Spirited Away</h1>
  <div id="options-5" class="video hdd on"><iframe data-src="https://ravok.buzz/video/ec4de54f"></iframe></div>
  <div id="options-4" class="video hdd"><iframe data-src="https://abyssplayer.com/LR0L1Adhn"></iframe></div>
  <div id="options-0" class="video hdd"><iframe data-src="https://rubystm.com/e/mvybg38zz.html"></iframe></div>
</body></html>`;

test('a movie resolves to its /movies/<slug> page and its servers', () => {
    const result = runScenario({
        mode: 'handler',
        query: { type: 'movie', title: 'Spirited Away' },
        mocks: [
            { needle: '/movies/spirited-away', status: 200, body: MOVIE_HTML },
            { needle: '/s?q=', status: 200, body: '<a href="/movies/spirited-away">View Movie</a>' },
        ],
    });
    expect(result.code).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.type).toBe('movie');
    expect(result.body.movieUrl).toBe('https://toonstream.us/movies/spirited-away');
    expect(result.body.chosen).toBe('https://ravok.buzz/video/ec4de54f');
    expect(result.body.servers.map((s: { name: string }) => s.name)).toEqual(['Play', 'Short']);
    // Movies have no season/episode coordinates in the answer.
    expect(result.body.season).toBeUndefined();
});

test('a movie ToonStream does not carry stays without a server', () => {
    const result = runScenario({
        mode: 'handler',
        query: { type: 'movie', title: 'Some Missing Movie' },
        mocks: [{ needle: '/s?q=', status: 200, body: '<a href="/movies/another-film">View Movie</a>' }],
    });
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toBe('no-movie');
});

test('every catalog movie is considered, and only verified ones get a slug', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const routes = JSON.parse(readFileSync(join(ROOT, 'data', 'nxsha-titles.json'), 'utf8'));
    const block = html.slice(html.indexOf('var shows={'), html.indexOf('var rows=['));
    const movieKeys = [...block.matchAll(/\n\s+([A-Za-z0-9_]+):\{title:'((?:\\.|[^'\\])*)'/g)]
        .filter((match) => {
            const next = block.indexOf(':{title:', match.index! + match[0].length);
            const entry = block.slice(match.index!, next === -1 ? block.length : next);
            // `type:'Movie'` + purane catalog movies jo NX_DATA me kind movie hain.
            return /type:'Movie'/.test(entry) || routes[match[1]]?.kind === 'movie';
        })
        .map((match) => match[1]);
    // 19 Ghibli + DAN DA DAN movie + Another World + 12 purane catalog movies.
    expect(movieKeys.length).toBeGreaterThanOrEqual(33);
    // Wo movies bhi list me hain jinhe pehle series samajh liya jata tha.
    ['spirited', 'mononoke', 'howl', 'yourname', 'jjk0'].forEach((key) => expect(movieKeys).toContain(key));

    const baked = JSON.parse(
        html.match(/var TS_MOVIES=(\{.*?\});/)?.[1] ?? '{}',
    ) as Record<string, { slug: string }>;
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as { movies: Record<string, { slug: string }> };

    // Baked data aur state file ek hi baat kehte hain.
    expect(Object.keys(baked).sort()).toEqual(Object.keys(state.movies).sort());
    for (const [key, entry] of Object.entries(baked)) {
        expect(movieKeys).toContain(key);
        expect(entry.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
});

test('the bake is idempotent and --from-state --check matches the page', () => {
    const res = spawnSync('node', [SCRIPT, '--from-state', '--check'], { encoding: 'utf8' });
    expect(String(res.stdout)).toContain('TS_MOVIES in sync');
    expect(res.status).toBe(0);
});
