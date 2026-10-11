/**
 * Live-DOM checks for the Crunchyroll demo player's three servers.
 *
 * The page is a self-contained document (not a component), so it is booted in
 * jsdom and driven like a user would: open a title card, press play, tap the
 * poster. This catches wiring mistakes that string assertions cannot.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const NXSHA_PARAMS = 'server=GbruHindi&lang=hi&sub=hi&color=orange&disable_app_ad=true&disable_dl_button=true';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function boot() {
    const html = readFileSync(HTML_PATH, 'utf8');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    virtualConsole.on('error', () => {});
    return new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://animahd.com/crunchyroll.html',
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

const pills = (window: Win) =>
    Array.from(window.document.querySelectorAll('.server-pill')).map((p) => ({
        server: p.getAttribute('data-server'),
        hidden: p.hasAttribute('hidden'),
        active: p.classList.contains('active'),
    }));

jest.setTimeout(20000);

test('nxsha-only title: Server 3 is the only tab and builds the provider URL', async () => {
    const dom = boot();
    await wait(200);
    const doc = dom.window.document;

    // S1..S4 for Attack on Titan, straight from NX_DATA.
    doc.querySelector('[data-open="aot"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    const options = Array.from(doc.querySelectorAll<HTMLOptionElement>('#seasonSelect option')).map((o) => o.value);
    expect(options).toEqual(['1', '2', '3', '4']);

    await play(dom.window, 'aot');
    expect(pills(dom.window)).toEqual([
        { server: '0', hidden: true, active: false },
        { server: '1', hidden: true, active: false },
        { server: '2', hidden: false, active: true },
    ]);
    expect(doc.getElementById('serverName')!.textContent).toBe('Server 3 · nxsha.space');
    expect(doc.getElementById('serverFrame')!.getAttribute('src')).toBe(
        `https://nxsha.space/embed/tv/tt2560140/1/1?${NXSHA_PARAMS}`,
    );
    dom.window.close();
});

test('nxsha movie title: movie embed URL, no season/episode path', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'yourname');
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toBe(
        `https://nxsha.space/embed/movie/tt5311514?${NXSHA_PARAMS}`,
    );
    dom.window.close();
});

test('starting an episode expands the stage by itself (no separate control)', async () => {
    const dom = boot();
    await wait(200);
    const win = dom.window as unknown as Window & { Element: typeof Element };
    const fullscreened: string[] = [];
    // jsdom has no Fullscreen API — mimic a browser that supports it.
    (win.Element.prototype as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = function (
        this: Element,
    ) {
        fullscreened.push(this.id || this.tagName);
        return Promise.resolve();
    };
    await play(dom.window, 'solo');
    expect(fullscreened).toEqual(['videoStage']);
    expect(dom.window.document.getElementById('serverFs')!.hasAttribute('hidden')).toBe(true);
    dom.window.close();
});

test('leaving fullscreen leaves a quiet way back in (fallback button)', async () => {
    const dom = boot();
    await wait(200);
    const win = dom.window as unknown as Window & { Element: typeof Element };
    (win.Element.prototype as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen =
        function () {
            return Promise.resolve();
        };
    await play(dom.window, 'solo');
    // Auto-fullscreen succeeded, so nothing extra is on screen...
    expect(dom.window.document.getElementById('serverFs')!.hasAttribute('hidden')).toBe(true);
    // ...until the viewer exits fullscreen.
    dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    expect(dom.window.document.getElementById('serverFs')!.hasAttribute('hidden')).toBe(false);
    dom.window.close();
});

test('when fullscreen is unavailable, the small fallback button shows up', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'solo');
    const button = dom.window.document.getElementById('serverFs')!;
    expect(button.hasAttribute('hidden')).toBe(false);
    expect(button.textContent).toContain('Fullscreen');
    dom.window.close();
});

test('animahd title keeps Server 1 + Server 2 and hides the fallback pill', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'solo');
    expect(pills(dom.window)).toEqual([
        { server: '0', hidden: false, active: true },
        { server: '1', hidden: false, active: false },
        { server: '2', hidden: true, active: false },
    ]);
    const src = dom.window.document.getElementById('serverFrame')!.getAttribute('src') || '';
    expect(src).toContain('https://animahd.com/player/?file_id=144U5FdhfBjG-nTnQ72xiljp8syd_qoMS');
    expect(src).toContain('ep=0');
    dom.window.close();
});
