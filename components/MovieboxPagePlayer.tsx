import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MovieboxCroppedFrame } from './MovieboxCroppedFrame';
import { MovieboxLinkPanel } from './MovieboxLinkPanel';
import {
    buildMovieboxFrameProxyUrl,
    buildMovieboxPageUrl,
    MOVIEBOX_SERVER_LABEL,
} from '@/lib/moviebox';
import { describeMovieboxLink, getMovieboxLink, saveMovieboxLink } from '@/lib/movieboxLinks';

/**
 * "Server 2 · M2Box" — poora MovieBox watch page, sirf-player crop me.
 * ====================================================================
 * Player ke upar hamara koi UI nahi: bas upar-left ek chhota gola X (Esc se
 * bhi band), uske bagal me server switch pill, aur link badalne ka chhota
 * button. Frame ke andar M2Box ki poori site chalti hai (episode grid,
 * quality, subtitles sab wahi) — hum sirf dikhne wala hissa kaatte hain.
 *
 * Link ek baar chahiye: title row me `embed_url`/`videoUrl` me m2box link ho
 * to seedha chalta hai, warna panel link maangta hai aur use is browser me
 * title ke saath yaad rakhta hai (`lib/movieboxLinks.ts`).
 *
 * `allow-top-navigation` nahi diya jata — M2Box ki ads hamari tab hijack
 * nahi kar sakti. Baaki scripts/forms/popups allowed hain taaki site ke
 * apne controls (episode chunna, quality, subtitles) waise hi chalein.
 */

interface MovieboxPagePlayerProps {
    /** Title ke hisaab se stable key — link isi par yaad rehta hai. */
    linkKey: string;
    /** Title row se mila hua m2box link (agar hai). */
    initialLink?: string | null;
    title?: string;
    /** Series ke liye — page seedha usi episode se khulta hai. */
    season?: number;
    episode?: number;
    onClose: () => void;
    /** Server 1 par wapas jaane ke liye (cycle me switch). */
    onSwitchServer?: () => void;
    switchLabel?: string;
    /** Naya link save hone par (parent ko batane ke liye). */
    onLinkSaved?: (link: string) => void;
}

const FRAME_TIMEOUT_MS = 15000;

