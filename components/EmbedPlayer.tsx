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
import { detectProviderFromUrl } from '@/lib/embeds';
import { useTvBackHandler } from '@/hooks/useTvNavigation';
import { enterPlayerFullscreen } from '@/lib/playerFullscreen';
import { isPhoneUserAgent } from '@/lib/phonePlayer';
import {
    SEEK_NUDGE_DELAYS,
    buildSeekMessages,
    guessSeconds,
    sniffTimeEvent,
} from '@/lib/continueWatching';

/**
 * Third-party iframe embed player.
 *
 * EMBED SAFETY:
 *   - The iframe sandbox blocks ad popups and top-level redirects while keeping
 *     the capabilities a video provider needs to play in-frame.
 *   - NO contentWindow/document access (cross-origin → SecurityError).
 *   - Player MUST open after a user click — never auto-open.
 *
 * PLAYBACK POSITION (Continue Watching):
 *   - The player frame is asked for its playhead through postMessage. When the
 *     provider answers, the position is exact.
 *   - When it stays silent, a wall-clock estimator keeps the position roughly
 *     right (same fallback the Crunchyroll page uses).
 *   - `resumeAt` replays that position into the frame so a title continues
 *     exactly where it was left.
 */

export interface EmbedPlayerProps {
    src: string;
    title?: string;
    onClose?: () => void;
    onSwitchProvider?: () => void;
    /** Official title page to offer if the third-party player cannot load. */
    fallbackUrl?: string;
    timeoutMs?: number;
    /** Live playback position of the media, in seconds. */
    onProgress?: (info: { seconds: number; duration: number; ended: boolean }) => void;
    /** Position (seconds) the media should continue from. */
    resumeAt?: number;
    /** The player reported that the media finished. */
    onEnded?: () => void;
    /** Server jo abhi chal raha hai (Nxsha / NHD / Custom) — switcher pill. */
    serverName?: string;
    /** Agla server (switcher pill ka label), jab switch available ho. */
    nextServerName?: string;
    /**
     * Sirf Server 3 ke liye: abhi ka third-party source (Videasy / VidFast …)
     * aur ek tap me agla source. Ek hi pill — teen button nahi.
     */
    sourceName?: string;
    onCycleSource?: () => void;
}

const IS_WEB = Platform.OS === 'web';
const isDirectVideoSource = (url: string) => /\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(url);
// Nxsha does not expose scan/playback events to its embedding page. This is
// only a visual cover for the scan, not a way to speed it up or auto-play it.
const SCAN_COVER_DELAY_MS = 350;
// Bound the visual cover so a stream that loads quickly is not hidden too long.
const SCAN_COVER_MS = 12000;

