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
    const html = readFileSync(HTML_PATH, 'utf8');
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

    // Cards carry the site's own poster, title and source label.
    const cards = Array.from(doc.querySelectorAll('#homeRows .rail-card'));
    const jojo = cards.find((card) => (card.textContent || '').indexOf("JoJo's Bizarre Adventure") !== -1);
    expect(jojo).toBeTruthy();
    expect(jojo!.textContent).toContain('via ToonStream');
    expect(jojo!.textContent).toContain('S6 · E5');
    const playButton = jojo!.querySelector('[data-quick-play]');
    expect(playButton).toBeTruthy();

    // Tapping Play must resolve S6E5 through the resolver (not S1E1, and not
    // an empty Nxsha stage) and then load the ToonStream trio.
    click(dom.window, playButton);
    const resolved = await waitFor(() =>
        calls.some((c) => c.url.indexOf('/api/toonstream?title=') !== -1),
    );
    expect(resolved).toBe(true);
    const resolveUrl = decodeURIComponent(calls.find((c) => c.url.indexOf('/api/toonstream?title=') !== -1)!.url);
    expect(resolveUrl).toContain("title=JoJo's Bizarre Adventure");
    expect(resolveUrl).toContain('&s=6&e=5');

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
    const html = readFileSync(HTML_PATH, 'utf8');
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
