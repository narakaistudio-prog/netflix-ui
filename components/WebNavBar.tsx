import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useUser } from '@/contexts/UserContext';
import { SafeImage } from '@/components/SafeImage';

export const WEB_NAV_HEIGHT = 68;

const LINKS = [
    { href: '/' as const, label: 'Home', match: (p: string) => p === '/' || p.startsWith('/index') },
    { href: '/new' as const, label: 'New & Hot', match: (p: string) => p.startsWith('/new') },
    { href: '/profile' as const, label: 'My Netflix', match: (p: string) => p.startsWith('/profile') },
];

/**
 * Netflix.com style top navigation bar for the web build.
 * Rendered globally (above the navigator) so it stays visible on
 * non-tab pages like Search and Downloads as well.
 */
export function WebNavBar() {
    const router = useRouter();
    const pathname = usePathname();
    const { selectedProfile } = useUser();

    if (Platform.OS !== 'web' || !selectedProfile) return null;
    // The episode player is a fullscreen iframe — keep the bar out of the way.
    if (pathname.startsWith('/watch')) return null;

    return (
        <View style={styles.wrapper} pointerEvents="box-none">
            <LinearGradient
                colors={['rgba(0,0,0,0.9)', 'rgba(0,0,0,0.55)', 'transparent']}
                locations={[0, 0.6, 1]}
                style={styles.gradient}
                pointerEvents="none"
            />
            <View style={styles.bar}>
                <Pressable
                    onPress={() => router.push('/')}
                    style={({ hovered }: any) => [{ opacity: hovered ? 0.8 : 1 }]}
                >
                    <Text style={styles.logo}>NETFLIX</Text>
                </Pressable>

                <View style={styles.links}>
                    {LINKS.map(link => {
                        const active = link.match(pathname);
                        return (
                            <Pressable
                                key={link.href}
                                onPress={() => router.push(link.href)}
                                style={({ hovered }: any) => [{ opacity: hovered && !active ? 0.75 : 1 }]}
                            >
                                <Text style={[styles.link, active && styles.linkActive]}>
                                    {link.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

                <View style={styles.right}>
                    <Pressable
                        style={({ hovered }: any) => [
                            styles.addBtn,
                            hovered && styles.addBtnHover,
                        ]}
                        onPress={() => router.push('/admin')}
                    >
                        <Ionicons name="add" size={14} color="#fff" />
                        <Text style={styles.addBtnText}>Add Series</Text>
                    </Pressable>
                    <Pressable
                        onPress={() => router.push('/search')}
                        style={({ hovered }: any) => [{ opacity: hovered ? 0.75 : 1 }]}
                    >
                        <Ionicons name="search" size={22} color="#fff" />
                    </Pressable>
                    <Pressable
                        onPress={() => router.push('/profile')}
                        style={({ hovered }: any) => [{ opacity: hovered ? 0.8 : 1 }]}
                    >
                        <SafeImage
                            source={{ uri: selectedProfile.avatar }}
                            style={styles.avatar}
                            cachePolicy="memory-disk"
                        />
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
    },
    gradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 120,
    },
    bar: {
        height: WEB_NAV_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 48,
        gap: 36,
    },
    logo: {
        color: '#E50914',
        fontSize: 26,
        fontWeight: '900',
        letterSpacing: 1.5,
    },
    links: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 24,
        flex: 1,
    },
    link: {
        color: '#e5e5e5',
        fontSize: 14,
        fontWeight: '500',
    },
    linkActive: {
        color: '#fff',
        fontWeight: '700',
    },
    right: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 20,
    },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: 'rgba(229,9,20,0.9)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    addBtnHover: {
        backgroundColor: '#E50914',
    },
    addBtnText: {
        color: '#fff',
        fontSize: 12.5,
        fontWeight: '700',
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 4,
        backgroundColor: '#333',
    },
});
