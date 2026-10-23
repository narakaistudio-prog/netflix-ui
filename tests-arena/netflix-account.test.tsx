// @ts-nocheck — jsdom test: Netflix ka red sign-in aur fake profile/admin ka removal.
/**
 * Owner (comment box ke screenshot ke saath):
 *  1. “sign in to comment rehne de, uska color orange white kar crunchyroll ki
 *      traha, sign ka bhi waisa color karo” — Crunchyroll comment box se Supabase
 *      wali line gayi, heading + button Crunchyroll orange ho gaye.
 *  2. “netflix mae admin panel hta do aur fake sara profile hta do, netflix mae
 *      bhi red ka sign wala exact jo crunchyroll mae system hai wo kardo” —
 *      fake profiles (data/users.json) + admin screen delete, aur asli Supabase
 *      email/password sign-in (lib/account.ts, Crunchyroll ke saath shared
 *      session) Netflix red me.
 */
import React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const R = require('react');
    const icon = (props: any) => R.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/',
}));
jest.mock('expo-linear-gradient', () => {
    const R = require('react');
    return { LinearGradient: (props: any) => R.createElement('div', props, props.children) };
});
jest.mock('@/components/TvRemoteHelper', () => ({ TvRemoteHelper: () => null }));
jest.mock('@/hooks/useTvNavigation', () => ({
    useTvMode: () => ({ isTvMode: false, toggleTvMode: () => {} }),
}));

const ROOT = join(__dirname, '..');
const HTML = readFileSync(join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'), 'utf8');

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: any = null;

beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    delete (window as any).fetch;
});

function render(node: React.ReactElement) {
    act(() => {
        root = createRoot(container!);
        root.render(node);
    });
}

const text = () => container!.textContent || '';

function clickAria(label: string) {
    const node = document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
    expect(node).toBeTruthy();
    act(() => {
        node!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
}

function click(label: string) {
    // react-native-web Pressable = div; text wale node se upar chalo jab tak
    // clickable (role/button) na mile.
    const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
    const node = all.find((n) => (n.textContent || '').trim() === label);
    let target: HTMLElement | null = node || null;
    while (target && !(target.getAttribute('role') === 'button' || target.onclick || target.tagName === 'BUTTON')) {
        target = target.parentElement;
    }
    expect(target).toBeTruthy();
    act(() => {
        target!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
}

describe('Netflix ka red sign-in (Crunchyroll wala hi system)', () => {
    test('signed out par red Sign In button, fake profile nahi', async () => {
        const { UserProvider } = require('@/contexts/UserContext');
        const { WebNavBar } = require('@/components/WebNavBar');
        render(
            <UserProvider>
                <WebNavBar />
            </UserProvider>,
        );
        expect(text()).toContain('Sign In');
        // Fake profile names (data/users.json) kabhi nahi dikhte.
        ['Saúl', 'Primeagen', 'Theo', 'Kids'].forEach((n) => expect(text()).not.toContain(n));
        expect(text()).not.toContain('Admin');
    });

    test('Sign In dabane par dialog khulta hai aur token session save hota hai', async () => {
        const calls: any[] = [];
        (window as any).fetch = (url: string, init: any = {}) => {
            calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () =>
                    Promise.resolve({
                        access_token: 'tok',
                        refresh_token: 'ref',
                        expires_in: 3600,
                        user: { id: 'u1', email: 'fan@example.com', user_metadata: { display_name: 'Fan' } },
                    }),
            });
        };

        const { UserProvider, useUser } = require('@/contexts/UserContext');
        const { SignInDialog } = require('@/components/SignInDialog');

        let api: any = null;
        function Probe() {
            api = useUser();
            return null;
        }
        render(
            <UserProvider>
                <Probe />
                <SignInDialog />
            </UserProvider>,
        );

        act(() => api.openSignIn());
        const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
        expect(inputs.length).toBe(2); // email + password
        act(() => {
            const set = (el: HTMLInputElement, v: string) => {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
                setter.call(el, v);
                el.dispatchEvent(new window.Event('input', { bubbles: true }));
            };
            set(inputs[0], 'fan@example.com');
            set(inputs[1], 'secret123');
        });
        clickAria('Sign in'); // modal ka submit (aria-label ke bina title text bhi 'Sign In' hai)

        await act(async () => {
            await new Promise((r) => setTimeout(r, 30));
        });

        // Wahi Supabase auth endpoint jo Crunchyroll page use karta hai.
        expect(calls[0].url).toContain('/auth/v1/token?grant_type=password');
        expect(calls[0].body).toEqual({ email: 'fan@example.com', password: 'secret123' });
        // Session shared key me — Crunchyroll comments turant signed-in ho jate hain.
        const stored = JSON.parse(window.localStorage.getItem('cr_comment_session_v1')!);
        expect(stored.access_token).toBe('tok');
        expect(stored.user.display_name).toBe('Fan');
        expect(api.signedIn).toBe(true);
        expect(api.account.email).toBe('fan@example.com');
    });

    test('sign out session clear karta hai', async () => {
        window.localStorage.setItem(
            'cr_comment_session_v1',
            JSON.stringify({
                access_token: 'tok',
                refresh_token: 'ref',
                expires_at: Date.now() + 600000,
                user: { id: 'u1', email: 'fan@example.com', display_name: 'Fan' },
            }),
        );
        (window as any).fetch = () => Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });

        const { UserProvider, useUser } = require('@/contexts/UserContext');
        let api: any = null;
        function Probe() {
            api = useUser();
            return null;
        }
        render(
            <UserProvider>
                <Probe />
            </UserProvider>,
        );
        expect(api.signedIn).toBe(true);
        expect(api.selectedProfile.name).toBe('Fan');

        await act(async () => {
            await api.signOut();
        });
        expect(api.signedIn).toBe(false);
        expect(window.localStorage.getItem('cr_comment_session_v1')).toBeNull();
    });

    test('expired token refresh hota hai (Crunchyroll jaisa flow)', async () => {
        window.localStorage.setItem(
            'cr_comment_session_v1',
            JSON.stringify({
                access_token: 'old',
                refresh_token: 'ref',
                expires_at: Date.now() - 1000,
                user: { id: 'u1', email: 'fan@example.com', display_name: 'Fan' },
            }),
        );
        const seen: string[] = [];
        (window as any).fetch = (url: string) => {
            seen.push(String(url));
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () =>
                    Promise.resolve({
                        access_token: 'new',
                        refresh_token: 'ref2',
                        expires_in: 3600,
                        user: { id: 'u1', email: 'fan@example.com', user_metadata: { display_name: 'Fan' } },
                    }),
            });
        };
        const { ensureFreshSession } = require('@/lib/account');
        const session = await ensureFreshSession();
        expect(seen[0]).toContain('grant_type=refresh_token');
        expect(session.access_token).toBe('new');
        expect(JSON.parse(window.localStorage.getItem('cr_comment_session_v1')!).access_token).toBe('new');
    });
});

