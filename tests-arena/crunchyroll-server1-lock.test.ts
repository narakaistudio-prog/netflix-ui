/**
 * Server 1 (AnimaHD) is THE player — locked in on purpose.
 *
 * The embed config below is the one that plays perfectly: the frame is not
 * sandboxed, keeps its own scrollbar, carries no permissions list, and is
 * shown in a plain 16:9 stage with nothing cropped or covered. Fullscreen is
 * the player page's own control, so leaving it never leaves a white frame.
 *
 * If one of these assertions fails, a change has broken the locked player —
 * fix the change, not the test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

const ANIMAHD_ATTRS =
    "else{serverFrame.removeAttribute('sandbox');serverFrame.removeAttribute('scrolling');serverFrame.removeAttribute('allow')}";

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

test('Server 1 is the named default player', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // First tab is Server 1 / animahd.com, and it is what every playback
    // starts on — regardless of the server used last time.
    expect(html).toContain("var SERVERS=[{name:'Server 1',host:'animahd.com'}");
    expect(html).toContain('var PLAYER_DEFAULT_SERVER=0;');
    expect(html).toContain('setActiveServer(PLAYER_DEFAULT_SERVER);');
    expect(html).toContain(
        'if(serverAvailable(PLAYER_DEFAULT_SERVER)){activeServer=PLAYER_DEFAULT_SERVER}else if(!serverAvailable(activeServer))',
    );
    expect(html).toContain('var activeServer=PLAYER_DEFAULT_SERVER;');
});

test('AnimaHD embed config is the locked reference (no crop, no cover, no sandbox)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The exact attribute line the working player had.
    expect(html).toContain(ANIMAHD_ATTRS);
    expect(html).toContain(
        "if(i===1||i===2){serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin');serverFrame.setAttribute('scrolling','no');serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')}",
    );
    // 16:9 full-width stage; the frame's own scrolling stays available.
    expect(html).toContain('.video-stage.s16x9{padding-bottom:56.25%}');
    expect(html).toContain("setClass(videoStage,'s16x9',i===0)");
    expect(html).toContain('<iframe id="serverFrame" title="Anime server player" allowfullscreen');
    // No cropping, covering or blurring of the player page.
    expect(html).not.toContain('s1cover');
    expect(html).not.toContain('s1fit');
    expect(html).not.toContain('max-width:1000px');
    expect(html).not.toContain('backdrop-filter:blur');
});

test('playback always lands on Server 1 when the title has it', async () => {
    const dom = boot();
    await wait(200);

    // Start with a title only AnimaHD carries.
    await play(dom.window, 'solo');
    expect(activeServer(dom.window)).toBe(0);
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://animahd.com/player/?file_id=',
    );

    // A title AnimaHD does not have falls back to Nxsha…
    await play(dom.window, 'aot');
    expect(activeServer(dom.window)).toBe(2);

    // …and the next AnimaHD title comes back to Server 1 by itself.
    await play(dom.window, 'solo');
    expect(activeServer(dom.window)).toBe(0);
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://animahd.com/player/?file_id=',
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
