import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTvBackHandler } from '@/hooks/useTvNavigation';
import { pickLevelIndex, type NxshaSource } from '@/lib/nxshaStream';

const IS_WEB = Platform.OS === 'web';

/** The picture height this player is asked to pin (the whole point of it). */
export const TARGET_HEIGHT = 1080;

export interface DirectStreamPlayerProps {
    source: NxshaSource;
    /** Alternate sources tried in order when one fails. */
    alternates?: NxshaSource[];
    /** Base URL of the deployed extractor proxy (handles Referer + CORS). */
    proxyBase?: string;
    title?: string;
    onClose?: () => void;
    /** Every source failed — the parent falls back to the embed player. */
    onFallback?: () => void;
    timeoutMs?: number;
}

/**
 * Direct-stream player: plays the resolved nxsha m3u8/mp4 in OUR OWN video
 * element, with the HLS level pinned to 1080p in code — the thing the nxsha
 * embed player cannot do.
 *
 * Falls back to the parent (which mounts the classic embed) when every source
 * fails to load, so playback never gets worse than before.
 */
export function DirectStreamPlayer({
    source,
    alternates = [],
    proxyBase = '',
    title,
    onClose,
    onFallback,
    timeoutMs = 16000,
}: DirectStreamPlayerProps) {
    const [status, setStatus] = useState<'loading' | 'playing' | 'failed'>('loading');
    const [pinned, setPinned] = useState<string | null>(null);
    /** Which candidate is playing now (source first, then the alternates). */
    const [candidateIndex, setCandidateIndex] = useState(0);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<any>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const candidates = [source, ...alternates].filter(Boolean);
    const current = candidates[Math.min(candidateIndex, candidates.length - 1)];

    /**
     * Proxied media URL — sends the Referer the CDN expects server-side.
     * Without an explicit proxy base the same-origin function that ships with
     * the app (api/stream.mjs on Vercel) is used via a relative path.
     */
    const mediaUrl = (src: NxshaSource, viaProxy: boolean) => {
        if (!viaProxy) return src.url;
        const b64u = (value: string) =>
            btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const referer = src.referer || 'https://web.nxsha.app/';
        const base = proxyBase ? proxyBase.replace(/\/+$/, '') : '';
        return `${base}/api/stream?u=${b64u(src.url)}&r=${b64u(referer)}`;
    };

    /** Move to the next source (or the proxied variant) / give up to the embed. */
    const advance = () => {
        setStatus('loading');
        if (candidateIndex + 1 < candidates.length) {
            setCandidateIndex(candidateIndex + 1);
        } else {
            onFallback?.();
        }
    };

    // Boot the media for the current candidate.
    useEffect(() => {
        if (!IS_WEB || !current) return;
        const video = videoRef.current;
        if (!video) return;

        let cancelled = false;
        let viaProxy = false;
        let hls: any = null;

        const setPin = (level: any) => {
            if (!level) return;
            const height = level.height || level.bitrate || 0;
            setPinned(height >= 1000 && height < 3000 ? `${height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)}k` : '1080p');
        };

        const boot = async () => {
            setStatus('loading');
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                if (!cancelled) advance();
            }, timeoutMs);

            const attachNative = (url: string) => {
                video.src = url;
                video.load();
                try { video.play()?.catch?.(() => {}); } catch {}
            };

            if (current.kind === 'mp4') {
                attachNative(mediaUrl(current, viaProxy));
                return;
            }

            const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl');
            if (canNativeHls) {
                // Safari: native HLS. The browser's ABR starts high enough on
                // a fast link; the pinned-level guarantee needs hls.js.
                attachNative(mediaUrl(current, viaProxy));
                return;
            }

            try {
                // Lazy-required so the engine only loads with this player.
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const mod: any = require('hls.js');
                const Hls = mod?.default ?? mod;
                if (cancelled || !Hls) return;
                if (!Hls.isSupported()) {
                    attachNative(mediaUrl(current, viaProxy));
                    return;
                }
                hls = new Hls({
                    // Start at the 1080p level and stay there: no ABR ramp from 240p.
                    startLevel: -1,
                    capLevelToPlayerSize: false,
                    enableWorker: true,
                    lowLatencyMode: false,
                    maxBufferLength: 30,
                });
                hlsRef.current = hls;
                hls.on(Hls.Events.MANIFEST_PARSED, (_event: unknown, data: any) => {
                    if (cancelled) return;
                    const heights: number[] = (data?.levels ?? []).map((l: any) => l.height || 0);
                    const index = pickLevelIndex(heights, TARGET_HEIGHT);
                    if (index >= 0) {
                        hls.currentLevel = index;
                        setPin(data.levels[index]);
                    }
                    video.play().catch(() => {});
                });
                hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
                    if (cancelled || !data?.fatal) return;
                    if (!viaProxy && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        // The CDN likely wants its Referer (or blocks CORS):
                        // retry once through the proxy (same-origin by default).
                        viaProxy = true;
                        hls.destroy();
                        hlsRef.current = null;
                        boot();
                        return;
                    }
                    advance();
                });
                hls.loadSource(mediaUrl(current, viaProxy));
                hls.attachMedia(video);
            } catch {
                // hls.js failed to load at all: try plain playback or fall back.
                attachNative(mediaUrl(current, viaProxy));
            }
        };

        boot();
        return () => {
            cancelled = true;
            if (timerRef.current) clearTimeout(timerRef.current);
            if (hlsRef.current) {
                try { hlsRef.current.destroy(); } catch {}
                hlsRef.current = null;
            }
            try { video.removeAttribute('src'); video.load(); } catch {}
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateIndex, current?.url]);

    // Stop everything no matter how the component leaves the tree.
    useEffect(() => () => {
        if (hlsRef.current) {
            try { hlsRef.current.destroy(); } catch {}
            hlsRef.current = null;
        }
        const video = videoRef.current;
        if (video) {
            try { video.pause(); } catch {}
            try { video.removeAttribute('src'); video.load(); } catch {}
        }
    }, []);

    useTvBackHandler(() => {
        onClose?.();
        return true;
    }, true);

    if (!current) {
        // Nothing to play at all — the parent decides (fallback).
        onFallback?.();
        return null;
    }

    return (
        <View style={styles.container} testID="direct-stream-player">
            <video
                ref={(node: any) => { videoRef.current = node; }}
                poster={undefined}
                controls
                playsInline
                autoPlay
                onPlaying={() => { setStatus('playing'); if (timerRef.current) clearTimeout(timerRef.current); }}
                onError={() => advance()}
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#000',
                    objectFit: 'contain',
                } as any}
            />

            {status === 'loading' ? (
                <View style={styles.loadingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.loadingText}>1080p stream load ho raha hai…</Text>
                </View>
            ) : null}

            <View style={styles.topBar} pointerEvents="box-none">
                <Pressable
                    style={styles.iconButton}
                    onPress={onClose}
                    accessibilityLabel="Close player"
                    accessibilityRole="button"
                >
                    <Ionicons name="close" size={22} color="#fff" />
                </Pressable>
                {status === 'playing' && pinned ? (
                    <View style={styles.qualityBadge} pointerEvents="none">
                        <Text style={styles.qualityText}>{pinned}</Text>
                    </View>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000', position: 'relative' },
    topBar: {
        position: 'absolute', top: 0, left: 0, right: 0,
        paddingHorizontal: 12, paddingTop: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 2,
    },
    iconButton: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center', justifyContent: 'center',
    },
    qualityBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 12,
        paddingHorizontal: 10, paddingVertical: 5,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    },
    qualityText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)', gap: 14,
    },
    loadingText: { color: '#ccc', fontSize: 13 },
});
