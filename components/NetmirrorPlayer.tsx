import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MovieboxDirectPlayer } from './MovieboxDirectPlayer';
import {
    fetchNetmirrorStreams,
    NETMIRROR_LABEL,
    netmirrorTmdbNumber,
    type NetmirrorResult,
} from '@/lib/netmirror';
import type { DirectStream } from '@/lib/movieboxDirect';

/**
 * "NetMirror" server ka player — apna `<video>`, koi iframe nahi.
 * ==============================================================
 * Owner: *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale"*.
 *
 * NetMirror ka REST route seedhe MP4 links deta hai (1080p tak). Wo links
 * `api/netmirror` (hamara same-origin function) se aate hain, video CDN se
 * seedha browser tak jaata hai — isliye na ad, na popup, na iframe ka jhanjhat.
 *
 * Teen halat:
 *   1. `loading` — streams aa rahe hain (chhota spinner).
 *   2. `ready`   — `MovieboxDirectPlayer` (wahi ±10s / seek / progress wala
 *                  player jo MovieBox direct route par chalta hai).
 *   3. `empty`   — NetMirror par title nahi / network fail. Dead button nahi:
 *                  seedha Nxsha par bhejne wala button dikhta hai.
 */

interface NetmirrorPlayerProps {
    /** Catalog id — `tmdb:1465943` / `1465943`. */
    tmdbId?: string | number | null;
    mediaType: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    onClose?: () => void;
    onProgress?: (info: { currentTime: number; duration: number }) => void;
    /** Yahan se parent wapas Server 1 (Nxsha) par le jata hai. */
    onUnavailable?: (reason: string) => void;
    /** Pehle se laaye gaye streams (parent cache) — optional. */
    initialStreams?: DirectStream[];
}

const IS_WEB = Platform.OS === 'web';

export function NetmirrorPlayer({
    tmdbId,
    mediaType,
    season,
    episode,
    title,
    onClose,
    onProgress,
    onUnavailable,
    initialStreams,
}: NetmirrorPlayerProps) {
    const hasId = Boolean(netmirrorTmdbNumber(tmdbId));
    const [state, setState] = useState<'loading' | 'ready' | 'empty'>(
        initialStreams && initialStreams.length ? 'ready' : 'loading',
    );
    const [streams, setStreams] = useState<DirectStream[]>(initialStreams ?? []);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        if (initialStreams && initialStreams.length) {
            setStreams(initialStreams);
            setState('ready');
            return;
        }
        if (!hasId) {
            setError('TMDB id nahi mila');
            setState('empty');
            return;
        }
        let cancelled = false;
        setState('loading');
        setError('');
        fetchNetmirrorStreams({ tmdbId, mediaType, season, episode }).then((result: NetmirrorResult) => {
            if (cancelled) return;
            if (result.ok && result.streams.length) {
                setStreams(result.streams);
                setState('ready');
                return;
            }
            setError(
                result.reason === 'not-added'
                    ? 'This title is not on NetMirror yet'
                    : result.reason === 'bad-id'
                      ? 'NetMirror needs a TMDB id'
                      : 'NetMirror did not answer',
            );
            setState('empty');
        });
        return () => {
            cancelled = true;
        };
    }, [hasId, tmdbId, mediaType, season, episode, initialStreams]);

    const fallback = useCallback(() => {
        onUnavailable?.(error || 'not-added');
    }, [onUnavailable, error]);

    const quality = streams.length ? String(streams[0].quality) : '';

    return (
        <View style={styles.root} testID="netmirror-player">
            {state === 'ready' ? (
                <MovieboxDirectPlayer
                    streams={streams}
                    title={title}
                    onProgress={onProgress}
                    onUnavailable={() => {
                        setError('Stream did not play');
                        setState('empty');
                    }}
                />
            ) : null}

            {state === 'loading' ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#E50914" />
                    <Text style={styles.hint}>{NETMIRROR_LABEL} · connecting…</Text>
                </View>
            ) : null}

            {state === 'empty' ? (
                <View style={styles.center}>
                    <Ionicons name="cloud-offline-outline" size={30} color="#9a9a9a" />
                    <Text style={styles.hint}>{error}</Text>
                    {onUnavailable ? (
                        <Pressable
                            onPress={fallback}
                            style={styles.switchButton}
                            accessibilityRole="button"
                            accessibilityLabel="Play on Nxsha instead"
                            testID="netmirror-fallback"
                        >
                            <Text style={styles.switchText}>Play on Nxsha</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}

            {/* Top-left chrome: band karna + kaunsa server chal raha hai. */}
            {IS_WEB || true ? (
                <View style={styles.topBar} pointerEvents="box-none">
                    {onClose ? (
                        <Pressable
                            onPress={onClose}
                            style={styles.iconButton}
                            accessibilityRole="button"
                            accessibilityLabel="Close player"
                        >
                            <Ionicons name="close" size={22} color="#fff" />
                        </Pressable>
                    ) : (
                        <View />
                    )}
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                            {NETMIRROR_LABEL}
                            {state === 'ready' && quality ? ` · ${quality}p` : ''}
                        </Text>
                    </View>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', position: 'relative' },
    center: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
    },
    hint: { color: '#c7c7c7', fontSize: 14, textAlign: 'center' },
    switchButton: {
        marginTop: 6,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 22,
        backgroundColor: '#E50914',
    },
    switchText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    topBar: {
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    iconButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.25)',
    },
    badge: {
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.25)',
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
