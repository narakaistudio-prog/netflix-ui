import React, { createElement, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const IS_WEB = Platform.OS === 'web';

interface SeriesEmbedPlayerProps {
    /** The embed URL to render (already has {id}/{s}/{e} replaced). */
    src: string;
    /** Accessible/SEO title, e.g. "Frieren — S2E5". */
    title: string;
    /** Provider currently active, e.g. "Nxsha (Hindi)". */
    providerLabel: string;
    /** Provider the "Switch player" button would switch TO. */
    switchToLabel: string;
    onSwitchProvider: () => void;
    onClose?: () => void;
}

/**
 * Renders a cross-origin episode embed in an <iframe>.
 *
 * PROVEN-TO-WORK attribute set (do not "improve" it):
 *   - allow="accelerometer; autoplay; clipboard-write; encrypted-media;
 *            gyroscope; picture-in-picture; fullscreen"
 *   - allowFullScreen
 *   - referrerPolicy="no-referrer-when-downgrade"
 *   - NO `sandbox` attribute — sandboxing breaks these players.
 *
 * The iframe is cross-origin: we NEVER read playback state from it (no
 * postMessage tracking). We just render it, plus a dismissable hint for the
 * first-click popup Nxsha may show, and a "Switch player" fallback button.
 *
 * Native platforms have no <iframe>, so the URL is opened in the browser.
 */
export function SeriesEmbedPlayer({
    src,
    title,
    providerLabel,
    switchToLabel,
    onSwitchProvider,
    onClose,
}: SeriesEmbedPlayerProps) {
    const [showHint, setShowHint] = useState(true);

    // The hint is most relevant right when an episode starts; keep it
    // brief so it never annoys, and always dismissable.
    useEffect(() => {
        setShowHint(true);
        const timer = setTimeout(() => setShowHint(false), 15000);
        return () => clearTimeout(timer);
    }, [src]);

    if (!IS_WEB) {
        return (
            <View style={styles.container}>
                <View style={styles.nativeCard}>
                    <Ionicons name="tv-outline" size={34} color="#E50914" />
                    <Text style={styles.nativeTitle}>{title}</Text>
                    <Text style={styles.nativeSub}>
                        Playing via {providerLabel}
                    </Text>
                    <Text style={styles.nativeNote}>
                        Iframes only work on the web build. On this device the
                        episode opens in your browser instead.
                    </Text>
                    <Pressable
                        style={styles.nativeOpen}
                        onPress={() => Linking.openURL(src)}
                    >
                        <Ionicons name="open-outline" size={18} color="#000" />
                        <Text style={styles.nativeOpenText}>Open in browser</Text>
                    </Pressable>
                    <Pressable
                        style={styles.nativeSwitch}
                        onPress={onSwitchProvider}
                    >
                        <Ionicons name="swap-horizontal" size={16} color="#fff" />
                        <Text style={styles.nativeSwitchText}>
                            Switch player ({switchToLabel})
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {createElement('iframe', {
                // Remount the player whenever the URL changes (episode or
                // provider) so the embedded player starts clean.
                key: src,
                src,
                title,
                style: {
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    display: 'block',
                    backgroundColor: '#000',
                },
                allow:
                    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
                allowFullScreen: true,
                referrerPolicy: 'no-referrer-when-downgrade',
                // Note: deliberately NO sandbox attribute — it breaks the
                // Nxsha/NHD players.
            })}

            {/* Controls overlay — pointerEvents pass through to the iframe
                except on the buttons themselves. */}
            <View style={styles.overlay} pointerEvents="box-none">
                <View style={styles.topFade} pointerEvents="none">
                    <LinearGradient
                        colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
                        locations={[0, 1]}
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                <View style={styles.topRow} pointerEvents="box-none">
                    <Pressable
                        style={({ hovered }: any) => [
                            styles.closeButton,
                            hovered && styles.closeButtonHover,
                        ]}
                        onPress={onClose}
                        accessibilityLabel="Close player"
                    >
                        <Ionicons name="close" size={22} color="#fff" />
                    </Pressable>

                    <View style={styles.topRight} pointerEvents="box-none">
                        <View style={styles.providerBadge}>
                            <Ionicons name="tv" size={11} color="#E50914" />
                            <Text style={styles.providerBadgeText}>
                                {providerLabel}
                            </Text>
                        </View>
                        <Pressable
                            style={({ hovered }: any) => [
                                styles.switchButton,
                                hovered && styles.switchButtonHover,
                            ]}
                            onPress={onSwitchProvider}
                            accessibilityLabel={`Switch player to ${switchToLabel}`}
                        >
                            <Ionicons name="swap-horizontal" size={14} color="#fff" />
                            <Text style={styles.switchButtonText}>
                                Switch player · {switchToLabel}
                            </Text>
                        </Pressable>
                    </View>
                </View>

                {showHint ? (
                    <View style={styles.hint} pointerEvents="auto">
                        <Ionicons name="alert-circle-outline" size={14} color="#FFC107" />
                        <Text style={styles.hintText}>
                            Popup aaye to close karke video par dobara click karo
                        </Text>
                        <Pressable
                            style={styles.hintClose}
                            onPress={() => setShowHint(false)}
                            accessibilityLabel="Dismiss hint"
                        >
                            <Ionicons name="close" size={12} color="#bbb" />
                        </Pressable>
                    </View>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        overflow: 'hidden',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
    },
    topFade: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 84,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 14,
        paddingHorizontal: 14,
    },
    topRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeButtonHover: {
        backgroundColor: 'rgba(0,0,0,0.8)',
    },
    providerBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    providerBadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
    },
    switchButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(229,9,20,0.9)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    switchButtonHover: {
        backgroundColor: '#E50914',
    },
    switchButtonText: {
        color: '#fff',
        fontSize: 11.5,
        fontWeight: '700',
    },
    hint: {
        position: 'absolute',
        bottom: 18,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: 'rgba(0,0,0,0.78)',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,193,7,0.35)',
        maxWidth: '88%',
        ...Platform.select({
            web: { boxShadow: '0 6px 20px rgba(0,0,0,0.5)' } as any,
            default: {
                shadowColor: '#000',
                shadowOpacity: 0.5,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 3 },
                elevation: 6,
            } as any,
        }),
    },
    hintText: {
        color: '#ffd76a',
        fontSize: 12,
        fontWeight: '600',
        flexShrink: 1,
    },
    hintClose: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: 'rgba(255,255,255,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    nativeCard: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 28,
        backgroundColor: '#000',
    },
    nativeTitle: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '800',
        textAlign: 'center',
    },
    nativeSub: {
        color: '#E50914',
        fontSize: 13,
        fontWeight: '700',
    },
    nativeNote: {
        color: '#9a9a9a',
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center',
    },
    nativeOpen: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: '#fff',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 10,
        marginTop: 10,
    },
    nativeOpenText: {
        color: '#000',
        fontSize: 13,
        fontWeight: '800',
    },
    nativeSwitch: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    nativeSwitchText: {
        color: '#e5e5e5',
        fontSize: 12.5,
        fontWeight: '700',
    },
});
