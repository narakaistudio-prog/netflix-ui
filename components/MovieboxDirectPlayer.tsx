import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DirectStream } from '@/lib/movieboxDirect';
import { MOVIEBOX_SKIP_SECONDS, registerMovieboxSeek } from '@/lib/movieboxSeekBridge';
import { enterPlayerFullscreen } from '@/lib/playerFullscreen';
import { cueAt, parseVtt, type SubtitleCue } from '@/lib/subtitles';
import type { AudioTrack } from '@/lib/movieboxAudio';

/**
 * Direct player (MovieBox / NetMirror) — Netflix jaisa poora chrome
 * ==================================================================
 * Owner: *"player ke control image 2 ko sahi se dekh kar bilkul waisa banao"*
 * (Netflix ka screenshot) + *"multilanguage dub chahiye tha"*.
 *
 * Video hamare hi document ka element hai (`<video>`), isliye controls bhi
 * apne — koi iframe nahi:
 *
 *   TOP    back arrow · "You're Watching" · Title (Year) · audio/subtitles ·
 *          fullscreen                     (patla black gradient scrim, bar nahi)
 *   BOTTOM seek bar + time, phir play/pause · ⟲10 · 10⟳ · volume |
 *          CC/subtitles · settings (audio / quality / speed) · fullscreen
 *
 * MULTI-LANGUAGE:
 *   - **Audio (dub)** — provider par har dub apna subject hota hai, isliye
 *     list `api/moviebox-audio` se aati hai aur chunne par naye streams lagte
 *     hain (`onAudioSelect`). Jis title par nahi hai, wahan section hi nahi.
 *   - **Subtitles** — `/api/netmirror-subtitle` (SRT→VTT) se file aati hai,
 *     yahan parse hoti hai aur **apne overlay** me dikhti hai (native `<track>`
 *     ka style control me nahi tha aur wahi chup-chaap fail hota tha).
 *
 * Gestures waise hi: baayein/daayein double-tap = ±10s, beech = play/pause.
 */

