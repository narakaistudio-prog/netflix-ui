/**
 * Guards the "Fresh Drop Toon" rail: the row is built at runtime from
 * /api/toonstream?home=1 (the toonstream.us home page's own Fresh Drop rail),
 * so this test boots the real page with a stubbed fetch and drives a card like
 * a user would — the tap must resolve playState's season/episode and land on
 * the ToonStream trio, not an empty Nxsha stage.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HOME_BODY = {
    ok: true,
    status: 200,
    count: 2,
    items: [
        {
            title: "JoJo's Bizarre Adventure",
            slug: "jojo's-bizarre-adventure",
            img: 'https://image.tmdb.org/t/p/w780/jojo.jpg',
            url: "https://toonstream.us/episode/jojo's-bizarre-adventure-6x5/",
            episode: "https://toonstream.us/episode/jojo's-bizarre-adventure-6x5/",
            season: 6,
            ep: 5,
        },
        {
            title: 'Overgeared',
            slug: 'overgeared',
            img: 'https://image.tmdb.org/t/p/w780/overgeared.jpg',
            url: 'https://toonstream.us/episode/overgeared-1x4/',
            episode: 'https://toonstream.us/episode/overgeared-1x4/',
            season: 1,
            ep: 4,
        },
    ],
};

const RESOLVE_BODY = {
    ok: true,
    title: "JoJo's Bizarre Adventure",
    season: 6,
    episode: 5,
    episodeUrl: "https://toonstream.us/episode/jojo's-bizarre-adventure-6x5/",
    via: 'direct',
    chosen: 'https://ravok.buzz/video/abc123',
    servers: [
        { name: 'Play', url: 'https://ravok.buzz/video/abc123' },
        { name: 'Short', url: 'https://abyssplayer.com/kEffTFVQy' },
        { name: 'MultiQ', url: 'https://multi.example/mq123' },
    ],
};

type FetchCall = { url: string; body: any };

function boot(): { dom: JSDOM; calls: FetchCall[] } {
    // Force the live-fallback path: the committed page normally carries a bake.
    const html = readFileSync(HTML_PATH, 'utf8').replace(/var TS_DROPS=\[.*?\];/, 'var TS_DROPS=[];');
    const calls: FetchCall[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    virtualConsole.on('error', () => {});
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
        beforeParse(window) {
            (window as any).fetch = (input: any) => {
                const url = String(input);
                if (url.indexOf('/api/toonstream?home=1') !== -1) {
                    calls.push({ url, body: HOME_BODY });
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(HOME_BODY) });
                }
                if (url.indexOf('/api/toonstream?') !== -1) {
                    calls.push({ url, body: RESOLVE_BODY });
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(RESOLVE_BODY) });
                }
                return Promise.reject(new Error('unexpected fetch ' + url));
            };
        },
    });
    return { dom, calls };
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) await wait(60);
    return predicate();
}

function click(window: JSDOM['window'], element: Element | null) {
    if (!element) throw new Error('element missing while driving the rail');
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}


/**
 * Boot with a baked TS_DROPS block (what scripts/harvest-toonstream-drops.mjs
 * writes). The rest of the page is untouched.
 */
function bootWithBake(items: any[], fetchCalls: FetchCall[] = []): { dom: JSDOM; calls: FetchCall[] } {
    const html = readFileSync(HTML_PATH, 'utf8').replace(
        /var TS_DROPS=\[.*?\];/,
        `var TS_DROPS=${JSON.stringify(items)};`,
    );
    const calls = fetchCalls;
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    virtualConsole.on('error', () => {});
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
        beforeParse(window) {
            (window as any).fetch = (input: any) => {
                const url = String(input);
                if (url.indexOf('/api/toonstream?home=1') !== -1) {
                    calls.push({ url, body: { ok: true, items: [] } });
                    return Promise.reject(new Error('the bake must be used without a network fetch'));
                }
                if (url.indexOf('/api/toonstream?') !== -1) {
                    calls.push({ url, body: RESOLVE_BODY });
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(RESOLVE_BODY) });
                }
                return Promise.reject(new Error('unexpected fetch ' + url));
            };
        },
    });
    return { dom, calls };
}

