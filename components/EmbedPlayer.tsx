import React, { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Third-party iframe embed player.
 *
 * HARD RULES:
 *   - NO `sandbox` attribute (Nxsha refuses sandboxed frames).
 *   - NO contentWindow/document access (cross-origin → SecurityError).
 *   - NO postMessage listeners — providers don't emit them.
 *   - Player MUST open after a user click — never auto-open.
 */

export interface EmbedPlayerProps {
    src: string;
    title?: string;
    onClose?: () => void;
    onSwitchProvider?: () => void;
    onNextEpisode?: () => void;
    onPrevEpisode?: () => void;
    isTv?: boolean;
    timeoutMs?: number;
}

const IS_WEB = Platform.OS === 'web';

export function EmbedPlayer({
    src,
    title,
    onClose,
    onSwitchProvider,
    onNextEpisode,
    onPrevEpisode,
    isTv,
    timeoutMs = 12000,
}: EmbedPlayerProps) {
    const [loading, setLoading] = useState(true);
    const [timedOut, setTimedOut] = useState(false);
    const hostRef = useRef<View | HTMLDivElement | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setLoading(true);
        setTimedOut(false);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            setTimedOut(true);
            setLoading(false);
        }, timeoutMs);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [src, timeoutMs]);

    // Mount the iframe imperatively into the host DOM node so we avoid
    // React Native Web's wrapping/transform issues with createElement('iframe').
    useEffect(() => {
        if (!IS_WEB) return;
        const host = hostRef.current as unknown as HTMLElement | null;
        if (!host) return;
        host.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.setAttribute('data-arena-embed', '1');
        iframe.src = src;
        iframe.title = title ?? 'Video player';
        iframe.setAttribute(
            'allow',
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
        );
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        iframe.style.position = 'absolute';
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.backgroundColor = '#000';
        iframe.onload = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            setLoading(false);
            setTimedOut(false);
        };
        host.appendChild(iframe);
        iframeRef.current = iframe;
        return () => {
            killIframe();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, title]);

    /**
     * Kill the playing iframe HARD: navigating it to about:blank tears down
     * the embed's document (and any playing media/audio) immediately, then we
     * remove the node. Without the about:blank step some providers keep audio
     * alive in the background after the player is "closed".
     */
    const killIframe = useCallback(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        try { iframe.onload = null; } catch {}
        try { iframe.src = 'about:blank'; } catch {}
        try { iframe.remove(); } catch {}
        iframeRef.current = null;
    }, []);

    // Safety net: no matter how this component leaves the tree, media stops.
    useEffect(() => () => killIframe(), [killIframe]);

    const handleClose = useCallback(() => {
        killIframe();
        onClose?.();
    }, [killIframe, onClose]);

    const openInNewTab = () => {
        if (IS_WEB) {
            try { window.open(src, '_blank', 'noopener'); } catch {}
        } else {
            Linking.openURL(src).catch(() => {});
        }
    };

    if (!IS_WEB) {
        return (
            <View style={styles.nativeFallback}>
                <Ionicons name="play-circle-outline" size={56} color="#E50914" />
                <Text style={styles.nativeTitle}>{title ?? 'Video player'}</Text>
                <Text style={styles.nativeHint}>
                    Embedded player is available in the web preview. Tap below to open in your browser.
                </Text>
                <Pressable style={styles.nativeButton} onPress={openInNewTab}>
                    <Ionicons name="open-outline" size={18} color="#000" />
                    <Text style={styles.nativeButtonText}>Open Player</Text>
                </Pressable>
                {onClose ? (
                    <Pressable onPress={handleClose} style={styles.nativeGhostButton}>
                        <Text style={styles.nativeGhostText}>Close</Text>
                    </Pressable>
                ) : null}
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View
                ref={(r: any) => { hostRef.current = r; }}
                style={styles.frameWrap}
                collapsable={false}
            />

            {loading && !timedOut ? (
                <View style={styles.loadingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.loadingText}>Loading player…</Text>
                </View>
            ) : null}

            {timedOut ? (
                <View style={styles.timeoutOverlay}>
                    <Ionicons name="alert-circle-outline" size={36} color="#fff" />
                    <Text style={styles.timeoutTitle}>Player abhi load nahi hua</Text>
                    <Text style={styles.timeoutText}>
                        Ad-block ya popup blocker ne embed roka hoga. Naya tab me khol ke dekho, ya dusra player try karo.
                    </Text>
                    <Pressable style={styles.openButton} onPress={openInNewTab}>
                        <Ionicons name="open-outline" size={16} color="#000" />
                        <Text style={styles.openButtonText}>Open in new tab</Text>
                    </Pressable>
                    {onSwitchProvider ? (
                        <Pressable style={styles.ghostButton} onPress={onSwitchProvider}>
                            <Ionicons name="swap-horizontal" size={16} color="#fff" />
                            <Text style={styles.ghostButtonText}>Switch player</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}

            <View style={styles.topBar} pointerEvents="box-none">
                <Pressable style={styles.iconButton} onPress={handleClose} accessibilityLabel="Close player">
                    <Ionicons name="close" size={22} color="#fff" />
                </Pressable>
                <View style={{ flex: 1 }} />
                {onSwitchProvider ? (
                    <Pressable style={styles.iconButton} onPress={onSwitchProvider} accessibilityLabel="Switch player provider">
                        <Ionicons name="swap-horizontal" size={20} color="#fff" />
                    </Pressable>
                ) : null}
                <Pressable style={styles.iconButton} onPress={openInNewTab} accessibilityLabel="Open in new tab">
                    <Ionicons name="open-outline" size={20} color="#fff" />
                </Pressable>
            </View>

            {isTv && onNextEpisode ? (
                <View style={styles.episodeBar}>
                    <Pressable
                        style={[styles.epButton, !onPrevEpisode && styles.epButtonDisabled]}
                        disabled={!onPrevEpisode}
                        onPress={onPrevEpisode}
                    >
                        <Ionicons name="play-skip-back" size={18} color={onPrevEpisode ? '#fff' : '#666'} />
                        <Text style={[styles.epButtonText, !onPrevEpisode && { color: '#666' }]}>Prev</Text>
                    </Pressable>
                    <Pressable style={styles.epButton} onPress={onNextEpisode}>
                        <Text style={styles.epButtonText}>Next Episode</Text>
                        <Ionicons name="play-skip-forward" size={18} color="#fff" />
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000', position: 'relative' },
    frameWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
    topBar: {
        position: 'absolute', top: 0, left: 0, right: 0,
        paddingHorizontal: 12, paddingTop: 12,
        flexDirection: 'row', alignItems: 'center', zIndex: 2,
    },
    iconButton: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center', justifyContent: 'center', marginLeft: 8,
    },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)', gap: 14,
    },
    loadingText: { color: '#ccc', fontSize: 13 },
    timeoutOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.88)', padding: 24, gap: 12,
    },
    timeoutTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
    timeoutText: { color: '#b3b3b3', fontSize: 13, textAlign: 'center', maxWidth: 360, lineHeight: 18 },
    openButton: {
        marginTop: 8, backgroundColor: '#fff',
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 18, paddingVertical: 10, borderRadius: 6,
    },
    openButtonText: { color: '#000', fontWeight: '700', fontSize: 13 },
    ghostButton: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', marginTop: 6,
    },
    ghostButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    episodeBar: {
        position: 'absolute', bottom: 16, left: 16, right: 16,
        flexDirection: 'row', justifyContent: 'space-between', zIndex: 2,
    },
    epButton: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    },
    epButtonDisabled: { opacity: 0.6 },
    epButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    nativeFallback: {
        flex: 1, backgroundColor: '#000',
        alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14,
    },
    nativeTitle: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
    nativeHint: { color: '#9a9a9a', fontSize: 13, textAlign: 'center', lineHeight: 18 },
    nativeButton: {
        marginTop: 10, backgroundColor: '#fff',
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 22, paddingVertical: 12, borderRadius: 6,
    },
    nativeButtonText: { color: '#000', fontWeight: '700', fontSize: 14 },
    nativeGhostButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10 },
    nativeGhostText: { color: '#b3b3b3', fontSize: 13 },
});
