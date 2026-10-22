// Player ke ANDAR "Next episode" button — owner: "player ke andar next ka
// button laga do bas sahi jagah par... cursor move hoga to dikhega, kuch nahi
// hoga to hide rahega, jaisa MovieBox me laga hai."
//
// MovieBox (components/MovieboxPagePlayer.tsx) ka wahi pattern: video ke
// bottom-right white pill, ~3.2s idle par gayab. Yahan stage ke andar
// cross-origin iframe hai, isliye reveal ke signals parent page par lagte hain
// (mousemove click touch key wheel scroll + pointer-into-iframe ka mouseout).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

type Win = JSDOM['window'];

jest.setTimeout(45000);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Har test ka apna 9MB page — sab zinda rahein to heap phat jata hai.
const openDoms: JSDOM[] = [];
afterEach(() => {
    while (openDoms.length) {
        try {
            openDoms.pop()!.window.close();
        } catch {}
    }
});

function boot() {
    const html = readFileSync(HTML_PATH, 'utf8');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error: Error) => {
        if (/Not implemented/.test(error.message)) return;
        throw error;
    });
    virtualConsole.on('error', () => {});
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.local/crunchyroll', virtualConsole });
    openDoms.push(dom);
    return dom;
}

async function waitForElement(window: Win, selector: string, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let element = window.document.querySelector(selector);
    while (!element && Date.now() < deadline) {
        await wait(60);
        element = window.document.querySelector(selector);
    }
    if (!element) throw new Error(`element nahi mila: ${selector}`);
    return element;
}

function click(window: Win, element: Element | null) {
    if (!element) throw new Error('element missing');
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

const isShown = (el: HTMLElement) => !el.hidden && el.classList.contains('show');

test('button player ke stage ke andar hai — MovieBox jaisa pill, autohide timing ke saath', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Stage ke andar (iframe ke upar) — page ke bahar/floating nahi.
    const stage = html.slice(html.indexOf('id="videoStage"'), html.indexOf('id="videoStage"') + 3000);
    expect(stage).toContain('id="nextFloat"');
    expect(stage).toContain('next-float');
    expect(stage).toContain('Next Episode');
    // Autohide: idle timer + activity listeners.
    expect(html).toContain('var NEXT_IDLE_MS=3200;');
    expect(html).toContain("document.addEventListener('mousemove',activity,true);");
    expect(html).toContain("document.addEventListener('mouseout',function(e){if(!e.relatedTarget)activity()},false);");
    expect(html).toContain('function nextFloatShow(');
    expect(html).toContain('function nextFloatHide(');
    // Purana auto-next bar poora nikal gaya (owner: "sab bekar").
    expect(html).not.toContain('autoNextBar');
    expect(html).not.toContain('armAutoNext');
});

test('episode chalte hi button dikhta hai, 3.2s idle par gayab, cursor hilne par wapas', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'aot');

    const btn = doc.getElementById('nextFloat') as HTMLElement;
    // Stage chalu hote hi ek baar dikhta hai (user ko pata chale).
    expect(btn.hidden).toBe(false);
    expect(btn.classList.contains('show')).toBe(true);
    expect(doc.getElementById('nextFloatLabel')!.textContent).toBe('Next · E2');

    // 3.2s+ kuch nahi kiya → gayab.
    await wait(3600);
    expect(btn.classList.contains('show')).toBe(false);

    // Cursor hilate hi wapas.
    doc.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
    await wait(60);
    expect(btn.classList.contains('show')).toBe(true);
    expect(btn.hidden).toBe(false);
});

test('button dabane par agla episode usi player me lag jata hai', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'aot');
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP1');

    click(dom.window, doc.getElementById('nextFloat'));
    await wait(600);

    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP2');
    expect((doc.getElementById('serverFrame') as HTMLIFrameElement).getAttribute('src')).toContain('/tt2560140/1/2');
    expect(doc.getElementById('nextFloatLabel')!.textContent).toBe('Next · E3');
});

test('movie par button nahi aata (movie ka agla episode nahi hota)', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'yourname');

    doc.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
    await wait(120);
    expect((doc.getElementById('nextFloat') as HTMLElement).hidden).toBe(true);
});

test('aakhri episode par button nahi aata, sirf toast', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    // 'chainsaw' S1E12 hi last hai (data me 12 episodes).
    await play(dom.window, 'chainsaw');
    const sub = doc.getElementById('playerSub') as HTMLElement;
    expect(sub.textContent).toBe('S1 · EP1');

    // Seedha last episode par jao — Next dabate-dabate (11 baar) E12 tak.
    for (let i = 0; i < 11; i += 1) {
        click(dom.window, doc.getElementById('nextFloat'));
        await wait(120);
    }
    expect(sub.textContent).toBe('S1 · EP12');
    expect((doc.getElementById('nextFloat') as HTMLElement).hidden).toBe(true);
});
