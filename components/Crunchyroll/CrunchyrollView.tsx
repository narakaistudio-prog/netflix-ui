import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAssets } from 'expo-asset';

// Metro bundles the demo page as a local .html asset (see metro.config.js),
// so the native WebView loads it from disk — no network needed.
const CRUNCHYROLL_HTML = require('@/assets/crunchyroll/crunchyroll.html');

/**
 * Native (iOS / Android): the Crunchyroll OTT experience full-screen in a
 * WebView, loaded from the bundled self-contained demo page.
 */
export function CrunchyrollView(): React.JSX.Element {
    const [assets, error] = useAssets([CRUNCHYROLL_HTML]);
    const [pageLoaded, setPageLoaded] = useState(false);

    const uri = assets?.[0]?.localUri ?? assets?.[0]?.uri;

    if (error) {
        return (
            <View style={styles.center}>
                <Text style={styles.brand}>
                    crunchy<Text style={styles.brandAccent}>roll</Text>
                </Text>
                <Text style={styles.errorText}>
                    Couldn&apos;t load the Crunchyroll experience. Please try again.
                </Text>
            </View>
        );
    }

    if (!uri) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#f47521" />
                <Text style={styles.loaderText}>Loading Crunchyroll…</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <WebView
                source={{ uri }}
                originWhitelist={['*']}
                javaScriptEnabled
                domStorageEnabled
                allowFileAccess
                allowingReadAccessToURL={uri}
                allowsFullscreenVideo
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                startInLoadingState={false}
                onLoadEnd={() => setPageLoaded(true)}
                style={styles.webview}
            />
            {!pageLoaded && (
                <View style={styles.loaderOverlay} pointerEvents="none">
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
    },
    webview: {
        flex: 1,
        backgroundColor: '#000',
    },
    center: {
        flex: 1,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        paddingHorizontal: 32,
    },
    loaderOverlay: {
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
    brand: {
        color: '#fff',
        fontSize: 28,
        fontWeight: '900',
        letterSpacing: -1,
    },
    brandAccent: {
        color: '#f47521',
    },
    errorText: {
        color: '#a9abb0',
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
});
