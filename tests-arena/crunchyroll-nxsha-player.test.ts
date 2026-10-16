/**
 * Live-DOM checks for the Crunchyroll page's single Nxsha player.
 *
 * The page is a self-contained document, so it is booted in jsdom and driven
 * like a user would: open a catalog title, hit play, and click the poster.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const NXSHA_PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type NxTitle = {
    id: string;
    kind: 'tv' | 'movie';
    seasons: Record<string, number>;
    title: string;
};

function readNxData(): Record<string, NxTitle> {
    const html = readFileSync(HTML_PATH, 'utf8');
    const match = html.match(/\/\*__NXSHA__\*\/var NX_DATA=(\{.*?\});\/\*__END_NXSHA__\*\//);
    if (!match) throw new Error('Nxsha title table is missing from the Crunchyroll page');
    return JSON.parse(match[1]);
}

type NxEpisodeMeta = {
    title?: string;
    image?: string;
    overview?: string;
    airDate?: string;
    runtime?: number;
};

type NxEpisodeGuide = Record<string, Record<string, Record<string, NxEpisodeMeta>>>;

function readNxEpisodeGuide(): NxEpisodeGuide {
    const html = readFileSync(HTML_PATH, 'utf8');
    const match = html.match(/\/\*__NXSHA_GUIDE__\*\/var NX_EPISODE_DATA=(\{.*?\});\/\*__END_NXSHA_GUIDE__\*\//);
    if (!match) throw new Error('Nxsha episode guide is missing from the Crunchyroll page');
    return JSON.parse(match[1]);
}

type NxEpisodeRecord = {
    season: number;
    episode: number;
    title?: string;
    image?: string;
    overview?: string;
    airDate?: string;
    runtime?: number;
};

type NxEpisodeSnapshot = {
    shows: Record<string, { seasons: Record<string, number>; episodes: NxEpisodeRecord[] }>;
};

function readNxEpisodeSnapshot(): NxEpisodeSnapshot {
    return JSON.parse(readFileSync(join(ROOT, 'data', 'nxsha-episodes.json'), 'utf8'));
}

function boot() {
    const html = readFileSync(HTML_PATH, 'utf8');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    virtualConsole.on('error', () => {});
    return new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
    });
}

type Win = JSDOM['window'];

async function waitForElement(window: Win, selector: string, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let element = window.document.querySelector(selector);
    while (!element && Date.now() < deadline) {
        await wait(100);
        element = window.document.querySelector(selector);
    }
    return element;
}

function click(window: Win, element: Element | null) {
    if (!element) throw new Error('element missing while driving the player');
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

async function play(window: Win, key: string, season = '1') {
    const doc = window.document;
    click(window, await waitForElement(window, `#catalogGrid [data-open="${key}"]`));
    await wait(70);

    const seasonSelect = doc.getElementById('seasonSelect') as HTMLSelectElement | null;
    if (seasonSelect && Array.from(seasonSelect.options).some((option) => option.value === season)) {
        seasonSelect.value = season;
        seasonSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    }

    click(window, doc.getElementById('demoPlay'));
    await wait(70);
    click(window, doc.getElementById('stagePoster'));
    await wait(180);
}

const activePlayer = (window: Win) =>
    Array.from(window.document.querySelectorAll('.server-pill')).map((pill) => ({
        server: pill.getAttribute('data-server'),
        active: pill.classList.contains('active'),
        label: pill.textContent?.trim(),
    }));

jest.setTimeout(45000);

test('Nxsha is the sole player and the default for the Crunchyroll section', async () => {
    const dom = boot();
    await wait(200);
    const doc = dom.window.document;

    // The server bar is gone — the player boots straight into Nxsha.
    expect(activePlayer(dom.window)).toEqual([]);
    expect(doc.getElementById('serverName')).toBeNull();
    expect(doc.body.textContent).not.toContain('Server 1');
    expect(doc.body.textContent).not.toContain('Server 2');

    await play(dom.window, 'aot');
    // The player heading carries no server branding any more.
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP1');
    expect(doc.getElementById('serverFrame')!.getAttribute('src')).toBe(
        `https://nxsha.space/embed/tv/tt2560140/1/1?${NXSHA_PARAMS}`,
    );
    dom.window.close();
});

test('all 64 Crunchyroll catalog titles have one Nxsha mapping', async () => {
    const dom = boot();
    await wait(200);

    const nxData = readNxData();
    const catalogKeys = Array.from(
        dom.window.document.querySelectorAll('#catalogGrid [data-open]'),
    ).map((card) => card.getAttribute('data-open') || '');
    expect(new Set(catalogKeys).size).toBe(64);
    expect(Object.keys(nxData).sort()).toEqual([...new Set(catalogKeys)].sort());
    for (const entry of Object.values(nxData)) {
        expect(entry.id).toMatch(/^(tt\d{6,10}|\d{1,9})$/);
        expect(['tv', 'movie']).toContain(entry.kind);
        expect(Object.keys(entry.seasons).length).toBeGreaterThan(0);
    }
    dom.window.close();
});

test('all non-One-Piece season maps match the harvested Nxsha episode guide when available', () => {
    const nxData = readNxData();
    expect(nxData.onepiece.seasons).toEqual({ '1': 31, '20': 10 });
    expect(nxData.tokyo.seasons).toEqual({ '1': 55 });
    const snapshotPath = join(ROOT, 'data', 'nxsha-episodes.json');
    if (!existsSync(snapshotPath)) {
        // Bootstrap commits must not mistake unchecked-in local counts for Nxsha data.
        expect(readNxEpisodeGuide()).toEqual({});
        return;
    }
    const snapshot = readNxEpisodeSnapshot();
    const animeKeys = Object.entries(nxData)
        .filter(([key, entry]) => entry.kind === 'tv' && key !== 'onepiece')
        .map(([key]) => key)
        .sort();
    expect(Object.keys(snapshot.shows).sort()).toEqual(animeKeys);

    for (const key of animeKeys) {
        const counts: Record<string, number> = {};
        for (const episode of snapshot.shows[key].episodes) {
            counts[String(episode.season)] = (counts[String(episode.season)] || 0) + 1;
        }
        expect(nxData[key].seasons).toEqual(counts);
        expect(Object.values(nxData[key].seasons).reduce((sum, count) => sum + count, 0)).toBe(
            snapshot.shows[key].episodes.length,
        );
    }
});

test('episode cards use Nxsha stills, titles, and synopsis, without changing One Piece metadata', async () => {
    const guide = readNxEpisodeGuide();
    expect(guide.onepiece).toBeUndefined();
    const snapshotPath = join(ROOT, 'data', 'nxsha-episodes.json');
    const snapshot = existsSync(snapshotPath) ? readNxEpisodeSnapshot() : null;
    const firstEpisode = snapshot
        ? snapshot.shows.vinland.episodes.find((episode) => episode.season === 1 && episode.episode === 1)!
        : null;
    if (snapshot) {
        expect(firstEpisode).toBeTruthy();
        expect(firstEpisode!.title).toBeTruthy();
        expect(firstEpisode!.image).toMatch(/^https:\/\/image\.tmdb\.org\//);
        expect(firstEpisode!.overview).toBeTruthy();
        expect(guide.vinland['1']['1']).toMatchObject({
            title: firstEpisode!.title,
            image: firstEpisode!.image,
            overview: firstEpisode!.overview,
        });
    } else {
        expect(guide).toEqual({});
    }

    const dom = boot();
    await wait(180);
    const doc = dom.window.document;
    click(dom.window, await waitForElement(dom.window, '#catalogGrid [data-open="vinland"]'));
    await wait(80);
    const cards = Array.from(doc.querySelectorAll('#episodeList .episode-card'));
    expect(cards).toHaveLength(readNxData().vinland.seasons['1']);
    if (firstEpisode) {
        expect(cards[0].querySelector('strong')?.textContent).toBe(firstEpisode.title);
        expect(cards[0].querySelector('img')?.getAttribute('data-src')).toBe(firstEpisode.image);
        expect(cards[0].querySelector('.episode-desc')?.textContent).toBe(firstEpisode.overview);
    } else {
        expect(cards[0].querySelector('strong')?.textContent).toBe('Episode 1');
        expect(cards[0].querySelector('img')?.getAttribute('data-src')).toMatch(/^data:image\/svg\+xml/);
        expect(cards[0].querySelector('.episode-desc')).toBeNull();
        expect(cards[0].querySelector('.episode-runtime')).toBeNull();
    }
    // The episode list scrolls inside .detail-page, not the window. A newly
    // visible lazy still must be promoted from data-src to src there.
    await wait(130);
    const lazyStill = cards[14].querySelector('img') as HTMLImageElement;
    const lazyStillUrl = lazyStill.getAttribute('data-src');
    expect(lazyStillUrl).toBeTruthy();
    Object.defineProperty(lazyStill, 'offsetWidth', { configurable: true, get: () => 100 });
    Object.defineProperty(lazyStill, 'offsetHeight', { configurable: true, get: () => 56 });
    let stillTop = 5000;
    lazyStill.getBoundingClientRect = () => ({
        x: 0, y: stillTop, top: stillTop, bottom: stillTop + 56,
        left: 0, right: 100, width: 100, height: 56,
        toJSON: () => ({}),
    } as DOMRect);
    const detailPageScroller = doc.querySelector('.detail-page')!;
    detailPageScroller.dispatchEvent(new dom.window.Event('scroll'));
    await wait(130);
    expect(lazyStill.hasAttribute('data-src')).toBe(true);
    stillTop = 100;
    detailPageScroller.dispatchEvent(new dom.window.Event('scroll'));
    await wait(130);
    expect(lazyStill.hasAttribute('data-src')).toBe(false);
    expect(lazyStill.getAttribute('src')).toBe(lazyStillUrl);

    if (snapshot) {
        click(dom.window, doc.querySelector('.dialog-close'));
        await wait(60);
        click(dom.window, await waitForElement(dom.window, '#catalogGrid [data-open="tokyo"]'));
        await wait(80);
        const tokyoCards = Array.from(doc.querySelectorAll('#episodeList .episode-card'));
        expect(tokyoCards).toHaveLength(55);
        const episode55 = snapshot.shows.tokyo.episodes.find((episode) => episode.season === 1 && episode.episode === 55)!;
        expect(tokyoCards[54].querySelector('strong')?.textContent).toBe(episode55.title);
        expect(tokyoCards[54].querySelector('img')?.getAttribute('data-src')).toMatch(/^data:image\/svg\+xml/);
        expect(tokyoCards[54].querySelector('.episode-desc')).toBeNull();
        expect(tokyoCards[54].querySelector('.episode-air-date')?.textContent).toBe(episode55.airDate);
        expect(tokyoCards[54].querySelector('.episode-runtime')).toBeNull();
    }
    dom.window.close();
});

test('titles formerly using other sources now open directly through Nxsha', async () => {
    const dom = boot();
    await wait(200);

    await play(dom.window, 'solo');
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toBe(
        `https://nxsha.space/embed/tv/127532/1/1?${NXSHA_PARAMS}`,
    );
    click(dom.window, dom.window.document.getElementById('closePlayer'));
    await wait(60);

    await play(dom.window, 'onepiece', '20');
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toBe(
        `https://nxsha.space/embed/tv/37854/20/1?${NXSHA_PARAMS}`,
    );
    dom.window.close();
});

test('Nxsha movie embeds omit season and episode path segments', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'yourname');
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toBe(
        `https://nxsha.space/embed/movie/tt5311514?${NXSHA_PARAMS}`,
    );
    dom.window.close();
});

test('Nxsha iframe remains sandboxed and allows fullscreen playback', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'aot');
    const frame = dom.window.document.getElementById('serverFrame')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('src')).toContain('https://nxsha.space/embed/tv/tt2560140/1/1');
    expect(frame.getAttribute('scrolling')).toBe('no');
    expect(frame.getAttribute('allow')).toBe('autoplay; fullscreen; encrypted-media; picture-in-picture');
    expect(frame.hasAttribute('allowfullscreen')).toBe(true);
    expect(dom.window.document.getElementById('videoStage')!.classList.contains('s16x9')).toBe(true);
    dom.window.close();
});

test('the watch page next-episode card reloads Nxsha with the new episode number', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'aot');
    const doc = dom.window.document;

    const nextCard = doc.getElementById('watchNextCard') as HTMLButtonElement | null;
    expect(nextCard).toBeTruthy();
    expect(nextCard!.hidden).toBe(false);
    expect(nextCard!.querySelector('.up-info b')?.textContent).toBe('E2 – That Day: The Fall of Shiganshina (2)');
    click(dom.window, nextCard);
    await wait(120);
    // openEpisode re-arms the poster gate; one click loads the new episode.
    click(dom.window, doc.getElementById('stagePoster'));
    await wait(180);
    expect(doc.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/tt2560140/1/2',
    );
    dom.window.close();
});

test('the failure notice still offers retry with no alternate server (trigger guarded)', async () => {
    const dom = boot();
    await wait(200);
    const doc = dom.window.document;

    // The old help button went away with the server bar; the notice it opened is
    // still wired through the guarded listener and the playback watchdog, and
    // there is still no alternate server anywhere.
    expect(doc.getElementById('noticeAlt')).toBeNull();
    expect(readFileSync(HTML_PATH, 'utf8')).toContain('function onServerTimeout(');
    expect(readFileSync(HTML_PATH, 'utf8')).toContain('Retry the player or open it in a new tab.');
    expect(readFileSync(HTML_PATH, 'utf8')).toContain(
        "var serverHelpBtn=byId('serverHelp');if(serverHelpBtn)serverHelpBtn.addEventListener(",
    );
    expect(doc.getElementById('blockedOpen')).toBeTruthy();
    expect(readFileSync(HTML_PATH, 'utf8')).not.toContain('function nextServer(');

    await play(dom.window, 'solo');
    expect(doc.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/127532/1/1',
    );
    dom.window.close();
});

test('opening and closing the player toggles the immersive nav state', async () => {
    const dom = boot();
    await wait(200);
    const doc = dom.window.document;
    expect(doc.body.classList.contains('playing')).toBe(false);
    await play(dom.window, 'solo');
    expect(doc.body.classList.contains('playing')).toBe(true);

    click(dom.window, doc.getElementById('closePlayer'));
    await wait(60);
    expect(doc.body.classList.contains('playing')).toBe(false);
    expect(doc.getElementById('serverFrame')!.getAttribute('src')).toBe('about:blank');
    dom.window.close();
});

test('fullscreen exit keeps the Nxsha URL and enables the one-tap repaint recovery', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'solo');
    const frame = dom.window.document.getElementById('serverFrame')!;
    const srcBefore = frame.getAttribute('src');

    Object.defineProperty(dom.window.document, 'fullscreenElement', {
        configurable: true,
        value: dom.window.document.body,
    });
    dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    await wait(20);
    Object.defineProperty(dom.window.document, 'fullscreenElement', {
        configurable: true,
        value: null,
    });
    dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    await wait(500);

    expect(frame.getAttribute('src')).toBe(srcBefore);
    expect(dom.window.document.querySelector('.toast')!.textContent).toContain('Player frozen?');
    dom.window.close();
});
