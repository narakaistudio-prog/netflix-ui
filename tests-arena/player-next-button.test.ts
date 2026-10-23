// Player ke ANDAR "Next episode" button — sirf ToonStream (TS_MODE) par.
// Owner: "button abhi jis mark par kiya hai waha lagaoo", "jab cursor player ke
// andar hide hota hai to next button hide hona chahiye", aur "nxsha server par
// ye next lagana jaruri nahi hai".
//
// Autohide ka core problem: video cross-origin iframe hai — uske ANDAR ka
// mousemove parent page ko kabhi nahi milta. Isliye:
//   - dikhne ke liye har activity (move/click/touch/key/wheel/scroll) aur
//     pointer-into-iframe ka `mouseout` signal,
//   - chhupne ke baad `stage-idle` probe: iframe `pointer-events:none` ho jata
//     hai, isliye cursor wapas video par aane ki pehli movement parent ko mil
//     jati hai (aur turant probe hat jata hai — clicks normal).
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
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
        // Idle-probe sirf hover-capable devices par on hota hai — jsdom me
        // matchMedia default `false` deta hai, isliye test me patch karte hain.
        beforeParse(window: Win) {
            (window as any).matchMedia = () => ({
                matches: true,
                media: '',
                onchange: null,
                addListener() {},
                removeListener() {},
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent: () => false,
            });
        },
    } as any);
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

/** Nxsha → ToonStream trio. */
async function useToonStream(window: Win) {
    click(window, window.document.getElementById('tsServerBtn'));
    await wait(120);
}

const isShown = (el: HTMLElement) => !el.hidden && el.classList.contains('show');

test('button player ke stage ke andar hai — red mark wali jagah, idle-hide ke saath', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Stage ke andar (iframe ke upar).
    const stage = html.slice(html.indexOf('id="videoStage"'), html.indexOf('id="videoStage"') + 3000);
    expect(stage).toContain('id="nextFloat"');
    expect(stage).toContain('next-float');
    // Jagah: control bar se kaafi upar (owner ka naya red mark ~30%).
    expect(html).toContain('bottom:clamp(56px,30%,300px)');
    // Autohide + idle probe (cursor chhupe to button bhi chhupe).
    expect(html).toContain('var NEXT_IDLE_MS=3200;');
    expect(html).toContain('.video-stage.stage-idle iframe{pointer-events:none}');
    expect(html).toContain('function nextFloatProbe(');
    // Sirf ToonStream par — Nxsha par nahi.
    expect(html).toContain('return !!(TS_MODE&&stageInjected&&playerShell&&!playerShell.hidden&&nextFloatTarget())');
    // Purana auto-next bar poora nikal gaya.
    expect(html).not.toContain('autoNextBar');
    expect(html).not.toContain('armAutoNext');
});

test('Nxsha server par next button nahi aata', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'aot');
    // Server order: ToonStream = 1 (default), Nxsha = 2. Play ab ToonStream par
    // shuru hota hai, isliye Nxsha par switch karke hi ye rule check hoga.
    click(dom.window, doc.getElementById('nxServerBtn'));
    await wait(120);

    const btn = doc.getElementById('nextFloat') as HTMLElement;
    expect(btn.hidden).toBe(true);
    // Activity karne par bhi nahi.
    doc.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
    await wait(80);
    expect(btn.hidden).toBe(true);
});

test('ToonStream par button dikhta hai, idle par gayab, movement par probe ke saath wapas', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    const stage = doc.getElementById('videoStage') as HTMLElement;
    await play(dom.window, 'aot');
    await useToonStream(dom.window);

    const btn = doc.getElementById('nextFloat') as HTMLElement;
    expect(btn.hidden).toBe(false);
    expect(btn.classList.contains('show')).toBe(true);
    expect(doc.getElementById('nextFloatLabel')!.textContent).toBe('Next · E2');

    // 3.2s+ kuch nahi → button gayab + cursor-probe on (iframe click-through),
    // taaki video par wapas aane ki pehli movement humein mile.
    await wait(3600);
    expect(btn.classList.contains('show')).toBe(false);
    expect(stage.classList.contains('stage-idle')).toBe(true);

    // Wahi movement → button wapas, probe off (clicks normal).
    doc.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
    await wait(60);
    expect(btn.classList.contains('show')).toBe(true);
    expect(stage.classList.contains('stage-idle')).toBe(false);

    // Player se bahar nikalte hi (900ms) chhup jata hai.
    stage.dispatchEvent(new dom.window.MouseEvent('mouseleave', { bubbles: false }));
    await wait(1100);
    expect(btn.classList.contains('show')).toBe(false);
});

test('button dabane par agla episode usi player me lag jata hai', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'aot');
    await useToonStream(dom.window);
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP1');

    click(dom.window, doc.getElementById('nextFloat'));
    await wait(400);

    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP2');
    expect(doc.getElementById('nextFloatLabel')!.textContent).toBe('Next · E3');
});

test('movie par button nahi aata', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'yourname');
    await useToonStream(dom.window);

    doc.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
    await wait(120);
    expect((doc.getElementById('nextFloat') as HTMLElement).hidden).toBe(true);
});

test('aakhri episode par button nahi aata', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    // 'chainsaw' S1 me 12 episodes — E12 aakhri.
    await play(dom.window, 'chainsaw');
    await useToonStream(dom.window);
    const sub = doc.getElementById('playerSub') as HTMLElement;
    expect(sub.textContent).toBe('S1 · EP1');

    for (let i = 0; i < 11; i += 1) {
        click(dom.window, doc.getElementById('nextFloat'));
        await wait(120);
    }
    expect(sub.textContent).toBe('S1 · EP12');
    expect((doc.getElementById('nextFloat') as HTMLElement).hidden).toBe(true);
});
