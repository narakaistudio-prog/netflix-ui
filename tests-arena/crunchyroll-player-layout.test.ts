/**
 * Owner ke teen points (23 Oct, screenshots ke saath):
 *  1. “video player ka size sahi karoo bahut jyda bada hai niche tak jata hai”
 *     — 16:9 stage width se banta tha, isliye 1400px screen par ~790px tall
 *     ho kar page scroll karta tha.
 *  2. “agar ho sake to continue watching ka exact timing lagao, nahi to timing
 *     mat likho” — clock/progress sirf tab jab player ne khud duration bheji ho.
 *  3. “jaha jaha hinglish website mae likha hai usse english mae karo” — UI
 *     copy English, code comments Hinglish (owner ka standing rule).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const HTML = readFileSync(HTML_PATH, 'utf8');

jest.setTimeout(180000);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function boot(resume: unknown[] = []) {
    const dom = new JSDOM(HTML, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole: new VirtualConsole(),
        beforeParse(window) {
            window.localStorage.setItem('cr-resume-v1', JSON.stringify(resume));
            (window as any).fetch = () =>
                Promise.resolve({ ok: false, status: 0, text: () => Promise.resolve(''), json: () => Promise.resolve({}) });
        },
    });
    return dom;
}

describe('player ka size + Continue Watching ki exact timing', () => {
    test('video stage viewport me fit hota hai (width height se bandhi hui)', () => {
        // Stage ki height 100vh - 124px (top bar 66 + layout padding 58) se bandhi
        // hai, width wahi se 16:9 nikalta hai — isliye player screen se bahar nahi
        // jata. Rule desktop par hi lagta hai; phone pe purana full-width 16:9.
        expect(HTML).toMatch(
            /@media\(min-width:701px\)\{\.player-shell \.video-stage\{width:min\(100%,calc\(\(100vh - 124px\) \* 1\.77778\)\);aspect-ratio:16\/9;height:auto;padding-bottom:0/,
        );
        expect(HTML).toMatch(/@supports \(height:100dvh\)\{@media\(min-width:701px\)\{\.player-shell \.video-stage\{/);
        // Padding-bottom trick (jo height ko width se bandhti thi) override ho gayi.
        expect(HTML).toMatch(/\.player-shell \.video-stage\{[^}]*padding-bottom:0/);
    });

    test('guessed duration par clock/progress nahi dikhte', async () => {
        // durReal nahi hai = duration andaza (guessDur) tha → koi clock nahi.
        const now = Date.now();
        const dom = boot([{ key: 'aot', season: '1', ep: 3, at: now, sec: 768, dur: 1440 }]);
        await wait(1200);
        const { document } = dom.window;
        const card = document.querySelector('#continueGrid .continue-card')!;
        expect(card.textContent).toContain('Attack on Titan');
        expect(card.querySelector('.continue-sub em')).toBeNull();
        expect(card.querySelector('.progress')).toBeNull();
        // Naye items par bhi: time hai par duration andaza → clock nahi.
        dom.window.close();
    });

    test('real duration (player event) par exact clock dikhta hai', async () => {
        const now = Date.now();
        const dom = boot([{ key: 'aot', season: '1', ep: 3, at: now, sec: 768, dur: 1440, durReal: 1 }]);
        await wait(1200);
        const { document } = dom.window;
        const card = document.querySelector('#continueGrid .continue-card')!;
        expect(card.querySelector('.continue-sub em')!.textContent).toBe('12:48 / 24:00');
        expect((card.querySelector('.progress i') as HTMLElement).style.width).toBe('53%');
        dom.window.close();
    });

    test('10 second se kam par clock nahi (kaafi data nahi)', async () => {
        const now = Date.now();
        const dom = boot([{ key: 'aot', season: '1', ep: 3, at: now, sec: 4, dur: 1440, durReal: 1 }]);
        await wait(1200);
        const { document } = dom.window;
        const card = document.querySelector('#continueGrid .continue-card')!;
        expect(card.querySelector('.continue-sub em')).toBeNull();
        dom.window.close();
    });
});

describe('UI copy English hai', () => {
    const HINGLISH =
        /\b(nahi|nahin|karo|karoo|chalu|mil[ai]|hua|raha|rahe|abhi|zyada|jyada|bahut|thoda|dekho|tumhara|apna|karna|karke|hain|mein|wala|sake|sakte|padega|chahiye|banao|daalo|taiyaar|chhota|lamba|jaisa|jaise|karein|kare)\b/i;

    test('crunchyroll page ke visible strings Hinglish nahi hain', () => {
        // Data blobs (TS_DROPS/season guides) aur code comments chhod do — sirf
        // "UI sinks" dekho: toast, confirm, textContent, placeholder, aria-label.
        // Block comments (Hinglish why-comments) visible copy nahi hain — hata do.
        const code = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
        const lines = code.split('\n').filter((l) => l.length < 1500 && !l.trim().startsWith('//'));
        const sinks = /(showToast|resumeToast|confirm\(|textContent\s*=|innerHTML\s*=|placeholder=|aria-label=|title=|<p[ >]|<span|<strong|<small|<h[1-4][ >])/;
        const offenders = lines.filter((l) => sinks.test(l) && HINGLISH.test(l));
        expect(offenders.map((l) => l.trim().slice(0, 120))).toEqual([]);
    });

    test('naye copy strings English hain', () => {
        expect(HTML).toContain("'Sign in to vote'");
        expect(HTML).toContain("'Comment is too short.'");
        expect(HTML).toContain("'Link copied — '");
        // Owner: "comment box mae supabase wala kya likha hai, hta do" — guest box
        // me sirf heading + Sign in button rehta hai (netflix-account.test.tsx dekho).
        expect(HTML).toContain('<strong>Sign in to comment</strong>');
        // Purani Hinglish strings gayi.
        expect(HTML).not.toContain('Vote karne ke liye sign in karo');
        expect(HTML).not.toContain('Link copy ho gaya');
        expect(HTML).not.toContain('Comment bahut chhota hai');
    });
});
