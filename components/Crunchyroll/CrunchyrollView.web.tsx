import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { EXIT_CHIP_HEIGHT, exitChipPosition } from './exitChip';

/** Rough wordmark width + gap: used only to detect an off-screen placement. */
const EXIT_CHIP_FALLBACK_SPAN = 150;

/** Never leave the exit unreachable: show it after this long, measured or not. */
const EXIT_READY_TIMEOUT = 700;

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
    const [exitReady, setExitReady] = useState(false);

    // Place the exit chip right after the demo page's "Request" nav item.
    // Falls back to the old top-left corner whenever the page is not readable.
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const measure = () => {
            setExitReady(true);
            const frame = frameRef.current as HTMLIFrameElement | null;
            try {
                const doc = frame && frame.contentDocument;
                const win = frame && (frame.contentWindow as (Window & typeof globalThis) | null);
                const anchor = doc && (doc.querySelector('[data-scroll="requestAnime"]') as HTMLElement | null);
                if (!frame || !anchor) return;
                const frameRect = frame.getBoundingClientRect();
                const navRect = anchor.getBoundingClientRect();
                // Small screens can push "Request" past the right edge; the
                // wordmark must stay reachable, so keep the corner then.
                if (frameRect.left + navRect.right + EXIT_CHIP_FALLBACK_SPAN > frameRect.right) {
                    setExitPos(null);
                    return;
                }
                // Document space: the control is drawn fixed, so measuring with
                // the page's scroll offset means it never moves afterwards.
                setExitPos(
                    exitChipPosition(frameRect, navRect, {
                        x: win ? win.scrollX : 0,
                        y: win ? win.scrollY : 0,
                    }),
                );
            } catch {
                // Cross-origin or not ready yet: the corner fallback stays.
            }
        };
        measure();
        const timers = [120, 480, EXIT_READY_TIMEOUT].map((ms) => window.setTimeout(measure, ms));
        // Only layout changes re-measure — never scroll, so the wordmark is stable.
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

            {/* Exit wordmark: sits in the page's nav row, right after "Request",
                and stays put while the page scrolls. */}
            {exitReady && (
                <Pressable
                    onPress={() => router.back()}
                    tabIndex={0}
                    accessibilityRole="button"
                    accessibilityLabel="Back to Netflix"
                    title="Back to Netflix"
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
                    <Text style={styles.backPillText}>NETFLIX</Text>
                </Pressable>
            )}
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
        // Fixed: neither the page's own scrolling nor the shell can move it.
        position: 'fixed',
        // Corner fallback until the Request item has been measured.
        top: 14,
        left: 14,
        height: EXIT_CHIP_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.92,
        zIndex: 10,
        ...(Platform.select({
            web: { cursor: 'pointer', transition: 'opacity 0.2s ease' },
            default: {},
        }) as any),
    },
    backPillHover: {
        opacity: 1,
    },
    // Same wordmark as the app navbar logo (components/WebNavBar.tsx).
    backPillText: {
        color: '#E50914',
        fontSize: 22,
        fontWeight: '900',
        letterSpacing: 1.2,
    },
});
