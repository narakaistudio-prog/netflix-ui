import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { CrunchyrollIcon } from '@/icons/Crunchyroll';
import { isPhoneWidth, PHONE_TAB_BAR_HEIGHT, showsPhoneTabBar } from '@/lib/layout';

const TABS = [
    { label: 'Home', href: '/' as const, kind: 'route' as const, icon: 'home' as const, match: (p: string) => p === '/' || p === '/index' },
    { label: 'TV Shows', href: '/browse/tv' as const, kind: 'catalog' as const, catalog: 'tv', icon: 'tv' as const, match: (p: string) => p === '/browse/tv' },
    { label: 'Movies', href: '/browse/movies' as const, kind: 'catalog' as const, catalog: 'movies', icon: 'film' as const, match: (p: string) => p === '/browse/movies' },
    { label: 'Anime', href: '/anime' as const, kind: 'route' as const, icon: 'sparkles' as const, match: (p: string) => p === '/anime' },
    { label: 'K-Dramas', href: '/kdramas' as const, kind: 'route' as const, icon: 'heart' as const, match: (p: string) => p === '/kdramas' || p.startsWith('/kdramas/') },
    { label: 'My List', href: '/profile' as const, kind: 'route' as const, icon: 'bookmark' as const, match: (p: string) => p.startsWith('/profile') },
    { label: 'Crunchyroll', href: '/crunchyroll' as const, kind: 'ott' as const, icon: 'play' as const, match: (p: string) => p.startsWith('/crunchyroll') },
];

/**
 * Bottom tab bar for phone-width web, the way the Netflix app navigates.
 * The desktop links live in WebNavBar, which hides them on phones.
 */
export function PhoneTabBar() {
    const router = useRouter();
    const pathname = usePathname();
    const { width } = useWindowDimensions();
    // Guest bhi navigate kar sakta hai — account gate nahi (owner: fake profile hatao).
    if (!showsPhoneTabBar(pathname, isPhoneWidth(width), Platform.OS === 'web')) return null;

    return (
        <View style={styles.bar} {...({ dataSet: { playerChrome: 'true' } } as any)}>
            {TABS.map(tab => {
                const active = tab.match(pathname);
                const color = active ? '#ffffff' : 'rgba(255,255,255,0.5)';
                return (
                    <Pressable
                        key={tab.label}
                        accessibilityRole="button"
                        accessibilityLabel={tab.label}
                        onPress={() => {
                            if (tab.kind === 'catalog') {
                                router.push({ pathname: '/browse/[rowTitle]', params: { rowTitle: tab.catalog } });
                            } else {
                                router.push(tab.href);
                            }
                        }}
                        style={styles.tab}
                    >
                        {tab.kind === 'ott' ? (
                            <CrunchyrollIcon size={22} color={active ? '#f47521' : 'rgba(244, 117, 33, 0.6)'} />
                        ) : (
                            <Ionicons name={active ? tab.icon : (`${tab.icon}-outline` as any)} size={22} color={color} />
                        )}
                        <Text style={[styles.label, { color }, active && styles.labelActive]} numberOfLines={1}>
                            {tab.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        position: 'fixed' as any,
        left: 0,
        right: 0,
        bottom: 0,
        height: PHONE_TAB_BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-around',
        backgroundColor: '#000',
        borderTopWidth: 1,
        borderTopColor: '#1f1f1f',
        paddingTop: 7,
        paddingBottom: 6,
        zIndex: 998,
    } as any,
    tab: {
        flex: 1,
        alignItems: 'center',
        gap: 3,
        minWidth: 0,
    },
    label: {
        fontSize: 9,
        fontWeight: '600',
        letterSpacing: -0.1,
    },
    labelActive: {
        fontWeight: '800',
    },
});
