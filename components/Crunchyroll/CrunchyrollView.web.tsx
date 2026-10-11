import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

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
 * Crunchyroll opened.
 *
 * The way back lives *inside* the page: a red NETFLIX wordmark in the page's
 * own nav, right after "Request" (mirroring how the Crunchyroll entry sits
 * beside My List in the app navbar). The page's nav is sticky, so the wordmark
 * can never drift with the content — no overlay, no measuring.
 *
 * The page cannot reach the router itself, so it talks to this view over
 * postMessage (same-origin): "exit" goes back to Netflix.
 *
 * Fullscreen needs no help from here: the AnimaHD tab runs unsandboxed, so the
 * player's own fullscreen control works and the page's layout never changes —
 * which is why coming back from fullscreen never leaves a white video.
 */
export function CrunchyrollView(): React.JSX.Element {
    const router = useRouter();
    const [loaded, setLoaded] = useState(false);

    // The page cannot reach the router itself, so it asks us (same-origin
    // postMessage) to leave to Netflix.
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const onMessage = (event: MessageEvent) => {
            const data = event?.data;
            if (data && typeof data === 'object' && data.type === 'crunchyroll:exit') {
                router.back();
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [router]);

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
    }
});
