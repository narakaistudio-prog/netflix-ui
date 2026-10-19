// @ts-nocheck — the toonstream "server 2" resolver, driven with mocked upstreams.
// Fixtures mirror the structures observed on the live site (episode slug
// `<title>-<s>x<e>`, series pages, player rows with 1080p download links).
const handler = require('../api/toonstream.mjs').default;
const { titleSlug, matchScore, extractServers, extractIframes, findEpisodeLink } = require('../api/toonstream.mjs')._internal;

const ROOT = process.cwd();

function makeRes() {
    return {
        statusCode: 0,
        body: null as any,
        setHeader: () => {},
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(body: any) {
            this.body = body;
            return this;
        },
    };
}

function call(query: Record<string, string>) {
    const res = makeRes();
    return Promise.resolve(
        handler(
            {
                method: 'GET',
                headers: { origin: 'https://app.example' },
                socket: { remoteAddress: '1.2.3.4' },
                query,
            },
            res,
        ),
    ).then(() => res);
}

afterEach(() => {
    try { delete (global as any).fetch; } catch {}
});

/** The live episode page shape: player iframes + quality-labelled rows. */
const EPISODE_HTML = `
<html><body>
  <div class="player"><iframe src="https://awish.click/embed-abc123.html" allowfullscreen></iframe></div>
  <div class="server-row"><b>01</b> <span>Ruby</span> <span>Multi Audio</span> <span>1080p</span>
    <a href="https://rubystm.com/d/lcwyoy23xi5n.html">Download</a></div>
  <div class="server-row"><b>05</b> <span>vidc</span> <span>Multi Audio</span> <span>1080p</span>
    <a href="https://vidc.upns.pro/#u3rzj5">Download</a></div>
  <div class="server-row"><b>06</b> <span>Moly</span> <span>Multi Audio</span> <span>720p</span>
    <a href="https://vidmoly.me/dl/l0933jnjbn3y">Download</a></div>
  <a href="/episode/overgeared-1x1/">prev</a> <a href="/episode/overgeared-1x3/">next</a>
</body></html>`;

const SERIES_HTML = `
<html><body>
  <a href="/series/overgeared/">Overgeared</a>
  <a href="/episode/overgeared-1x1/">E1</a>
  <a href="/episode/overgeared-1x2/">E2</a>
  <a href="/episode/overgeared-1x3/">E3</a>
</body></html>`;

const SEARCH_HTML = `
<html><body>
  <a href="/series/overgeared/">Overgeared (2026)</a>
  <a href="/series/overgeared-hindi-dub/">Overgeared Hindi Dub</a>
</body></html>`;

function mockUpstream(map: Record<string, [number, string]>) {
    const entries = Object.entries(map);
    return jest.fn(async (url: string) => {
        // The LONGEST matching needle wins, so '/episode/x-1x2' beats
        // '/episode/x-1x2/' when both are registered.
        const hit = entries
            .filter(([needle]) => String(url).includes(needle))
            .sort((a, b) => b[0].length - a[0].length)[0];
        if (hit) {
            const [status, body] = hit[1];
            return { status, text: async () => body } as any;
        }
        return { status: 404, text: async () => 'not found' } as any;
    });
}

test('titleSlug follows the site rule (verified against live URLs)', () => {
    expect(titleSlug('Kaiju No. 8')).toBe('kaiju-no-8');
    expect(titleSlug('Overgeared')).toBe('overgeared');
    expect(titleSlug('The Beginning After the End')).toBe('the-beginning-after-the-end');
    expect(titleSlug('Ranma1/2')).toBe('ranma1-2');
});

test('matchScore ranks the right series first', () => {
    const q = ['kaiju', 'no', '8'];
    expect(matchScore(q, 'Kaiju No. 8')).toBe(1);
    expect(matchScore(q, 'Kaiju No. 8 Hindi Dub')).toBe(1);
    expect(matchScore(['overgeared'], 'Overgeared (2026)')).toBe(1);
    expect(matchScore(['overgeared'], 'Totally Different Show')).toBe(0);
});

test('resolves the episode directly from the deterministic slug and picks the embed', async () => {
    global.fetch = mockUpstream({
        '/episode/overgeared-1x2/': [200, EPISODE_HTML],
    }) as any;

    const res = await call({ title: 'Overgeared', s: '1', e: '2' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('direct');
    expect(res.body.episodeUrl).toBe('https://toonstream.us/episode/overgeared-1x2/');
    // Inline iframe wins as the chosen embed.
    expect(res.body.chosen).toBe('https://awish.click/embed-abc123.html');
    expect(res.body.embeds).toContain('https://awish.click/embed-abc123.html');
    // Player rows come back with their quality labels.
    const ruby = res.body.servers.find((s: any) => s.url.includes('rubystm'));
    expect(ruby).toMatchObject({ quality: '1080p', name: 'rubystm' });
    const moly = res.body.servers.find((s: any) => s.url.includes('vidmoly'));
    expect(moly.quality).toBe('720p');
    // Only ONE upstream hit: the direct URL (no search roundtrip).
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
});

test('falls back to search -> series -> episode when the slug misses', async () => {
    // Realistic miss: our slug rule dashes the apostrophe, the site drops it —
    // so the direct URL 404s and the search chain takes over.
    const FRIEREN_EP = EPISODE_HTML.replace('overgeared', 'frieren-beyond-journeys-end');
    global.fetch = mockUpstream({
        '/episode/frieren-beyond-journey-s-end-1x2/': [404, 'nope'],  // direct slug miss...
        '?s=Frieren': [200, SEARCH_HTML.replace(/overgeared/g, 'frieren-beyond-journeys-end').replace(/Overgeared/g, 'Frieren: Beyond Journey')],
        '/series/frieren-beyond-journeys-end/': [200, SERIES_HTML.replace(/overgeared/g, 'frieren-beyond-journeys-end').replace(/Overgeared/g, 'Frieren: Beyond Journey End')],
        '/episode/frieren-beyond-journeys-end-1x2/': [200, FRIEREN_EP], // found via the series page
    }) as any;

    const res = await call({ title: 'Frieren: Beyond Journey\'s End', s: '1', e: '2', debug: '1' });
    expect(res.body.ok).toBe(true);
    expect(res.body.via).toBe('search');
    expect(res.body.chosen).toBe('https://awish.click/embed-abc123.html');
    const stepNames = res.body.steps.map((s: any) => s.step);
    expect(stepNames).toContain('episode-direct');
    expect(stepNames).toContain('search');
    expect(stepNames).toContain('series-candidates');
    expect(stepNames).toContain('series');
    expect(stepNames).toContain('episode');
});

test('no episode anywhere -> ok:false with a helpful hint, still a 200', async () => {
    global.fetch = mockUpstream({}) as any;
    const res = await call({ title: 'Made Up Show', s: '3', e: '9', debug: '1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('no-episode');
    expect(res.body.hint).toContain('Made Up Show');
});

test('an unreachable site stays ok:false, never a 5xx', async () => {
    global.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
    }) as any;
    const res = await call({ title: 'Overgeared', s: '1', e: '2' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
});

test('parsing helpers are conservative (only real player hosts, no site frames)', () => {
    expect(extractIframes('<iframe src="https://toonstream.us/x"></iframe><iframe src="https://a-ads.com/f"></iframe><iframe src="https://awish.click/e1"></iframe>')).toEqual([
        'https://awish.click/e1',
    ]);
    expect(findEpisodeLink(SERIES_HTML, '1', '2')).toBe('/episode/overgeared-1x2');
    expect(findEpisodeLink(SERIES_HTML, '2', '9')).toBe(null);
});

