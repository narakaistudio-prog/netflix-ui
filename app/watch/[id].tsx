import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SeriesEmbedPlayer } from '@/components/SeriesEmbedPlayer';
import { useSeries } from '@/hooks/useMySeries';
import {
    buildEmbedUrl,
    fallbackProvider,
    providerLabel,
    resolveTemplate,
} from '@/services/embedProviders';

/**
 * Fullscreen episode player.
 *
 * Route: /watch/{seriesId}?s={season}&e={episode}
 *
 * The embed URL was generated when the series was added ({id}/{s}/{e}
 * string-replaced into the provider template) and is stored per episode.
 * "Switch player" swaps to the other preset for the SAME id/s/e as a
 * fallback — that's the only interaction with the cross-origin iframe;
 * playback state is never read from it.
 */
export default function WatchScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ id?: string; s?: string; e?: string }>();

    const rawId =
        typeof params.id === 'string'
            ? params.id
            : Array.isArray(params.id)
                ? params.id[0]
                : '';
    const seasonNum = Math.max(1, Math.floor(Number(params.s ?? 1)) || 1);
    const episodeNum = Math.max(1, Math.floor(Number(params.e ?? 1)) || 1);

    const series = useSeries(rawId);
    const [slot, setSlot] = useState<'primary' | 'fallback'>('primary');

    if (!series) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={styles.empty}>
                    <Ionicons name="videocam-off-outline" size={40} color="#4a4a4a" />
                    <Text style={styles.emptyTitle}>Series not found</Text>
                    <Pressable style={styles.emptyBtn} onPress={() => router.back()}>
                        <Text style={styles.emptyBtnText}>Go back</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    const season =
        series.seasons.find(s => s.number === seasonNum) ?? series.seasons[0];
    const episode =
        season?.episodes.find(e => e.number === episodeNum) ??
        season?.episodes[0];

    const s = season?.number ?? seasonNum;
    const e = episode?.number ?? episodeNum;

    const coords = { id: series.imdbId, s, e };
    const primaryUrl =
        episode?.embedUrl ?? buildEmbedUrl(resolveTemplate(series), coords);
    const otherProvider = fallbackProvider(series);
    const fallbackUrl = buildEmbedUrl(otherProvider.template, coords);

    const usingPrimary = slot === 'primary';
    const src = usingPrimary ? primaryUrl : fallbackUrl;
    const activeLabel = usingPrimary ? providerLabel(series) : otherProvider.name;
    const switchToLabel = usingPrimary
        ? otherProvider.name
        : providerLabel(series);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />
            <SeriesEmbedPlayer
                src={src}
                title={`${series.name} — S${s}E${e}`}
                providerLabel={activeLabel}
                switchToLabel={switchToLabel}
                onSwitchProvider={() =>
                    setSlot(v => (v === 'primary' ? 'fallback' : 'primary'))
                }
                onClose={() => router.back()}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    emptyTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '800',
        marginTop: 8,
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
});
