import React, { useEffect, useRef, useState } from 'react';
import {
    Platform,
    View,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Text,
    ActivityIndicator,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Movie } from '@/types/movie';
import { useCatalog } from '@/hooks/useCatalog';
import { useDebounce } from 'use-debounce';
import { SafeImage } from '@/components/SafeImage';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';

const IS_WEB = Platform.OS === 'web';

export default function Search() {
    const params = useLocalSearchParams<{ q?: string }>();
    // Everything comes from the live catalog
    const { rows } = useCatalog();
    const tvAndMovies = rows.flatMap(r => r.movies);

    const [searchQuery, setSearchQuery] = useState(params.q ?? '');
    const [isLoading, setIsLoading] = useState(false);
    const [filteredShows, setFilteredShows] = useState<Movie[]>(tvAndMovies);
    const [debouncedSearchTerm] = useDebounce(searchQuery, 500);
    const inputRef = useRef<TextInput>(null);
    const router = useRouter();

    useEffect(() => {
        if (params.q !== undefined && params.q !== searchQuery) {
            setSearchQuery(params.q);
        }
    }, [params.q]);

    // Keep results in sync when the live catalog arrives
    useEffect(() => {
        if (!searchQuery.trim()) {
            setFilteredShows(tvAndMovies);
        }
    }, [rows]);

    useEffect(() => {
        if (!debouncedSearchTerm.trim()) {
            setFilteredShows(tvAndMovies);
            setIsLoading(false);
            return;
        }

        const searchText = debouncedSearchTerm.toLowerCase();
        const matchedShows = tvAndMovies.filter(show =>
            (show.title ?? '').toLowerCase().includes(searchText)
        );

        setFilteredShows(matchedShows);
        setIsLoading(false);
    }, [debouncedSearchTerm]);

    const NoResultsView = () => (
        <View style={styles.noResults}>
            <Text style={styles.noResultsTitle}>Oh darn. We don't have that.</Text>
            <Text style={styles.noResultsSubtitle}>
                Try searching for another movie, show, actor, director, or genre.
            </Text>
        </View>
    );

    return (
        <View style={styles.container}>
            <StatusBar style="light" />
            <Stack.Screen options={{ headerShown: false }} />

            <View style={[styles.header, IS_WEB && webStyles.header]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
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
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color="#666" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {isLoading ? (
                <View style={styles.loaderContainer}>
                    <ActivityIndicator size="large" color="#fff" />
                </View>
            ) : searchQuery.trim() !== '' && filteredShows.length === 0 ? (
                <NoResultsView />
            ) : (
                <ScrollView style={[styles.content, IS_WEB && webStyles.content]}>
                    {/* TV Shows & Movies Section - only show if there are shows */}
                    {filteredShows.length > 0 && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                {searchQuery.trim() ? 'Top Results - Shows & Movies' : 'Recommended TV Shows & Movies'}
                            </Text>
                            <View style={styles.showsList}>
                                {filteredShows.map((item, index) => (
                                    <TouchableOpacity
                                        key={index}
                                        style={styles.showItem}
                                        onPress={() => router.push(`/movie/${item.id}`)}
                                    >
                                        <SafeImage
                                            source={{ uri: item.imageUrl }}
                                            style={styles.showImage}
                                            transition={200}
                                            fallbackLabel={item.title}
                                        />
                                        <View style={styles.showInfo}>
                                            <Text style={styles.showTitle}>{item.title}</Text>
                                        </View>
                                        <TouchableOpacity style={styles.playButton}>
                                            <Ionicons name="play-circle-outline" size={32} color="white" />
                                        </TouchableOpacity>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
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
    },
    content: {
        flex: 1,
    },
    section: {
        paddingVertical: 16,
    },
    sectionTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 16,
        paddingHorizontal: 16,
    },
    gamesRow: {
        paddingHorizontal: 16,
        gap: 12,
    },
    showsList: {
        paddingHorizontal: 16,
    },
    showItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    showImage: {
        width: 150,
        height: 80,
        borderRadius: 4,
        backgroundColor: '#333',
    },
    showInfo: {
        flex: 1,
        marginLeft: 12,
    },
    showTitle: {
        color: 'white',
        fontSize: 16,
    },
    playButton: {
        padding: 8,
    },
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000',
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
        paddingTop: WEB_NAV_HEIGHT + 12,
        marginTop: 0,
        maxWidth: 1000,
        width: '100%',
        alignSelf: 'center',
    },
    content: {
        maxWidth: 1000,
        width: '100%',
        alignSelf: 'center',
    },
});
