import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DirectStream } from '@/lib/movieboxDirect';
import { MOVIEBOX_SKIP_SECONDS, registerMovieboxSeek } from '@/lib/movieboxSeekBridge';
import { enterPlayerFullscreen } from '@/lib/playerFullscreen';

/**
 * Direct player (MovieBox / NetMirror) — Netflix jaisa poora chrome
 * ==================================================================
 * Owner: *"player ke controls aisa bnao"* (Netflix screenshot) aur
 * *"multilanguage hai to wo bhi do"*.
 *
 * Video hamare hi document ka element hai (`<video>`), isliye controls bhi
 * apne — koi iframe nahi:
 *
 *   TOP    back arrow · "You're Watching" · Title (Year) · audio/subtitles ·
 *          fullscreen
 *   BOTTOM seek bar + time, phir play/pause · −10 · +10 · volume | CC ·
 *          settings (quality / speed) · fullscreen
 *
 * MULTI-LANGUAGE: jahan provider audio/subtitle tracks deta hai (NetMirror ke
 * `captions[]`), CC menu me saari bhashayein aati hain — chunne par `<track>`
 * lag jata hai. Audio track tab hi dikhta hai jab provider de (jhoothi list
 * nahi banate).
 *
 * Gestures waise hi: baayein/daayein double-tap = ±10s, beech = play/pause.
 */

const IS_WEB = Platform.OS === 'web';
const STEP_SECONDS = MOVIEBOX_SKIP_SECONDS;
const TAP_MS = 340;
const ZONE = 0.34;
const TOAST_MS = 900;
const CHROME_HIDE_MS = 3500;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export interface SubtitleTrack {
    /** ISO code (`en`, `hi` …). */
    lang: string;
    /** Dikhne wala naam (`English`, `हिन्दी`). */
    name: string;
    /** Browser me chalaney layak URL (VTT) — parent resolve karke deta hai. */
    url: string;
}

interface MovieboxDirectPlayerProps {
    streams: DirectStream[];
    title?: string;
    year?: string | number;
    /** Back arrow (screenshot jaisa) — na ho to button hi nahi. */
    onBack?: () => void;
    /** Provider ke subtitle tracks (multi-language). */
    captions?: SubtitleTrack[];
    /** Agla server (pill) — cycle ke liye; na ho to pill hi nahi. */
    nextServerName?: string;
    onSwitchServer?: () => void;
    /** Stream nahi chala — parent iframe/Doosre server par wapas jaye. */
    onUnavailable: (reason: string) => void;
    /** Position (Continue Watching ke liye). */
    onProgress?: (info: { currentTime: number; duration: number }) => void;
    /** Pehla subtitle apne aap on (browser language match nahi hui to). */
    subtitleLang?: string | null;
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

/** `1080` / `'auto'` → menu par dikhne wala label. */
function qualityLabel(quality: string | number): string {
    const value = String(quality ?? '').trim();
    if (!value || value.toLowerCase() === 'auto') return 'Auto';
    return /^\d+$/.test(value) ? `${value}p` : value;
}

/**
 * Browser jo stream chala sakta hai wahi chuno.
 *
 * MP4 seedha chalta hai (media element ko CORS nahi chahiye). HLS sirf wahan
 * jahan browser natively de (Safari/iOS) — Chrome me hls.js ko XHR chahiye
 * hota hai aur provider ke CDN par `Access-Control-Allow-Origin` nahi hota,
 * isliye wahan HLS try hi nahi karte.
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

export function MovieboxDirectPlayer({
    streams,
    title,
    year,
    onBack,
    captions,
    nextServerName,
    onSwitchServer,
    onUnavailable,
    onProgress,
    subtitleLang = null,
}: MovieboxDirectPlayerProps) {
    const hostRef = useRef<View | null>(null);
    const rootRef = useRef<View | null>(null);
    const trackRef = useRef<View | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [toast, setToast] = useState<{ text: string; side: 'left' | 'right' | 'center' } | null>(null);
    /** Video se aane wali live values — poora chrome isi se banta hai. */
    const [playback, setPlayback] = useState({
        playing: false,
        current: 0,
        duration: 0,
        buffered: 0,
        muted: false,
        volume: 1,
    });
    const [chromeVisible, setChromeVisible] = useState(true);
    const [activity, setActivity] = useState(0);
    const lastBump = useRef(0);
    const [menu, setMenu] = useState<null | 'subtitles' | 'settings'>(null);
    const [speed, setSpeed] = useState(1);
    /** `null` = Auto (best available). */
    const [quality, setQuality] = useState<string | null>(null);
    const [activeSubtitle, setActiveSubtitle] = useState<string | null>(subtitleLang);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const actionsRef = useRef<{
        toggle: () => void;
        seekBy: (seconds: number) => void;
        seekTo: (seconds: number) => void;
        setMuted: (muted: boolean) => void;
        setSpeed: (rate: number) => void;
    }>({ toggle: () => {}, seekBy: () => {}, seekTo: () => {}, setMuted: () => {}, setSpeed: () => {} });