const IS_WEB = Platform.OS === 'web';
const STEP_SECONDS = MOVIEBOX_SKIP_SECONDS;
const TAP_MS = 340;
const ZONE = 0.34;
const TOAST_MS = 1200;
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
    /** Provider ki audio languages (dub) — na ho to section hi nahi. */
    audioTracks?: AudioTrack[];
    /** Abhi kaunsi audio chalu hai (subjectId). */
    activeAudio?: string | null;
    /** Doosri bhasha chuno — parent naye streams laata hai. `false` = nahi mila. */
    onAudioSelect?: (track: AudioTrack) => boolean | Promise<boolean>;
    /** Audio badalne ke baad isi jagah se shuru (seconds). */
    startAt?: number;
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
    audioTracks,
    activeAudio,
    onAudioSelect,
    startAt = 0,
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
    const [cues, setCues] = useState<SubtitleCue[]>([]);
    const [subtitleState, setSubtitleState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [audioBusy, setAudioBusy] = useState<string | null>(null);
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

        // Audio (dub) badalne par stream naya hota hai — wahi jagah se chalao.
        let seekApplied = false;
        const applyStartAt = () => {
            if (seekApplied) return;
            seekApplied = true;
            if (!startAt || startAt <= 0) return;
            const duration = Number(video.duration);
            if (Number.isFinite(duration) && duration > 0 && startAt >= duration - 1) return;
            try {
                video.currentTime = startAt;
            } catch {
                // property rok di gayi ho to chhod do
            }
            sync();
        };
        video.addEventListener('loadedmetadata', applyStartAt);

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
            video.removeEventListener('loadedmetadata', applyStartAt);
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
    }, [streams, attempt, quality, speed, bump, startAt]);

    /* --------------------- Subtitles (multi-language) --------------------- */

    /**
     * Chuni hui bhasha ki file laao (bridge VTT deta hai) aur parse karo.
     * Native `<track>` jaan-boojh kar use nahi karte: uska style app ke
     * control me nahi tha aur cross-origin video par chup-chaap fail hota tha.
     */
    useEffect(() => {
        if (!IS_WEB) return;
        if (!activeSubtitle) {
            setCues([]);
            setSubtitleState('idle');
            return;
        }
        const track = (captions || []).find((item) => item.lang === activeSubtitle);
        if (!track?.url) {
            setCues([]);
            setSubtitleState('error');
            return;
        }
        let cancelled = false;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        setSubtitleState('loading');
        fetch(track.url, { signal: controller?.signal })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .then((text) => {
                if (cancelled) return;
                const parsed = parseVtt(text);
                setCues(parsed);
                if (parsed.length) {
                    setSubtitleState('ready');
                } else {
                    setSubtitleState('error');
                    setToast({ text: 'Subtitles khaali mile', side: 'center' });
                }
            })
            .catch(() => {
                if (cancelled) return;
                setCues([]);
                setSubtitleState('error');
                setToast({ text: 'Subtitles load nahi hue', side: 'center' });
            });
        return () => {
            cancelled = true;
            controller?.abort();
        };
    }, [activeSubtitle, captions]);

    const subtitleText = activeSubtitle ? cueAt(cues, playback.current) : null;

    /**
     * Pehli baar ek chhota hint: owner *"subtitle nahi chal raha"* keh rahe the
     * — bhasha chunna zaroori hai, wo baat chhupni nahi chahiye. Sirf ek baar,
     * 4s ke liye (baaki UI text English me hai).
     */
    const hintShown = useRef(false);
    useEffect(() => {
        if (hintShown.current || !(captions || []).length) return;
        hintShown.current = true;
        setToast({ text: 'Subtitles & audio — tap CC', side: 'center' });
        const timer = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(timer);
    }, [captions]);

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
    const audioOptions = audioTracks || [];
    const qualityOptions = playableStreams(streams, (type) => {
        const probe = typeof document !== 'undefined' ? document.createElement('video') : null;
        return probe?.canPlayType(type) ?? '';
    });

    const resolveQuality = (value: string | null) => {
        setQuality(value);
        setAttempt(0);
        bump();
    };

    const chooseAudio = async (track: AudioTrack) => {
        if (!onAudioSelect || audioBusy) return;
        setAudioBusy(track.subjectId);
        let ok = false;
        try {
            ok = (await onAudioSelect(track)) !== false;
        } catch {
            ok = false;
        }
        setAudioBusy(null);
        if (ok) {
            setMenu(null);
            setToast({ text: `Audio: ${track.name}`, side: 'center' });
        } else {
            setToast({ text: `${track.name} audio nahi mila`, side: 'center' });
        }
        bump();
    };

    return (
        <View ref={rootRef as any} style={styles.root}>
            <View ref={hostRef as any} style={styles.videoHost} testID="moviebox-direct-video" collapsable={false} />

            {/* Subtitles — apna overlay (native track jaisa chhota/invisible nahi). */}
            {subtitleText ? (
                <View
                    pointerEvents="none"
                    style={[styles.subtitleLayer, chromeVisible || menu ? styles.subtitleLayerRaised : null]}
                    testID="direct-subtitle-overlay"
                >
                    <Text style={styles.subtitleText}>{subtitleText}</Text>
                </View>
            ) : null}

            {chromeVisible || !playback.playing || menu ? (
                <View style={styles.chrome} pointerEvents="box-none">
                    {/* Dono scrims pehle — baaki sab unke upar (menu dim na ho). */}
                    <LinearGradient
                        colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
                        style={styles.topScrim}
                        pointerEvents="none"
                    />
                    <LinearGradient
                        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']}
                        style={styles.bottomScrim}
                        pointerEvents="none"
                    />

                    {/* ---------------------------- Top bar ---------------------------- */}
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
                                    <MaterialCommunityIcons name="arrow-left" size={32} color="#fff" />
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
                                style={styles.topIcon}
                                onPress={() => {
                                    setMenu(menu === 'subtitles' ? null : 'subtitles');
                                    bump();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel="Audio and subtitles"
                                testID="direct-audio-subs"
                            >
                                <MaterialCommunityIcons name="cast" size={26} color="#fff" />
                            </Pressable>
                            <View style={styles.divider} />
                            <Pressable
                                style={styles.topIcon}
                                onPress={() => {
                                    toggleFullscreen();
                                    bump();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel="Full screen"
                                testID="direct-fullscreen-top"
                            >
                                <MaterialCommunityIcons
                                    name={isFullscreen ? 'fullscreen-exit' : 'arrow-expand'}
                                    size={26}
                                    color="#fff"
                                />
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
                            <MaterialCommunityIcons name="play" size={38} color="#fff" />
                        </Pressable>
                    ) : null}

                    {/* ---------------- Menus (audio/subs + settings) ---------------- */}
                    {menu ? (
                        <View style={styles.menuLayer} pointerEvents="box-none">
                            <View style={styles.menu} testID={`direct-menu-${menu}`}>
                                <Text style={styles.menuTitle}>
                                    {menu === 'subtitles' ? 'Audio & Subtitles' : 'Settings'}
                                </Text>
                                <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
                                    {menu === 'subtitles' ? (
                                        <>
                                            {audioOptions.length ? (
                                                <Text style={styles.menuSection}>Audio</Text>
                                            ) : null}
                                            {audioOptions.map((track) => (
                                                <MenuRow
                                                    key={`audio-${track.subjectId}`}
                                                    label={track.name}
                                                    hint={
                                                        audioBusy === track.subjectId
                                                            ? '…'
                                                            : (track.lang || '').toUpperCase()
                                                    }
                                                    active={activeAudio === track.subjectId}
                                                    onPress={() => {
                                                        void chooseAudio(track);
                                                    }}
                                                    testID={`audio-${track.lang}`}
                                                />
                                            ))}
                                            <Text style={styles.menuSection}>Subtitles</Text>
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
                                                    hint={
                                                        activeSubtitle === track.lang && subtitleState === 'loading'
                                                            ? '…'
                                                            : (track.lang || '').toUpperCase()
                                                    }
                                                    active={activeSubtitle === track.lang}
                                                    onPress={() => {
                                                        setActiveSubtitle(track.lang);
                                                        setMenu(null);
                                                        bump();
                                                    }}
                                                    testID={`subtitle-${track.lang}`}
                                                />
                                            ))}
                                            {activeSubtitle && subtitleState === 'error' ? (
                                                <Text style={styles.menuEmpty}>
                                                    Ye subtitle load nahi hua — doosri bhasha try karo.
                                                </Text>
                                            ) : null}
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

                    {/* ---------------------------- Bottom bar ---------------------------- */}
                    <View style={styles.bottomBar} pointerEvents="auto">
                        <View style={styles.seekRow}>
                            <View
                                ref={trackRef as any}
                                style={styles.track}
                                testID="direct-seek"
                                collapsable={false}
                                {...({ 'data-testid': 'direct-seek-track' } as any)}
                            >
                                <View style={styles.trackRail} />
                                <View
                                    style={[styles.trackBufferFill, { width: `${bufferedPct}%` } as any]}
                                />
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
                                    <MaterialCommunityIcons
                                        name={playback.playing ? 'pause' : 'play'}
                                        size={38}
                                        color="#fff"
                                    />
                                </Pressable>
                                <Pressable
                                    style={styles.iconButton}
                                    onPress={() => {
                                        actionsRef.current.seekBy(-STEP_SECONDS);
                                        bump();
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Back ${STEP_SECONDS} seconds`}
                                    testID="direct-back-10"
                                >
                                    <MaterialCommunityIcons name="rewind-10" size={36} color="#fff" />
                                </Pressable>
                                <Pressable
                                    style={styles.iconButton}
                                    onPress={() => {
                                        actionsRef.current.seekBy(STEP_SECONDS);
                                        bump();
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Forward ${STEP_SECONDS} seconds`}
                                    testID="direct-forward-10"
                                >
                                    <MaterialCommunityIcons name="fast-forward-10" size={36} color="#fff" />
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
                                    <MaterialCommunityIcons
                                        name={playback.muted || playback.volume === 0 ? 'volume-off' : 'volume-high'}
                                        size={32}
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
                                    <MaterialCommunityIcons name="subtitles-outline" size={30} color="#fff" />
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
                                    <MaterialCommunityIcons name="cog" size={30} color="#fff" />
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
                                    <MaterialCommunityIcons
                                        name={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
                                        size={30}
                                        color="#fff"
                                    />
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

/** Menu ki ek line (audio language / subtitle / quality / speed). */
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
            {active ? <MaterialCommunityIcons name="check" size={20} color="#fff" /> : null}
        </Pressable>
    );
}

/**
 * Screenshot ke naap (1673×940 par measure kiye gaye) — isliye padding 28,
 * title 24, seek bar 5px, knob 16, icons 30–38.
 */
const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', position: 'relative' },
    videoHost: { flex: 1, backgroundColor: '#000' },

    /** Controls layer — khaali jagah se tap video tak jaata hai (box-none). */
    chrome: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },

    topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 170 },
    bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 220 },

    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 28,
        paddingTop: 22,
        gap: 16,
    },
    topLeft: { flexDirection: 'row', alignItems: 'center', gap: 20, flexShrink: 1 },
    backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    titleBlock: { flexShrink: 1 },
    eyebrow: { color: '#e2e2e2', fontSize: 14, fontWeight: '500', letterSpacing: 0.2 },
    titleText: { color: '#fff', fontSize: 24, fontWeight: '700', letterSpacing: 0.2, marginTop: 2 },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    topIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    serverPill: {
        height: 30,
        paddingHorizontal: 12,
        borderRadius: 15,
        justifyContent: 'center',
        backgroundColor: 'rgba(229,9,20,0.8)',
        marginRight: 4,
    },
    serverPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    divider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.45)', marginHorizontal: 2 },

    bigPlay: {
        position: 'absolute',
        alignSelf: 'center',
        top: '50%',
        marginTop: -40,
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.5)',
    },

    bottomBar: {
        gap: 2,
        paddingHorizontal: 28,
        paddingBottom: 22,
    },
    seekRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 14,
    },
    controlsLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    controlsRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },

    iconButton: {
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconActive: { backgroundColor: 'rgba(229,9,20,0.45)' },
    timeText: {
        color: '#e8e8e8',
        fontSize: 15,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        minWidth: 116,
        textAlign: 'right',
    },
    track: { flex: 1, height: 26, justifyContent: 'center', cursor: 'pointer' },
    trackRail: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.32)',
    },
    trackBufferFill: {
        position: 'absolute',
        left: 0,
        height: 5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.5)',
    },
    trackFill: { position: 'absolute', left: 0, height: 5, borderRadius: 3, backgroundColor: '#E50914' },
    knob: {
        position: 'absolute',
        width: 16,
        height: 16,
        marginLeft: -8,
        borderRadius: 8,
        backgroundColor: '#E50914',
    },

    subtitleLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 96,
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    subtitleLayerRaised: { bottom: 150 },
    subtitleText: {
        color: '#fff',
        fontSize: 22,
        lineHeight: 30,
        fontWeight: '600',
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.95)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 6,
    },

    menuLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-end', justifyContent: 'center' },
    menu: {
        width: 290,
        maxHeight: '78%',
        marginRight: 28,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: 'rgba(20,20,20,0.97)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.18)',
    },
    menuScroll: { maxHeight: 340 },
    menuTitle: { color: '#c9c9c9', fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 6 },
    menuSection: {
        color: '#8f8f8f',
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    menuRowText: { flex: 1, color: '#e8e8e8', fontSize: 15 },
    menuRowTextActive: { color: '#fff', fontWeight: '700' },
    menuRowHint: { color: '#8f8f8f', fontSize: 12 },
    menuEmpty: { color: '#9a9a9a', fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },

    toast: {
        position: 'absolute',
        top: '50%',
        marginTop: -20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(0,0,0,0.65)',
    },
    toastLeft: { left: '8%' },
    toastRight: { right: '8%' },
    toastCenter: { alignSelf: 'center', left: 0, right: 0, alignItems: 'center', backgroundColor: 'transparent' },
    toastText: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

    fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', gap: 6 },
    fallbackText: { color: '#fff', fontWeight: '700' },
    fallbackHint: { color: '#9a9a9a', fontSize: 12 },
});

export default MovieboxDirectPlayer;
