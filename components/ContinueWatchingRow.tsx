import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '@/components/SafeImage';
import { MovieDetailModal } from '@/components/MovieList/MovieDetailModal';
import { useCatalog } from '@/hooks/useCatalog';
import {
    getRecentlyWatched,
    removeWatched,
    RECENTLY_WATCHED_EVENT,
    type WatchedEntry,
} from '@/lib/recentlyWatched';
import type { Movie } from '@/types/movie';

const IS_WEB = Platform.OS === 'web';

/** "Watched 5 minutes ago", "Watched 2 hours ago", "Watched 3 days ago". */
export function timeAgo(ts: number, now: number = Date.now()): string {
    const diff = Math.max(0, now - ts);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * "Continue Watching" row: titles the viewer pressed Play on, newest first.
 * Progress is not shown: the Nxsha player is a cross-origin iframe that does not
 * report playback position, so a progress bar or "time left" would be guesswork.
 */
export function ContinueWatchingRow() {
    const [entries, setEntries] = useState<WatchedEntry[]>([]);
    const [selected, setSelected] = useState<Movie | null>(null);
    const { rows } = useCatalog();

    useEffect(() => {
        const refresh = () => setEntries(getRecentlyWatched().filter((e) => e.type === 'movie'));
        refresh();
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
        window.addEventListener(RECENTLY_WATCHED_EVENT, refresh);
        return () => window.removeEventListener(RECENTLY_WATCHED_EVENT, refresh);
    }, []);

    const catalog = useMemo(() => {
        const map = new Map<string, Movie>();
        rows.forEach((row) => row.movies.forEach((m) => map.set(m.id, m)));
        return map;
    }, [rows]);

    if (entries.length === 0) return null;

    // Full details come from the catalog when the title is still there; the
    // saved entry covers the rest (artwork, ids, title).
    const toMovie = (e: WatchedEntry): Movie => {
        const full = catalog.get(e.titleId);
        return {
            ...(full ?? {}),
            id: e.titleId,
            title: full?.title ?? e.title,
            imageUrl: full?.imageUrl || e.imageUrl || e.backdropUrl || '',
            backdropUrl: full?.backdropUrl || e.backdropUrl,
            year: full?.year || e.year,
            tmdb_id: full?.tmdb_id ?? e.tmdbId,
            imdb_id: full?.imdb_id ?? e.imdbId,
            embed_provider: (full?.embed_provider ?? e.provider) as Movie['embed_provider'],
            mediaType: 'movie',
        } as Movie;
    };

    return (
        <View style={styles.wrap}>
            <Text style={styles.title}>Continue Watching</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
            >
                {entries.map((e) => {
                    const movie = toMovie(e);
                    const img = movie.backdropUrl || movie.imageUrl || '';
                    return (
                        <Pressable
                            key={e.id}
                            onPress={() => setSelected(movie)}
                            style={styles.card}
                            accessibilityLabel={`Continue ${e.title ?? ''}`}
                        >
                            <View style={styles.thumb}>
                                {img ? (
                                    <SafeImage
                                        source={{ uri: img }}
                                        style={{ width: '100%', height: '100%' } as any}
                                        fallbackLabel={e.title}
                                        loading="eager"
                                    />
                                ) : null}
                                <Pressable
                                    onPress={() => removeWatched(e.id)}
                                    style={styles.remove}
                                    accessibilityLabel={`Remove ${e.title ?? ''} from Continue Watching`}
                                >
                                    <Ionicons name="close" size={16} color="#fff" />
                                </Pressable>
                            </View>
                            <Text style={styles.cardTitle} numberOfLines={1}>{e.title ?? ''}</Text>
                            <Text style={styles.cardMeta}>Watched {timeAgo(e.startedAt)}</Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
            <MovieDetailModal movie={selected} onClose={() => setSelected(null)} />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingTop: 16,
        paddingBottom: 8,
    },
    title: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '700',
        marginLeft: IS_WEB ? 48 : 16,
        marginBottom: 10,
    },
    row: {
        paddingHorizontal: IS_WEB ? 48 : 16,
        gap: 12,
    },
    card: {
        width: IS_WEB ? 280 : 220,
    },
    thumb: {
        width: '100%',
        aspectRatio: 16 / 9,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: '#222',
    },
    remove: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    cardTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
        marginTop: 8,
    },
    cardMeta: {
        color: '#a3a3a3',
        fontSize: 12,
        marginTop: 2,
    },
});
