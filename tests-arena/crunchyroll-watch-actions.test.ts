/**
 * Player ke watch actions (Task 14) — owner ke teen points:
 *  - “like bhi save hona chahiye” (Supabase me, reload ke baad bhi)
 *  - “share ka button real karo, sahi se work kare” (asli deep link)
 *  - “G7 wala fake profile hta do”
 * Saath me notification badge (dekhne ke baad number gayab) aur Continue
 * Watching ka naya card (image 3) — jisme sirf real timing dikhti hai.
 *
 * Supabase network sandbox me nahi hai, isliye `fetch` fake hai: tests RPC
 * payload/response aur UI behaviour check karte hain (asli DB ka SQL test alag
 * chala hua hai — supabase/migrations/).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const MIGRATION = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261023160000_crunchyroll_reactions.sql'),
    'utf8',
);

jest.setTimeout(180000);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { url: string; body: any };

function boot(options: { url?: string; resume?: unknown[] } = {}) {
    const calls: Call[] = [];
    const copied: string[] = [];
    let signedIn = false;
    let likes = 7;
    let dislikes = 2;
    let myVote = 0;

    const jsonReply = (body: unknown, status = 200) => {
        const text = JSON.stringify(body);
        return Promise.resolve({
            ok: status < 400,
            status,
            text: () => Promise.resolve(text),
            json: () => Promise.resolve(body),
        });
    };

    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(readFileSync(HTML_PATH, 'utf8'), {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: options.url || 'https://app.local/crunchyroll',
        virtualConsole,
        beforeParse(window) {
            if (options.resume) window.localStorage.setItem('cr-resume-v1', JSON.stringify(options.resume));
            (window as any).fetch = (url: string, init: any = {}) => {
                const body = init.body ? JSON.parse(String(init.body)) : {};
                calls.push({ url: String(url), body });
                const u = String(url);
                if (u.includes('/rpc/cr_reaction_counts')) {
                    return jsonReply([{ like_count: likes, dislike_count: dislikes, my_vote: myVote }]);
                }
                if (u.includes('/rpc/cr_toggle_reaction')) {
                    if (!signedIn) return jsonReply({ message: 'SIGN_IN_REQUIRED' }, 401);
                    if (body.p_value === 1) {
                        likes = myVote === 1 ? likes - 1 : likes + 1;
                        myVote = myVote === 1 ? 0 : 1;
                    } else {
                        dislikes = myVote === -1 ? dislikes - 1 : dislikes + 1;
                        myVote = myVote === -1 ? 0 : -1;
                    }
                    return jsonReply([{ like_count: likes, dislike_count: dislikes, my_vote: myVote }]);
                }
                if (u.includes('/rpc/cr_list_comments')) return jsonReply([]);
                if (u.includes('/rpc/cr_comment_count')) return jsonReply(0);
                if (u.includes('grant_type=password')) {
                    signedIn = true;
                    return jsonReply({
                        access_token: 'tok',
                        refresh_token: 'ref',
                        expires_in: 3600,
                        user: { id: 'u-1', email: 'sk@example.com', user_metadata: { display_name: 'sk' } },
                    });
                }
                return jsonReply({});
            };
            Object.defineProperty(window.navigator, 'clipboard', {
                value: {
                    writeText: (text: string) => {
                        copied.push(text);
                        return Promise.resolve();
                    },
                },
                configurable: true,
            });
        },
    });

    const win = dom.window as any;
    const click = (el: Element | null) => el?.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    return { dom, win, doc: win.document, calls, copied, click };
}

async function openPlayer(win: any, doc: any, click: (el: Element | null) => void) {
    click(doc.querySelector('#catalogGrid [data-open="aot"]'));
    await wait(200);
    click(doc.getElementById('demoPlay'));
    await wait(600);
}

test('like/dislike DB se aate hain aur guest ko sign-in par bhejta hai', async () => {
    const { win, doc, calls, click } = boot();
    await wait(400);
    await openPlayer(win, doc, click);

    // Counts saved reactions se (7 like, 2 dislike), apna vote 0.
    expect(doc.getElementById('watchLikeCount')?.textContent).toBe('7');
    expect(doc.getElementById('watchDislikeCount')?.textContent).toBe('2');

    click(doc.getElementById('watchLike'));
    await wait(200);
    // Guest ka like save nahi hota — sign-in modal khulta hai, RPC nahi jaata.
    expect((doc.getElementById('crAuthModal') as HTMLElement).hidden).toBe(false);
    expect(calls.some((c) => c.url.includes('cr_toggle_reaction'))).toBe(false);

    // Sign in karke like dabao: episode-scoped RPC, phir count badh kar 8.
    (doc.getElementById('crEmail') as HTMLInputElement).value = 'sk@example.com';
    (doc.getElementById('crPassword') as HTMLInputElement).value = 'secret123';
    doc.getElementById('crAuthForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await wait(400);
    click(doc.getElementById('watchLike'));
    await wait(300);

    const toggle = calls.find((c) => c.url.includes('cr_toggle_reaction'));
    expect(toggle?.body).toEqual({ p_show_key: 'aot', p_season: 1, p_episode: 1, p_value: 1 });
    expect(doc.getElementById('watchLike')?.classList.contains('active')).toBe(true);
    expect(doc.getElementById('watchLikeCount')?.textContent).toBe('8');

    // Wahi button dobara: vote hat gaya, count wapas 7.
    click(doc.getElementById('watchLike'));
    await wait(300);
    expect(doc.getElementById('watchLike')?.classList.contains('active')).toBe(false);
    expect(doc.getElementById('watchLikeCount')?.textContent).toBe('7');
    win.close();
});

test('share button asli deep link copy karta hai, asset URL nahi', async () => {
    const { win, doc, copied, click } = boot();
    await wait(400);
    await openPlayer(win, doc, click);

    click(doc.getElementById('watchShare'));
    await wait(250);

    expect(copied).toHaveLength(1);
    expect(copied[0]).toBe('https://app.local/crunchyroll?show=aot&s=1&e=1');
    // Purana bug: iframe ka asset URL copy hota tha.
    expect(copied[0]).not.toContain('/assets/crunchyroll/');
    // UI copy English hai (owner: "hinglish ko english mae karo").
    expect(doc.querySelector('.toast')?.textContent).toContain('Link copied —');
    win.close();
});

test('shared link kholne par wahi episode chalta hai', async () => {
    const { win, doc } = boot({ url: 'https://app.local/crunchyroll?show=aot&s=1&e=3' });
    await wait(700);

    expect((doc.getElementById('playerShell') as HTMLElement).hidden).toBe(false);
    expect(doc.getElementById('playerSub')?.textContent).toBe('S1 · EP3');
    win.close();
});

test('notification items dekhne ke baad bell ka number chhup jata hai', async () => {
    const { win, doc, click } = boot();
    await wait(400);
    const dot = doc.getElementById('notifyCount') as HTMLElement;

    // Pehli baar: naye drops ka number dikhta hai.
    expect(dot.hidden).toBe(false);
    // Sab naye drops ek hi din ke hain, isliye badge "9+" tak cap hota hai.
    expect(dot.textContent).toMatch(/^(9\+|\d+)$/);

    click(doc.getElementById('notificationButton'));
    await wait(200);
    expect((doc.getElementById('notificationPanel') as HTMLElement).hidden).toBe(false);
    expect(dot.hidden).toBe(true);

    // Band karke dobara kholne par bhi number wapas nahi aata (seen save hai).
    click(doc.getElementById('closeNotifications'));
    await wait(100);
    click(doc.getElementById('notificationButton'));
    await wait(150);
    expect(dot.hidden).toBe(true);
    win.close();
});

test('G7 fake profile aur uske fake stats hata diye gaye hain', () => {
    const page = readFileSync(HTML_PATH, 'utf8');
    expect(page).not.toContain('Guest #A7F2');
    expect(page).not.toContain('id="guestProfile"');
    expect(page).not.toContain('aria-label="Open guest profile"');
    expect(page).not.toContain('18h 42m');
    // Asli account entry point wahin hai.
    expect(page).toContain('id="authButton"');
});

test('Continue Watching card image-3 jaisa hai aur bina real timing ke clock nahi dikhata', async () => {
    const now = Date.now();
    const { win, doc } = boot({
        resume: [{ key: 'aot', season: '1', ep: 3, at: now, sec: 768, dur: 1440, durReal: 1 }],
    });
    await wait(500);

    const card = doc.querySelector('#continueGrid .continue-card') as HTMLElement;
    expect(card.querySelector('.continue-thumb img')).not.toBeNull();
    expect(card.querySelector('.continue-thumb .continue-play')).not.toBeNull();
    expect(card.querySelector('.continue-copy strong')?.textContent).toBe('Attack on Titan');
    expect(card.querySelector('.continue-sub small')?.textContent).toBe('S1 · E3');
    // 12:48 / 24:00 — player se aayi asli position aur duration.
    expect(card.querySelector('.continue-sub em')?.textContent).toBe('12:48 / 24:00');
    // Purane andaze ("in", "min left", "just now") nahi.
    expect(card.textContent).not.toContain('min left');
    expect(card.textContent).not.toContain('just now');
    win.close();
});

test('reaction schema sirf signed-in users ko likhne deta hai', () => {
    expect(MIGRATION).toContain('alter table public.cr_episode_reactions enable row level security');
    expect(MIGRATION).not.toMatch(/create policy[^;]*for insert/i);
    expect(MIGRATION).toContain('security definer');
    expect(MIGRATION).toMatch(/revoke execute on function public\.cr_toggle_reaction[^;]*from anon/i);
    expect(MIGRATION).toMatch(/grant execute on function public\.cr_reaction_counts[^;]*to anon, authenticated/i);
});
