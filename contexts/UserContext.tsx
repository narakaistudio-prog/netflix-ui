import React, { createContext, useContext, useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import profilesData from '@/data/users.json';

export interface Profile {
    id: string;
    name: string;
    avatar: string;
}

interface UserContextType {
    profiles: Profile[];
    selectedProfile: Profile | null;
    selectProfile: (profileId: string) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
    const [selectedProfile, setSelectedProfile] = useState<Profile | null>(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
            const saved = window.localStorage.getItem('netflix_selected_profile_id');
            const found = profilesData.profiles.find(p => p.id === saved);
            if (found) return found;
        }
        // On web, immediately select the primary profile so homepage and nav render without blocker
        return Platform.OS === 'web' ? profilesData.profiles[0] : null;
    });

    const selectProfile = useCallback((profileId: string) => {
        const profile = profilesData.profiles.find(p => p.id === profileId);
        if (profile) {
            setSelectedProfile(profile);
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem('netflix_selected_profile_id', profileId);
            }
        }
    }, []);

    const value = useMemo(() => ({
        profiles: profilesData.profiles,
        selectedProfile,
        selectProfile,
    }), [selectedProfile, selectProfile]);

    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
}

export function useUser() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
} 