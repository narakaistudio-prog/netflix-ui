import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

jest.setTimeout(30000);

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

/** The IMDb list order, exactly as the Movies rail renders it. */
const GHIBLI_TITLES = [
    'The Tale of The Princess Kaguya',
    'Spirited Away',
    'When Marnie Was There',
    'Grave of the Fireflies',
    'Princess Mononoke',
    'The Secret World of Arrietty',
    'Pom Poko',
    'Only Yesterday',
    'My Neighbor Totoro',
    'The Wind Rises',
    'Nausicaä of the Valley of the Wind',
    'Ponyo',
    "Kiki's Delivery Service",
    'My Neighbors the Yamadas',
    'Porco Rosso',
    'Howl’s Moving Castle',
    'Castle in the Sky',
    'Whisper of the Heart',
    'From Up on Poppy Hill',
    'Tales from Earthsea',
    'The Cat Returns',
    'Ocean Waves',
];

function boot() {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    return new JSDOM(readFileSync(HTML_PATH, 'utf8'), {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
    });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('Movies ships a Ghibli Movies rail with all 22 IMDb-list films', async () => {
    const dom = boot();
    await wait(300);
    const doc = dom.window.document;

    const row = doc.querySelector('#movies .ghibli-rail');
    expect(row).not.toBeNull();
    expect(row?.querySelector('#ghibli-title')?.textContent?.trim()).toBe('Ghibli Movies');
    expect(row?.querySelector('.rail-sub')?.textContent).toBe('All 22 Studio Ghibli films');

    const cards = Array.from(row?.querySelectorAll('#ghibliTrack .rail-card') ?? []);
    expect(cards).toHaveLength(22);
    expect(cards.map((card) => card.querySelector('.rail-copy h3')?.textContent)).toEqual(GHIBLI_TITLES);

    cards.forEach((card) => {
        expect(card.getAttribute('data-open')).toBeTruthy();
        expect(card.querySelector('.ghibli-flag')?.textContent).toBe('Studio Ghibli');
        expect(card.querySelector('.rail-copy p')?.textContent).toMatch(/^★ \d\.\d · \d{4} · /);
        const poster = card.querySelector('.rail-poster img');
        // New entries stream their TMDB poster lazily; the three films that
        // were already catalog movies keep their baked-in artwork.
        const art = poster?.getAttribute('data-src') ?? poster?.getAttribute('src') ?? '';
        expect(art).toMatch(/^(https:\/\/image\.tmdb\.org\/t\/p\/w500\/|data:image\/jpeg;base64,)/);
        // Broken artwork falls back to the generated Ghibli placeholder.
        expect(decodeURIComponent(poster?.getAttribute('onerror') ?? '')).toContain('svg');
    });

    // Rail-only collection titles stay out of the playable Browse grid; the
    // three Ghibli films that were already catalog movies remain there.
    const browse = new Set(
        Array.from(doc.querySelectorAll('#catalogGrid [data-open]')).map((node) => node.getAttribute('data-open')),
    );
    // IMDb import (Task 7) ke baad Browse grid = purane 64 playable titles +
    // imported titles. Fixed number likhne se har import par test tootta hai,
    // isliye ginti state file se aati hai.
    const imported = JSON.parse(
        readFileSync(join(ROOT, 'data', 'imdb-anime-catalog.json'), 'utf8'),
    ).entries as Array<{ key: string }>;
    expect(browse.size).toBe(64 + imported.length);
    ['kaguya', 'totoro', 'fireflies'].forEach((key) => expect(browse.has(key)).toBe(false));
    ['spirited', 'mononoke', 'howl'].forEach((key) => expect(browse.has(key)).toBe(true));
    imported.forEach((entry) => expect(browse.has(entry.key)).toBe(true));

    dom.window.close();
});

test('a Ghibli card opens its movie detail page and can be saved', async () => {
    const dom = boot();
    await wait(300);
    const doc = dom.window.document;
    const card = doc.querySelector('#ghibliTrack .rail-card[data-open="totoro"]') as HTMLElement;
    expect(card).toBeTruthy();

    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(doc.getElementById('detailDialog')?.hasAttribute('open')).toBe(true);
    expect(doc.getElementById('detailTitle')?.textContent).toBe('My Neighbor Totoro');
    const stats = doc.getElementById('detailStats')?.textContent ?? '';
    expect(stats).toContain('1h 26m');
    expect(stats).toContain('Runtime');
    // Movies have no episode guide.
    expect((doc.querySelector('.episode-guide') as HTMLElement).hidden).toBe(true);

    const save = card.querySelector('[data-save-key]') as HTMLElement;
    save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(save.className).toContain('saved');

    dom.window.close();
});

test('every Ghibli film has an Nxsha route and Play loads the movie embed', async () => {
    const dom = boot();
    await wait(300);
    const doc = dom.window.document;

    const html = readFileSync(HTML_PATH, 'utf8');
    const match = html.match(/\/\*__NXSHA__\*\/var NX_DATA=(\{.*?\});\/\*__END_NXSHA__\*\//);
    expect(match).not.toBeNull();
    const nxData = JSON.parse((match as RegExpMatchArray)[1]);

    const keys = Array.from(doc.querySelectorAll('#ghibliTrack .rail-card[data-open]')).map((node) =>
        node.getAttribute('data-open'),
    );
    expect(keys).toHaveLength(22);
    keys.forEach((key) => {
        expect(nxData[key as string]).toMatchObject({ kind: 'movie' });
        expect(nxData[key as string].id).toMatch(/^(tt\d{6,10}|\d{1,9})$/);
        expect(Object.keys(nxData[key as string].seasons)).toEqual(['1']);
    });

    // Card -> detail -> Watch Now -> the Nxsha movie embed for that film.
    const card = doc.querySelector('#ghibliTrack [data-open="totoro"]') as HTMLElement;
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    (doc.getElementById('demoPlay') as HTMLElement).dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
    );
    await wait(80);
    // The watch page gates the embed behind its poster (autoplay policy).
    (doc.getElementById('stagePoster') as HTMLElement).dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
    );
    await wait(250);

    expect(doc.getElementById('playerShell')?.hasAttribute('hidden')).toBe(false);
    expect(doc.getElementById('serverFrame')?.getAttribute('src')).toBe(
        'https://nxsha.space/embed/movie/8392?server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true',
    );
    expect(doc.getElementById('playerTitle')?.textContent).toBe('My Neighbor Totoro');

    dom.window.close();
});
