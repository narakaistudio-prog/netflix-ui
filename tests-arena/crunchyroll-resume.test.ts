// Continue Watching must resume the SAME episode at the EXACT playback position
// on the Crunchyroll page. The Nxsha embed is cross-origin, so the page pins the
// position from player postMessage time events (exact ack), falls back to a
// wall-clock estimator while the stage is live, and sprays seek nudges back into
// the frame when a card is resumed. These tests drive the real page in JSDOM.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

type Win = JSDOM['window'];

jest.setTimeout(45000);

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

function click(window: Win, element: Element | null) {
    if (!element) throw new Error('element missing while driving Continue Watching');
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

async function play(window: Win, key: string) {
    const doc = window.document;
    click(window, await waitForElement(window, `#catalogGrid [data-open="${key}"]`));
    await wait(80);
    click(window, doc.getElementById('demoPlay'));
    await wait(80);
    click(window, doc.getElementById('stagePoster'));
    await wait(220);
}

async function waitForElement(window: Win, selector: string, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let element = window.document.querySelector(selector);
    while (!element && Date.now() < deadline) {
        await wait(80);
        element = window.document.querySelector(selector);
    }
    return element;
}

function resumeEntries(window: Win): any[] {
    return JSON.parse(window.localStorage.getItem('cr-resume-v1') ?? '[]');
}

function postPlayerMessage(window: Win, data: unknown) {
    window.dispatchEvent(new window.MessageEvent('message', { data }));
}

test('player time events pin the exact position, the card renders it, and resuming seeks the frame back to it', async () => {
    const dom = boot();
    await wait(400);
    const doc = dom.window.document;
    await play(dom.window, 'aot');

    // The frame boots untouched — resume must never rewrite the embed URL.
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP1');
    const frame = doc.getElementById('serverFrame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toContain('https://nxsha.space/embed/tv/tt2560140/1/1?');
    expect(frame.getAttribute('src')).not.toContain('start');

    // The player acknowledges 6m12s watched of a 24m episode, then pauses.
    postPlayerMessage(dom.window, { type: 'MEDIA_DATA', data: { event: 'timeupdate', currentTime: 372, duration: 1440 } });
    postPlayerMessage(dom.window, { event: 'pause', currentTime: 372, duration: 1440 });
    await wait(60);

    // The exact position and duration are stored against this episode.
    const [entry] = resumeEntries(dom.window);
    expect(entry.key).toBe('aot');
    expect(entry.ep).toBe(1);
    expect(entry.sec).toBeGreaterThanOrEqual(372);
    expect(entry.sec).toBeLessThanOrEqual(375);
    expect(entry.dur).toBe(1440);

    // The card shows where playback stopped, how much is left, and a progress bar.
    const card = doc.querySelector('#continueGrid .continue-card') as HTMLElement;
    expect(card.querySelector('em')!.textContent).toMatch(/^S1 · EP1 · 6:1\d in · 18 min left · just now$/);
    const bar = card.querySelector('.progress i') as HTMLElement;
    expect(bar.style.width).toMatch(/^2[5-7]%$/);

    // Closing keeps the position; the row does not reset.
    click(dom.window, doc.getElementById('closePlayer'));
    await wait(80);
    expect(resumeEntries(dom.window)[0].sec).toBeGreaterThanOrEqual(372);

    // Resuming from the card re-opens the SAME episode and announces the resume point
    // (the grid re-renders on close, so re-query the fresh card node).
    click(dom.window, doc.querySelector('#continueGrid .continue-card .continue-main'));
    await wait(100);
    expect(doc.getElementById('playerShell')!.hasAttribute('hidden')).toBe(false);
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP1');
    expect(doc.body.textContent).toContain('Resuming S1 EP1 at 6:12');

    // Once the stage is live again, the frame load sprays seek nudges carrying 372s.
    click(dom.window, doc.getElementById('stagePoster'));
    await wait(200);
    const seen: unknown[] = [];
    (frame.contentWindow as any)?.addEventListener?.('message', (e: any) => seen.push(e.data));
    frame.dispatchEvent(new dom.window.Event('load'));
    await wait(700);
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).toContain('372');

    // Watching on from the resume point never rewinds the stored position.
    click(dom.window, doc.getElementById('closePlayer'));
    await wait(80);
    expect(resumeEntries(dom.window)[0].sec).toBeGreaterThanOrEqual(372);
    dom.window.close();
});

test('with no player events, the wall-clock estimator still records the playback position', async () => {
    const dom = boot();
    await wait(400);
    const doc = dom.window.document;
    await play(dom.window, 'aot');
    await wait(2100); // ~2s of real playback, not a word from the player

    click(dom.window, doc.getElementById('closePlayer'));
    await wait(80);
    const [entry] = resumeEntries(dom.window);
    expect(entry.key).toBe('aot');
    expect(entry.sec).toBeGreaterThanOrEqual(1);
    expect(entry.sec).toBeLessThanOrEqual(6);
    expect(entry.dur).toBe(1440);

    // A barely-started entry keeps the classic label format (no position clutter).
    const em = doc.querySelector('#continueGrid .continue-card em');
    expect(em!.textContent).toBe('S1 · EP1 · just now');
    dom.window.close();
});

test('an explicit ended event from the player marks the episode watched and drops it from the row', async () => {
    const dom = boot();
    await wait(400);
    const doc = dom.window.document;
    await play(dom.window, 'aot');

    postPlayerMessage(dom.window, { type: 'PLAYER_EVENT', event: 'player_progress', currentTime: 1400, duration: 1440 });
    await wait(50);
    expect(resumeEntries(dom.window)).toHaveLength(1);

    postPlayerMessage(dom.window, { type: 'PLAYER_EVENT', data: { event: 'ended' } });
    await wait(80);
    expect(resumeEntries(dom.window)).toHaveLength(0);
    expect(doc.body.textContent).toContain('Marked as watched');
    dom.window.close();
});
