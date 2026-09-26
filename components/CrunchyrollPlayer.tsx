import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
    AnimeStreamSource,
    resolveAnimeStream,
} from '@/services/animeStreamService';

export interface CrunchyrollPlayerProps {
    title: string;
    tmdbId?: string | number;
    season?: number;
    episode?: number;
    totalEpisodes?: number;
    initialAudio?: string;
    onClose?: () => void;
    onNextEpisode?: () => void;
    onPrevEpisode?: () => void;
    onSelectEpisode?: (ep: number) => void;
    onSwitchProvider?: () => void;
}

const IS_WEB = Platform.OS === 'web';
const NETFLIX_RED = '#E50914';

export function CrunchyrollPlayer({
    title,
    tmdbId,
    season = 1,
    episode = 1,
    totalEpisodes = 24,
    onClose,
    onNextEpisode,
    onPrevEpisode,
    onSelectEpisode,
}: CrunchyrollPlayerProps) {
    const iframeHostRef = useRef<HTMLDivElement | null>(null);
    const [streamData, setStreamData] = useState<AnimeStreamSource>(() =>
        resolveAnimeStream(title, season, episode, 'hindi', tmdbId)
    );

    const [loading, setLoading] = useState(true);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Re-resolve stream data when title, season, episode, or TMDB ID changes
    useEffect(() => {
        const next = resolveAnimeStream(title, season, episode, 'hindi', tmdbId);
        setStreamData(next);
        setLoading(true);
    }, [title, season, episode, tmdbId]);

    // Mount active stream iframe
    useEffect(() => {
        if (!IS_WEB) return;
        const host = iframeHostRef.current;
        if (!host) return;

        host.innerHTML = '';
        setLoading(true);

        const iframe = document.createElement('iframe');
        iframe.setAttribute('data-arena-embed', '1');
        iframe.src = streamData.embedUrl;
        iframe.title = `${title} Episode ${episode} (Hindi Dub)`;
        iframe.setAttribute(
            'allow',
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
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

        const loadTimeout = setTimeout(() => {
            setLoading(false);
        }, 1200);

        iframe.onload = () => {
            clearTimeout(loadTimeout);
            setLoading(false);
        };

        host.appendChild(iframe);

        return () => {
            clearTimeout(loadTimeout);
            try { iframe.onload = null; } catch {}
            try { iframe.src = 'about:blank'; } catch {}
            try { iframe.remove(); } catch {}
        };
    }, [streamData.embedUrl, title, episode]);

    const openDirectInNewTab = () => {
        if (IS_WEB) {
            window.open(streamData.embedUrl, '_blank', 'noopener,noreferrer');
        } else {
            Linking.openURL(streamData.embedUrl).catch(() => {});
        }
    };

    const pokeControls = useCallback(() => {
        setControlsVisible(true);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            if (!showEpisodesDrawer) setControlsVisible(false);
        }, 5000);
    }, [showEpisodesDrawer]);

    // Keyboard navigation
    useEffect(() => {
        if (!IS_WEB) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['input', 'textarea'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) return;

            switch (e.code) {
                case 'KeyN':
                    if (onNextEpisode) {
                        e.preventDefault();
                        onNextEpisode();
                    }
                    break;
                case 'KeyP':
                    if (onPrevEpisode) {
                        e.preventDefault();
                        onPrevEpisode();
                    }
                    break;
                case 'KeyE':
                    e.preventDefault();
                    setShowEpisodesDrawer(prev => !prev);
                    break;
                case 'Escape':
                    if (showEpisodesDrawer) {
                        setShowEpisodesDrawer(false);
                    } else if (onClose) {
                        onClose();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showEpisodesDrawer, onNextEpisode, onPrevEpisode, onClose]);

    if (!IS_WEB) {
        return (
            <View style={styles.nativeContainer}>
                <Ionicons name="play-circle" size={64} color={NETFLIX_RED} />
                <Text style={styles.nativeTitle}>{title}</Text>
                <Text style={styles.nativeSubtitle}>Hindi Dub (Episode {episode})</Text>
                <Pressable style={styles.nativeButton} onPress={openDirectInNewTab}>
                    <Text style={styles.nativeButtonText}>Play Stream</Text>
                </Pressable>
                <Pressable style={[styles.nativeButton, { backgroundColor: '#333', marginTop: 12 }]} onPress={onClose}>
                    <Text style={styles.nativeButtonText}>Close</Text>
                </Pressable>
            </View>
        );
    }

    const effectiveTotal = Math.max(totalEpisodes || 24, streamData.totalEpisodes || 24);
    const canGoNext = Boolean(onNextEpisode && (!effectiveTotal || episode < effectiveTotal));
    const canGoPrev = Boolean(onPrevEpisode && episode > 1);
    const episodeList = Array.from({ length: Math.min(effectiveTotal, 60) }, (_, i) => i + 1);

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: '#000',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                fontFamily: '"Helvetica Neue", Arial, sans-serif',
            }}
            onMouseMove={pokeControls}
            onClick={pokeControls}
        >
            {/* Top Control Bar */}
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 64,
                    padding: '0 20px',
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.75) 70%, rgba(0,0,0,0) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: controlsVisible ? 1 : 0,
                    pointerEvents: controlsVisible ? 'auto' : 'none',
                    transition: 'opacity 0.25s ease',
                    zIndex: 50,
                }}
            >
                {/* Left: Back button & Title Info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            onClose?.();
                        }}
                        style={{
                            background: 'rgba(255,255,255,0.15)',
                            border: '1px solid rgba(255,255,255,0.25)',
                            borderRadius: '50%',
                            width: 38,
                            height: 38,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            cursor: 'pointer',
                        }}
                        title="Back to Catalog (Esc)"
                    >
                        <Ionicons name="arrow-back" size={20} color="#fff" />
                    </button>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span
                                style={{
                                    backgroundColor: '#E50914',
                                    color: '#fff',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    fontWeight: 900,
                                    fontSize: 11,
                                    letterSpacing: 0.5,
                                }}
                            >
                                🇮🇳 HINDI DUB
                            </span>
                            <span
                                style={{
                                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                                    border: '1px solid rgba(34, 197, 94, 0.4)',
                                    color: '#4ade80',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                }}
                            >
                                1080P FULL HD • 0 ADS
                            </span>
                        </div>

                        <h2 style={{ margin: '3px 0 0 0', color: '#fff', fontSize: 15, fontWeight: 800 }}>
                            {title}
                            <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500, fontSize: 13, marginLeft: 8 }}>
                                S{season} : E{episode}
                            </span>
                        </h2>
                    </div>
                </div>

                {/* Right: Episodes Drawer & Close */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Episodes Drawer Trigger */}
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            setShowEpisodesDrawer(prev => !prev);
                        }}
                        style={{
                            background: showEpisodesDrawer ? '#E50914' : 'rgba(255,255,255,0.15)',
                            color: '#fff',
                            border: '1px solid rgba(255,255,255,0.2)',
                            padding: '6px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                        title="Browse episodes (E)"
                    >
                        <Ionicons name="list" size={15} color="#fff" />
                        <span>Episodes</span>
                    </button>

                    {/* Pop-out Button */}
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            openDirectInNewTab();
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'rgba(255,255,255,0.15)',
                            border: '1px solid rgba(255,255,255,0.3)',
                            borderRadius: 6,
                            padding: '6px 10px',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: 'pointer',
                        }}
                        title="Open Stream in new tab"
                    >
                        <Ionicons name="open-outline" size={14} color="#fff" />
                    </button>

                    {/* Close Button */}
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            onClose?.();
                        }}
                        style={{
                            background: 'rgba(255,255,255,0.15)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '50%',
                            width: 38,
                            height: 38,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            cursor: 'pointer',
                        }}
                        title="Close (Esc)"
                    >
                        <Ionicons name="close" size={20} color="#fff" />
                    </button>
                </div>
            </div>

            {/* Video Iframe Mount Host */}
            <div
                ref={iframeHostRef}
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#000',
                    flex: 1,
                }}
            />

            {/* Loading Indicator */}
            {loading && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 12,
                        pointerEvents: 'none',
                        zIndex: 20,
                    }}
                >
                    <ActivityIndicator size="large" color="#E50914" />
                    <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: 0.3 }}>
                        Loading Hindi Dub Stream…
                    </span>
                </div>
            )}

            {/* Bottom Episode Navigation Controls */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 20,
                    right: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    zIndex: 50,
                    opacity: controlsVisible ? 1 : 0,
                    pointerEvents: controlsVisible ? 'auto' : 'none',
                    transition: 'opacity 0.25s ease',
                }}
            >
                {canGoPrev && (
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            onPrevEpisode?.();
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'rgba(0,0,0,0.85)',
                            border: '1.5px solid rgba(255,255,255,0.25)',
                            color: '#fff',
                            padding: '8px 16px',
                            borderRadius: 24,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            backdropFilter: 'blur(10px)',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                        }}
                    >
                        <Ionicons name="play-skip-back" size={13} color="#fff" />
                        <span>Ep {episode - 1}</span>
                    </button>
                )}

                {canGoNext && (
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            onNextEpisode?.();
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            background: '#E50914',
                            border: '1.5px solid rgba(255,255,255,0.4)',
                            color: '#fff',
                            padding: '8px 18px',
                            borderRadius: 24,
                            fontSize: 12,
                            fontWeight: 900,
                            cursor: 'pointer',
                            boxShadow: '0 4px 18px rgba(229,9,20,0.5)',
                        }}
                    >
                        <span>Next Ep {episode + 1}</span>
                        <Ionicons name="play-skip-forward" size={14} color="#fff" />
                    </button>
                )}
            </div>

            {/* Episode List Drawer */}
            {showEpisodesDrawer && (
                <div
                    onClick={e => e.stopPropagation()}
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: 320,
                        backgroundColor: '#111',
                        borderLeft: '1px solid rgba(255,255,255,0.15)',
                        zIndex: 70,
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '-10px 0 30px rgba(0,0,0,0.8)',
                    }}
                >
                    <div
                        style={{
                            padding: '18px 20px',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        <div>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: 15, fontWeight: 800 }}>
                                Season {season} Episodes
                            </h3>
                            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                                Total {episodeList.length} episodes
                            </span>
                        </div>
                        <button
                            onClick={() => setShowEpisodesDrawer(false)}
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                borderRadius: '50%',
                                width: 32,
                                height: 32,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                cursor: 'pointer',
                            }}
                        >
                            <Ionicons name="close" size={18} color="#fff" />
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {episodeList.map(ep => {
                            const isCurrent = ep === episode;
                            return (
                                <button
                                    key={ep}
                                    onClick={() => {
                                        if (onSelectEpisode) onSelectEpisode(ep);
                                        setShowEpisodesDrawer(false);
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: '10px 12px',
                                        borderRadius: 8,
                                        background: isCurrent ? 'rgba(229, 9, 20, 0.25)' : 'rgba(255,255,255,0.04)',
                                        border: isCurrent ? '1.5px solid #E50914' : '1.5px solid transparent',
                                        color: '#fff',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'background 0.15s ease',
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 30,
                                            height: 30,
                                            borderRadius: 6,
                                            backgroundColor: isCurrent ? '#E50914' : 'rgba(255,255,255,0.1)',
                                            color: '#fff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: 800,
                                            fontSize: 13,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {isCurrent ? <Ionicons name="play" size={14} color="#fff" /> : ep}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: 13, color: isCurrent ? '#E50914' : '#fff' }}>
                                            Episode {ep}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                                            🇮🇳 Hindi Dub • 1080p Full HD
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

const styles = StyleSheet.create({
    nativeContainer: {
        flex: 1,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    nativeTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
        marginTop: 16,
        textAlign: 'center',
    },
    nativeSubtitle: {
        color: '#E50914',
        fontSize: 14,
        fontWeight: '600',
        marginTop: 6,
    },
    nativeButton: {
        backgroundColor: '#E50914',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        marginTop: 24,
    },
    nativeButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
