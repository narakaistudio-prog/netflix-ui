// ToonStream (Play/Short/MultiQ trio) aur Nxsha dono par "episode khatam hone
// ke baad agla episode khud lag jaye" — user ka seedha requirement.
//
// Third-party ToonStream hosts cross-origin iframes hain, isliye unke andar ka
// `ended` event parent ko hamesha nahi milta. Page do raaste rakhta hai:
//   1. player ka `ended/finished/complete` postMessage (exact),
//   2. clock fallback — episode ki runtime ke aakhri AUTO_NEXT_TAIL_SEC sec par
//      countdown chalu (jab koi message hi na aaye).
// Countdown 8s ka hai aur usi server slot (S1/S2/S3) par agla episode kholta hai.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

type Win = JSDOM['window'];

jest.setTimeout(45000);

// Har test ka apna 9MB page — theeno ek saath zinda rahein to heap phat jata
// hai, isliye test ke baad window band kar dete hain.
const openDoms: JSDOM[] = [];
afterEach(() => {
    while (openDoms.length) {
        try {
            openDoms.pop()!.window.close();
        } catch {}
    }
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function boot() {
    const html = readFileSync(HTML_PATH, 'utf8');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error: Error) => {
        if (/Not implemented/.test(error.message)) return;
        throw error;
    });
    virtualConsole.on('error', () => {});
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.local/crunchyroll', virtualConsole });
    // Test me 8s ka intezaar na karna pade — countdown chhota kar dete hain.
    (dom.window as any).AUTONEXT_SECONDS = 1;
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

function postPlayerMessage(window: Win, data: unknown) {
    window.dispatchEvent(new window.MessageEvent('message', { data }));
}

test('autonext ka plumbing page me hai — bar, clock fallback aur wahi ToonStream slot', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Bar + dono buttons (Play now / cancel) DOM me hone chahiye.
    expect(html).toContain('id="autoNextBar"');
    expect(html).toContain('id="autoNextNow"');
    expect(html).toContain('id="autoNextCancel"');
    // Ended message, last-episode guard aur countdown.
    expect(html).toContain('function armAutoNext(');
    expect(html).toContain('function goNextEpisode(');
    expect(html).toContain('AUTO_NEXT_TAIL_SEC');
    // Clock fallback: cross-origin ToonStream players message na bhejein to bhi
    // agla episode lage — isliye wall-clock wala interval zaroori hai.
    expect(html).toContain('function watchElapsed(');
    expect(html).toContain('setInterval(function(){\n        if(autoNextArmed||!WATCH.active');
    // Episode badalne par source wahi rehna chahiye: ToonStream par usi slot
    // (S1/S2/S3) par agla episode, warna Nxsha.
    expect(html).toContain('playToonstream({server:tsActiveIndex})');
    expect(html).toContain('function pickSlot(');
    expect(html).toContain('tsActiveIndex=i;tsInject(st.url)');
});

test('Nxsha par episode ended hone ke baad countdown dikhta hai aur agla episode khud lag jata hai', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'aot');

    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP1');

    // Player batata hai ki episode khatam (duration ke saath).
    postPlayerMessage(dom.window, { event: 'ended', currentTime: 1440, duration: 1440 });
    await wait(120);

    const bar = doc.getElementById('autoNextBar') as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect(doc.getElementById('autoNextText')!.textContent).toContain('S1 · E2');

    // Countdown pura hone par khud agla episode (S1E2) load ho jata hai.
    await wait(1600);
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP2');
    expect((doc.getElementById('serverFrame') as HTMLIFrameElement).getAttribute('src')).toContain('/tt2560140/1/2');
    expect((doc.getElementById('autoNextBar') as HTMLElement).hidden).toBe(true);
});

test('jin players se sirf time events aate hain, unme bhi last 12s par countdown chalu ho jata hai', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'aot');

    // `ended` nahi aaya — sirf timestamps (jaise ToonStream hosts bhejte hain).
    postPlayerMessage(dom.window, { event: 'timeupdate', currentTime: 1432, duration: 1440 });
    await wait(120);
    expect((doc.getElementById('autoNextBar') as HTMLElement).hidden).toBe(false);
    expect(doc.getElementById('autoNextText')!.textContent).toContain('S1 · E2');

    await wait(1600);
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP2');
});

test('cancel dabane par agla episode khud nahi lagta', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'aot');

    postPlayerMessage(dom.window, { event: 'ended', currentTime: 1440, duration: 1440 });
    await wait(120);
    expect((doc.getElementById('autoNextBar') as HTMLElement).hidden).toBe(false);

    click(dom.window, doc.getElementById('autoNextCancel'));
    await wait(1600);
    // Wahi episode chalta rahe — aage nahi badha.
    expect(doc.getElementById('playerSub')!.textContent).toBe('S1 · EP1');
});

test('movie par autonext nahi hota (movie ka koi agla episode nahi)', async () => {
    const dom = boot();
    await wait(350);
    const doc = dom.window.document;
    await play(dom.window, 'yourname');

    postPlayerMessage(dom.window, { event: 'ended', currentTime: 6400, duration: 6400 });
    await wait(200);
    expect((doc.getElementById('autoNextBar') as HTMLElement).hidden).toBe(true);
    expect(doc.querySelector('.toast')!.textContent).toContain('Movie');
});
