import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
    Text,
    Dimensions,
} from 'react-native';
import { EmbedPlayer } from './EmbedPlayer';
import {
    PROVIDERS,
    ProviderId,
    buildEmbedUrl,
    BuildEmbedParams,
} from '@/lib/embeds';
import {
    EmbedSettings,
    loadSettings,
    templateOverridesFor,
} from '@/lib/settings';

/**
 * Full-screen player overlay. Works for both movies and TV episodes.
 *
 * Opens as a modal on native; on web it's a fixed full-viewport layer
 * (since modals in a phone-frame look cramped otherwise).
 *
 * Props mirror what a title detail screen knows:
 *   - type: 'movie' | 'tv'
 *   - ids: tmdbId + imdbId (either is fine; imdb preferred per brief)
 *   - season/episode for TV
 *   - provider override + custom embed_url (for per-title admin edits)
 */

export interface PlayerOverlayProps {
    visible: boolean;
    onRequestClose: () => void;
    title?: string;
    type: 'movie' | 'tv';
    tmdbId?: string | number;
    imdbId?: string;
    /** Manual embed URL — takes precedence over any provider template. */
    embedUrl?: string;
    /** Forced provider. Defaults to saved defaultProvider. */
    provider?: ProviderId;
    /** Initial season/episode (TV only). */
    initialSeason?: number;
    initialEpisode?: number;
    /** Total episodes in the current season, to know when "Next" disables. */
    totalEpisodesInSeason?: number;
    /** Called when playback starts — UI can record a "recently watched" entry. */
    onPlay?: (info: {
        provider: ProviderId;
        season?: number;
        episode?: number;
    }) => void;
}

const IS_WEB = Platform.OS === 'web';

