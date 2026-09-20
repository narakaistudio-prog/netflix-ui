import React, { useMemo, useState } from 'react';
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '@/components/SafeImage';
import { useSeries } from '@/hooks/useMySeries';
import { removeSeries } from '@/services/seriesStore';
import { providerLabel } from '@/services/embedProviders';
import { totalEpisodeCount } from '@/services/seriesBuilder';

const GRID_GAP = 12;
const WEB_TOP_PAD = 96;

/**
 * Series screen: banner + poster + genres, then a season picker and an
 * episode grid (Jikan thumbnails + titles). Tapping an episode opens the
 * fullscreen iframe player (/watch/[id]?s=…&e=…).
 */
export default function SeriesScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ id?: string }>();
    const rawId =
        typeof params.id === 'string'
            ? params.id
            : Array.isArray(params.id)
                ? params.id[0]
                : '';
    const series = useSeries(rawId);

    const [seasonIndex, setSeasonIndex] = useState(0);
    const { width } = useWindowDimensions();

    const seasonCount = series?.seasons.length ?? 0;
    const season = series?.seasons[
        Math.min(seasonIndex, Math.max(0, seasonCount - 1))
    ];

    const cellWidth =
        (Math.min(width, 760) - 24 * 2 - GRID_GAP) / 2;

    const openEpisode = (s: number, e: number) =>
        router.push({
            pathname: '/watch/[id]',
            params: { id: rawId, s: String(s), e: String(e) },
        });

    const handleRemove = () => {
        if (!series) return;
        removeSeries(series.id);
        router.back();
    };

    const genreChips = useMemo(() => series?.genres ?? [], [series?.genres]);

    if (!series) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={styles.empty}>
                    <Ionicons name="film-outline" size={40} color="#4a4a4a" />
                    <Text style={styles.emptyTitle}>Series not found</Text>
                    <Text style={styles.emptySub}>
                        It may have been removed from your library.
                    </Text>
                    <Pressable style={styles.emptyBtn} onPress={() => router.back()}>
                        <Text style={styles.emptyBtnText}>Go back</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingTop: Platform.OS === 'web' ? WEB_TOP_PAD : 24,
                        paddingBottom: 90,
                    },
                ]}
            >
                <View style={styles.heroWrap}>
                    {series.banner ? (
                        <SafeImage
                            source={{ uri: series.banner }}
                            style={styles.heroBanner}
                            blurRadius={8}
                            hideOnError
                        />
                    ) : null}
                    <View style={styles.heroDim} />

                    <View style={styles.heroRow}>
                        <SafeImage
                            source={{ uri: series.poster || series.banner || '' }}
                            style={styles.poster}
                            fallbackLabel={series.name}
                        />
                        <View style={styles.heroInfo}>
                            <View style={styles.providerChip}>
                                <Ionicons name="tv" size={12} color="#E50914" />
                                <Text style={styles.providerChipText}>
                                    {providerLabel(series)}
                                </Text>
                            </View>
                            <Text style={styles.seriesTitle} numberOfLines={3}>
                                {series.name}
                            </Text>
                            <Text style={styles.seriesMeta}>
                                {[
                                    series.year,
                                    `${seasonCount} Season${seasonCount > 1 ? 's' : ''}`,
                                    `${totalEpisodeCount(series)} Episodes`,
                                    series.imdbId,
                                ]
                                    .filter(Boolean)
                                    .join('  ·  ')}
                            </Text>
                            {genreChips.length ? (
                                <View style={styles.genreRow}>
                                    {genreChips.slice(0, 6).map(g => (
                                        <View key={g} style={styles.genreChip}>
                                            <Text style={styles.genreChipText}>
                                                {g}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                            {series.description ? (
                                <Text style={styles.description} numberOfLines={4}>
                                    {series.description}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                </View>

                <View style={styles.actions}>
                    <Pressable
                        style={({ hovered }: any) => [
                            styles.actionBtn,
                            hovered && styles.actionBtnHover,
                        ]}
                        onPress={() => {
                            const first = season?.episodes[0];
                            if (first && season) openEpisode(season.number, first.number);
                        }}
                    >
                        <Ionicons name="play" size={17} color="#000" />
                        <Text style={styles.actionBtnText}>Play</Text>
                    </Pressable>
                    <Pressable
                        style={({ hovered }: any) => [
                            styles.actionGhost,
                            hovered && styles.actionGhostHover,
                        ]}
                        onPress={handleRemove}
                    >
                        <Ionicons name="trash-outline" size={16} color="#fff" />
                        <Text style={styles.actionGhostText}>Remove</Text>
                    </Pressable>
                </View>

                {seasonCount > 1 ? (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.seasonPicker}
                        contentContainerStyle={styles.seasonPickerContent}
                    >
                        {series.seasons.map((s, i) => (
                            <Pressable
                                key={s.number}
                                style={({ hovered }: any) => [
                                    styles.seasonChip,
                                    i === seasonIndex && styles.seasonChipActive,
                                    i !== seasonIndex &&
                                        hovered && styles.seasonChipHover,
                                ]}
                                onPress={() => setSeasonIndex(i)}
                                accessibilityLabel={`Season ${s.number}`}
                            >
                                <Text
                                    style={[
                                        styles.seasonChipText,
                                        i === seasonIndex &&
                                            styles.seasonChipTextActive,
                                    ]}
                                >
                                    {s.name ? `S${s.number} · ${s.name}` : `S${s.number}`}
                                </Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                ) : null}

                <Text style={styles.episodesTitle}>
                    {season?.name
                        ? `Season ${season.number} — ${season.name}`
                        : `Season ${season?.number ?? 1}`}
                </Text>

                <View style={styles.grid}>
                    {season?.episodes.map(ep => (
                        <Pressable
                            key={`${season?.number}-${ep.number}`}
                            style={({ hovered }: any) => [
                                styles.epCard,
                                { width: cellWidth },
                                hovered && styles.epCardHover,
                            ]}
                            onPress={() => {
                                if (season) openEpisode(season.number, ep.number);
                            }}
                        >
                            <View style={styles.epArt}>
                                {ep.thumbnail ? (
                                    <SafeImage
                                        source={{ uri: ep.thumbnail }}
                                        style={styles.epThumb}
                                        fallbackLabel={`E${ep.number}`}
                                    />
                                ) : (
                                    <View style={styles.epThumbFallback}>
                                        <Ionicons
                                            name="play-circle-outline"
                                            size={34}
                                            color="#4a4a4a"
                                        />
                                        <Text style={styles.epThumbFallbackText}>
                                            E{ep.number}
                                        </Text>
                                    </View>
                                )}
                                <View style={styles.epNumberBadge}>
                                    <Text style={styles.epNumberBadgeText}>
                                        {ep.number}
                                    </Text>
                                </View>
                            </View>
                            <Text style={styles.epTitle} numberOfLines={2}>
                                E{ep.number}
                                {ep.title && ep.title !== `Episode ${ep.number}`
                                    ? ` · ${ep.title}`
                                    : ''}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                <Text style={styles.footerNote}>
                    Embedded via {providerLabel(series)} · if an episode is
                    down, use "Switch player" inside the player to retry on
                    the other host.
                </Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    content: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        paddingHorizontal: 24,
    },
    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 32,
    },
    emptyTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '800',
    },
    emptySub: {
        color: '#9a9a9a',
        fontSize: 13,
    },
    emptyBtn: {
        backgroundColor: '#fff',
        borderRadius: 999,
        paddingHorizontal: 20,
        paddingVertical: 10,
        marginTop: 10,
    },
    emptyBtnText: {
        color: '#000',
        fontSize: 13,
        fontWeight: '800',
    },
    heroWrap: {
        overflow: 'hidden',
        borderRadius: 16,
        backgroundColor: '#111',
        marginTop: 8,
    },
    heroBanner: {
        width: '100%',
        height: 260,
    },
    heroDim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    heroRow: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 14,
        flexDirection: 'row',
        gap: 14,
    },
    poster: {
        width: 118,
        aspectRatio: 2 / 3,
        borderRadius: 10,
        backgroundColor: '#222',
    },
    heroInfo: {
        flex: 1,
        justifyContent: 'flex-end',
        gap: 7,
    },
    providerChip: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap: 5,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 4,
    },
    providerChipText: {
        color: '#fff',
        fontSize: 10.5,
        fontWeight: '700',
    },
    seriesTitle: {
        color: '#fff',
        fontSize: 24,
        fontWeight: '900',
        lineHeight: 29,
        textShadowColor: 'rgba(0,0,0,0.8)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    seriesMeta: {
        color: '#d5d5d5',
        fontSize: 12,
        fontWeight: '600',
    },
    genreRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    genreChip: {
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 3,
    },
    genreChipText: {
        color: '#eee',
        fontSize: 10.5,
        fontWeight: '700',
    },
    description: {
        color: '#c9c9c9',
        fontSize: 12,
        lineHeight: 17,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 18,
    },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        backgroundColor: '#fff',
        borderRadius: 999,
        paddingHorizontal: 22,
        paddingVertical: 11,
    },
    actionBtnHover: {
        backgroundColor: '#e5e5e5',
    },
    actionBtnText: {
        color: '#000',
        fontSize: 14,
        fontWeight: '800',
    },
    actionGhost: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        paddingHorizontal: 16,
        paddingVertical: 11,
    },
    actionGhostHover: {
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    actionGhostText: {
        color: '#e5e5e5',
        fontSize: 13,
        fontWeight: '700',
    },
    seasonPicker: {
        marginTop: 18,
    },
    seasonPickerContent: {
        gap: 8,
        paddingRight: 8,
    },
    seasonChip: {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 8,
        flexShrink: 0,
    },
    seasonChipHover: {
        backgroundColor: 'rgba(255,255,255,0.14)',
    },
    seasonChipActive: {
        backgroundColor: '#fff',
    },
    seasonChipText: {
        color: '#e5e5e5',
        fontSize: 12.5,
        fontWeight: '700',
    },
    seasonChipTextActive: {
        color: '#000',
    },
    episodesTitle: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '800',
        marginTop: 18,
        marginBottom: 10,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: GRID_GAP,
        rowGap: GRID_GAP,
    },
    epCard: {
        marginBottom: 2,
    },
    epCardHover: {
        transform: [{ scale: 1.02 }],
        zIndex: 10,
    },
    epArt: {
        width: '100%',
        aspectRatio: 16 / 9,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#1b1b1b',
    },
    epThumb: {
        width: '100%',
        height: '100%',
    },
    epThumbFallback: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    epThumbFallbackText: {
        color: '#6f6f6f',
        fontSize: 13,
        fontWeight: '800',
    },
    epNumberBadge: {
        position: 'absolute',
        right: 6,
        bottom: 6,
        backgroundColor: 'rgba(0,0,0,0.72)',
        borderRadius: 5,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    epNumberBadgeText: {
        color: '#fff',
        fontSize: 10.5,
        fontWeight: '800',
    },
    epTitle: {
        color: '#dcdcdc',
        fontSize: 11.5,
        fontWeight: '600',
        marginTop: 6,
        lineHeight: 15,
    },
    footerNote: {
        color: '#6f6f6f',
        fontSize: 11,
        marginTop: 22,
        lineHeight: 16,
    },
});