export function MovieboxPagePlayer({
    linkKey,
    initialLink,
    title,
    season,
    episode,
    onClose,
    onSwitchServer,
    switchLabel,
    onLinkSaved,
}: MovieboxPagePlayerProps) {
    const [link, setLink] = useState<string | null>(null);
    const [proxy, setProxy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /* ---------------------------- Link ---------------------------- */

    useEffect(() => {
        const saved = getMovieboxLink(linkKey);
        const next = (initialLink && initialLink.trim()) || saved?.url || null;
        setLink(next);
        setProxy(saved?.proxy ?? false);
        setLoading(Boolean(next));
        setTimedOut(false);
    }, [linkKey, initialLink]);

    const pageUrl = useMemo(
        () => (link ? buildMovieboxPageUrl(link, { se: season, ep: episode }) : null),
        [link, season, episode],
    );

    const frameSrc = useMemo(() => {
        if (!pageUrl) return null;
        return proxy ? buildMovieboxFrameProxyUrl(pageUrl) : pageUrl;
    }, [pageUrl, proxy]);

    /* --------------------------- Frame ---------------------------- */

    useEffect(() => {
        setTimedOut(false);
        if (!frameSrc) {
            setLoading(false);
            if (timerRef.current) clearTimeout(timerRef.current);
            return;
        }
        setLoading(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            setLoading(false);
            setTimedOut(true);
        }, FRAME_TIMEOUT_MS);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [frameSrc]);

    /* ---------------------------- Keys ---------------------------- */

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    /* --------------------------- Actions -------------------------- */

    const handlePlay = useCallback(
        (raw: string, opts: { proxy: boolean }) => {
            const page = buildMovieboxPageUrl(raw, { se: season, ep: episode });
            if (!page) return;
            saveMovieboxLink(linkKey, raw, { proxy: opts.proxy });
            setLink(raw.trim());
            setProxy(opts.proxy);
            setLoading(true);
            setTimedOut(false);
            onLinkSaved?.(raw.trim());
        },
        [episode, linkKey, onLinkSaved, season],
    );

    /**
     * Edit (link badalna): frame ko chup-chaap band karke panel dikhao.
     * about:blank pehle — warna purana page background me chalta reh sakta
     * hai (audio ke saath).
     */
    const editLink = useCallback(() => {
        setLink(null);
        setLoading(false);
        setTimedOut(false);
    }, []);

    /* --------------------------- Render --------------------------- */

    return (
        <View style={styles.root} {...({ dataSet: { tvScope: 'player' } } as any)}>
            {frameSrc ? (
                <MovieboxCroppedFrame
                    key={frameSrc}
                    src={frameSrc}
                    title={title}
                    onLoad={() => {
                        if (timerRef.current) clearTimeout(timerRef.current);
                        setLoading(false);
                        setTimedOut(false);
                    }}
                />
            ) : (
                <MovieboxLinkPanel
                    title={title}
                    initialLink={link}
                    initialProxy={proxy}
                    onPlay={handlePlay}
                    onBack={onSwitchServer}
                    backLabel={switchLabel || 'Server 1'}
                />
            )}

            {frameSrc && loading ? (
                <View style={styles.loadingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.loadingText}>{MOVIEBOX_SERVER_LABEL} page khul raha hai…</Text>
                </View>
            ) : null}

            {/* Top bar: bas X + server switch + link badalna. */}
            <View style={styles.topBar} pointerEvents="box-none">
                <Pressable
                    style={styles.iconButton}
                    onPress={onClose}
                    accessibilityLabel="Close player"
                    accessibilityRole="button"
                    testID="moviebox-close"
                >
                    <Ionicons name="close" size={22} color="#fff" />
                </Pressable>

                {onSwitchServer ? (
                    <Pressable
                        style={styles.serverPill}
                        onPress={onSwitchServer}
                        accessibilityLabel={`Switch to ${switchLabel || 'Server 1'}`}
                        testID="moviebox-switch-server"
                    >
                        <Ionicons name="swap-horizontal" size={14} color="#fff" />
                        <Text style={styles.serverPillText}>{switchLabel || 'Server 1'}</Text>
                    </Pressable>
                ) : null}

                {frameSrc ? (
                    <Pressable
                        style={[styles.iconButton, styles.editButton]}
                        onPress={editLink}
                        accessibilityLabel="Change M2Box link"
                        testID="moviebox-edit-link"
                    >
                        <Ionicons name="link-outline" size={18} color="#fff" />
                    </Pressable>
                ) : null}
            </View>

            {/* Seedha frame khali aaya (frame-blocking) — proxy ka rasta do. */}
            {frameSrc && timedOut && !proxy ? (
                <View style={styles.hintBar} pointerEvents="box-none">
                    <Text style={styles.hintText}>
                        Frame khali laga? M2Box framing rok raha ho to proxy se kholo.
                    </Text>
                    <Pressable
                        style={styles.hintButton}
                        onPress={() => {
                            setTimedOut(false);
                            setProxy(true);
                        }}
                        accessibilityLabel="Reload through proxy"
                    >
                        <Ionicons name="git-network-outline" size={14} color="#000" />
                        <Text style={styles.hintButtonText}>Proxy se kholo</Text>
                    </Pressable>
                </View>
            ) : null}

            {frameSrc && proxy ? (
                <View style={styles.proxyBadge} pointerEvents="none">
                    <Text style={styles.proxyBadgeText}>PROXY</Text>
                </View>
            ) : null}

            {frameSrc && link ? (
                <View style={styles.titleBadge} pointerEvents="none">
                    <Text style={styles.titleBadgeText} numberOfLines={1}>
                        {MOVIEBOX_SERVER_LABEL} · {describeMovieboxLink(link)}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', position: 'relative' },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        gap: 14,
    },
    loadingText: { color: '#ccc', fontSize: 13 },
    topBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 12,
        paddingTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 3,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    editButton: { marginLeft: 'auto', opacity: 0.6 },
    serverPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.25)',
        opacity: 0.75,
    },
    serverPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    hintBar: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: 'rgba(15,15,15,0.92)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.18)',
        zIndex: 4,
    },
    hintText: { color: '#cfcfcf', fontSize: 12, flex: 1, lineHeight: 17 },
    hintButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#fff',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 6,
    },
    hintButtonText: { color: '#000', fontSize: 12, fontWeight: '700' },
    proxyBadge: {
        position: 'absolute',
        right: 14,
        bottom: 14,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.14)',
        zIndex: 2,
    },
    proxyBadgeText: { color: '#d0d0d0', fontSize: 9, letterSpacing: 0.8, fontWeight: '700' },
    titleBadge: {
        position: 'absolute',
        left: 12,
        bottom: 14,
        maxWidth: '60%',
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: 'rgba(0,0,0,0.45)',
        zIndex: 2,
    },
    titleBadgeText: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },
});

export default MovieboxPagePlayer;