export function EmbedPlayer({
    src,
    title,
    onClose,
    onSwitchProvider,
    fallbackUrl,
    timeoutMs = 12000,
    onProgress,
    resumeAt,
    onEnded,
    serverName,
    nextServerName,
    sourceName,
    onCycleSource,
}: EmbedPlayerProps) {
    const [loading, setLoading] = useState(true);
    const [timedOut, setTimedOut] = useState(false);
    const [scanCovered, setScanCovered] = useState(false);
    const directVideo = isDirectVideoSource(src);
    const nxshaEmbed = !directVideo && detectProviderFromUrl(src) === 'nxsha';
    const hostRef = useRef<View | HTMLDivElement | null>(null);
    const containerRef = useRef<View | HTMLDivElement | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /* ------------------------------------------------------------------ */
    /* Playback position (Continue Watching)                              */
    /* ------------------------------------------------------------------ */

    /**
     * The playhead we know about:
     *   baseSec  — the last position reported by the player (or the resume
     *              point we started from),
     *   baseStamp— when that position was true,
     *   dur      — media duration, when the player reports one,
     *   started  — the media is actually rolling (the viewer pressed play),
     *   paused   — the player said it is paused,
     *   ended    — the media finished.
     */
    const playRef = useRef({
        baseSec: 0,
        baseStamp: 0,
        dur: 0,
        started: false,
        paused: false,
        ended: false,
    });
    const progressCbRef = useRef(onProgress);
    progressCbRef.current = onProgress;
    const endedCbRef = useRef(onEnded);
    endedCbRef.current = onEnded;
    // The window losing focus pauses the wall-clock estimator: the video may
    // keep playing in the background, but we must not count that time.
    const blurredRef = useRef(false);
    /** Last position handed to the tracker — keeps the writes sane. */
    const lastFlushSec = useRef(-10);

    /** Is the media really playing right now? */
    const isRunning = useCallback(() => {
        const p = playRef.current;
        if (!p.started || p.paused || p.ended) return false;
        if (blurredRef.current) return false;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
        return true;
    }, []);

    /** The playhead right now, in seconds. */
    const positionSec = useCallback(() => {
        const p = playRef.current;
        const extra = isRunning() && p.baseStamp ? (Date.now() - p.baseStamp) / 1000 : 0;
        return Math.max(0, p.baseSec + extra);
    }, [isRunning]);

    /** Freeze the current position so the clock can start again from it. */
    const rebase = useCallback(() => {
        const p = playRef.current;
        if (!p.baseStamp) return;
        if (isRunning()) p.baseSec = Math.max(0, p.baseSec + (Date.now() - p.baseStamp) / 1000);
        p.baseStamp = Date.now();
    }, [isRunning]);

    /** Hand the current position to whoever is tracking it. */
    const flushProgress = useCallback((force = false) => {
        const p = playRef.current;
        if (!p.started) return;
        const seconds = Math.max(0, Math.floor(positionSec()));
        // A brand new title has no position worth storing yet.
        if (!force && seconds <= 3) return;
        progressCbRef.current?.({
            seconds,
            duration: Math.floor(p.dur || 0),
            ended: p.ended,
        });
    }, [positionSec]);

    /** Pin the playhead to a position the player reported. */
    const setPosition = useCallback((seconds: number, duration?: number | null) => {
        const p = playRef.current;
        rebase();
        p.baseSec = Math.max(0, Math.floor(seconds || 0));
        p.baseStamp = Date.now();
        if (duration && duration > 0) p.dur = duration;
        // A media that is still running is not finished, whatever an old
        // "ended" flag said.
        if (p.dur && p.baseSec < p.dur * 0.9) p.ended = false;
        // The player reports a time event several times per second: only the
        // meaningful steps are worth storing.
        if (Math.abs(p.baseSec - lastFlushSec.current) < 2) return;
        lastFlushSec.current = p.baseSec;
        flushProgress(true);
    }, [rebase, flushProgress]);

    /**
     * Video chalu ho gayi — owner ka rule: **play dabne ke baad player me
     * server badalne ka option nahi** dikhna chahiye. Server ab detail
     * screen (Hindi/Multi) se chuna jata hai.
     */
    const [rolling, setRolling] = useState(false);

    /** The viewer pressed play inside the frame: the media starts rolling. */
    const markStarted = useCallback(() => {
        const p = playRef.current;
        if (p.started) return;
        p.started = true;
        p.paused = false;
        p.baseStamp = Date.now();
        setRolling(true);
    }, []);

    /**
     * Spray a seek command into the player frame.
     *
     * The provider boots at its own pace, so the command is repeated a few
     * times — the same schedule the Crunchyroll page uses.
     */
    const spraySeek = useCallback((seconds: number) => {
        const target = Math.floor(seconds || 0);
        if (!target || target < 5) return;
        const messages = buildSeekMessages(target);
        SEEK_NUDGE_DELAYS.forEach((delay) => {
            setTimeout(() => {
                const frame = iframeRef.current;
                const target = frame?.contentWindow;
                if (!target) return;
                messages.forEach((message) => {
                    try {
                        target.postMessage(message as any, '*');
                    } catch {}
                });
            }, delay);
        });
    }, []);

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
        if (!IS_WEB || directVideo) return;
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
        // Do not grant `allow-popups` or top navigation: provider ads cannot
        // open tabs/windows or replace the Netflix app while the video plays.
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
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
            // The provider player is up: replay the resume point into it.
            if (resumeAt) spraySeek(resumeAt);
        };
        host.appendChild(iframe);
        iframeRef.current = iframe;
        // The resume point is sprayed as soon as the frame exists, and again
        // once the provider finished booting (see iframe.onload above).
        if (resumeAt) spraySeek(resumeAt);
        return () => {
            killIframe();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, title, directVideo]);

    // A new source is a new media: start from a clean playhead, seeded with
    // the position the viewer wants to continue from.
    useEffect(() => {
        const from = Math.max(0, Math.floor(resumeAt || 0));
        playRef.current = {
            baseSec: from,
            baseStamp: Date.now(),
            dur: 0,
            started: false,
            paused: false,
            ended: false,
        };
        lastFlushSec.current = -10;
    }, [src, resumeAt]);

    // A direct video file can be seeked precisely — no guessing needed.
    useEffect(() => {
        if (!directVideo) return;
        const from = Math.max(0, Math.floor(resumeAt || 0));
        if (!from) return;
        const video = videoRef.current;
        if (!video) return;
        try {
            video.currentTime = from;
        } catch {}
    }, [directVideo, resumeAt, src]);

    // The provider player reports its playhead through postMessage. When it
    // does, the position is exact; when it stays silent the wall-clock
    // estimator keeps it roughly right.
    useEffect(() => {
        if (!IS_WEB || typeof window === 'undefined') return;
        const onMessage = (event: MessageEvent) => {
            const data = event?.data;
            if (data && typeof data === 'object') {
                const body: any =
                    data.data && typeof data.data === 'object' ? data.data : {};
                const name = [
                    data.event,
                    data.type,
                    data.name,
                    body.event,
                    body.type,
                    body.name,
                ]
                    .join(' ')
                    .toLowerCase();
                if (/ended|finish|complete/.test(name)) {
                    // The player says the media finished — that is unambiguous,
                    // even when it does not report the duration.
                    const duration =
                        guessSeconds(data.duration) ??
                        guessSeconds(body.duration) ??
                        playRef.current.dur;
                    const p = playRef.current;
                    markStarted();
                    p.ended = true;
                    if (duration) {
                        p.baseSec = duration;
                        p.baseStamp = Date.now();
                    }
                    flushProgress(true);
                    endedCbRef.current?.();
                    return;
                }
                if (/pause|paused/.test(name)) {
                    const p = playRef.current;
                    if (p.started && !p.paused) {
                        rebase();
                        p.paused = true;
                    }
                } else if (/\bplay\b|playing|player_progress|timeupdate/.test(name)) {
                    const p = playRef.current;
                    markStarted();
                    if (p.paused) {
                        p.paused = false;
                        p.baseStamp = Date.now();
                    }
                }
            }
            const hit = sniffTimeEvent(data);
            if (hit) {
                markStarted();
                setPosition(hit.t, hit.dur);
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [flushProgress, markStarted, rebase, setPosition]);

    // Keep the stored position fresh while the media rolls, and store it one
    // last time when the tab is hidden or the player goes away.
    useEffect(() => {
        if (!IS_WEB) return;
        const tick = setInterval(() => flushProgress(false), 5000);
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                rebase();
                flushProgress(true);
            } else if (playRef.current.started) {
                playRef.current.baseStamp = Date.now();
            }
        };
        const onBlur = () => {
            blurredRef.current = true;
            rebase();
            flushProgress(false);
        };
        const onFocus = () => {
            blurredRef.current = false;
            if (playRef.current.started) playRef.current.baseStamp = Date.now();
        };
        const onHide = () => {
            rebase();
            flushProgress(true);
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onHide);
        return () => {
            clearInterval(tick);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('beforeunload', onHide);
            // The player is going away: do not lose the position.
            rebase();
            flushProgress(true);
        };
    }, [flushProgress, rebase]);

    // Clicking the red Play button happens inside Nxsha's cross-origin frame;
    // the parent does not receive that click. Focus moving into the iframe is
    // the only signal available here. Wait until the click has completed so
    // the cover never steals it, then show our own neutral loading screen.
    // Auto-reveal after a bounded time: Nxsha has no scan-complete signal, so
    // keeping the cover up indefinitely could hide an already playing video.
    useEffect(() => {
        setScanCovered(false);
        if (!IS_WEB || !nxshaEmbed) return;
        let focusTimer: ReturnType<typeof setTimeout> | undefined;
        let revealTimer: ReturnType<typeof setTimeout> | undefined;
        let started = false;
        const onBlur = () => {
            if (started || focusTimer) return;
            focusTimer = setTimeout(() => {
                focusTimer = undefined;
                if (document.visibilityState === 'hidden' ||
                    !iframeRef.current?.isConnected ||
                    document.activeElement !== iframeRef.current) return;
                started = true;
                setScanCovered(true);
                revealTimer = setTimeout(() => setScanCovered(false), SCAN_COVER_MS);
            }, SCAN_COVER_DELAY_MS);
        };
        // Depending on the browser, either the parent window blurs or the
        // iframe element receives a focus event when it is clicked.
        const iframe = iframeRef.current;
        window.addEventListener('blur', onBlur);
        iframe?.addEventListener('focus', onBlur);
        return () => {
            window.removeEventListener('blur', onBlur);
            iframe?.removeEventListener('focus', onBlur);
            if (focusTimer) clearTimeout(focusTimer);
            if (revealTimer) clearTimeout(revealTimer);
        };
    }, [src, title, nxshaEmbed]);

    // The viewer pressed play inside the provider frame: from now on the
    // media is rolling, so the wall-clock estimator may follow it.
    useEffect(() => {
        if (!IS_WEB) return;
        const onFocusIn = () => markStarted();
        const onWindowBlur = () => {
            if (document.activeElement === iframeRef.current) markStarted();
        };
        const iframe = iframeRef.current;
        window.addEventListener('blur', onWindowBlur);
        iframe?.addEventListener('focus', onFocusIn);
        return () => {
            window.removeEventListener('blur', onWindowBlur);
            iframe?.removeEventListener('focus', onFocusIn);
        };
    }, [src, title, markStarted]);

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

    /* ------------------------------------------------------------------ */
    /* Phone: landscape SIRF user ke fullscreen par (owner: "humara landscape
       nahi… jab user full screen karega tab hi landscape hoga") — play dabate
       hi koi auto-fullscreen nahi. Top bar ka button user-initiated hai:
       fullscreen + landscape lock, best effort. */
    /* ------------------------------------------------------------------ */

    const isPhoneWeb =
        IS_WEB && typeof navigator !== 'undefined' && isPhoneUserAgent(navigator.userAgent);
    const canAutoFullscreen = isPhoneWeb;

    useTvBackHandler(() => {
        handleClose();
        return true;
    }, true);

    const openExternal = (url: string) => {
        if (IS_WEB) {
            try { window.open(url, '_blank', 'noopener'); } catch {}
        } else {
            Linking.openURL(url).catch(() => {});
        }
    };

    const openInNewTab = () => openExternal(src);
    const openOfficialTitle = () => {
        if (fallbackUrl) openExternal(fallbackUrl);
    };

    if (!IS_WEB) {
        return (
            <View style={styles.nativeFallback}>
                <Ionicons name="play-circle-outline" size={56} color="#E50914" />
                <Text style={styles.nativeTitle}>{title ?? 'Video player'}</Text>
                <Text style={styles.nativeHint}>
                    Embedded player is available in the web preview. Tap below to open in your browser.
                </Text>
                <Pressable
                    style={styles.nativeButton}
                    onPress={fallbackUrl ? openOfficialTitle : openInNewTab}
                >
                    <Ionicons name="open-outline" size={18} color="#000" />
                    <Text style={styles.nativeButtonText}>
                        {fallbackUrl ? 'Watch on Netflix' : 'Open Player'}
                    </Text>
                </Pressable>
                {fallbackUrl ? (
                    <Pressable onPress={openInNewTab} style={styles.nativeGhostButton}>
                        <Text style={styles.nativeGhostText}>Open embed player</Text>
                    </Pressable>
                ) : null}
                {onClose ? (
                    <Pressable onPress={handleClose} style={styles.nativeGhostButton}>
                        <Text style={styles.nativeGhostText}>Close</Text>
                    </Pressable>
                ) : null}
            </View>
        );
    }

    return (
        <View
            ref={(r: any) => { containerRef.current = r; }}
            style={styles.container}
            testID="embed-player"
            {...({ dataSet: { tvScope: 'player' } } as any)}
        >
            {directVideo ? (
                React.createElement('video', {
                    ref: (node: any) => { videoRef.current = node; },
                    src,
                    autoPlay: true,
                    controls: true,
                    playsInline: true,
                    onCanPlay: () => {
                        if (timerRef.current) clearTimeout(timerRef.current);
                        setLoading(false);
                        setTimedOut(false);
                    },
                    onError: () => {
                        setLoading(false);
                        setTimedOut(true);
                    },
                    onPlay: () => markStarted(),
                    onPause: () => {
                        const p = playRef.current;
                        if (p.started && !p.paused) {
                            rebase();
                            p.paused = true;
                        }
                    },
                    onTimeUpdate: (event: any) => {
                        const video = event?.target as HTMLVideoElement | undefined;
                        if (!video) return;
                        markStarted();
                        setPosition(video.currentTime, Number.isFinite(video.duration) ? video.duration : null);
                    },
                    onEnded: () => {
                        const p = playRef.current;
                        p.ended = true;
                        flushProgress(true);
                        endedCbRef.current?.();
                    },
                    style: {
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: '#000',
                        objectFit: 'contain',
                    },
                })
            ) : (
                <View
                    ref={(r: any) => { hostRef.current = r; }}
                    style={styles.frameWrap}
                    collapsable={false}
                />
            )}

            {loading && !timedOut ? (
                <View style={styles.loadingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.loadingText}>Loading player…</Text>
                </View>
            ) : null}

            {scanCovered && !loading && !timedOut ? (
                <View style={styles.scanCover} pointerEvents="none" testID="nxsha-scan-cover">
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.scanCoverText}>Loading video…</Text>
                </View>
            ) : null}

            {timedOut ? (
                <View style={styles.timeoutOverlay}>
                    <Ionicons name="alert-circle-outline" size={36} color="#fff" />
                    <Text style={styles.timeoutTitle}>{directVideo ? 'Preview video did not load' : 'Player has not loaded yet'}</Text>
                    <Text style={styles.timeoutText}>
                        {directVideo
                            ? 'The preview URL could not load in this browser. Try opening it in a new tab.'
                            : 'An ad-blocker or popup blocker probably stopped the embed. Open it in a new tab, or try another player.'}
                    </Text>
                    {fallbackUrl ? (
                        <Pressable style={styles.openButton} onPress={openOfficialTitle}>
                            <Ionicons name="open-outline" size={16} color="#000" />
                            <Text style={styles.openButtonText}>Watch on Netflix</Text>
                        </Pressable>
                    ) : (
                        <Pressable style={styles.openButton} onPress={openInNewTab}>
                            <Ionicons name="open-outline" size={16} color="#000" />
                            <Text style={styles.openButtonText}>Open in new tab</Text>
                        </Pressable>
                    )}
                    {fallbackUrl ? (
                        <Pressable style={styles.ghostButton} onPress={openInNewTab}>
                            <Ionicons name="open-outline" size={16} color="#fff" />
                            <Text style={styles.ghostButtonText}>Open embed in new tab</Text>
                        </Pressable>
                    ) : null}
                    {onSwitchProvider ? (
                        <Pressable style={styles.ghostButton} onPress={onSwitchProvider}>
                            <Ionicons name="swap-horizontal" size={16} color="#fff" />
                            <Text style={styles.ghostButtonText}>Switch player</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}

            <View style={styles.topBar} pointerEvents="box-none">
                <Pressable
                    style={styles.iconButton}
                    onPress={handleClose}
                    accessibilityLabel="Close player"
                    tabIndex={0}
                    accessibilityRole="button"
                    {...({
                        dataSet: {
                            tvFocusable: 'true',
                            tvRow: 'player-top',
                            tvId: 'player-close',
                            tvInitial: 'true',
                        },
                    } as any)}
                >
                    <Ionicons name="close" size={22} color="#fff" />
                </Pressable>

                {/**
                 * Server switcher: Nxsha/NHD/custom ke saath M2Box (Server 2)
                 * bhi cycle me hai. Bina is button ke dusre server tak pahunchne
                 * ka koi rasta nahi tha (switch sirf timeout overlay me tha).
                 */}
                {onSwitchProvider && nextServerName && !rolling ? (
                    <Pressable
                        style={styles.serverPill}
                        onPress={onSwitchProvider}
                        accessibilityLabel={`Switch server to ${nextServerName}`}
                        accessibilityRole="button"
                        testID="embed-server-switch"
                    >
                        <Ionicons name="swap-horizontal" size={14} color="#fff" />
                        <Text style={styles.serverPillText}>
                            {serverName ? `${serverName} → ${nextServerName}` : nextServerName}
                        </Text>
                    </Pressable>
                ) : null}

                {/**
                 * Server 3 ka source switch — ek pill, tap par agla provider.
                 * Owner ka pattern: naya source pehle optional, aur agar wo
                 * ruk ruk kar chale to user ko atkna na pade.
                 */}
                {sourceName && onCycleSource ? (
                    <Pressable
                        style={styles.sourcePill}
                        onPress={onCycleSource}
                        accessibilityRole="button"
                        accessibilityLabel={`Change source, now ${sourceName}`}
                        testID="embed-source-cycle"
                    >
                        <Text style={styles.sourcePillText}>{sourceName} ⟳</Text>
                    </Pressable>
                ) : null}


                {canAutoFullscreen ? (
                    <Pressable
                        style={styles.iconButton}
                        onPress={() => enterPlayerFullscreen(containerRef.current as any)}
                        accessibilityLabel="Full screen"
                        accessibilityRole="button"
                    >
                        <Ionicons name="scan" size={20} color="#fff" />
                    </Pressable>
                ) : null}
            </View>

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
    serverPill: {
        height: 32,
        marginLeft: 8,
        paddingHorizontal: 12,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.25)',
        opacity: 0.8,
    },
    serverPillText: { color: '#fff', fontSize: 11, fontWeight: '600' },
    /** Server 3 ka source switch (ek pill). */
    sourcePill: {
        height: 32,
        marginLeft: 8,
        paddingHorizontal: 10,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(229,9,20,0.75)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.3)',
    },
    sourcePillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)', gap: 14,
    },
    loadingText: { color: '#ccc', fontSize: 13 },
    scanCover: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000',
        alignItems: 'center', justifyContent: 'center', gap: 14, zIndex: 1,
    },
    scanCoverText: { color: '#ccc', fontSize: 14 },
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
