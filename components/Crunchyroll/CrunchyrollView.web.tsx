import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EXIT_CHIP_HEIGHT, exitChipPosition } from './exitChip';

/** Rough chip width + gap: used only to detect an off-screen placement. */
const EXIT_CHIP_FALLBACK_SPAN = 150;

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
 * Crunchyroll opened; the exit chip is the way back.
 *
 * The chip sits *inside* the page's own nav row, right after "Request" —
 * mirroring the Crunchyroll entry that sits beside My List in the app's
 * navbar. The iframe is same-origin, so the page's Request button is measured
 * and the chip follows it (and follows resizes).
 */
export function CrunchyrollView(): React.JSX.Element {
    const router = useRouter();
    const [loaded, setLoaded] = useState(false);
    const frameRef = useRef<any>(null);
    const [exitPos, setExitPos] = useState<{ left: number; top: number } | null>(null);

    // Place the exit chip right after the demo page's "Request" nav item.
    // Falls back to the old top-left corner whenever the page is not readable.
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const measure = () => {
            const frame = frameRef.current as HTMLIFrameElement | null;
            try {
                const doc = frame && frame.contentDocument;
                const anchor = doc && (doc.querySelector('[data-scroll="requestAnime"]') as HTMLElement | null);
                if (!frame || !anchor) return;
                const frameRect = frame.getBoundingClientRect();
                const navRect = anchor.getBoundingClientRect();
                // Small screens can push "Request" past the right edge; the chip
                // must stay reachable, so keep the corner fallback then.
                if (frameRect.left + navRect.right + EXIT_CHIP_FALLBACK_SPAN > frameRect.right) {
                    setExitPos(null);
                    return;
                }
                setExitPos(exitChipPosition(frameRect, navRect));
            } catch {
                // Cross-origin or not ready yet: keep the default corner.
            }
        };
        measure();
        const timers = [120, 480, 1200].map((ms) => window.setTimeout(measure, ms));
        window.addEventListener('resize', measure);
        const fonts = (document as any).fonts;
        if (fonts && fonts.ready && typeof fonts.ready.then === 'function') {
            fonts.ready.then(measure).catch(() => {});
        }
        return () => {
            timers.forEach((id) => window.clearTimeout(id));
            window.removeEventListener('resize', measure);
        };
    }, [loaded]);

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
                ref: frameRef,
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

            {/* Exit chip: sits in the page's nav row, right after "Request" */}
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
                    exitPos,
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
        // Default spot until the Request item has been measured.
        top: 14,
        left: 14,
        height: EXIT_CHIP_HEIGHT,
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
