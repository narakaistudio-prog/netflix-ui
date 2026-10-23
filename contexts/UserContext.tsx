import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    AccountSession,
    getSession,
    signIn as accountSignIn,
    signOut as accountSignOut,
    signUp as accountSignUp,
    subscribe,
} from '@/lib/account';

/**
 * Netflix app ka user context.
 *
 * Pehle yahan `data/users.json` se **fake profiles** (Saúl / Primeagen / Theo /
 * Kids) aate the aur app "Who is watching?" screen dikha kar unme se ek chunwa
 * deta tha. Owner: "fake sara profile hta do, netflix mae bhi red ka sign wala
 * exact jo crunchyroll mae system hai wo kardo" — ab yahan sirf asli Supabase
 * account rehta hai (lib/account.ts, Crunchyroll ke saath shared session).
 *
 * Guest bhi poora app browse kar sakta hai; sign in sirf tab chahiye jab account
 * chahiye (My List / comments).
 */

export interface Profile {
    id: string;
    name: string;
    avatar: string;
}

interface UserContextType {
    /** Asli signed-in account, ya null (guest). */
    account: AccountSession['user'] | null;
    signedIn: boolean;
    /** Purane components ke liye: account ko profile shape me. */
    selectedProfile: Profile | null;
    /** Sign-in modal khula hai ya nahi — navbar aur profile page dono isko use karte hain. */
    signInOpen: boolean;
    openSignIn: () => void;
    closeSignIn: () => void;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, displayName: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
    const [account, setAccount] = useState<AccountSession['user'] | null>(() => getSession()?.user ?? null);
    const [signInOpen, setSignInOpen] = useState(false);

    useEffect(() => subscribe((session) => setAccount(session?.user ?? null)), []);

    const signIn = useCallback(async (email: string, password: string) => {
        const session = await accountSignIn(email.trim(), password);
        setAccount(session.user);
        setSignInOpen(false);
    }, []);

    const signUp = useCallback(async (email: string, password: string, displayName: string) => {
        const session = await accountSignUp(email.trim(), password, displayName.trim());
        setAccount(session.user);
        setSignInOpen(false);
    }, []);

    const signOut = useCallback(async () => {
        await accountSignOut();
        setAccount(null);
    }, []);

    const value = useMemo<UserContextType>(() => {
        const profile: Profile | null = account
            ? { id: account.id || account.email, name: account.name || account.email, avatar: '' }
            : null;
        return {
            account,
            signedIn: !!account,
            selectedProfile: profile,
            signInOpen,
            openSignIn: () => setSignInOpen(true),
            closeSignIn: () => setSignInOpen(false),
            signIn,
            signUp,
            signOut,
        };
    }, [account, signInOpen, signIn, signUp, signOut]);

    return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
}
