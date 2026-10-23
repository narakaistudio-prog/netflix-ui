/**
 * Owner ke teen points (23 Oct, screenshot ke saath):
 *  1. “continue watching bahut bada hai … player ke jitna bada hai, chota karo,
 *      normal jaisa” — ek hi resume item poori row me phail kar ~790px ka card
 *      ban jata tha.
 *  2. “my list ka fake data htaoo” — Continue 2 / Favorites 3 / Watch later 4 /
 *      History 12 aur `favorites={solo,jjk,demon}` sab hardcoded the.
 *  3. (Netflix bell ka test `notifications.test.ts` me hai.)
 *
 * Ye test asli jsdom page boot karta hai (Supabase/network nahi chahiye).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

jest.setTimeout(180000);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function boot(resume: unknown[] = []) {
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(readFileSync(HTML_PATH, 'utf8'), {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
        beforeParse(window) {
            window.localStorage.setItem('cr-resume-v1', JSON.stringify(resume));
            // Trailer/asset images ko network par jaane ki zaroorat nahi.
            (window as any).fetch = () =>
                Promise.resolve({ ok: false, status: 0, text: () => Promise.resolve(''), json: () => Promise.resolve({}) });
        },
    });
    return dom;
}

const resumeItem = (key: string, season: string, ep: number, sec: number) => ({
    key,
    season,
    ep,
    at: Date.now(),
    sec,
    dur: 1440,
});

describe('Continue Watching card size + My List real data', () => {
    test('ek resume item poori row nahi bharta — card rail jitna normal hai', async () => {
        const dom = boot([resumeItem('aot', '1', 3, 768)]);
        await wait(1200);
        const { document } = dom.window;
        const html = readFileSync(HTML_PATH, 'utf8');

        const card = document.querySelector('#continueGrid .continue-card') as HTMLElement;
        expect(card).toBeTruthy();
        // Card ab flex-grow nahi karta: fixed 1/5 width (max-width bhi) —
        // warna single item stretch ho kar player jitna bada lagta tha.
        expect(html).toMatch(/\.continue-card\{[^}]*flex:0 0 calc\(20% - 13px\)/);
        expect(html).not.toMatch(/\.continue-card\{[^}]*flex:1 1 0/);
        expect(html).not.toMatch(/\.continue-card\{[^}]*min-width:220px/);
        // Purana `.continue-main img{height:110px}` media-query leftover bhi gaya.
        expect(html).not.toMatch(/\.continue-main img\{height:110px\}/);
        dom.window.close();
    });

    test('My List me koi seeded favorite/item/count nahi hota', async () => {
        const dom = boot([]);
        await wait(1200);
        const { document } = dom.window;

        const tabs = Array.from(document.querySelectorAll('[data-list-tab]'));
        expect(tabs.map((t) => t.getAttribute('data-list-tab'))).toEqual(['continue', 'favorites', 'watchlater']);
        expect(tabs.map((t) => t.querySelector('b')!.textContent)).toEqual(['0', '0', '0']);
        expect(document.querySelector('#miniList .mini-item')).toBeNull();
        expect(document.querySelector('#miniList .empty')!.textContent).toMatch(/Nothing to continue yet/);

        // Purane fake item (Solo Leveling / Jujutsu Kaisen) kahin nahi.
        expect(document.getElementById('miniList')!.textContent).not.toMatch(/Solo Leveling|Jujutsu Kaisen/);
        dom.window.close();
    });

    test('favorites tab sirf user ke apne tap se bharta hai, aur count bhi real', async () => {
        const dom = boot([]);
        await wait(1200);
        const { document } = dom.window;
        const click = (el: Element | null) => {
            expect(el).toBeTruthy();
            el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        };

        // Show kholo → heart (favorite) dabao.
        click(document.querySelector('[data-open="solo"]'));
        await wait(300);
        click(document.getElementById('detailFavorite'));
        await wait(200);

        click(document.querySelector('[data-list-tab="favorites"]'));
        await wait(200);
        const items = Array.from(document.querySelectorAll('#miniList .mini-item'));
        expect(items.length).toBe(1);
        expect(items[0].getAttribute('data-open')).toBe('solo');
        expect(document.querySelector('[data-list-tab="favorites"] b')!.textContent).toBe('1');
        // localStorage me bhi gaya (reload par rahega).
        expect(dom.window.localStorage.getItem('cr-list-v1')).toContain('"solo":true');
        dom.window.close();
    });

    test('watch later tab save button se bharta hai (pehle 4 fake shows the)', async () => {
        const dom = boot([]);
        await wait(1200);
        const { document } = dom.window;
        const click = (el: Element | null) => {
            expect(el).toBeTruthy();
            el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        };

        click(document.querySelector('[data-open="aot"]'));
        await wait(300);
        click(document.getElementById('detailSave'));
        await wait(200);
        click(document.querySelector('[data-list-tab="watchlater"]'));
        await wait(200);

        const items = Array.from(document.querySelectorAll('#miniList .mini-item'));
        expect(items.map((i) => i.getAttribute('data-open'))).toEqual(['aot']);
        expect(document.querySelector('[data-list-tab="watchlater"] b')!.textContent).toBe('1');
        dom.window.close();
    });

    test('continue tab asli resume list dikhata hai aur card par resume index hota hai', async () => {
        const dom = boot([resumeItem('aot', '1', 3, 768), resumeItem('jjk', '2', 5, 0)]);
        await wait(1200);
        const { document } = dom.window;

        const cards = Array.from(document.querySelectorAll('#continueGrid .continue-card'));
        expect(cards.length).toBe(2);
        expect(document.querySelector('[data-list-tab="continue"] b')!.textContent).toBe('2');

        document.querySelector('[data-list-tab="continue"]')!.dispatchEvent(
            new dom.window.MouseEvent('click', { bubbles: true }),
        );
        await wait(200);
        const items = Array.from(document.querySelectorAll('#miniList .mini-item'));
        expect(items.length).toBe(2);
        expect(items[0].getAttribute('data-resume-index')).toBe('0');
        // Sub-line asli progress batati hai (S1 · E3 · 12:48) — koi fake “Continue episode”.
        expect(items[0].textContent).toMatch(/S1 · E3 · 12:48/);
        expect(items[0].textContent).not.toMatch(/Continue episode/);
        dom.window.close();
    });
});
