import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useUser } from '@/contexts/UserContext';
import { SafeImage } from '@/components/SafeImage';

export const WEB_NAV_HEIGHT = 68;

const NAV_LINKS = [
    { label: 'Home', href: '/' as const, type: 'route' },
    { label: 'TV Shows', href: '/browse/tv' as const, type: 'filter', filter: 'tv' },
    { label: 'Movies', href: '/browse/movies' as const, type: 'filter', filter: 'movie' },
    { label: 'New & Popular', href: '/new' as const, type: 'route' },
    { label: 'My List', href: '/profile' as const, type: 'route' },
    { label: 'Browse by Languages', href: '/search' as const, type: 'route' },
];

const NOTIFICATIONS = [
    { id: '1', title: 'Heeramandi: The Diamond Bazaar', time: '1 day ago', text: 'Season 1 is now streaming in 4K HDR Hindi & Regional.' },
    { id: '2', title: 'Jawan', time: '2 days ago', text: 'Shah Rukh Khan’s #1 blockbuster now available.' },
    { id: '3', title: 'Animal', time: '4 days ago', text: 'Top 10 trending in India today.' },
];

/**
 * Present-day Netflix India desktop navigation bar.
 * Transparent over the billboard, transitions to solid dark on scroll.
 */
export function WebNavBar() {
    const router = useRouter();
    const pathname = usePathname();
    const { selectedProfile } = useUser();
    const [scrolled, setScrolled] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showBellMenu, setShowBellMenu] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;

        const handleScroll = () => {
            if (window.scrollY > 30) {
                setScrolled(true);
            } else {
                setScrolled(false);
            }
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    if (Platform.OS !== 'web' || !selectedProfile) return null;

    const handleSearchSubmit = () => {
        if (searchQuery.trim()) {
            router.push({
                pathname: '/search',
                params: { q: searchQuery.trim() },
            });
        }
    };

    return (
        <View
            style={[
                styles.wrapper,
                scrolled ? styles.wrapperScrolled : styles.wrapperTransparent,
            ]}
        >
            {!scrolled && (
                <LinearGradient
                    colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.4)', 'transparent']}
                    locations={[0, 0.6, 1]}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                />
            )}

            <View style={styles.bar}>
                {/* Netflix Brand Wordmark */}
                <Pressable
                    onPress={() => router.push('/')}
                    style={({ hovered }: any) => [styles.logoBtn, hovered && { opacity: 0.85 }]}
                >
                    <Text style={styles.logo}>NETFLIX</Text>
                </Pressable>

                {/* Main Desktop Links */}
                <View style={styles.links}>
                    {NAV_LINKS.map((link) => {
                        const isHome = link.label === 'Home' && (pathname === '/' || pathname === '/index');
                        const isNew = link.label === 'New & Popular' && pathname.startsWith('/new');
                        const isMyList = link.label === 'My List' && pathname.startsWith('/profile');
                        const isSearch = link.label === 'Browse by Languages' && pathname.startsWith('/search');
                        const active = isHome || isNew || isMyList || isSearch;

                        return (
                            <Pressable
                                key={link.label}
                                onPress={() => {
                                    if (link.type === 'route') {
                                        router.push(link.href);
                                    } else if (link.label === 'TV Shows') {
                                        router.push({
                                            pathname: '/browse/[rowTitle]',
                                            params: { rowTitle: 'Top 10 TV Shows in India Today' },
                                        });
                                    } else if (link.label === 'Movies') {
                                        router.push({
                                            pathname: '/browse/[rowTitle]',
                                            params: { rowTitle: 'Top 10 Movies in India Today' },
                                        });
                                    }
                                }}
                                style={({ hovered }: any) => [
                                    styles.linkItem,
                                    hovered && !active && { opacity: 0.7 },
                                ]}
                            >
                                <Text style={[styles.link, active && styles.linkActive]}>
                                    {link.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

                {/* Right utility items */}
                <View style={styles.right}>
                    {/* Expandable Search Input */}
                    {searchOpen ? (
                        <View style={styles.searchBox}>
                            <Ionicons name="search" size={18} color="#fff" />
                            <TextInput
                                placeholder="Titles, people, genres"
                                placeholderTextColor="#8c8c8c"
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                onSubmitEditing={handleSearchSubmit}
                                autoFocus
                                style={styles.searchInput}
                                onBlur={() => {
                                    if (!searchQuery) setSearchOpen(false);
                                }}
                            />
                            {searchQuery.length > 0 && (
                                <Pressable onPress={() => setSearchQuery('')}>
                                    <Ionicons name="close" size={18} color="#aaa" />
                                </Pressable>
                            )}
                        </View>
                    ) : (
                        <Pressable
                            onPress={() => setSearchOpen(true)}
                            style={({ hovered }: any) => [styles.iconBtn, hovered && { opacity: 0.75 }]}
                        >
                            <Ionicons name="search" size={20} color="#fff" />
                        </Pressable>
                    )}

                    {/* Children link */}
                    <Pressable
                        onPress={() => router.push('/search')}
                        style={({ hovered }: any) => [styles.childrenBtn, hovered && { opacity: 0.8 }]}
                    >
                        <Text style={styles.childrenText}>Children</Text>
                    </Pressable>

                    {/* Notifications Bell */}
                    <View style={styles.bellContainer}>
                        <Pressable
                            onPress={() => {
                                setShowBellMenu((prev) => !prev);
                                setShowProfileMenu(false);
                            }}
                            style={({ hovered }: any) => [styles.iconBtn, hovered && { opacity: 0.75 }]}
                        >
                            <Ionicons name="notifications-outline" size={21} color="#fff" />
                            <View style={styles.bellDot}>
                                <Text style={styles.bellDotText}>3</Text>
                            </View>
                        </Pressable>

                        {/* Bell Notifications Dropdown */}
                        {showBellMenu && (
                            <View style={styles.dropdownMenu}>
                                <Text style={styles.dropdownHeader}>Notifications</Text>
                                {NOTIFICATIONS.map((n) => (
                                    <Pressable
                                        key={n.id}
                                        style={styles.notifItem}
                                        onPress={() => setShowBellMenu(false)}
                                    >
                                        <View style={styles.notifDot} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.notifTitle}>{n.title}</Text>
                                            <Text style={styles.notifText}>{n.text}</Text>
                                            <Text style={styles.notifTime}>{n.time}</Text>
                                        </View>
                                    </Pressable>
                                ))}
                            </View>
                        )}
                    </View>

                    {/* Profile Avatar + Dropdown */}
                    <View style={styles.profileContainer}>
                        <Pressable
                            onPress={() => {
                                setShowProfileMenu((prev) => !prev);
                                setShowBellMenu(false);
                            }}
                            style={styles.profileBtn}
                        >
                            <SafeImage
                                source={{ uri: selectedProfile.avatar }}
                                style={styles.avatar}
                                cachePolicy="memory-disk"
                            />
                            <Ionicons
                                name={showProfileMenu ? 'caret-up' : 'caret-down'}
                                size={12}
                                color="#fff"
                            />
                        </Pressable>

                        {/* Profile Dropdown Menu */}
                        {showProfileMenu && (
                            <View style={[styles.dropdownMenu, styles.profileDropdown]}>
                                <View style={styles.profileHeaderRow}>
                                    <SafeImage
                                        source={{ uri: selectedProfile.avatar }}
                                        style={styles.avatarSmall}
                                    />
                                    <Text style={styles.profileName}>{selectedProfile.name}</Text>
                                </View>
                                <View style={styles.menuDivider} />
                                <Pressable
                                    style={styles.menuItem}
                                    onPress={() => {
                                        setShowProfileMenu(false);
                                        router.push('/profile');
                                    }}
                                >
                                    <Ionicons name="person-outline" size={16} color="#aaa" />
                                    <Text style={styles.menuItemText}>Account & Settings</Text>
                                </Pressable>
                                <Pressable
                                    style={styles.menuItem}
                                    onPress={() => {
                                        setShowProfileMenu(false);
                                        router.push('/profile');
                                    }}
                                >
                                    <Ionicons name="bookmark-outline" size={16} color="#aaa" />
                                    <Text style={styles.menuItemText}>My List</Text>
                                </Pressable>
                                <View style={styles.menuDivider} />
                                <Pressable
                                    style={styles.menuItem}
                                    onPress={() => {
                                        setShowProfileMenu(false);
                                        router.push('/profile');
                                    }}
                                >
                                    <Text style={[styles.menuItemText, { color: '#e5e5e5' }]}>
                                        Sign out of Netflix
                                    </Text>
                                </Pressable>
                            </View>
                        )}
                    </View>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'fixed' as any,
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999,
        ...Platform.select({
            web: { transition: 'background-color 0.4s ease' } as any,
            default: {},
        }),
    },
    wrapperTransparent: {
        backgroundColor: 'transparent',
    },
    wrapperScrolled: {
        backgroundColor: '#141414',
        boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
    } as any,
    bar: {
        height: WEB_NAV_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 48,
        gap: 32,
    },
    logoBtn: {
        marginRight: 8,
    },
    logo: {
        color: '#E50914',
        fontSize: 27,
        fontWeight: '900',
        letterSpacing: 1.2,
    },
    links: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 20,
        flex: 1,
    },
    linkItem: {
        paddingVertical: 6,
    },
    link: {
        color: '#e5e5e5',
        fontSize: 14,
        fontWeight: '500',
    },
    linkActive: {
        color: '#ffffff',
        fontWeight: '800',
    },
    right: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 22,
    },
    iconBtn: {
        padding: 4,
        position: 'relative',
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        borderWidth: 1,
        borderColor: '#fff',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 2,
        gap: 8,
        width: 240,
    },
    searchInput: {
        color: '#fff',
        fontSize: 13,
        flex: 1,
        outlineStyle: 'none',
    } as any,
    childrenBtn: {
        paddingVertical: 4,
    },
    childrenText: {
        color: '#e5e5e5',
        fontSize: 13.5,
        fontWeight: '500',
    },
    bellContainer: {
        position: 'relative',
    },
    bellDot: {
        position: 'absolute',
        top: 2,
        right: 0,
        backgroundColor: '#E50914',
        borderRadius: 8,
        width: 14,
        height: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bellDotText: {
        color: '#fff',
        fontSize: 9,
        fontWeight: '900',
    },
    profileContainer: {
        position: 'relative',
    },
    profileBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 4,
        backgroundColor: '#333',
    },
    avatarSmall: {
        width: 28,
        height: 28,
        borderRadius: 4,
        backgroundColor: '#333',
    },
    dropdownMenu: {
        position: 'absolute',
        top: 44,
        right: 0,
        width: 280,
        backgroundColor: 'rgba(20, 20, 20, 0.96)',
        borderWidth: 1,
        borderColor: '#333',
        borderRadius: 4,
        paddingVertical: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
        zIndex: 1000,
    } as any,
    profileDropdown: {
        width: 200,
    },
    dropdownHeader: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
        paddingHorizontal: 14,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#2b2b2b',
    },
    notifItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#242424',
    },
    notifDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#E50914',
        marginTop: 6,
    },
    notifTitle: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
    notifText: {
        color: '#b3b3b3',
        fontSize: 11.5,
        lineHeight: 15,
        marginTop: 2,
    },
    notifTime: {
        color: '#777',
        fontSize: 10,
        marginTop: 4,
    },
    profileHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    profileName: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
    menuDivider: {
        height: 1,
        backgroundColor: '#2b2b2b',
        marginVertical: 6,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    menuItemText: {
        color: '#b3b3b3',
        fontSize: 12.5,
        fontWeight: '500',
    },
});
