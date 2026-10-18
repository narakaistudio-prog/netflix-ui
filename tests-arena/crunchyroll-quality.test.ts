// The Crunchyroll page must ask the Nxsha player for 1080p every time the
// frame loads — the player's own default is Auto (240p) and the provider
// documents no quality parameter, so the page sprays the same command
// spellings it uses for resume-seek. Drives the real page in JSDOM.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function boot() {
    const html = readFileSync(HTML_PATH, 'utf8');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error: Error) => {
        if (/Not implemented/.test(error.message)) return;
        throw error;
    });
    virtualConsole.on('error', () => {});
    return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.local/crunchyroll', virtualConsole });
}

function click(window: JSDOM['window'], element: Element | null) {
    if (!element) throw new Error('element missing while driving the player');
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

async function waitForElement(window: JSDOM['window'], selector: string, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let element = window.document.querySelector(selector);
    while (!element && Date.now() < deadline) {
        await wait(80);
        element = window.document.querySelector(selector);
    }
    return element;
}

test('every player load sprays a 1080p ask into the Nxsha frame', async () => {
    const dom = boot();
    await wait(400);
    const doc = dom.window.document;

    click(dom.window, await waitForElement(dom.window, '#catalogGrid [data-open="aot"]'));
    await wait(80);
    click(dom.window, doc.getElementById('demoPlay'));
    await wait(80);
    click(dom.window, doc.getElementById('stagePoster'));
    await wait(220);

    const frame = doc.getElementById('serverFrame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toContain('https://nxsha.space/embed/tv/tt2560140/1/1');

    const seen: unknown[] = [];
    (frame.contentWindow as any).postMessage = (data: any) => { seen.push(data); };
    frame.dispatchEvent(new dom.window.Event('load'));
    await wait(700);

    expect(seen.length).toBeGreaterThan(0);
    for (const message of seen) {
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        expect(text).toContain('1080');
    }
    dom.window.close();
}, 45000);
