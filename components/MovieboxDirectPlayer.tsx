import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DirectStream } from '@/lib/movieboxDirect';
import { MOVIEBOX_SKIP_SECONDS, registerMovieboxSeek } from '@/lib/movieboxSeekBridge';
import { enterPlayerFullscreen } from '@/lib/playerFullscreen';

/**
 * MovieBox ka apna player — hamare paas ka `<video>`, isliye phone par
 * **invisible ±10 second** (bina koi button).
 * ======================================================================
 * Owner: "moviebox ke player mae 10 sec aage ya peeche karne ka koi tarika nhi
 * hai … lekin invisible chiyea koi button nhi mainly ye phone ke liyea karna".
 *
 * Yahan video hamare hi document ka element hai (`lib/movieboxDirect.ts` stream
 * URL seedha browser me laata hai — koi proxy nahi), isliye seek karne ke liye
 * sirf `video.currentTime` chhui jaati hai.
 *
 * UX (jaisa YouTube/Crunchyroll phone par):
 *   - video ke **baayein 34%** par **double-tap = −10s**, **daayein 34% = +10s**
 *   - **beech** me double-tap = play/pause
 *   - ek tap = play/pause (0.8s ka toast)
 *   - 0 se pehle / duration ke bahar kuch nahi
 *
 * CONTROL BAR (owner: *"player ke controls to bnado bhaii"*):
 *   - neeche patti — play/pause, −10s, +10s, time (chalu / total), seek bar
 *     (drag ya tap), mute, fullscreen.
 *   - beech me bada play button **jab paused** ho.
 *   - 3.5s me apne aap gayab (jab chal raha ho); mouse hilao / tap karo to
 *     wapas. Keyboard: space = play/pause, ←/→ = ±10s, f = fullscreen,
 *     m = mute.
 *   - Bar gayab ho to video ke gestures (double-tap) jaise the waise chalte
 *     hain (`pointerEvents="none"`), dikhte waqt bhi khaali jagah se tap
 *     neeche chala jata hai (`box-none`).
 *
 * Kuch bhi galat ho (stream shuru na ho / HLS support na ho) to `onUnavailable`
 * — parent turant purane cropped iframe par chala jata hai (koi regression nahi).
 */

const IS_WEB = Platform.OS === 'web';
const STEP_SECONDS = MOVIEBOX_SKIP_SECONDS;
const TAP_MS = 340;
const ZONE = 0.34;
const TOAST_MS = 900;

interface MovieboxDirectPlayerProps {
    streams: DirectStream[];
    title?: string;
    /** Stream nahi chala — parent iframe par wapas jaye. */
    onUnavailable: (reason: string) => void;
    /** Position (Continue Watching ke liye). */
    onProgress?: (info: { currentTime: number; duration: number }) => void;
}

function formatClock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 && m < 10 ? `0${m}` : String(m);
    const ss = s < 10 ? `0${s}` : String(s);
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Browser jo stream chala sakta hai wahi chuno.
 *
 * MP4 seedha chalta hai (media element ko CORS nahi chahiye). HLS sirf wahan
 * jahan browser natively de (Safari/iOS) — Chrome me hls.js ko XHR chahiye
 * hota hai aur MovieBox ke CDN par `Access-Control-Allow-Origin` nahi hota
 * (CI probe se verify), isliye wahan HLS try hi nahi karte.
 */
export function pickPlayableStream(
    streams: DirectStream[],
    canPlay: (type: string) => string,
): DirectStream | null {
    return playableStreams(streams, canPlay)[0] ?? null;
}

/** Jo variants is browser me chal sakte hain — order me (MP4 pehle). */
export function playableStreams(
    streams: DirectStream[],
    canPlay: (type: string) => string,
): DirectStream[] {
    const hlsNative = Boolean(canPlay('application/vnd.apple.mpegurl'));
    return streams.filter(
        (stream) => stream.kind === 'mp4' || (stream.kind === 'hls' && hlsNative),
    );
}

