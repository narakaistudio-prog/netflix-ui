/**
 * Live-DOM checks for the Crunchyroll demo player — Nxsha is the one and only
 * server, and every title embeds from it.
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
        url: 'https://app.local/crunchyroll.html',
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

test('nxsha is the only tab for a tv title and builds the provider URL', async () => {
    const dom = boot();
    await wait(200);
    const doc = dom.window.document;

    // S1..S4 for Attack on Titan, straight from NX_DATA.
    doc.querySelector('[data-open="aot"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    const options = Array.from(doc.querySelectorAll<HTMLOptionElement>('#seasonSelect option')).map((o) => o.value);
    expect(options).toEqual(['1', '2', '3', '4']);

    await play(dom.window, 'aot');
    expect(pills(dom.window)).toEqual([{ server: '0', hidden: false, active: true }]);
    expect(doc.getElementById('serverName')!.textContent).toBe('Nxsha · nxsha.space');
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

test('titles the old file-based servers carried now play on nxsha too', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'solo');
    const frame = dom.window.document.getElementById('serverFrame')!;
    // Solo Leveling's S1E1 resolves to the Nxsha provider URL, not a file_id.
    expect(frame.getAttribute('src')).toBe(`https://nxsha.space/embed/tv/tt21209876/1/1?${NXSHA_PARAMS}`);
    expect(frame.getAttribute('src')).not.toContain('file_id');
    dom.window.close();
});

test('nxsha embed config: sandboxed (popup shield) with fullscreen grant', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'aot');
    const frame = dom.window.document.getElementById('serverFrame')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('src')).toContain('https://nxsha.space/embed/tv/tt2560140/1/1');
    expect(frame.getAttribute('scrolling')).toBe('no');
    expect(frame.getAttribute('allow')).toBe('autoplay; fullscreen; encrypted-media; picture-in-picture');
    expect(frame.hasAttribute('allowfullscreen')).toBe(true);
    expect(frame.hasAttribute('webkitallowfullscreen')).toBe(true);
    expect(frame.hasAttribute('mozallowfullscreen')).toBe(true);
    dom.window.close();
});

test('opening the player unsticks the nav, closing it restores the logo', async () => {
    const dom = boot();
    await wait(200);
    const doc = dom.window.document;
    expect(doc.body.classList.contains('playing')).toBe(false);
    await play(dom.window, 'solo');
    // No sticky layer over the frames while playing...
    expect(doc.body.classList.contains('playing')).toBe(true);
    // ...and it comes back for browsing.
    doc.getElementById('closePlayer')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await wait(60);
    expect(doc.body.classList.contains('playing')).toBe(false);
    dom.window.close();
});

test('leaving fullscreen triggers the repaint nudge', async () => {
    const dom = boot();
    await wait(200);
    await play(dom.window, 'solo');
    const frame = dom.window.document.getElementById('serverFrame')!;
    const srcBefore = frame.getAttribute('src');
    dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    await wait(500);
    // The nudge is a blink + 1px re-layout, never a reload: the episode keeps
    // playing from the same URL and no style leftovers remain.
    expect(frame.getAttribute('src')).toBe(srcBefore);
    expect((frame.getAttribute('style') || '').trim()).toBe('');
    dom.window.close();
});

test('every title lands on the single nxsha pill', async () => {
    const dom = boot();
    await wait(200);
    // An old AnimaHD-only title…
    await play(dom.window, 'solo');
    expect(pills(dom.window)).toEqual([{ server: '0', hidden: false, active: true }]);
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/tt21209876/1/1',
    );
    // …and an always-nxsha title come back to the same pill, same player.
    await play(dom.window, 'aot');
    expect(pills(dom.window)).toEqual([{ server: '0', hidden: false, active: true }]);
    expect(dom.window.document.getElementById('serverFrame')!.getAttribute('src')).toContain(
        'https://nxsha.space/embed/tv/tt2560140/1/1',
    );
    dom.window.close();
});
