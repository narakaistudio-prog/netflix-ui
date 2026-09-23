import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Platform,
    View,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Text,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Movie } from '@/types/movie';
import { useCatalog } from '@/hooks/useCatalog';
import { SafeImage } from '@/components/SafeImage';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';

const IS_WEB = Platform.OS === 'web';

export default function Search() {
    const params = useLocalSearchParams<{ q?: string }>();
    const { rows } = useCatalog();
    const router = useRouter();
    const inputRef = useRef<TextInput>(null);
    const [searchQuery, setSearchQuery] = useState(params.q ?? '');

    const catalog = useMemo(() => {
        const seen = new Set<string>();
        const unique: Movie[] = [];
        for (const row of rows) {
            for (const show of row.movies) {
                const key = String(show.id ?? show.title ?? '');
                if (!key || seen.has(key)) continue;
                seen.add(key);
                unique.push(show);
            }
        }
        return unique;
    }, [rows]);

    // Same-frame filter. A debounce left the previous results on screen after
    // the query changed or was cleared.
    const filteredShows = useMemo(() => {
        const searchText = searchQuery.trim().toLowerCase();
        if (!searchText) return catalog.slice(0, 18);
        return catalog
            .filter(show => (show.title ?? '').toLowerCase().includes(searchText))
            .slice(0, 40);
    }, [catalog, searchQuery]);

    useEffect(() => {
        if (params.q !== undefined && params.q !== searchQuery) {
            setSearchQuery(params.q);
        }
    }, [params.q]);

    const closeSearch = () => {
        inputRef.current?.blur();
        if (router.canGoBack()) router.back();
        else router.replace('/');
    };

    useEffect(() => {
        if (!IS_WEB || typeof window === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeSearch();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [router]);

    const openTitle = (id: string) => {
        inputRef.current?.blur();
        // Replace so search unmounts immediately instead of staying under the
        // title modal until a stack animation finishes.
        router.replace(`/movie/${id}` as any);
    };

    return (
        <View style={styles.container}>
            <StatusBar style="light" />
            <Stack.Screen options={{ headerShown: false, animation: 'none' }} />

            <View style={[styles.header, IS_WEB && webStyles.header]}>
                <TouchableOpacity onPress={closeSearch} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={24} color="white" />
                </TouchableOpacity>
                <View style={styles.searchInputContainer}>
                    <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
                    <TextInput
                        ref={inputRef}
                        style={styles.searchInput}
                        placeholder="Search shows, movies..."
                        placeholderTextColor="#6b6b6b"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        autoCapitalize="none"
                        autoFocus={!params.q}
                        returnKeyType="search"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                            <Ionicons name="close-circle" size={20} color="#666" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {searchQuery.trim() !== '' && filteredShows.length === 0 ? (
                <View style={styles.noResults}>
                    <Text style={styles.noResultsTitle}>Oh darn. We don't have that.</Text>
                    <Text style={styles.noResultsSubtitle}>
                        Try searching for another movie, show, actor, director, or genre.
                    </Text>
                </View>
            ) : (
                <ScrollView
                    style={styles.content}
                    contentContainerStyle={[styles.section, IS_WEB && webStyles.section]}
                    keyboardShouldPersistTaps="handled"
                >
                    <Text style={styles.sectionTitle}>
                        {searchQuery.trim() ? 'Top Results' : 'Recommended'}
                    </Text>
                    <View style={styles.grid}>
                        {filteredShows.map((item) => (
                            <TouchableOpacity
                                key={String(item.id)}
                                style={styles.card}
                                onPress={() => openTitle(String(item.id))}
                                activeOpacity={0.85}
                            >
                                <View style={styles.posterBox}>
                                    <SafeImage
                                        source={{ uri: item.imageUrl }}
                                        style={styles.poster}
                                        fallbackLabel={item.title}
                                    />
                                </View>
                                <Text style={styles.cardTitle} numberOfLines={1}>
                                    {item.title}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#141414',
        ...(Platform.OS === 'web'
            ? {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 20,
                minHeight: '100vh',
            }
            : null),
    } as any,
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 50,
        paddingHorizontal: 16,
        paddingBottom: 16,
        marginTop: 10,
    },
    backButton: {
        marginRight: 12,
    },
    searchInputContainer: {
        flex: 1,
        height: 32,
        backgroundColor: '#323232',
        borderRadius: 4,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        color: 'white',
        fontSize: 16,
        outlineStyle: 'none',
    } as any,
    content: {
        flex: 1,
    },
    section: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        paddingBottom: 48,
    },
    sectionTitle: {
        color: '#e5e5e5',
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 14,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 14,
    },
    card: {
        width: 168,
    },
    posterBox: {
        width: 168,
        height: 96,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#222',
    },
    poster: {
        width: '100%',
        height: '100%',
    },
    cardTitle: {
        color: '#e5e5e5',
        fontSize: 13,
        fontWeight: '600',
        marginTop: 6,
    },
    noResults: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 80,
    },
    noResultsTitle: {
        color: 'white',
        fontSize: 28,
        fontWeight: '700',
        marginBottom: 8,
    },
    noResultsSubtitle: {
        color: '#6b6b6b',
        fontSize: 18,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
});

const webStyles = StyleSheet.create({
    header: {
        paddingTop: WEB_NAV_HEIGHT + 16,
        marginTop: 0,
        paddingHorizontal: 48,
        width: '100%',
    },
    section: {
        paddingHorizontal: 48,
    },
});
