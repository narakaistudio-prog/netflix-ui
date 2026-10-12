import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '@/components/SafeImage';
import type { Movie } from '@/types/movie';

const IS_WEB = Platform.OS === 'web';
const PANEL_BG = '#181818';
const MUTED = '#a3a3a3';

type Props = {
    movie: Movie | null;
    /** Other titles from the same shelf, shown as "More Like This". */
    related?: Movie[];
    onClose: () => void;
    onPlay: (movie: Movie) => void;
    /** Opens another title's details inside this modal. */
    onSelect?: (movie: Movie) => void;
};

/**
 * Title details shown over the row when a card is pressed: full-width backdrop
 * with a fade into the panel, title and Play on the image, then year, runtime,
 * description, cast and genres. Play opens the title's player page.
 */
export function MovieDetailModal({ movie, related = [], onClose, onPlay, onSelect }: Props) {
    const { width, height } = useWindowDimensions();
    const panelWidth = Math.min(1000, width * 0.94);
    const wide = panelWidth > 640;
    const fiveUp = panelWidth > 880;
    const heroHeight = Math.min(panelWidth * 0.56, height * (IS_WEB ? 0.62 : 0.4));

    if (!movie) {
        return <Modal visible={false} transparent onRequestClose={onClose} />;
    }

    const image = movie.backdropUrl || movie.imageUrl || '';
    const isSeries = movie.type === 'SERIES';
    const meta = [movie.year, movie.duration || (isSeries ? '1 Season' : '')].filter(Boolean);
    const cast = (movie.cast || []).filter((name) => name && name !== 'Cast not available');
    const genres = movie.genres || [];

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="Close details" />
                <View style={[styles.panel, { width: panelWidth }]}>
                    <ScrollView key={movie.id} bounces={false} showsVerticalScrollIndicator={false}>
                        <View style={[styles.hero, { height: heroHeight }]}>
                            {image ? (
                                <SafeImage
                                    source={{ uri: image }}
                                    style={{ width: '100%', height: '100%' } as any}
                                    fallbackLabel={movie.title}
                                    loading="eager"
                                />
                            ) : (
                                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#222' }]} />
                            )}
                            <LinearGradient
                                colors={['rgba(24,24,24,0)', 'rgba(24,24,24,0.7)', PANEL_BG]}
                                locations={[0.3, 0.75, 1]}
                                style={StyleSheet.absoluteFillObject}
                                pointerEvents="none"
                            />

                            <Pressable
                                onPress={onClose}
                                style={styles.closeButton}
                                accessibilityLabel="Close details"
                            >
                                <Ionicons name="close" size={22} color="#fff" />
                            </Pressable>

                            <View style={styles.heroContent}>
                                <Text style={styles.title} numberOfLines={2}>{movie.title || ''}</Text>
                                <Pressable
                                    onPress={() => onPlay(movie)}
                                    style={styles.playButton}
                                    accessibilityLabel={`Play ${movie.title || ''}`}
                                >
                                    <Ionicons name="play" size={20} color="#000" />
                                    <Text style={styles.playText}>Play</Text>
                                </Pressable>
                            </View>
                        </View>

                        <View style={[styles.body, wide && styles.bodyWide]}>
                            <View style={[styles.main, wide && styles.mainWide]}>
                                <View style={styles.metaRow}>
                                    {movie.ranking_text ? <Text style={styles.rank}>{movie.ranking_text}</Text> : null}
                                    {meta.map((item) => (
                                        <Text key={item} style={styles.metaText}>{item}</Text>
                                    ))}
                                    <Text style={styles.hdBadge}>HD</Text>
                                </View>
                                {movie.description ? (
                                    <Text style={styles.description}>{movie.description}</Text>
                                ) : null}
                            </View>

                            <View style={[styles.side, wide && styles.sideWide]}>
                                {cast.length > 0 ? (
                                    <Text style={styles.sideText}>
                                        <Text style={styles.sideLabel}>Cast: </Text>
                                        {cast.join(', ')}
                                    </Text>
                                ) : null}
                                {genres.length > 0 ? (
                                    <Text style={styles.sideText}>
                                        <Text style={styles.sideLabel}>Genres: </Text>
                                        {genres.join(', ')}
                                    </Text>
                                ) : null}
                            </View>
                        </View>

                        {related.length > 0 ? (
                            <View style={styles.more}>
                                <Text style={styles.moreTitle}>More Like This</Text>
                                <View style={styles.moreGrid}>
                                    {related.map((item) => (
                                        <Pressable
                                            key={item.id}
                                            onPress={() => onSelect?.(item)}
                                            style={[styles.moreItem, fiveUp ? styles.moreItemFive : wide ? styles.moreItemWide : styles.moreItemNarrow]}
                                            accessibilityLabel={`Open ${item.title || ''}`}
                                        >
                                            <SafeImage
                                                source={{ uri: item.imageUrl }}
                                                style={styles.morePoster as any}
                                                fallbackLabel={item.title}
                                                loading="eager"
                                            />
                                            <Text style={styles.moreItemTitle} numberOfLines={2}>{item.title || ''}</Text>
                                            {item.year ? <Text style={styles.moreItemMeta}>{item.year}</Text> : null}
                                        </Pressable>
                                    ))}
                                </View>
                            </View>
                        ) : null}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
    },
    panel: {
        maxHeight: '92%',
        backgroundColor: PANEL_BG,
        borderRadius: 8,
        overflow: 'hidden',
    },
    hero: {
        width: '100%',
        backgroundColor: '#000',
    },
    closeButton: {
        position: 'absolute',
        top: 12,
        right: 12,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    heroContent: {
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: 16,
        gap: 14,
    },
    title: {
        color: '#fff',
        fontSize: 34,
        fontWeight: '800',
        textShadowColor: 'rgba(0,0,0,0.6)',
        textShadowRadius: 8,
    },
    playButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 4,
        paddingVertical: 8,
        paddingHorizontal: 22,
    },
    playText: {
        color: '#000',
        fontSize: 18,
        fontWeight: '700',
    },
    body: {
        paddingHorizontal: 24,
        paddingBottom: 24,
        gap: 16,
    },
    bodyWide: {
        flexDirection: 'row',
        gap: 28,
    },
    main: {
        gap: 12,
    },
    mainWide: {
        flex: 3,
    },
    side: {
        gap: 10,
    },
    sideWide: {
        flex: 2,
    },
    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
    },
    rank: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    metaText: {
        color: MUTED,
        fontSize: 15,
    },
    hdBadge: {
        color: MUTED,
        fontSize: 12,
        borderWidth: 1,
        borderColor: MUTED,
        borderRadius: 3,
        paddingHorizontal: 5,
        paddingVertical: 1,
    },
    description: {
        color: '#e5e5e5',
        fontSize: 16,
        lineHeight: 24,
    },
    sideText: {
        color: '#e5e5e5',
        fontSize: 14,
        lineHeight: 20,
    },
    sideLabel: {
        color: MUTED,
    },
    more: {
        paddingHorizontal: 24,
        paddingBottom: 28,
        gap: 14,
    },
    moreTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '700',
    },
    moreGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    moreItem: {
        gap: 6,
    },
    moreItemFive: {
        width: '18.5%',
    },
    moreItemWide: {
        width: '31.5%',
    },
    moreItemNarrow: {
        width: '48.5%',
    },
    morePoster: {
        width: '100%',
        aspectRatio: 2 / 3,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#222',
    },
    moreItemTitle: {
        color: '#e5e5e5',
        fontSize: 14,
        fontWeight: '600',
    },
    moreItemMeta: {
        color: MUTED,
        fontSize: 12,
    },
});
