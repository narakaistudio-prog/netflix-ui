import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '@/components/SafeImage';
import { MovieDetailModal } from '@/components/MovieList/MovieDetailModal';
import { useCatalog } from '@/hooks/useCatalog';
import {
    getRecentlyWatched,
    lastActivity,
    removeWatched,
    RECENTLY_WATCHED_EVENT,
    type WatchedEntry,
} from '@/lib/recentlyWatched';
import { buildContinueMeta } from '@/lib/continueWatching';
import { getTvEpisode } from '@/lib/tvEpisodes';
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
 * "Continue Watching" row.
 *
 * Same feature as the one on the Crunchyroll page: every title the viewer
 * started is kept together with the position they stopped at, so the card can
 * show the playhead ("6:12 in · 18 min left"), a progress bar, and resume the
 * very same episode from the very same second.
 */
export function ContinueWatchingRow() {
    const [entries, setEntries] = useState<WatchedEntry[]>([]);
    /** Title the viewer picked, plus the episode and position to resume. */
    const [selected, setSelected] = useState<{
        movie: Movie;
        entry: WatchedEntry;
    } | null>(null);
    const { rows } = useCatalog();

    useEffect(() => {
        const refresh = () => setEntries(getRecentlyWatched());
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
            mediaType: e.type === 'tv' ? 'tv' : 'movie',
        } as Movie;
    };

    /** The card copy — same wording as the Crunchyroll Continue Watching row. */
    const metaFor = (e: WatchedEntry) => {
        const episodeName =
            e.type === 'tv'
                ? getTvEpisode(e.tmdbId, e.season, e.episode)?.name
                : undefined;
        return buildContinueMeta({
            type: e.type,
            season: e.season,
            episode: e.episode,
            episodeName,
            positionSec: e.positionSec,
            durationSec: e.durationSec,
            at: lastActivity(e),
        });
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
                    const { label, meta, percent } = metaFor(e);
                    return (
                        <Pressable
                            key={e.id}
                            onPress={() => setSelected({ movie, entry: e })}
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
                            </View>
                            <View style={styles.copy}>
                                <Text style={styles.cardTitle} numberOfLines={1}>{e.title ?? ''}</Text>
                                <Text style={styles.cardLabel} numberOfLines={1}>{label}</Text>
                                <Text style={styles.cardMeta} numberOfLines={1}>{meta}</Text>
                                {percent > 0 ? (
                                    <View style={styles.progress}>
                                        <View
                                            testID="continue-progress"
                                            style={[styles.progressFill, { width: `${percent}%` }]}
                                        />
                                    </View>
                                ) : null}
                            </View>
                            <Pressable
                                onPress={() => removeWatched(e.id)}
                                style={styles.remove}
                                accessibilityLabel={`Remove ${e.title ?? ''} from Continue Watching`}
                            >
                                <Ionicons name="close" size={16} color="#fff" />
                            </Pressable>
                        </Pressable>
                    );
                })}
            </ScrollView>
            {selected ? (
                <MovieDetailModal
                    movie={selected.movie}
                    initialEpisode={
                        selected.entry.type === 'tv'
                            ? {
                                season: selected.entry.season ?? 1,
                                episode: selected.entry.episode ?? 1,
                            }
                            : null
                    }
                    autoPlay
                    resumeAt={selected.entry.positionSec ?? 0}
                    onClose={() => setSelected(null)}
                />
            ) : null}
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
        alignItems: 'flex-start',
    },
    card: {
        width: IS_WEB ? 380 : 300,
        flexDirection: 'row',
        gap: 12,
        backgroundColor: '#15171b',
        borderWidth: 1,
        borderColor: '#34363b',
        borderRadius: 4,
        padding: 8,
    },
    thumb: {
        width: IS_WEB ? 150 : 120,
        aspectRatio: 16 / 9,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#222',
    },
    copy: {
        flex: 1,
        minWidth: 0,
        justifyContent: 'center',
        gap: 3,
    },
    cardTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    cardLabel: {
        color: '#a9abb0',
        fontSize: 12,
    },
    cardMeta: {
        color: '#a9abb0',
        fontSize: 12,
    },
    progress: {
        height: 4,
        borderRadius: 2,
        backgroundColor: '#3b3d42',
        overflow: 'hidden',
        marginTop: 6,
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#E50914',
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
});
