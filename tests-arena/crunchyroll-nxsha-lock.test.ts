/** Nxsha is intentionally the only playback provider in the Crunchyroll section. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

jest.setTimeout(30000);

test('Nxsha is the sole locked provider and the default player', () => {
    const html = readFileSync(HTML_PATH, 'utf8');

    expect(html).toContain("var SERVERS=[{name:'Nxsha',host:'nxsha.space'}];");
    expect(html).toContain('var PLAYER_DEFAULT_SERVER=0;');
    expect(html).toContain('function serverUrl(i){var st=playState;if(i!==0)return null;');
    expect(html).toContain("if(!nx||!nx.id)return null");
    expect(html).toContain("https://nxsha.space/embed/");
    expect(html).not.toContain('animahd.com');
    expect(html).not.toContain('drive.google.com');
    expect(html).not.toContain('Server 1');
    expect(html).not.toContain('Server 2');
    expect(html).not.toContain('Server 3');
    expect(html).not.toContain('nextServer(');
    expect(html).not.toContain('noticeAlt');
});

test('no provider controls remain in the DOM (the server bar is gone)', async () => {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    const dom = new JSDOM(readFileSync(HTML_PATH, 'utf8'), {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const pills = Array.from(dom.window.document.querySelectorAll('.server-pill'));
    expect(pills).toHaveLength(0);
    // The stage is still Nxsha's and only Nxsha's.
    expect(dom.window.document.getElementById('serverFrame')).toBeTruthy();
    dom.window.close();
});

test('every catalog key is mapped to Nxsha', async () => {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    const dom = new JSDOM(readFileSync(HTML_PATH, 'utf8'), {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const html = readFileSync(HTML_PATH, 'utf8');
    const match = html.match(/\/\*__NXSHA__\*\/var NX_DATA=(\{.*?\});\/\*__END_NXSHA__\*\//);
    expect(match).not.toBeNull();
    const nxData = JSON.parse((match as RegExpMatchArray)[1]);
    const catalogKeys = Array.from(
        dom.window.document.querySelectorAll('#catalogGrid [data-open]'),
    ).map((card) => card.getAttribute('data-open') || '');

    const ghibliKeys = Array.from(
        dom.window.document.querySelectorAll('#ghibliTrack [data-open]'),
    ).map((card) => card.getAttribute('data-open') || '');

    expect(new Set(catalogKeys).size).toBe(64);
    expect(new Set(ghibliKeys).size).toBe(22);
    // Every card the page can open — catalog and Ghibli rail — has a route.
    expect(Object.keys(nxData).sort()).toEqual(
        [...new Set([...catalogKeys, ...ghibliKeys])].sort(),
    );
    dom.window.close();
});