export function MovieboxDirectPlayer({ streams, title, onUnavailable, onProgress }: MovieboxDirectPlayerProps) {
    const hostRef = useRef<View | null>(null);
    const [toast, setToast] = useState<{ text: string; side: 'left' | 'right' | 'center' } | null>(null);
    const rootRef = useRef<View | null>(null);
    const trackRef = useRef<View | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    /** Video se aane wali live values — control bar isi se banti hai. */
    const [playback, setPlayback] = useState({
        playing: false,
        current: 0,
        duration: 0,
        buffered: 0,
        muted: false,
    });
    const [chromeVisible, setChromeVisible] = useState(true);
    const [activity, setActivity] = useState(0);
    const lastBump = useRef(0);
    /** Effect ke andar bane actions — buttons yahan se bulate hain. */
    const actionsRef = useRef<{
        toggle: () => void;
        seekBy: (seconds: number) => void;
        seekTo: (seconds: number) => void;
        setMuted: (muted: boolean) => void;
    }>({ toggle: () => {}, seekBy: () => {}, seekTo: () => {}, setMuted: () => {} });

    /** Control bar dikhao aur auto-hide ka timer reset karo. */
    const bump = useCallback(() => {
        const now = Date.now();
        setChromeVisible(true);
        if (now - lastBump.current < 600) return;
        lastBump.current = now;
        setActivity((n) => n + 1);
    }, []);

    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        if (!IS_WEB || typeof document === 'undefined') return;
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    /** Poora player fullscreen (desktop + Android) — fail soft. */
    const toggleFullscreen = useCallback(() => {
        if (!IS_WEB || typeof document === 'undefined') return;
        // Parent shell fullscreen karo taaki player ke apne buttons (close /
        // server pill) bhi fullscreen me dikhein — sirf video nahi.
        const own = rootRef.current as unknown as HTMLElement | null;
        const el = (own?.parentElement as HTMLElement | null) ?? own;
        try {
            if (document.fullscreenElement) {
                void document.exitFullscreen?.();
                return;
            }
            const target: any = el ?? document.documentElement;
            if (typeof target.requestFullscreen === 'function') {
                const request = target.requestFullscreen({ navigationUI: 'hide' });
                if (request && typeof request.catch === 'function') {
                    request.catch(() => enterPlayerFullscreen(target));
                }
                return;
            }
            void enterPlayerFullscreen(target);
        } catch {
            void enterPlayerFullscreen(el as any);
        }
    }, []);
    /**
     * Kaunsa stream try ho raha hai. Ek CDN variant kharab ho (403/error) to
     * agla quality try hota hai — pehle hi iframe par nahi girte.
     */
    const [attempt, setAttempt] = useState(0);
    const onUnavailableRef = useRef(onUnavailable);
    onUnavailableRef.current = onUnavailable;
    const onProgressRef = useRef(onProgress);
    onProgressRef.current = onProgress;

    useEffect(() => {
        if (!IS_WEB) return;
        const host = hostRef.current as unknown as HTMLElement | null;
        if (!host || typeof document === 'undefined') return;

        const doc = host.ownerDocument;
        host.innerHTML = '';

        const video = doc.createElement('video');
        video.setAttribute('data-m2box', 'direct-video');
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('preload', 'metadata');
        video.controls = false;
        video.autoplay = true;
        Object.assign(video.style, {
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
            display: 'block',
        } as Partial<CSSStyleDeclaration>);

        const candidates = playableStreams(streams, (type) => video.canPlayType(type));
        if (!candidates.length) {
            onUnavailableRef.current('unsupported-format');
            return;
        }
        if (attempt >= candidates.length) {
            // Sab variants fail — ab iframe hi bacha hai.
            onUnavailableRef.current('media-error');
            return;
        }
        video.src = candidates[attempt].url;
        host.appendChild(video);

        const fail = (reason: string) => {
            if (attempt + 1 < candidates.length) setAttempt((value) => value + 1);
            else onUnavailableRef.current(reason);
        };
        video.addEventListener('error', () => fail('media-error'));

        /* ------------------- Control bar ke liye sync ------------------- */
        videoRef.current = video;
        const sync = () => {
            let buffered = 0;
            try {
                if (video.buffered && video.buffered.length) {
                    buffered = video.buffered.end(video.buffered.length - 1);
                }
            } catch {
                // some CDNs throw on buffered ranges
            }
            setPlayback({
                playing: !video.paused && !video.ended,
                current: Number(video.currentTime) || 0,
                duration: Number.isFinite(video.duration) ? video.duration : 0,
                buffered,
                muted: video.muted,
            });
        };
        sync();
        const syncEvents = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'progress', 'ended', 'seeked'];
        syncEvents.forEach((name) => video.addEventListener(name, sync));

        // Autoplay block ho jaye (phone par data-saver / muted requirement) to
        // muted karke dobara — user ke pehle tap par awaaz wapas.
        const play = video.play();
        if (play && typeof play.catch === 'function') {
            play.catch(() => {
                video.muted = true;
                const retry = video.play();
                if (retry && typeof retry.catch === 'function') retry.catch(() => fail('autoplay-blocked'));
            });
        }

        /**
         * Watchdog: stream ne shuru hi nahi kiya (CDN ne referer/region par
         * roka, ya network slow) — 12s me `readyState < 2` matlab abhi tak ek
         * frame bhi nahi aaya. Tab iframe par wapas, warna phone par kaala
         * dabba reh jata.
         */
        const watchdog = setTimeout(() => {
            if (video.readyState < 2) fail('not-playing');
        }, 12000);

        video.addEventListener('timeupdate', () => {
            if (!onProgressRef.current) return;
            if (!Number.isFinite(video.duration) || video.duration <= 0) return;
            onProgressRef.current({ currentTime: video.currentTime, duration: video.duration });
        });

        /* --------------------------- Gestures --------------------------- */

        let lastTapAt = 0;
        let lastSide: '' | 'left' | 'right' | 'center' = '';
        let toastTimer: ReturnType<typeof setTimeout> | null = null;
        let unmounted = false;

        const showToast = (text: string, side: 'left' | 'right' | 'center') => {
            if (unmounted) return;
            setToast({ text, side });
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                if (!unmounted) setToast(null);
            }, TOAST_MS);
        };

        const seekBy = (side: 'left' | 'right') => {
            const duration = Number(video.duration);
            const delta = side === 'right' ? STEP_SECONDS : -STEP_SECONDS;
            let next = (Number(video.currentTime) || 0) + delta;
            if (Number.isFinite(duration) && duration > 0) next = Math.min(next, duration - 0.3);
            next = Math.max(0, next);
            try {
                video.currentTime = next;
            } catch {
                // kuch players property rok dete hain
            }
            showToast(
                `${delta > 0 ? '+' : '−'}${STEP_SECONDS}s   ${formatClock(next)}${
                    Number.isFinite(duration) && duration > 0 ? ` / ${formatClock(duration)}` : ''
                }`,
                side,
            );
        };

        const toggle = () => {
            if (video.paused) {
                // Muted autoplay ke baad pehla tap awaaz wapas laata hai.
                if (video.muted) video.muted = false;
                void video.play();
                showToast('Play', 'center');
            } else {
                video.pause();
                showToast('Pause', 'center');
            }
        };

        const onPointerDown = (event: PointerEvent) => {
            bump();
            const rect = video.getBoundingClientRect();
            const x = event.clientX;
            const y = event.clientY;
            if (!rect.width || !rect.height) return;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;

            const side: 'left' | 'right' | 'center' =
                x < rect.left + rect.width * ZONE
                    ? 'left'
                    : x > rect.right - rect.width * ZONE
                    ? 'right'
                    : 'center';

            const now = Date.now();
            if (lastSide === side && now - lastTapAt <= TAP_MS) {
                lastTapAt = 0;
                lastSide = '';
                if (side === 'center') toggle();
                else seekBy(side);
                return;
            }
            lastTapAt = now;
            lastSide = side;
            // Single tap: itni der baad toggle — warna double-tap ka pehla tap
            // play/pause bhi kar deta.
            setTimeout(() => {
                if (unmounted) return;
                if (lastTapAt === now && lastSide === side) {
                    lastTapAt = 0;
                    lastSide = '';
                    if (video.muted) video.muted = false;
                    toggle();
                }
            }, TAP_MS);
        };

        actionsRef.current = {
            toggle,
            seekBy: (seconds: number) => {
                const duration = Number(video.duration);
                let next = (Number(video.currentTime) || 0) + seconds;
                if (Number.isFinite(duration) && duration > 0) next = Math.min(next, duration - 0.3);
                next = Math.max(0, next);
                try {
                    video.currentTime = next;
                } catch {
                    // property rok di gayi ho to chhod do
                }
                sync();
            },
            seekTo: (seconds: number) => {
                const duration = Number(video.duration);
                const clamped = Math.max(0, Number.isFinite(duration) && duration > 0 ? Math.min(seconds, duration - 0.3) : seconds);
                try {
                    video.currentTime = clamped;
                } catch {
                    // ignore
                }
                sync();
            },
            setMuted: (muted: boolean) => {
                video.muted = muted;
                if (!muted && video.paused) void video.play();
                sync();
            },
        };

        host.addEventListener('pointerdown', onPointerDown, true);

        /**
         * Dikhne wale −10s / +10s buttons (`MovieDetailModal`) isi handler se
         * chute hain — dono jagah ek hi clamp/toast logic rehta hai.
         */
        const unregisterSeek = registerMovieboxSeek((delta) => {
            if (video.error) return false;
            seekBy(delta < 0 ? 'left' : 'right');
            return true;
        });

        return () => {
            unregisterSeek();
            unmounted = true;
            syncEvents.forEach((name) => video.removeEventListener(name, sync));
            if (videoRef.current === video) videoRef.current = null;
            clearTimeout(watchdog);
            if (toastTimer) clearTimeout(toastTimer);
            host.removeEventListener('pointerdown', onPointerDown, true);
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch {
                // ignore
            }
            host.innerHTML = '';
        };
    }, [streams, attempt]);

    /* ------------------------------------------------------------------ */
    /* Control bar: auto-hide, mouse/keyboard, seek bar drag               */
    /* ------------------------------------------------------------------ */

    /** 3.5s me gayab — sirf jab video chal raha ho. */
    useEffect(() => {
        if (!chromeVisible || !playback.playing) return;
        const timer = setTimeout(() => setChromeVisible(false), 3500);
        return () => clearTimeout(timer);
    }, [chromeVisible, playback.playing, activity]);

    /** Mouse hilane par bar wapas. */
    useEffect(() => {
        if (!IS_WEB) return;
        const el = rootRef.current as unknown as HTMLElement | null;
        if (!el) return;
        const onMove = () => bump();
        el.addEventListener('pointermove', onMove);
        return () => el.removeEventListener('pointermove', onMove);
    }, [bump]);

    /** Keyboard: space/k = play-pause, ←/→ = ±10s, m = mute, f = fullscreen. */
    useEffect(() => {
        if (!IS_WEB || typeof window === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            const tag = (event.target as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (event.key === ' ' || event.key === 'k') {
                event.preventDefault();
                actionsRef.current.toggle();
                bump();
            } else if (event.key === 'ArrowLeft') {
                actionsRef.current.seekBy(-STEP_SECONDS);
                bump();
            } else if (event.key === 'ArrowRight') {
                actionsRef.current.seekBy(STEP_SECONDS);
                bump();
            } else if (event.key === 'm') {
                actionsRef.current.setMuted(!(videoRef.current?.muted ?? false));
                bump();
            } else if (event.key === 'f') {
                toggleFullscreen();
                bump();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [bump, toggleFullscreen]);

    /** Seek bar: click ya drag — dono se position badalti hai. */
    useEffect(() => {
        if (!IS_WEB || typeof window === 'undefined') return;
        const el = trackRef.current as unknown as HTMLElement | null;
        if (!el) return;
        const seekFrom = (clientX: number) => {
            const rect = el.getBoundingClientRect();
            const width = rect.width || 1;
            const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / width));
            const duration = videoRef.current?.duration ?? 0;
            if (Number.isFinite(duration) && duration > 0) {
                actionsRef.current.seekTo(ratio * duration);
            }
        };
        let dragging = false;
        const onDown = (event: PointerEvent) => {
            dragging = true;
            event.stopPropagation();
            if (typeof event.preventDefault === 'function') event.preventDefault();
            seekFrom(event.clientX);
            bump();
        };
        const onMove = (event: PointerEvent) => {
            if (!dragging) return;
            seekFrom(event.clientX);
        };
        const onUp = () => {
            dragging = false;
        };
        el.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            el.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [bump, chromeVisible]);

    if (!IS_WEB) {
        return (
            <View style={styles.fallback}>
                <Text style={styles.fallbackText}>{title || 'MovieBox'}</Text>
                <Text style={styles.fallbackHint}>Web preview me chalta hai.</Text>
            </View>
        );
    }

    const duration = playback.duration;
    const pct = duration > 0 ? Math.min(100, (playback.current / duration) * 100) : 0;
    const bufferedPct = duration > 0 ? Math.min(100, (playback.buffered / duration) * 100) : 0;

    return (
        <View ref={rootRef as any} style={styles.root}>
            <View ref={hostRef as any} style={styles.videoHost} testID="moviebox-direct-video" collapsable={false} />
            {chromeVisible || !playback.playing ? (
                <View style={styles.chrome} pointerEvents="box-none">
                    {!playback.playing ? (
                        <Pressable
                            style={styles.bigPlay}
                            onPress={() => {
                                actionsRef.current.toggle();
                                bump();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Play"
                            testID="direct-play"
                        >
                            <Ionicons name="play" size={30} color="#fff" />
                        </Pressable>
                    ) : null}

                    <View style={styles.bottomBar} pointerEvents="auto">
                        {/* Seek bar poori chaudai — phone par bhi ungli se aasan. */}
                        <View
                            ref={trackRef as any}
                            style={styles.track}
                            testID="direct-seek"
                            collapsable={false}
                            {...({ 'data-testid': 'direct-seek-track' } as any)}
                        >
                            <View style={[styles.trackBufferFill, { width: `${bufferedPct}%` } as any]} />
                            <View style={[styles.trackFill, { width: `${pct}%` } as any]} />
                            <View style={[styles.knob, { left: `${pct}%` } as any]} />
                        </View>
                        <View style={styles.controlsRow}>
                        <Pressable
                            style={styles.iconButton}
                            onPress={() => {
                                actionsRef.current.toggle();
                                bump();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={playback.playing ? 'Pause' : 'Play'}
                            testID="direct-play-pause"
                        >
                            <Ionicons name={playback.playing ? 'pause' : 'play'} size={20} color="#fff" />
                        </Pressable>
                        <Pressable
                            style={styles.skipButton}
                            onPress={() => {
                                actionsRef.current.seekBy(-STEP_SECONDS);
                                bump();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Back ${STEP_SECONDS} seconds`}
                            testID="direct-back-10"
                        >
                            <Ionicons name="play-back" size={16} color="#fff" />
                            <Text style={styles.skipText}>{STEP_SECONDS}</Text>
                        </Pressable>
                        <Pressable
                            style={styles.skipButton}
                            onPress={() => {
                                actionsRef.current.seekBy(STEP_SECONDS);
                                bump();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Forward ${STEP_SECONDS} seconds`}
                            testID="direct-forward-10"
                        >
                            <Ionicons name="play-forward" size={16} color="#fff" />
                            <Text style={styles.skipText}>{STEP_SECONDS}</Text>
                        </Pressable>

                        <Text style={styles.timeText} testID="direct-time">
                            {formatClock(playback.current)} / {duration > 0 ? formatClock(duration) : '--:--'}
                        </Text>

                        <Pressable
                            style={styles.iconButton}
                            onPress={() => {
                                actionsRef.current.setMuted(!playback.muted);
                                bump();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={playback.muted ? 'Unmute' : 'Mute'}
                            testID="direct-mute"
                        >
                            <Ionicons
                                name={playback.muted ? 'volume-mute' : 'volume-high'}
                                size={19}
                                color="#fff"
                            />
                        </Pressable>
                        <Pressable
                            style={styles.iconButton}
                            onPress={() => {
                                toggleFullscreen();
                                bump();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Full screen"
                            testID="direct-fullscreen"
                        >
                            <Ionicons name={isFullscreen ? 'contract' : 'scan'} size={19} color="#fff" />
                        </Pressable>
                        </View>
                    </View>
                </View>
            ) : null}
            {toast ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.toast,
                        toast.side === 'left' ? styles.toastLeft : toast.side === 'right' ? styles.toastRight : styles.toastCenter,
                    ]}
                >
                    <Text style={styles.toastText}>{toast.text}</Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', position: 'relative' },
    videoHost: { flex: 1, backgroundColor: '#000' },
    /** Toast button nahi hai — sirf feedback, tap onke through nikal jate hain. */
    toast: {
        position: 'absolute',
        top: '50%',
        marginTop: -20,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: 'rgba(0,0,0,0.62)',
    },
    toastLeft: { left: '8%' },
    toastRight: { right: '8%' },
    toastCenter: { alignSelf: 'center', left: 0, right: 0, alignItems: 'center', backgroundColor: 'transparent' },
    toastText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    /** Controls layer — khaali jagah se tap video tak jaata hai (box-none). */
    chrome: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
    bigPlay: {
        position: 'absolute',
        alignSelf: 'center',
        top: '50%',
        marginTop: -32,
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.35)',
    },
    bottomBar: {
        gap: 2,
        paddingHorizontal: 12,
        paddingTop: 6,
        paddingBottom: 8,
        backgroundColor: 'rgba(0,0,0,0.72)',
    },
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    iconButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    skipButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        height: 32,
        paddingHorizontal: 6,
        borderRadius: 16,
    },
    skipText: { color: '#fff', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
    timeText: {
        color: '#e6e6e6',
        fontSize: 11,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        minWidth: 82,
    },
    track: {
        width: '100%',
        height: 22,
        justifyContent: 'center',
        cursor: 'pointer',
    },
    trackBufferFill: {
        position: 'absolute',
        left: 0,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.35)',
    },
    trackFill: {
        position: 'absolute',
        left: 0,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#E50914',
    },
    knob: {
        position: 'absolute',
        width: 12,
        height: 12,
        marginLeft: -6,
        borderRadius: 6,
        backgroundColor: '#E50914',
        borderWidth: 2,
        borderColor: '#fff',
    },
    fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', gap: 6 },
    fallbackText: { color: '#fff', fontWeight: '700' },
    fallbackHint: { color: '#9a9a9a', fontSize: 12 },
});

export default MovieboxDirectPlayer;