export function PlayerOverlay(props: PlayerOverlayProps) {
    const {
        visible,
        onRequestClose,
        title,
        type,
        tmdbId,
        imdbId,
        embedUrl,
        provider: forcedProvider,
        initialSeason = 1,
        initialEpisode = 1,
        totalEpisodesInSeason,
        onPlay,
    } = props;

    const [settings, setSettings] = useState<EmbedSettings>(() => loadSettings());
    const [providerIndex, setProviderIndex] = useState(0);
    const [season, setSeason] = useState(initialSeason);
    const [episode, setEpisode] = useState(initialEpisode);

    // Reload settings each time overlay opens (picks up admin changes).
    useEffect(() => {
        if (visible) setSettings(loadSettings());
    }, [visible]);

    // Determine available providers. If a title has a custom embed_url,
    // add a "custom" slot so the switcher can toggle between that and
    // the standard providers.
    const cycle = useMemo<ProviderId[]>(() => {
        const list: ProviderId[] = [];
        if (forcedProvider) {
            list.push(forcedProvider);
        } else {
            list.push(settings.defaultProvider);
            // Include the other one for quick switching.
            for (const p of PROVIDERS) {
                if (p.id !== settings.defaultProvider) list.push(p.id);
            }
        }
        if (embedUrl) list.push('custom');
        // De-dupe while preserving order.
        return Array.from(new Set(list));
    }, [forcedProvider, settings.defaultProvider, embedUrl]);

    // Reset provider index + episode when the overlay (re)opens.
    useEffect(() => {
        if (visible) {
            setProviderIndex(0);
            setSeason(initialSeason);
            setEpisode(initialEpisode);
            if (onPlay) {
                onPlay({
                    provider: cycle[0] ?? settings.defaultProvider,
                    season: type === 'tv' ? initialSeason : undefined,
                    episode: type === 'tv' ? initialEpisode : undefined,
                });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    // Sync season/episode if the caller changes initial values while open.
    useEffect(() => {
        if (visible) {
            setSeason(initialSeason);
            setEpisode(initialEpisode);
        }
    }, [visible, initialSeason, initialEpisode]);

    // ESC to close on web.
    useEffect(() => {
        if (!IS_WEB || !visible) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onRequestClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [visible, onRequestClose]);

    const currentProvider: ProviderId = cycle[providerIndex] ?? 'nxsha';

    const src = useMemo(() => {
        try {
            const buildParams: BuildEmbedParams & { embed_url?: string } = {
                tmdbId,
                imdbId,
                season: type === 'tv' ? season : undefined,
                episode: type === 'tv' ? episode : undefined,
                strictHindi: settings.strictHindi && currentProvider === 'nxsha',
                embed_url: currentProvider === 'custom' ? embedUrl : undefined,
            };
            return buildEmbedUrl(
                currentProvider,
                type,
                buildParams,
                templateOverridesFor(settings, currentProvider),
            );
        } catch (e) {
            return '';
        }
    }, [
        currentProvider,
        type,
        tmdbId,
        imdbId,
        season,
        episode,
        settings,
        embedUrl,
    ]);

    const handleSwitchProvider = useCallback(() => {
        if (cycle.length <= 1) return;
        const nextIdx = (providerIndex + 1) % cycle.length;
        setProviderIndex(nextIdx);
        if (onPlay) onPlay({ provider: cycle[nextIdx], season, episode });
    }, [cycle, providerIndex, season, episode, onPlay]);

    const handleNextEpisode = useCallback(() => {
        if (type !== 'tv') return;
        const nextEp = episode + 1;
        if (totalEpisodesInSeason && nextEp > totalEpisodesInSeason) return;
        setEpisode(nextEp);
    }, [type, episode, totalEpisodesInSeason]);

    const handlePrevEpisode = useCallback(() => {
        if (type !== 'tv') return;
        if (episode <= 1) return;
        setEpisode(episode - 1);
    }, [type, episode]);

    const canGoNext =
        type === 'tv' &&
        (!totalEpisodesInSeason || episode < totalEpisodesInSeason);
    const canGoPrev = type === 'tv' && episode > 1;

    const providerLabel = useMemo(() => {
        if (currentProvider === 'nxsha') return 'Nxsha';
        if (currentProvider === 'nhd') return 'NHD';
        return 'Custom';
    }, [currentProvider]);

    /* -------------------------------- Render --------------------------------- */

    if (IS_WEB) {
        if (!visible) return null;
        const { height } = Dimensions.get('window');
        return (
            <View style={[webStyles.backdrop, { minHeight: height }]}>
                <Pressable style={webStyles.veil} onPress={onRequestClose} />
                <View style={webStyles.sheet}>
                    {src ? (
                        <EmbedPlayer
                            src={src}
                            title={title}
                            onClose={onRequestClose}
                            onSwitchProvider={cycle.length > 1 ? handleSwitchProvider : undefined}
                            onNextEpisode={canGoNext ? handleNextEpisode : undefined}
                            onPrevEpisode={canGoPrev ? handlePrevEpisode : undefined}
                            isTv={type === 'tv'}
                        />
                    ) : (
                        <View style={styles.errBox}>
                            <Text style={styles.errTitle}>
                                Embed URL ban nahi saka
                            </Text>
                            <Text style={styles.errText}>
                                Is title ke liye TMDB ya IMDb ID set nahi hai.
                                Admin me ja kar IDs verify karo.
                            </Text>
                            <Pressable
                                style={styles.errButton}
                                onPress={onRequestClose}
                            >
                                <Text style={styles.errButtonText}>Close</Text>
                            </Pressable>
                        </View>
                    )}
                    {type === 'tv' ? (
                        <View style={styles.metaRow}>
                            <Text style={styles.metaText} numberOfLines={1}>
                                {title ? `${title} • ` : ''}
                                S{season} E{episode} • {providerLabel}
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.metaRow}>
                            <Text style={styles.metaText} numberOfLines={1}>
                                {title ? `${title} • ` : ''}
                                {providerLabel}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        );
    }

    // Native: use a plain full-screen Modal (since we don't depend on a WebView,
    // inside we render the EmbedPlayer which offers an "Open in browser" button).
    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onRequestClose}
        >
            <View style={styles.nativeRoot}>
                {src ? (
                    <EmbedPlayer
                        src={src}
                        title={title}
                        onClose={onRequestClose}
                        onSwitchProvider={cycle.length > 1 ? handleSwitchProvider : undefined}
                        onNextEpisode={canGoNext ? handleNextEpisode : undefined}
                        onPrevEpisode={canGoPrev ? handlePrevEpisode : undefined}
                        isTv={type === 'tv'}
                    />
                ) : (
                    <View style={styles.errBox}>
                        <Text style={styles.errTitle}>Embed URL ban nahi saka</Text>
                        <Text style={styles.errText}>
                            Is title ke liye TMDB ya IMDb ID set nahi hai.
                        </Text>
                        <Pressable style={styles.errButton} onPress={onRequestClose}>
                            <Text style={styles.errButtonText}>Close</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    nativeRoot: {
        flex: 1,
        backgroundColor: '#000',
    },
    metaRow: {
        backgroundColor: '#0a0a0a',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: '#222',
    },
    metaText: {
        color: '#b3b3b3',
        fontSize: 12,
    },
    errBox: {
        flex: 1,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 12,
    },
    errTitle: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    errText: {
        color: '#9a9a9a',
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 18,
    },
    errButton: {
        marginTop: 10,
        backgroundColor: '#fff',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 6,
    },
    errButtonText: {
        color: '#000',
        fontWeight: '700',
        fontSize: 13,
    },
});

const webStyles = StyleSheet.create({
    backdrop: {
        position: 'fixed' as any,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        backgroundColor: '#000',
        display: 'flex' as any,
        alignItems: 'center',
        justifyContent: 'center',
    },
    veil: {
        position: 'absolute' as any,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
    },
    sheet: {
        position: 'relative' as any,
        width: '100%',
        maxWidth: 1100,
        height: '100%',
        maxHeight: '92%',
        backgroundColor: '#000',
        display: 'flex' as any,
        flexDirection: 'column' as any,
    },
});
