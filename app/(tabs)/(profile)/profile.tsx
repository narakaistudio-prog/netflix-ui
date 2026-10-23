import React from 'react';
import { Platform, View, StyleSheet, TouchableOpacity, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@/contexts/UserContext';
import { usePathname, useRouter } from 'expo-router';
import { TAB_SCREENS } from '@/app/(tabs)/_layout';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';

/**
 * My Netflix page.
 *
 * Pehle yahan sab **fake** tha: `data/users.json` ke profiles (Saúl / Primeagen /
 * Theo / Kids), "Who is watching?" switcher, example liked posters, example My
 * List, "New Arrival · The Perfect Couple" ka notice, aur ek **Admin Panel**
 * entry. Owner: "netflix mae admin panel hta do aur fake sara profile hta do
 * netflix mae bhi red ka sign wala exact jo crunchyroll mae system hai wo kardo".
 *
 * Ab ye page sirf asli account dikhata hai (lib/account.ts — Crunchyroll ke saath
 * shared Supabase session): signed out par red "Sign In" button, signed in par
 * naam + email + Sign out. Koi nakli list/poster nahi.
 */
export default function ProfileScreen() {
    const { account, signedIn, signOut, openSignIn } = useUser();
    const pathname = usePathname();
    const isActive = pathname === '/profile';
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const currentTabIndex = TAB_SCREENS.findIndex((screen) => screen.name === 'profile');
    const activeTabIndex = TAB_SCREENS.findIndex(
        (screen) => pathname === `/${screen.name}` || (screen.name === 'index' && pathname === '/')
    );
    const slideDirection = activeTabIndex > currentTabIndex ? 'right' : 'left';
    const initial = (account?.name || account?.email || '?').trim().charAt(0).toUpperCase();

    return (
        <TabScreenWrapper isActive={isActive} slideDirection={slideDirection}>
            <View style={styles.container}>
                <ScrollView
                    style={styles.scrollView}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                        paddingTop: Platform.OS === 'web' ? WEB_NAV_HEIGHT + 28 : insets.top + 56,
                        paddingBottom: 100,
                        ...(Platform.OS === 'web'
                            ? { maxWidth: 720, width: '100%', alignSelf: 'center' as const }
                            : null),
                    }}
                >
                    <Text style={styles.title}>My Netflix</Text>

                    {signedIn ? (
                        <View style={styles.accountCard}>
                            <View style={styles.accountAvatar}>
                                <Text style={styles.accountAvatarText}>{initial}</Text>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={styles.accountName} numberOfLines={1}>
                                    {account?.name || 'Account'}
                                </Text>
                                {!!account?.email && (
                                    <Text style={styles.accountEmail} numberOfLines={1}>
                                        {account.email}
                                    </Text>
                                )}
                            </View>
                        </View>
                    ) : (
                        <View style={styles.accountCard}>
                            <View style={[styles.accountAvatar, styles.guestAvatar]}>
                                <Ionicons name="person" size={26} color="#fff" />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={styles.accountName}>You are browsing as a guest</Text>
                                <Text style={styles.accountEmail}>
                                    Sign in to keep your account in one place across Netflix and Crunchyroll.
                                </Text>
                            </View>
                        </View>
                    )}

                    {!signedIn && (
                        <Pressable
                            style={({ hovered }: any) => [styles.signInBtn, hovered && { backgroundColor: '#f6121d' }]}
                            onPress={openSignIn}
                            accessibilityRole="button"
                            accessibilityLabel="Sign in"
                        >
                            <Text style={styles.signInBtnText}>Sign In</Text>
                        </Pressable>
                    )}

                    <View style={styles.section}>
                        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/downloads')}>
                            <View style={styles.menuIconContainer}>
                                <View style={[styles.menuIcon, { backgroundColor: '#0071EB' }]}>
                                    <Ionicons name="download-outline" size={20} color="#fff" />
                                </View>
                            </View>
                            <View style={styles.menuContent}>
                                <Text style={styles.menuText}>Downloads</Text>
                                <Ionicons name="chevron-forward" size={20} color="#fff" />
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.menuItem}
                            onPress={() => router.push('/crunchyroll')}
                        >
                            <View style={styles.menuIconContainer}>
                                <View style={[styles.menuIcon, { backgroundColor: '#F47521' }]}>
                                    <Ionicons name="play" size={20} color="#fff" />
                                </View>
                            </View>
                            <View style={styles.menuContent}>
                                <Text style={styles.menuText}>Crunchyroll</Text>
                                <Ionicons name="chevron-forward" size={20} color="#fff" />
                            </View>
                        </TouchableOpacity>
                    </View>

                    {signedIn && (
                        <Pressable
                            style={({ hovered }: any) => [styles.signOutBtn, hovered && { borderColor: '#fff' }]}
                            onPress={signOut}
                            accessibilityRole="button"
                            accessibilityLabel="Sign out of Netflix"
                        >
                            <Text style={styles.signOutText}>Sign out of Netflix</Text>
                        </Pressable>
                    )}

                    <Text style={styles.note}>
                        Sign-in is shared with Crunchyroll: one account for comments and for this profile.
                    </Text>
                </ScrollView>
            </View>
        </TabScreenWrapper>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    scrollView: { flex: 1 },
    title: {
        color: '#fff',
        fontSize: 28,
        fontWeight: '800',
        marginBottom: 18,
        paddingHorizontal: 20,
    },
    accountCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginHorizontal: 20,
        padding: 16,
        borderRadius: 8,
        backgroundColor: '#141414',
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    accountAvatar: {
        width: 54,
        height: 54,
        borderRadius: 6,
        backgroundColor: '#E50914',
        alignItems: 'center',
        justifyContent: 'center',
    },
    guestAvatar: { backgroundColor: '#3a3a3a' },
    accountAvatarText: { color: '#fff', fontSize: 24, fontWeight: '800' },
    accountName: { color: '#fff', fontSize: 17, fontWeight: '700' },
    accountEmail: { color: '#9a9a9a', fontSize: 13, marginTop: 4, lineHeight: 18 },
    signInBtn: {
        marginHorizontal: 20,
        marginTop: 14,
        backgroundColor: '#E50914',
        borderRadius: 4,
        paddingVertical: 12,
        alignItems: 'center',
    },
    signInBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    section: { marginTop: 26, borderTopWidth: 1, borderTopColor: '#222' },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#1d1d1d',
        gap: 14,
    },
    menuIconContainer: { width: 40, alignItems: 'center' },
    menuIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuContent: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    menuText: { color: '#fff', fontSize: 16 },
    signOutBtn: {
        marginHorizontal: 20,
        marginTop: 24,
        borderWidth: 1,
        borderColor: '#555',
        borderRadius: 4,
        paddingVertical: 12,
        alignItems: 'center',
    },
    signOutText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    note: {
        color: '#6f6f6f',
        fontSize: 12,
        lineHeight: 18,
        marginTop: 18,
        paddingHorizontal: 20,
    },
});