const BAKED = [
    {
        title: 'Overgeared',
        slug: 'overgeared',
        img: 'https://image.tmdb.org/t/p/w780/overgeared.jpg',
        season: 1,
        episode: 4,
        episodeUrl: 'https://toonstream.us/episode/overgeared-1x4/',
        nxId: '324502',
        seasons: { 1: 12 },
        firstSeen: '2026-10-19',
        guide: {
            1: {
                1: { title: 'Legendary Class', overview: 'Grid hopes to strike it rich.', image: 'https://image.tmdb.org/t/p/w300/e1.jpg', runtime: 24 },
                4: { title: 'Item Crafting Face-Off', image: 'https://image.tmdb.org/t/p/w300/e4.jpg', runtime: 24 },
            },
        },
    },
    // Already a catalog title: no second card, but the site slug is remembered.
    { title: "JoJo's Bizarre Adventure", slug: "jojo's-bizarre-adventure", season: 6, episode: 5, nxId: '45790', onSite: true },
    // The same anime twice in the home rail: one card only.
    { title: 'Mizuki', slug: 'mizuki', season: 1, episode: 2, nxId: '111' },
    { title: 'Mizuki', slug: 'mizuki-season-2', season: 2, episode: 1, nxId: '111' },
];

jest.setTimeout(30000);

test('Fresh Drop Toon rail renders from the home API and plays the exact drop episode', async () => {
    const { dom, calls } = boot();
    const doc = dom.window.document;

    const rendered = await waitFor(() =>
        Array.from(doc.querySelectorAll('#homeRows h2')).some(
            (h2) => (h2.textContent || '').trim() === 'Fresh Drop Toon',
        ),
    );
    expect(rendered).toBe(true);

    // The row is first in the home rails and is fed by the home endpoint.
    const firstRowTitle = (doc.querySelector('#homeRows h2')?.textContent || '').trim();
    expect(firstRowTitle).toBe('Fresh Drop Toon');
    expect(doc.body.textContent).toContain('New on toonstream.us right now');
    expect(calls.some((c) => c.url.indexOf('/api/toonstream?home=1') !== -1)).toBe(true);

    // JoJo is already on the page (a DeadToons Fresh Drops card), so the live
    // fallback must not add a second card for it.
    expect(doc.querySelectorAll('#homeRows [data-open^="tsd-"]').length).toBe(1);

    // Cards carry the site's own poster, title and source label.
    const cards = Array.from(doc.querySelectorAll('#homeRows .rail-card'));
    const overgeared = cards.find((card) => (card.textContent || '').indexOf('Overgeared') !== -1);
    expect(overgeared).toBeTruthy();
    expect(overgeared!.textContent).toContain('via ToonStream');
    expect(overgeared!.textContent).toContain('E4');
    const playButton = overgeared!.querySelector('[data-quick-play]');
    expect(playButton).toBeTruthy();

    // Tapping Play must resolve S1E4 through the resolver (not S1E1, and not
    // an empty Nxsha stage) and then load the ToonStream trio.
    click(dom.window, playButton);
    const resolved = await waitFor(() =>
        calls.some((c) => c.url.indexOf('/api/toonstream?title=') !== -1),
    );
    expect(resolved).toBe(true);
    const resolveUrl = decodeURIComponent(calls.find((c) => c.url.indexOf('/api/toonstream?title=') !== -1)!.url);
    expect(resolveUrl).toContain('title=Overgeared');
    expect(resolveUrl).toContain('slug=overgeared');
    expect(resolveUrl).toContain('&s=1&e=4');

    const frame = doc.getElementById('serverFrame') as HTMLIFrameElement | null;
    await waitFor(() => !!frame && frame.getAttribute('src') === RESOLVE_BODY.chosen);
    expect(frame!.getAttribute('src')).toBe(RESOLVE_BODY.chosen);

    // Sandbox policy stays intact: ravok.buzz blocks popups, abyssplayer allows.
    const sandbox = frame!.getAttribute('sandbox') || '';
    expect(sandbox).not.toContain('allow-popups');

    // The trio labels come straight from the resolver's servers array.
    expect(doc.body.textContent).toContain('Play');
    expect(doc.body.textContent).toContain('Short');
    expect(doc.body.textContent).toContain('MultiQ');

    dom.window.close();
});