describe('fake profile + admin panel hataye gaye', () => {
    test('admin screen, profile switcher aur fake users.json gaye', () => {
        expect(existsSync(join(ROOT, 'app', 'admin', 'index.tsx'))).toBe(false);
        expect(existsSync(join(ROOT, 'app', 'switch-profile.tsx'))).toBe(false);
        expect(existsSync(join(ROOT, 'components', 'WhoIsWatching.tsx'))).toBe(false);
        expect(existsSync(join(ROOT, 'data', 'users.json'))).toBe(false);
    });

    test('navbar aur profile page me admin ka koi entry nahi', () => {
        const nav = readFileSync(join(ROOT, 'components', 'WebNavBar.tsx'), 'utf8');
        const profile = readFileSync(join(ROOT, 'app', '(tabs)', '(profile)', 'profile.tsx'), 'utf8');
        const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        [nav, profile].forEach((src) => {
            const code = strip(src);
            expect(code).not.toContain("'/admin'");
            expect(code).not.toContain('Admin Panel');
        });
        // Sign in button Netflix red hai.
        expect(nav).toContain("backgroundColor: '#E50914'");
        expect(nav).toContain('Sign In');
    });

    test('profile page par koi fake liked/mylist/notification data nahi', () => {
        const profile = readFileSync(join(ROOT, 'app', '(tabs)', '(profile)', 'profile.tsx'), 'utf8').replace(
            /\/\*[\s\S]*?\*\//g,
            '',
        );
        expect(profile).not.toContain('exampleLikedShowsAndMovies');
        expect(profile).not.toContain('exampleMyList');
        expect(profile).not.toContain('The Perfect Couple');
        expect(profile).not.toContain('/switch-profile');
    });
});

describe('Crunchyroll comment box: sirf heading + orange sign in', () => {
    test('Supabase wali line gayi, heading aur button orange', () => {
        expect(HTML).not.toContain('Comments are saved in Supabase');
        expect(HTML).not.toContain('your name and comment are saved in Supabase');
        expect(HTML).toContain('<strong>Sign in to comment</strong>');
        // Guest box ka heading Crunchyroll orange, button bhi orange (dark text).
        expect(HTML).toMatch(/\.cr-guest strong\{color:#f47521/);
        expect(HTML).toMatch(/\.cr-signin-btn\{[^}]*background:#f47521;color:#160e08/);
        // Auth modal ka submit button bhi wahi orange.
        expect(HTML).toMatch(/\.cr-auth-submit\{[^}]*background:#f47521;color:#160e08/);
        // Purana violet accent kahin nahi.
        ['#8b5cf6', '#6d4bff', '#a78bfa', '#7c5cff'].forEach((hex) => expect(HTML).not.toContain(hex));
    });
});
