import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { DirectStream } from '@/lib/movieboxDirect';

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
 *   - ek tap = play/pause (koi permanent control bar nahi — sirf 0.8s ka toast)
 *   - 0 se pehle / duration ke bahar kuch nahi
 *
 * Kuch bhi galat ho (stream shuru na ho / HLS support na ho) to `onUnavailable`
 * — parent turant purane cropped iframe par chala jata hai (koi regression nahi).
 */

const IS_WEB = Platform.OS === 'web';
const STEP_SECONDS = 10;
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

        host.addEventListener('pointerdown', onPointerDown, true);

        return () => {
            unmounted = true;
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

    if (!IS_WEB) {
        return (
            <View style={styles.fallback}>
                <Text style={styles.fallbackText}>{title || 'MovieBox'}</Text>
                <Text style={styles.fallbackHint}>Web preview me chalta hai.</Text>
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <View ref={hostRef as any} style={styles.videoHost} testID="moviebox-direct-video" collapsable={false} />
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
    fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', gap: 6 },
    fallbackText: { color: '#fff', fontWeight: '700' },
    fallbackHint: { color: '#9a9a9a', fontSize: 12 },
});

export default MovieboxDirectPlayer;
