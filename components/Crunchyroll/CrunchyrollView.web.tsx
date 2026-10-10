import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Static URL of the self-contained Crunchyroll OTT demo page.
 *
 * In web dev the Metro server serves project files at root-relative paths
 * (same mechanism as /assets/posters/...), and `expo export` output gets
 * this file copied into dist by scripts/prepare-web-dist.mjs.
 */
export const CRUNCHYROLL_HTML_URL = '/assets/crunchyroll/crunchyroll.html';

/**
 * Web: the Crunchyroll OTT experience, full-screen in an iframe.
 *
 * Same-origin, scripts enabled, no sandbox — the demo page needs JS +
 * localStorage (My List / continue-watching state). The Netflix chrome
 * (WebNavBar) hides itself on /crunchyroll so it genuinely feels like
 * Crunchyroll opened; the floating pill is the way back.
 */
export function CrunchyrollView(): React.JSX.Element {
    const router = useRouter();
    const [loaded, setLoaded] = useState(false);

    // Immersion: the browser tab itself reads "Crunchyroll" while mounted.
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return;
        const previous = document.title;
        document.title = 'Crunchyroll — Watch Anime';
        return () => {
            document.title = previous || 'Netflix';
        };
    }, []);

    return (
        <View style={styles.container}>
            {React.createElement('iframe', {
                src: CRUNCHYROLL_HTML_URL,
                title: 'Crunchyroll',
                onLoad: () => setLoaded(true),
                allow: 'fullscreen; autoplay; encrypted-media; picture-in-picture',
                allowFullScreen: true,
                style: {
                    width: '100%',
                    height: '100%',
                    borderWidth: 0,
                    backgroundColor: '#000',
                },
            } as any)}

            {!loaded && (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color="#f47521" />
                    <Text style={styles.loaderText}>Loading Crunchyroll…</Text>
                </View>
            )}

            {/* Floating exit back to Netflix */}
            <Pressable
                onPress={() => router.back()}
                tabIndex={0}
                accessibilityRole="button"
                accessibilityLabel="Back to Netflix"
                {...({
                    dataSet: {
                        tvFocusable: 'true',
                        tvRow: 'crunchyroll-top',
                        tvId: 'crunchyroll-back',
                    },
                } as any)}
                style={({ hovered }: any) => [
                    styles.backPill,
                    hovered && styles.backPillHover,
                ]}
            >
                <Ionicons name="arrow-back" size={16} color="#fff" />
                <Text style={styles.backPillText}>Netflix</Text>
                <View style={styles.backPillDot} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        position: 'relative',
    },
    loader: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        pointerEvents: 'none',
    },
    loaderText: {
        color: '#f47521',
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: 0.4,
    },
    backPill: {
        position: 'absolute',
        top: 14,
        left: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(244, 117, 33, 0.65)',
        opacity: 0.92,
        zIndex: 10,
        ...(Platform.select({
            web: { cursor: 'pointer', transition: 'opacity 0.2s ease, transform 0.2s ease' },
            default: {},
        }) as any),
    },
    backPillHover: {
        opacity: 1,
        ...(Platform.select({
            web: { transform: 'translateY(-1px)' },
            default: {},
        }) as any),
    },
    backPillText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    backPillDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: '#f47521',
    },
});