test('keeps an empty rail off the page when the home API has nothing', async () => {
    const html = readFileSync(HTML_PATH, 'utf8').replace(/var TS_DROPS=\[.*?\];/, 'var TS_DROPS=[];');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    virtualConsole.on('error', () => {});
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
        beforeParse(window) {
            (window as any).fetch = () =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 200, count: 0, items: [] }) });
        },
    });
    await wait(300);
    const titles = Array.from(dom.window.document.querySelectorAll('#homeRows h2')).map((h2) =>
        (h2.textContent || '').trim(),
    );
    expect(titles).not.toContain('Fresh Drop Toon');
    expect(titles.length).toBeGreaterThan(0);
    dom.window.close();
});

test('a baked row carries the Nxsha guide and never repeats an anime', async () => {
    const { dom, calls } = bootWithBake(BAKED);
    const doc = dom.window.document;
    await wait(400);

    const row = Array.from(doc.querySelectorAll('#homeRows section')).find((section) =>
        (section.querySelector('h2')?.textContent || '').includes('Fresh Drop Toon'),
    );
    expect(row).toBeTruthy();
    const cards = Array.from(row!.querySelectorAll('.rail-card'));
    const titles = cards.map((card) => card.querySelector('.rail-copy h3')?.textContent || '');
    expect(titles).toContain('Overgeared');
    // JoJo already lives in the catalog rails; it must not get a twin card.
    expect(titles.some((title) => title.includes("JoJo"))).toBe(false);
    // Two ToonStream entries for one anime collapse into a single card.
    expect(titles.filter((title) => title === 'Mizuki')).toHaveLength(1);
    // …and the site slug is remembered for the catalog card's ToonStream pill.
    expect((dom.window as any).TS_SLUGS.jojo).toBe("jojo's-bizarre-adventure");
    // The bake must not hit the network for the row itself.
    expect(calls.some((call) => call.url.indexOf('home=1') !== -1)).toBe(false);

    // The card's detail view lists Nxsha episode names/stills, not placeholders.
    const overgeared = cards.find((card) => (card.textContent || '').includes('Overgeared'));
    overgeared!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await wait(200);
    const episodeList = doc.getElementById('episodeList')!;
    expect(episodeList.textContent).toContain('Legendary Class');
    expect(episodeList.textContent).toContain('Item Crafting Face-Off');
    expect(episodeList.querySelectorAll('.episode-card')).toHaveLength(12);
    // Stills come from the guide (not the placeholder image).
    expect(episodeList.innerHTML).toContain('e1.jpg');

    // Play still resolves through ToonStream, with the drop's exact S/E + slug.
    click(dom.window, doc.getElementById('demoPlay'));
    await waitFor(() => calls.some((call) => call.url.indexOf('/api/toonstream?title=') !== -1));
    const resolveUrl = decodeURIComponent(calls.find((call) => call.url.indexOf('/api/toonstream?title=') !== -1)!.url);
    expect(resolveUrl).toContain('title=Overgeared');
    expect(resolveUrl).toContain('slug=overgeared');
    expect(resolveUrl).toContain('s=1&e=4');
    const frame = doc.getElementById('serverFrame') as HTMLIFrameElement;
    await waitFor(() => frame.getAttribute('src') === RESOLVE_BODY.chosen);
    expect(frame.getAttribute('src')).toBe(RESOLVE_BODY.chosen);

    dom.window.close();
});

test('a stale bake (anime already dropped on the page) renders no duplicate', async () => {
    // A catalog title left in the bake without onSite: the page still dedupes
    // by title, so it can never show up twice.
    const { dom } = bootWithBake([
        { title: 'Solo Leveling', slug: 'solo-leveling', season: 2, episode: 13, nxId: '127532' },
    ]);
    await wait(400);
    const doc = dom.window.document;
    const row = Array.from(doc.querySelectorAll('#homeRows section')).find((section) =>
        (section.querySelector('h2')?.textContent || '').includes('Fresh Drop Toon'),
    );
    expect(row).toBeFalsy();
    expect((dom.window as any).TS_SLUGS.solo).toBe('solo-leveling');
    dom.window.close();
});

