import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MovieboxCroppedFrame } from './MovieboxCroppedFrame';
import { MovieboxLinkPanel } from './MovieboxLinkPanel';
import {
    buildMovieboxFrameProxyUrl,
    buildMovieboxPageUrl,
    buildMovieboxSearchUrl,
    MOVIEBOX_SERVER_LABEL,
} from '@/lib/moviebox';
import { describeMovieboxLink, getMovieboxLink, saveMovieboxLink } from '@/lib/movieboxLinks';
import { resolveMovieboxLive } from '@/lib/movieboxResolve';

/**
 * "Server 2 · M2Box" — poora MovieBox watch page, sirf-player crop me.
 * ====================================================================
 * Player ke upar hamara koi UI nahi: bas upar-left ek chhota gola X (Esc se
 * bhi band), uske bagal me server switch pill, aur link badalne ka chhota
 * button. Frame ke andar M2Box ki poori site chalti hai (episode grid,
 * quality, subtitles sab wahi) — hum sirf dikhne wala hissa kaatte hain.
 *
 * Link kahan se aata hai (is order me):
 *   1. title row ka `embed_url`/`videoUrl`,
 *   2. catalog ke liye baked link (`data/moviebox-links.json`),
 *   3. browser me pehle save hua link,
 *   4. **live resolve** — `/api/moviebox-resolve` MovieBox par khud dhoondhta hai
 *      (`lib/movieboxResolve.ts`), taaki user ko link paste na karna pade.
 * Sab fail ho jaye tabhi paste panel aata hai.
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
    /** Live resolve ke liye — MovieBox par sahi subject chunne me madad. */
    year?: number | string;
    mediaType?: 'movie' | 'tv';
    /** Band karo to live resolve nahi hoga (standalone /moviebox page). */
    autoResolve?: boolean;
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
    year,
    mediaType,
    autoResolve = true,
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
    /** Live resolve chal raha hai (baked/saved link nahi mila). */
    const [resolving, setResolving] = useState(false);
    /**
     * Live resolve chala par title ka watch page MovieBox par hai hi nahi.
     * Tab paste maangne ke bajaye MovieBox ke apne search results frame me
     * khulte hain — wahan se user seedha play kar sakta hai.
     */
    const [searchFallback, setSearchFallback] = useState(false);
    /** User ne search ke bajaye khud link paste karna chuna. */
    const [manualEntry, setManualEntry] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /* ---------------------------- Link ---------------------------- */

    useEffect(() => {
        const saved = getMovieboxLink(linkKey);
        const next = (initialLink && initialLink.trim()) || saved?.url || null;
        setLink(next);
        setProxy(saved?.proxy ?? false);
        setLoading(Boolean(next));
        setTimedOut(false);
        setSearchFallback(false);
        setManualEntry(false);
    }, [linkKey, initialLink]);

    /**
     * Koi link nahi mila (na row, na baked catalog, na saved) — to poochhne ke
     * bajaye khud dhoondho. Resolve hote hi frame khul jata hai.
     */
    useEffect(() => {
        if (!autoResolve || link || initialLink || !title) return;
        let cancelled = false;
        setResolving(true);
        setSearchFallback(false);
        resolveMovieboxLive(
            { title, year, mediaType },
            { key: linkKey, storeKey: linkKey },
        )
            .then((result) => {
                if (cancelled) return;
                if (result?.entry?.url) {
                    setLink(result.entry.url);
                    setProxy(false);
                    setLoading(true);
                    onLinkSaved?.(result.entry.url);
                } else {
                    setSearchFallback(true);
                    setLoading(true);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSearchFallback(true);
                    setLoading(true);
                }
            })
            .finally(() => {
                if (!cancelled) setResolving(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoResolve, link, initialLink, linkKey, title, year, mediaType]);

    const pageUrl = useMemo(
        () => (link ? buildMovieboxPageUrl(link, { se: season, ep: episode }) : null),
        [link, season, episode],
    );

    /** Search fallback ka page (sirf jab watch page hi na mile). */
    const searchUrl = useMemo(
        () => (searchFallback && !link ? buildMovieboxSearchUrl(title) : null),
        [searchFallback, link, title],
    );

    const frameSrc = useMemo(() => {
        if (searchUrl) return searchUrl;
        if (!pageUrl) return null;
        return proxy ? buildMovieboxFrameProxyUrl(pageUrl) : pageUrl;
    }, [pageUrl, proxy, searchUrl]);

    /** Frame me search results khule hain (watch page nahi). */
    const isSearchFrame = Boolean(searchUrl);

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
        setSearchFallback(false);
        setManualEntry(true);
        setLoading(false);
        setTimedOut(false);
    }, []);

    /** Search frame se wapas watch page par (live resolve dobara chalega). */
    const retryResolve = useCallback(() => {
        setSearchFallback(false);
        setManualEntry(false);
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
                    allowScroll={isSearchFrame}
                    onLoad={() => {
                        if (timerRef.current) clearTimeout(timerRef.current);
                        setLoading(false);
                        setTimedOut(false);
                    }}
                />
            ) : resolving ? (
                <View style={styles.resolving} {...({ dataSet: { movieboxResolving: '1' } } as any)}>
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.resolvingTitle}>Server 2 taiyaar ho raha hai</Text>
                    <Text style={styles.resolvingText}>
                        MovieBox par “{title}” dhoondha ja raha hai — link khud lag jayega.
                    </Text>
                </View>
            ) : searchFallback && !manualEntry ? null : (
                <MovieboxLinkPanel
                    title={title}
                    notice={
                        'MovieBox par is title ka watch page nahi mila. Wahan se link copy karke yahan paste kar do, ya thodi der baad dobara try karo.'
                    }
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

            {/* MovieBox par title hi nahi — search results khule hain. */}
            {isSearchFrame ? (
                <View style={styles.searchBar} pointerEvents="box-none">
                    <Text style={styles.searchBarText} numberOfLines={2}>
                        MovieBox par “{title}” ka watch page nahi mila — uske search results khule hain.
                        Neeche se title kholo, ya link paste kar do.
                    </Text>
                    <View style={styles.searchBarActions}>
                        <Pressable
                            style={styles.searchBarButton}
                            onPress={retryResolve}
                            accessibilityLabel="MovieBox par dobara dhoondho"
                            testID="moviebox-retry-resolve"
                        >
                            <Ionicons name="refresh" size={13} color="#000" />
                            <Text style={styles.searchBarButtonText}>Dobara dhoondho</Text>
                        </Pressable>
                        <Pressable
                            style={styles.searchBarButton}
                            onPress={editLink}
                            accessibilityLabel="Link paste karo"
                            testID="moviebox-manual-link"
                        >
                            <Ionicons name="link-outline" size={13} color="#000" />
                            <Text style={styles.searchBarButtonText}>Link paste karo</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}

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
    resolving: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 12,
    },
    resolvingTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
    resolvingText: { color: '#9a9a9a', fontSize: 13, textAlign: 'center', maxWidth: 420, lineHeight: 20 },
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
    searchBar: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        backgroundColor: 'rgba(12,12,12,0.92)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
    },
    searchBarText: { color: '#d8d8d8', fontSize: 12.5, lineHeight: 18 },
    searchBarActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    searchBarButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#e6e6e6',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    searchBarButtonText: { color: '#000', fontSize: 12, fontWeight: '600' },
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
