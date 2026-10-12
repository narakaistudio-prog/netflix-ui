/**
 * Nxsha (nxsha.space) is THE player — locked in on purpose.
 *
 * The Crunchyroll section has exactly one server: every title and every
 * episode embeds from https://nxsha.space/embed/… (NX_DATA). The embed config
 * below is the one that plays right: sandboxed with the media permissions
 * list, popup shield on, and shown in the plain stage with nothing cropped or
 * covered. Fullscreen is the embed's own control, so leaving it never leaves a
 * white frame.
 *
 * If one of these assertions fails, a change has broken the locked player —
 * fix the change, not the test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

const NXSHA_ATTRS =
    "serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin');serverFrame.setAttribute('scrolling','no');serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function boot() {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    virtualConsole.on('error', () => {});
    return new JSDOM(readFileSync(HTML_PATH, 'utf8'), {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
    });
}

type Win = JSDOM['window'];

async function play(window: Win, key: string) {
    const doc = window.document;
    const click = (el: Element | null) => {
        if (!el) throw new Error('element missing while driving the player');
        el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    };
    click(doc.querySelector(`[data-open="${key}"]`));
    await wait(60);
    click(doc.getElementById('demoPlay'));
    await wait(60);
    click(doc.getElementById('stagePoster'));
    await wait(200);
}

const activeServer = (window: Win) =>
    Array.from(window.document.querySelectorAll('.server-pill')).findIndex((pill) =>
        pill.classList.contains('active'),
    );

jest.setTimeout(30000);

test('Nxsha is the named default (and only) player', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The server table has one entry — Nxsha — and it is what every playback
    // starts on, regardless of anything else.
    expect(html).toContain("var SERVERS=[{name:'Nxsha',host:'nxsha.space'}]");
    expect(html).not.toContain("name:'Server 1'");
    expect(html).not.toContain("name:'Server 2'");
    expect(html).toContain('var PLAYER_DEFAULT_SERVER=0;');
    expect(html).toContain('setActiveServer(PLAYER_DEFAULT_SERVER);');
    expect(html).toContain(
        'if(serverAvailable(PLAYER_DEFAULT_SERVER)){activeServer=PLAYER_DEFAULT_SERVER}else if(!serverAvailable(activeServer))',
    );
    expect(html).toContain('var activeServer=PLAYER_DEFAULT_SERVER;');
});

test('Nxsha embed config is the locked reference (sandboxed, nothing over it)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The exact attribute line the working player uses — sandbox + media
    // permissions, and no branch anywhere that strips the sandbox again.
    expect(html).toContain(NXSHA_ATTRS);
    expect(html).not.toContain("removeAttribute('sandbox')");
    expect(html).toContain('<iframe id="serverFrame" title="Anime server player" allowfullscreen');
    // No cropping, covering or blurring of the player page.
    expect(html).not.toContain('s1cover');
    expect(html).not.toContain('s1fit');
    expect(html).not.toContain('s16x9');
    expect(html).not.toContain('max-width:1000px');
    expect(html).not.toContain('backdrop-filter:blur');
});

test('playback always lands on Nxsha', async () => {
    const dom = boot();
    await wait(200);

    // A title the old file-based servers used to carry…
    await play(dom.window, 'solo');
    expect(activeServer(dom.window)).toBe(0);
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/tt21209876/1/1',
    );

    // …a title that was always nxsha…
    await play(dom.window, 'aot');
    expect(activeServer(dom.window)).toBe(0);
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/tt2560140/1/1',
    );

    // …and the next title still comes back to the same single player.
    await play(dom.window, 'solo');
    expect(activeServer(dom.window)).toBe(0);
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/tt21209876/1/1',
    );
    dom.window.close();
});

test('safety nets stay invisibly in place around the locked player', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Repaint after leaving fullscreen (never a reload)…
    expect(html).toContain('function repaintStage()');
    expect(html).toContain('repaintStage();setTimeout(repaintStage,160);setTimeout(repaintStage,420)');
    // …the nav un-sticks for the player session…
    expect(html).toContain('body.playing .topbar{position:relative}');
    expect(html).toContain("addClass(document.body,'playing')");
    // …and the one-tap recovery toast is still the last resort.
    expect(html).toContain('Stuck on white? Tap here to reload');
});
