/**
 * Crunchyroll page ka comment feature (Task 13).
 *
 * Owner: “image 1 jaisa comment ka button, image 2 jaisa drawer, saara comment
 * Supabase me save ho, aur sirf sign in karne wala hi comment kar sake.”
 *
 * Ye tests page ko jsdom me boot karke asli user jaisa chalate hain aur
 * Supabase ko fake `fetch` se replace karte hain — sandbox me network nahi hai,
 * isliye RPC shapes aur gating yahan verify hote hain (DB khud ka SQL test
 * `supabase/migrations/` ke saath alag chala hua hai).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');
const PAGE = readFileSync(HTML_PATH, 'utf8');
const MIGRATION = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261023120000_crunchyroll_comments.sql'),
    'utf8',
);

jest.setTimeout(180000);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Row = {
    id: string;
    parent_id: string | null;
    author_name: string;
    body: string;
    created_at: string;
    mine: boolean;
    like_count: number;
    dislike_count: number;
    my_vote: number;
};

const TOP_COMMENT: Row = {
    id: '11111111-1111-1111-1111-111111111111',
    parent_id: null,
    author_name: 'AnimeLover_007',
    body: 'This episode was hilarious 😂 Tenchi is such a legend!',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    mine: false,
    like_count: 245,
    dislike_count: 3,
    my_vote: 0,
};

type Call = { url: string; method: string; body: any };

function boot() {
    const calls: Call[] = [];
    const rows: Row[] = [{ ...TOP_COMMENT }];
    let sessionToken: string | null = null;

    const jsonReply = (body: unknown, status = 200) => {
        const text = body === undefined ? '' : JSON.stringify(body);
        return Promise.resolve({
            ok: status < 400,
            status,
            text: () => Promise.resolve(text),
            json: () => Promise.resolve(body),
        });
    };

    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(PAGE, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
        beforeParse(window) {
            (window as any).fetch = (url: string, opts: any = {}) => {
                const method = String(opts.method || 'GET').toUpperCase();
                const body = opts.body ? JSON.parse(String(opts.body)) : {};
                calls.push({ url: String(url), method, body });

                if (String(url).includes('/rpc/cr_list_comments')) return jsonReply(rows.map((r) => ({ ...r })));
                if (String(url).includes('/rpc/cr_comment_count')) return jsonReply(rows.length);
                if (String(url).includes('/rpc/cr_add_comment')) {
                    if (!sessionToken) return jsonReply({ message: 'SIGN_IN_REQUIRED' }, 401);
                    rows.unshift({
                        id: '33333333-3333-3333-3333-333333333333',
                        parent_id: body.p_parent ?? null,
                        author_name: 'sk',
                        body: body.p_body,
                        created_at: new Date().toISOString(),
                        mine: true,
                        like_count: 0,
                        dislike_count: 0,
                        my_vote: 0,
                    });
                    return jsonReply({ id: '33333333-3333-3333-3333-333333333333' });
                }
                if (String(url).includes('/rpc/cr_vote_comment')) {
                    if (!sessionToken) return jsonReply({ message: 'SIGN_IN_REQUIRED' }, 401);
                    return jsonReply([{ like_count: 246, dislike_count: 3, my_vote: body.p_value }]);
                }
                if (String(url).includes('grant_type=password')) {
                    sessionToken = 'access-token';
                    return jsonReply({
                        access_token: 'access-token',
                        refresh_token: 'refresh-token',
                        expires_in: 3600,
                        user: { id: 'u-1', email: 'sk@example.com', user_metadata: { display_name: 'sk' } },
                    });
                }
                if (String(url).includes('/auth/v1/signup')) {
                    sessionToken = 'access-token';
                    return jsonReply({
                        access_token: 'access-token',
                        refresh_token: 'refresh-token',
                        expires_in: 3600,
                        user: { id: 'u-2', email: body.email, user_metadata: body.data },
                    });
                }
                return jsonReply({});
            };
        },
    });

    const win = dom.window as any;
    const click = (el: Element | null) => el?.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const submit = (el: Element | null) => el?.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    return { dom, win, doc: win.document, calls, rows, click, submit };
}

test('comment button + drawer + sign-in entry page par maujood hain', () => {
    const { win, doc } = boot();

    // Button wahi jagah hai jahan owner ne screenshot me dikhaya: player ke
    // actions row me, Share ke baad.
    const button = doc.querySelector('.watch-actions-row #watchCommentsBtn');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('Comment');
    expect(doc.getElementById('crBadge')).not.toBeNull();

    // Drawer band state me hai, composer guest ke liye hidden.
    const drawer = doc.getElementById('commentsDrawer');
    expect(drawer?.classList.contains('open')).toBe(false);
    expect(drawer?.getAttribute('aria-hidden')).toBe('true');
    expect((doc.getElementById('crComposer') as HTMLElement).hidden).toBe(true);
    expect((doc.getElementById('crGuestBox') as HTMLElement).hidden).toBe(false);

    // Header me sign in entry point.
    expect(doc.getElementById('authButton')?.textContent).toBe('Sign in');

    // Teen sort tabs, auth modal ke do modes.
    expect(doc.querySelectorAll('[data-cr-sort]')).toHaveLength(3);
    expect(doc.querySelectorAll('[data-cr-auth-mode]')).toHaveLength(2);

    win.close();
});

test('guest panel khol sakta hai, comments padh sakta hai, par likh nahi sakta', async () => {
    const { win, doc, calls, click, submit } = boot();
    await wait(400);

    click(doc.getElementById('watchCommentsBtn'));
    await wait(400);

    expect(doc.getElementById('commentsDrawer')?.classList.contains('open')).toBe(true);
    expect(doc.getElementById('watchCommentsBtn')?.getAttribute('aria-expanded')).toBe('true');
    expect(doc.getElementById('crHeaderCount')?.textContent).toBe('(1)');
    expect(doc.querySelectorAll('#crList .cr-item')).toHaveLength(1);
    expect(doc.querySelector('#crList .cr-body')?.textContent).toContain('Tenchi is such a legend');
    expect(doc.querySelector('#crList .cr-meta strong')?.textContent).toBe('AnimeLover_007');

    // Guest ke liye composer hi nahi hai — Post button bhi nahi.
    expect((doc.getElementById('crComposer') as HTMLElement).hidden).toBe(true);
    expect((doc.getElementById('crGuestBox') as HTMLElement).hidden).toBe(false);

    // Comment ka rpc call hua hi nahi.
    expect(calls.some((c) => c.url.includes('cr_add_comment'))).toBe(false);

    // Like dabaane par sign-in modal khulta hai (vote bhi signed-in only).
    click(doc.querySelector('#crList [data-cr-vote="1"]'));
    await wait(200);
    expect((doc.getElementById('crAuthModal') as HTMLElement).hidden).toBe(false);
    expect(calls.some((c) => c.url.includes('cr_vote_comment'))).toBe(false);

    // Guest ke form submit se bhi kuch save nahi hota.
    submit(doc.getElementById('crAuthForm'));
    await wait(150);
    expect(calls.some((c) => c.url.includes('cr_add_comment'))).toBe(false);

    win.close();
});

test('sign in ke baad hi comment post hota hai aur Supabase RPC me sahi episode jaata hai', async () => {
    const { win, doc, calls, click, submit } = boot();
    await wait(400);

    click(doc.getElementById('watchCommentsBtn'));
    await wait(300);
    click(doc.getElementById('crGuestSignIn'));
    await wait(150);

    (doc.getElementById('crEmail') as HTMLInputElement).value = 'sk@example.com';
    (doc.getElementById('crPassword') as HTMLInputElement).value = 'secret123';
    submit(doc.getElementById('crAuthForm'));
    await wait(400);

    expect(doc.getElementById('authButton')?.textContent).toBe('sk');
    expect((doc.getElementById('crAuthModal') as HTMLElement).hidden).toBe(true);
    expect((doc.getElementById('crComposer') as HTMLElement).hidden).toBe(false);
    expect((doc.getElementById('crGuestBox') as HTMLElement).hidden).toBe(true);

    const input = doc.getElementById('crInput') as HTMLTextAreaElement;
    input.value = 'Bhai episode ekdum mast tha!';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    expect((doc.getElementById('crPost') as HTMLButtonElement).disabled).toBe(false);

    submit(doc.getElementById('crComposer'));
    await wait(400);

    const add = calls.find((c) => c.url.includes('cr_add_comment'));
    expect(add).toBeDefined();
    // Episode-wise scoping: show key + season + episode, parent null (top-level).
    expect(add?.body).toEqual({
        p_show_key: 'solo',
        p_season: 1,
        p_episode: 1,
        p_body: 'Bhai episode ekdum mast tha!',
        p_parent: null,
    });
    // Post ke baad list refresh + naya comment sabse upar.
    expect(doc.querySelector('#crList .cr-body')?.textContent).toBe('Bhai episode ekdum mast tha!');
    expect(doc.querySelectorAll('#crList .cr-item')).toHaveLength(2);
    // Copy English hai (owner: "hinglish website mae na ho").
    expect(doc.querySelector('.toast')?.textContent).toContain('Comment posted');

    win.close();
});

test('reply parent id ke saath jaata hai aur reply chip reset hoti hai', async () => {
    const { win, doc, calls, click, submit } = boot();
    await wait(400);

    click(doc.getElementById('watchCommentsBtn'));
    await wait(300);
    click(doc.getElementById('crGuestSignIn'));
    await wait(100);
    (doc.getElementById('crEmail') as HTMLInputElement).value = 'sk@example.com';
    (doc.getElementById('crPassword') as HTMLInputElement).value = 'secret123';
    submit(doc.getElementById('crAuthForm'));
    await wait(400);

    click(doc.querySelector('#crList [data-cr-reply]'));
    await wait(100);
    expect((doc.getElementById('crReplyChip') as HTMLElement).hidden).toBe(false);
    expect(doc.getElementById('crReplyName')?.textContent).toBe('AnimeLover_007');
    expect((doc.getElementById('crInput') as HTMLTextAreaElement).placeholder).toContain('Reply to AnimeLover_007');

    (doc.getElementById('crInput') as HTMLTextAreaElement).value = 'Same feeling!';
    (doc.getElementById('crInput') as HTMLTextAreaElement).dispatchEvent(new win.Event('input', { bubbles: true }));
    submit(doc.getElementById('crComposer'));
    await wait(400);

    const add = calls.filter((c) => c.url.includes('cr_add_comment')).pop();
    expect(add?.body.p_parent).toBe(TOP_COMMENT.id);
    expect((doc.getElementById('crReplyChip') as HTMLElement).hidden).toBe(true);

    win.close();
});

test('page me sirf publishable (anon) key hai — service_role kabhi nahi', () => {
    // Browser bundle me sirf anon key ja sakti hai; asli protection RLS hai.
    expect(PAGE).toContain('https://wavzzkbemvujvgdaczqq.supabase.co');
    // JWT payload decode karke role check — key public honi chahiye, sirf `anon`.
    const key = PAGE.match(/var CR_SB=\{url:'[^']+',key:'([^']+)'\}/)?.[1] || '';
    expect(key.split('.')).toHaveLength(3);
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.role).toBe('anon');
    expect(PAGE).not.toMatch(/service_role|sb_secret_/);

    // Schema repo me hai aur RLS on hai.
    expect(MIGRATION).toContain('alter table public.cr_comments enable row level security');
    expect(MIGRATION).toContain('alter table public.cr_comment_votes enable row level security');
    // Likhna sirf SECURITY DEFINER functions se — direct insert policy nahi.
    expect(MIGRATION).not.toMatch(/create policy[^;]*for insert/i);
    expect(MIGRATION).toContain('security definer');
    // Guest (anon) write-functions call na kar sake.
    expect(MIGRATION).toMatch(/revoke execute on function public\.cr_add_comment[^;]*from anon/i);
    expect(MIGRATION).toMatch(/revoke execute on function public\.cr_vote_comment[^;]*from anon/i);
    // Guest padh sake, isliye list/select grants anon ko bhi.
    expect(MIGRATION).toMatch(/grant execute on function public\.cr_list_comments[^;]*to anon, authenticated/i);
});
