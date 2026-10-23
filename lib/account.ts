/**
 * Netflix app ka account system.
 *
 * Owner: "netflix mae bhi red ka sign wala exact jo crunchyroll mae system hai
 * wo kardo" — yaani wahi Supabase email+password auth jo Crunchyroll page
 * (assets/crunchyroll/crunchyroll.html) ke andar chalta hai, bas Netflix ka
 * red look. Isliye:
 *
 *  - Wahi Supabase project + anon key (anon key public hota hai, ye normal hai;
 *    asli security RLS + SECURITY DEFINER functions se aati hai).
 *  - Wahi localStorage key (`cr_comment_session_v1`) — ek hi site hai, isliye
 *    Netflix par sign in karne se Crunchyroll comments me bhi sign-in ho jata
 *    hai, aur sign out dono jagah se hota hai. Isse "same system" sach me same
 *    rehta hai (do alag sessions rakhna hi confusing hota).
 *
 * Fetch manually hai (supabase-js nahi) — repo me extra dependency nahi chahiye
 * aur Crunchyroll page bhi yahi REST calls karta hai.
 */

export const SUPABASE_URL = 'https://wavzzkbemvujvgdaczqq.supabase.co';
export const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhdnp6a2JlbXZ1anZnZGFjenFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NTYyODksImV4cCI6MjEwODMzMjI4OX0.ZBwn1ulT7wdC7WRVOucoOhXlhTLy7TUzx3nO7aa6wos';

/** Crunchyroll page ka key — dono ek hi session share karte hain (upar dekho). */
export const ACCOUNT_STORE_KEY = 'cr_comment_session_v1';

export interface AccountUser {
    id: string;
    email: string;
    name: string;
}

export interface AccountSession {
    access_token: string;
    refresh_token: string;
    /** Epoch ms; iske baad token refresh hota hai. */
    expires_at: number;
    user: AccountUser;
}

type StoredSession = {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    user?: { id?: string; email?: string; display_name?: string };
};

const listeners = new Set<(session: AccountSession | null) => void>();
/** Sirf tab use hota hai jab localStorage blocked ho (private mode). */
let memorySession: AccountSession | null = null;

function readStorage(): StoredSession | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
        const raw = window.localStorage.getItem(ACCOUNT_STORE_KEY);
        return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
        return null;
    }
}

/**
 * Disk par Crunchyroll page wala hi shape likhte hain
 * (`user.display_name`), warna dono taraf ke readers ko ek doosre ka session
 * samajh nahi aata — "same system" ka matlab yahi hai.
 */
function toStored(session: AccountSession) {
    return {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: { id: session.user.id, email: session.user.email, display_name: session.user.name },
    };
}

function writeStorage(session: AccountSession | null) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        if (session) window.localStorage.setItem(ACCOUNT_STORE_KEY, JSON.stringify(toStored(session)));
        else window.localStorage.removeItem(ACCOUNT_STORE_KEY);
    } catch {
        // Storage blocked (private mode) — session sirf memory me rahega.
    }
}

function normalize(stored: StoredSession | null): AccountSession | null {
    if (!stored || !stored.access_token) return null;
    const email = stored.user?.email ?? '';
    const name = stored.user?.display_name || (email ? email.split('@')[0] : '');
    return {
        access_token: stored.access_token,
        refresh_token: stored.refresh_token ?? '',
        expires_at: Number(stored.expires_at) || 0,
        user: { id: stored.user?.id ?? '', email, name },
    };
}

/**
 * Session hamesha storage se padha jata hai (cache nahi).
 *
 * Pehle `current` module-level cache tha, jisse doosre tab me sign-in/out ka
 * asar nahi dikhta tha — aur tests me purana cache leak karta tha. Storage read
 * sasta hai, isliye har call par fresh.
 */
export function getSession(): AccountSession | null {
    if (typeof window === 'undefined' || !window.localStorage) return memorySession;
    try {
        return normalize(readStorage());
    } catch {
        return memorySession;
    }
}

function setSession(next: AccountSession | null) {
    memorySession = next;
    writeStorage(next);
    listeners.forEach((fn) => fn(next));
}

/** Session badalne par (sign in / out / another tab) UI ko batata hai. */
export function subscribe(fn: (session: AccountSession | null) => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

if (typeof window !== 'undefined') {
    // Doosre tab me sign in/out ho to yahan bhi sync ho jaye.
    window.addEventListener?.('storage', (event) => {
        if (event.key !== ACCOUNT_STORE_KEY) return;
        const next = normalize(readStorage());
        listeners.forEach((fn) => fn(next));
    });
}

function sessionFromTokenResponse(data: any): AccountSession | null {
    if (!data || !data.access_token) return null;
    const meta = (data.user && data.user.user_metadata) || {};
    const email = (data.user && data.user.email) || '';
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || (getSession()?.refresh_token ?? ''),
        // 60s pehle expire maan lo, taaki request beech me fail na ho.
        expires_at: Date.now() + (Math.max(Number(data.expires_in) || 3600, 120) - 60) * 1000,
        user: {
            id: (data.user && data.user.id) || '',
            email,
            name: meta.display_name || (email ? email.split('@')[0] : ''),
        },
    };
}

async function authCall(path: string, body: unknown) {
    const res = await fetch(SUPABASE_URL + path, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    let data: any = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    if (!res.ok) {
        const message = String(
            data?.msg || data?.error_description || data?.message || data?.error || 'Sign in failed',
        );
        throw new Error(message);
    }
    return data;
}

/** Email/password se sign in. Session turant save + listeners ko notify. */
export async function signIn(email: string, password: string): Promise<AccountSession> {
    const data = await authCall('/auth/v1/token?grant_type=password', { email, password });
    const session = sessionFromTokenResponse(data);
    if (!session) throw new Error('Sign in failed');
    setSession(session);
    return session;
}

/** Naya account. Supabase me email-confirm off hai, isliye seedha session milta hai. */
export async function signUp(email: string, password: string, displayName: string): Promise<AccountSession> {
    const data = await authCall('/auth/v1/signup', {
        email,
        password,
        data: { display_name: displayName || email.split('@')[0] },
    });
    const session = sessionFromTokenResponse(data);
    if (!session) throw new Error('Please confirm your email first — check your inbox.');
    setSession(session);
    return session;
}

export async function signOut(): Promise<void> {
    const session = getSession();
    setSession(null);
    if (session?.access_token) {
        try {
            await fetch(SUPABASE_URL + '/auth/v1/logout', {
                method: 'POST',
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
            });
        } catch {
            // Network down ho to bhi local sign-out ho chuka hai.
        }
    }
}

/**
 * Token expire ho gaya ho to refresh karo. Har protected call se pehle chalta
 * hai; refresh fail = session clear (user ko dobara sign in karna hoga).
 */
export async function ensureFreshSession(): Promise<AccountSession | null> {
    const session = getSession();
    if (!session) return null;
    if (!session.expires_at || session.expires_at > Date.now()) return session;
    if (!session.refresh_token) {
        setSession(null);
        return null;
    }
    try {
        const data = await authCall('/auth/v1/token?grant_type=refresh_token', {
            refresh_token: session.refresh_token,
        });
        const next = sessionFromTokenResponse(data);
        setSession(next);
        return next;
    } catch {
        setSession(null);
        return null;
    }
}