    /** Chrome dikhao aur auto-hide ka timer reset karo. */
    const bump = useCallback(() => {
        const now = Date.now();
        setChromeVisible(true);
        if (now - lastBump.current < 600) return;
        lastBump.current = now;
        setActivity((n) => n + 1);
    }, []);

    useEffect(() => {
        if (!IS_WEB || typeof document === 'undefined') return;
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    /** Poora player fullscreen (desktop + Android) — fail soft. */
    const toggleFullscreen = useCallback(() => {
        if (!IS_WEB || typeof document === 'undefined') return;
        // Parent shell fullscreen karo taaki player ke apne buttons (back /
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
            // Sab variants fail — ab doosra server hi bacha hai.
            onUnavailableRef.current('media-error');
            return;
        }
        // Quality chuni hui ho to wahi, warna attempt ka kram.
        const chosenIndex =
            quality != null
                ? Math.max(0, candidates.findIndex((item) => String(item.quality) === quality))
                : attempt;
        video.src = candidates[chosenIndex].url;
        host.appendChild(video);

        const fail = (reason: string) => {
            if (attempt + 1 < candidates.length) setAttempt((value) => value + 1);
            else onUnavailableRef.current(reason);
        };
        video.addEventListener('error', () => fail('media-error'));

        /* ------------------- Chrome ke liye sync ------------------- */
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
                volume: Number.isFinite(video.volume) ? video.volume : 1,
            });
        };
        sync();
        const syncEvents = [
            'play',
            'pause',
            'timeupdate',
            'loadedmetadata',
            'durationchange',
            'volumechange',
            'progress',
            'ended',
            'seeked',
        ];
        syncEvents.forEach((name) => video.addEventListener(name, sync));
        video.playbackRate = speed;

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
         * Watchdog: stream ne shuru hi nahi kiya — 12s me `readyState < 2`
         * matlab abhi tak ek frame bhi nahi aaya. Tab doosre server par.
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
                const clamped = Math.max(
                    0,
                    Number.isFinite(duration) && duration > 0 ? Math.min(seconds, duration - 0.3) : seconds,
                );
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
            setSpeed: (rate: number) => {
                video.playbackRate = rate;
                sync();
            },
        };

        host.addEventListener('pointerdown', onPointerDown, true);

        /**
         * Dikhne wale −10s / +10s buttons isi handler se chute hain — dono
         * jagah ek hi clamp/toast logic rehta hai.
         */
        const unregisterSeek = registerMovieboxSeek((delta) => {
            if (video.error) return false;
            seekBy(delta < 0 ? 'left' : 'right');
            return true;
        });

        return () => {
            unregisterSeek();
            unmounted = true;
            clearTimeout(watchdog);
            if (toastTimer) clearTimeout(toastTimer);
            syncEvents.forEach((name) => video.removeEventListener(name, sync));
            host.removeEventListener('pointerdown', onPointerDown, true);
            if (videoRef.current === video) videoRef.current = null;
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch {
                // ignore
            }
            host.innerHTML = '';
        };
    }, [streams, attempt, quality, speed, bump]);

    /* --------------------- Subtitles (multi-language) --------------------- */

    useEffect(() => {
        if (!IS_WEB) return;
        const video = videoRef.current;
        if (!video) return;
        // Purani tracks hatao, chuni hui wapas lagao.
        Array.from(video.querySelectorAll('track')).forEach((node) => node.remove());
        const chosen = (captions || []).find((track) => track.lang === activeSubtitle);
        if (!chosen) return;
        const element = document.createElement('track');
        element.kind = 'subtitles';
        element.label = chosen.name || chosen.lang;
        element.srclang = chosen.lang || 'und';
        element.src = chosen.url;
        element.default = true;
        video.appendChild(element);
        try {
            const textTrack = (video.textTracks || []).length
                ? video.textTracks[video.textTracks.length - 1]
                : null;
            if (textTrack) textTrack.mode = 'showing';
        } catch {
            // kuch browsers par textTracks khaali hota hai — chhod do
        }
    }, [captions, activeSubtitle, streams, attempt, quality]);

    /* ---------------------- Chrome: hide / keyboard / drag ---------------------- */

    useEffect(() => {
        if (!chromeVisible || !playback.playing || menu) return;
        const timer = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
        return () => clearTimeout(timer);
    }, [chromeVisible, playback.playing, activity, menu]);

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
            } else if (event.key === 'Escape') {
                setMenu(null);
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
                <Text style={styles.fallbackText}>{title || 'Player'}</Text>
                <Text style={styles.fallbackHint}>Web preview me chalta hai.</Text>
            </View>
        );
    }

    const duration = playback.duration;
    const pct = duration > 0 ? Math.min(100, (playback.current / duration) * 100) : 0;
    const bufferedPct = duration > 0 ? Math.min(100, (playback.buffered / duration) * 100) : 0;
    const subtitleTracks = captions || [];
    const qualityOptions = playableStreams(streams, (type) => {
        const probe = typeof document !== 'undefined' ? document.createElement('video') : null;
        return probe?.canPlayType(type) ?? '';
    });

    const resolveQuality = (value: string | null) => {
        setQuality(value);
        setAttempt(0);
        bump();
    };

    return (
        <View ref={rootRef as any} style={styles.root}>
            <View ref={hostRef as any} style={styles.videoHost} testID="moviebox-direct-video" collapsable={false} />

            {chromeVisible || !playback.playing || menu ? (
                <View style={styles.chrome} pointerEvents="box-none">
                    {/* ------------------------- Top bar ------------------------- */}
                    <View style={styles.topBar} pointerEvents="box-none">
                        <View style={styles.topLeft}>
                            {onBack ? (
                                <Pressable
                                    onPress={() => {
                                        onBack();
                                        bump();
                                    }}
                                    style={styles.backButton}
                                    accessibilityRole="button"
                                    accessibilityLabel="Back"
                                    testID="direct-back"
                                >
                                    <Ionicons name="arrow-back" size={26} color="#fff" />
                                </Pressable>
                            ) : null}
                            <View style={styles.titleBlock}>
                                <Text style={styles.eyebrow}>You&apos;re Watching</Text>
                                <Text style={styles.titleText} numberOfLines={1}>
                                    {title || ''}
                                    {year ? ` (${year})` : ''}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.topRight}>
                            {nextServerName && onSwitchServer ? (
                                <Pressable
                                    style={styles.serverPill}
                                    onPress={() => {
                                        onSwitchServer();
                                        bump();
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Switch to ${nextServerName}`}
                                    testID="direct-switch-server"
                                >
                                    <Text style={styles.serverPillText}>{nextServerName} →</Text>
                                </Pressable>
                            ) : null}
                            <Pressable
                                style={styles.iconButton}
                                onPress={() => {
                                    setMenu(menu === 'subtitles' ? null : 'subtitles');
                                    bump();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel="Audio and subtitles"
                                testID="direct-audio-subs"
                            >
                                <Ionicons name="chatbox-ellipses-outline" size={22} color="#fff" />
                            </Pressable>
                            <View style={styles.divider} />
                            <Pressable
                                style={styles.iconButton}
                                onPress={() => {
                                    toggleFullscreen();
                                    bump();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel="Full screen"
                                testID="direct-fullscreen-top"
                            >
                                <Ionicons name={isFullscreen ? 'contract' : 'expand'} size={22} color="#fff" />
                            </Pressable>
                        </View>
                    </View>

                    {/* ------------------------ Big play ------------------------ */}
                    {!playback.playing && !menu ? (
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
                            <Ionicons name="play" size={32} color="#fff" />
                        </Pressable>
                    ) : null}

                    {/* --------------------- Menus (CC / settings) --------------------- */}
                    {menu ? (
                        <View style={styles.menuLayer} pointerEvents="box-none">
                            <View style={styles.menu} testID={`direct-menu-${menu}`}>
                                <Text style={styles.menuTitle}>
                                    {menu === 'subtitles' ? 'Subtitles' : 'Settings'}
                                </Text>
                                <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
                                    {menu === 'subtitles' ? (
                                        <>
                                            {subtitleTracks.length === 0 ? (
                                                <Text style={styles.menuEmpty}>
                                                    Is title par subtitles nahi mile.
                                                </Text>
                                            ) : null}
                                            <MenuRow
                                                label="Off"
                                                active={!activeSubtitle}
                                                onPress={() => {
                                                    setActiveSubtitle(null);
                                                    setMenu(null);
                                                    bump();
                                                }}
                                                testID="subtitle-off"
                                            />
                                            {subtitleTracks.map((track) => (
                                                <MenuRow
                                                    key={`${track.lang}-${track.url}`}
                                                    label={track.name || track.lang}
                                                    hint={(track.lang || '').toUpperCase()}
                                                    active={activeSubtitle === track.lang}
                                                    onPress={() => {
                                                        setActiveSubtitle(track.lang);
                                                        setMenu(null);
                                                        bump();
                                                    }}
                                                    testID={`subtitle-${track.lang}`}
                                                />
                                            ))}
                                        </>
                                    ) : (
                                        <>
                                            <Text style={styles.menuSection}>Quality</Text>
                                            <MenuRow
                                                label="Auto"
                                                active={quality == null}
                                                onPress={() => resolveQuality(null)}
                                                testID="quality-auto"
                                            />
                                            {qualityOptions.map((stream) => (
                                                <MenuRow
                                                    key={`q-${stream.url}`}
                                                    label={qualityLabel(stream.quality)}
                                                    active={quality === String(stream.quality)}
                                                    onPress={() => resolveQuality(String(stream.quality))}
                                                    testID={`quality-${stream.quality}`}
                                                />
                                            ))}
                                            <Text style={styles.menuSection}>Playback speed</Text>
                                            {SPEEDS.map((rate) => (
                                                <MenuRow
                                                    key={`s-${rate}`}
                                                    label={rate === 1 ? 'Normal' : `${rate}x`}
                                                    active={speed === rate}
                                                    onPress={() => {
                                                        setSpeed(rate);
                                                        actionsRef.current.setSpeed(rate);
                                                        bump();
                                                    }}
                                                    testID={`speed-${rate}`}
                                                />
                                            ))}
                                        </>
                                    )}
                                </ScrollView>
                            </View>
                        </View>
                    ) : null}

                    {/* ------------------------ Bottom bar ------------------------ */}
                    <View style={styles.bottomBar} pointerEvents="auto">
                        <View style={styles.seekRow}>
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
                            <Text style={styles.timeText} testID="direct-time">
                                {formatClock(playback.current)} / {duration > 0 ? formatClock(duration) : '--:--'}
                            </Text>
                        </View>

                        <View style={styles.controlsRow}>
                            <View style={styles.controlsLeft}>
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
                                    <Ionicons name={playback.playing ? 'pause' : 'play'} size={24} color="#fff" />
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
                                    <Ionicons name="play-back" size={20} color="#fff" />
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
                                    <Ionicons name="play-forward" size={20} color="#fff" />
                                    <Text style={styles.skipText}>{STEP_SECONDS}</Text>
                                </Pressable>
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
                                        name={playback.muted || playback.volume === 0 ? 'volume-mute' : 'volume-high'}
                                        size={22}
                                        color="#fff"
                                    />
                                </Pressable>
                            </View>

                            <View style={styles.controlsRight}>
                                <Pressable
                                    style={[styles.iconButton, activeSubtitle ? styles.iconActive : null]}
                                    onPress={() => {
                                        setMenu(menu === 'subtitles' ? null : 'subtitles');
                                        bump();
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel="Subtitles"
                                    testID="direct-subtitles"
                                >
                                    <Ionicons name="chatbox-ellipses" size={21} color="#fff" />
                                </Pressable>
                                <Pressable
                                    style={styles.iconButton}
                                    onPress={() => {
                                        setMenu(menu === 'settings' ? null : 'settings');
                                        bump();
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel="Settings"
                                    testID="direct-settings"
                                >
                                    <Ionicons name="settings-sharp" size={21} color="#fff" />
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
                                    <Ionicons name={isFullscreen ? 'contract' : 'scan'} size={21} color="#fff" />
                                </Pressable>
                            </View>
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

/** Menu ki ek line (subtitle language / quality / speed). */
function MenuRow({
    label,
    hint,
    active,
    onPress,
    testID,
}: {
    label: string;
    hint?: string;
    active: boolean;
    onPress: () => void;
    testID?: string;
}) {
    return (
        <Pressable
            style={styles.menuRow}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            {...({ dataSet: { selected: active ? '1' : '0' } } as any)}
            testID={testID}
        >
            <Text style={[styles.menuRowText, active && styles.menuRowTextActive]} numberOfLines={1}>
                {label}
            </Text>
            {hint ? <Text style={styles.menuRowHint}>{hint}</Text> : null}
            {active ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', position: 'relative' },
    videoHost: { flex: 1, backgroundColor: '#000' },

    /** Controls layer — khaali jagah se tap video tak jaata hai (box-none). */
    chrome: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },

    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 12,
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    topLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    titleBlock: { flexShrink: 1 },
    eyebrow: { color: '#c9c9c9', fontSize: 12, fontWeight: '500' },
    titleText: { color: '#fff', fontSize: 17, fontWeight: '800' },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    serverPill: {
        height: 30,
        paddingHorizontal: 12,
        borderRadius: 15,
        justifyContent: 'center',
        backgroundColor: 'rgba(229,9,20,0.8)',
        marginRight: 6,
    },
    serverPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    divider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.35)', marginHorizontal: 4 },

    bigPlay: {
        position: 'absolute',
        alignSelf: 'center',
        top: '50%',
        marginTop: -34,
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.35)',
    },

    bottomBar: {
        gap: 4,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 12,
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    seekRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    controlsLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    controlsRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },

    iconButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconActive: { backgroundColor: 'rgba(229,9,20,0.35)' },
    skipButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 1,
        height: 38,
        paddingHorizontal: 6,
        borderRadius: 19,
    },
    skipText: { color: '#fff', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
    timeText: {
        color: '#e6e6e6',
        fontSize: 12,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        minWidth: 96,
        textAlign: 'right',
    },
    track: { flex: 1, height: 22, justifyContent: 'center', cursor: 'pointer' },
    trackBufferFill: {
        position: 'absolute',
        left: 0,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.35)',
    },
    trackFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: '#E50914' },
    knob: {
        position: 'absolute',
        width: 13,
        height: 13,
        marginLeft: -6,
        borderRadius: 7,
        backgroundColor: '#E50914',
        borderWidth: 2,
        borderColor: '#fff',
    },

    menuLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-end', justifyContent: 'center' },
    menu: {
        width: 230,
        maxHeight: '80%',
        marginRight: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: 'rgba(20,20,20,0.96)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    menuScroll: { maxHeight: 300 },
    menuTitle: { color: '#c9c9c9', fontSize: 12, fontWeight: '700', paddingHorizontal: 14, paddingBottom: 6 },
    menuSection: {
        color: '#8f8f8f',
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 4,
        textTransform: 'uppercase',
    },
    menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    menuRowText: { flex: 1, color: '#e8e8e8', fontSize: 14 },
    menuRowTextActive: { color: '#fff', fontWeight: '700' },
    menuRowHint: { color: '#8f8f8f', fontSize: 11 },
    menuEmpty: { color: '#9a9a9a', fontSize: 12, paddingHorizontal: 14, paddingVertical: 8 },

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
    toastText: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

    fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', gap: 6 },
    fallbackText: { color: '#fff', fontWeight: '700' },
    fallbackHint: { color: '#9a9a9a', fontSize: 12 },
});

export default MovieboxDirectPlayer;