test('ToonStream seasons drive the card; Nxsha fills the guide and the mapped embed', async () => {
    // Ranma: ToonStream has S1 12, S2 12, S3 3. Nxsha merged all of it into one
    // 36-episode season, so the drop (S3E3) is really Nxsha S1E27. The card must
    // show ToonStream's three seasons, real metadata, and play Nxsha at the
    // mapped coordinates.
    const seasonGuide = (from: number, count: number) => {
        const out: Record<string, any> = {};
        for (let i = 0; i < count; i += 1) {
            const nxEp = from + i;
            out[String(i + 1)] = {
                title: nxEp === 27 ? 'The Weirdest Couple' : `Episode ${nxEp}`,
                overview: `Story ${nxEp}`,
                image: `https://image.tmdb.org/t/p/w300/e${nxEp}.jpg`,
                airDate: '2025-10-19',
                runtime: 23,
            };
        }
        return out;
    };
    const { dom } = bootWithBake([
        {
            title: 'Ranma1/2',
            slug: 'ranma1-2',
            img: 'https://image.tmdb.org/t/p/w780/ranma.jpg',
            season: 3,
            episode: 3,
            nxId: '259140',
            tsSlug: 'ranma1-2',
            seasons: { 1: 12, 2: 12, 3: 3 },
            nxMap: { 1: { season: 1, base: 0 }, 2: { season: 1, base: 12 }, 3: { season: 1, base: 24 } },
            firstSeen: '2026-10-19',
            guide: { 1: seasonGuide(1, 12), 2: seasonGuide(13, 12), 3: seasonGuide(25, 3) },
        },
    ]);
    await wait(400);
    const doc = dom.window.document;
    const card = Array.from(doc.querySelectorAll('#homeRows .rail-card')).find((node) =>
        (node.textContent || '').includes('Ranma1/2'),
    );
    expect(card).toBeTruthy();
    click(dom.window, card || null);
    await wait(250);

    const seasonSelect = doc.getElementById('seasonSelect') as HTMLSelectElement;
    // The dropped season opens first, with ToonStream's own episode count.
    expect(seasonSelect.value).toBe('3');
    expect(Array.from(seasonSelect.options).map((o) => o.value)).toEqual(['1', '2', '3']);
    expect(Array.from(seasonSelect.options).map((o) => (o.textContent || '').trim())).toEqual([
        'Season 1 (12)',
        'Season 2 (12)',
        'Season 3 (3)',
    ]);
    const episodeList = doc.getElementById('episodeList')!;
    expect(episodeList.querySelectorAll('.episode-card')).toHaveLength(3);
    expect(episodeList.textContent).toContain('The Weirdest Couple');
    expect(episodeList.innerHTML).toContain('e27.jpg');

    // Season 2 carries its own slice (Nxsha episodes 13–24), not S1's data.
    seasonSelect.value = '2';
    seasonSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(120);
    expect(episodeList.querySelectorAll('.episode-card')).toHaveLength(12);
    expect(episodeList.textContent).toContain('Episode 13');
    expect(episodeList.innerHTML).not.toContain('Episode still unavailable');

    // Opening S2E1 must build the Nxsha embed from the baked map: S1E13.
    const firstEpisode = episodeList.querySelector('.episode-card')!;
    click(dom.window, firstEpisode);
    await wait(200);
    // The drop auto-starts on ToonStream; switch to the Nxsha source.
    click(dom.window, doc.getElementById('nxServerBtn'));
    await wait(150);
    const poster = doc.getElementById('stagePoster');
    if (poster && !poster.hidden) click(dom.window, poster);
    const frame = doc.getElementById('serverFrame') as HTMLIFrameElement;
    const ready = await waitFor(() => (frame.getAttribute('src') || '').indexOf('nxsha.space/embed') !== -1, 4000);
    expect(ready).toBe(true);
    expect(frame.getAttribute('src')).toContain('/embed/tv/259140/1/13');
    dom.window.close();
});
