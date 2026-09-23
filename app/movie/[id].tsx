import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, Dimensions, View } from 'react-native';
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ThemedView } from '@/components/ThemedView';
import { ExpandedPlayer } from '@/components/BottomSheet/ExpandedPlayer';
import { EmbedPlayer } from '@/components/EmbedPlayer';
import { useRootScale } from '@/contexts/RootScaleContext';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useCatalog } from '@/hooks/useCatalog';
import * as Haptics from 'expo-haptics';
import { impactAsync } from '@/utils/haptics';
import { BlurView } from 'expo-blur';
import type { Movie } from '@/types/movie';
import {
    PROVIDERS,
    ProviderId,
    buildEmbedUrl,
} from '@/lib/embeds';
import { loadSettings, templateOverridesFor } from '@/lib/settings';
import { markWatched } from '@/lib/recentlyWatched';

const IS_WEB = Platform.OS === 'web';
const SCALE_FACTOR = 0.83;
const DRAG_THRESHOLD = Math.min(Dimensions.get('window').height * 0.20, 150);
const HORIZONTAL_DRAG_THRESHOLD = Math.min(Dimensions.get('window').width * 0.51, 80);
const DIRECTION_LOCK_ANGLE = 45;
const ENABLE_HORIZONTAL_DRAG_CLOSE = true;
// Refresh jobs historically attached generic Google sample clips to every
// catalog item. Those are not title previews and must never be treated as
// playback sources.
const PLACEHOLDER_VIDEO_URL = /commondatastorage\.googleapis\.com\/gtv-videos-bucket\/sample\//i;

export default function MovieScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { setScale } = useRootScale();
    const translateY = useSharedValue(0);
    const isClosing = useRef(false);
    const statusBarStyle = useSharedValue<'light' | 'dark'>('light');
    const scrollOffset = useSharedValue(0);
    const isDragging = useSharedValue(false);
    const translateX = useSharedValue(0);
    const initialGestureX = useSharedValue(0);
    const initialGestureY = useSharedValue(0);
    const isHorizontalGesture = useSharedValue(false);
    const isScrolling = useSharedValue(false);
    const blurIntensity = useSharedValue(20);

    const [playerOpen, setPlayerOpen] = useState(false);
    const [providerIndex, setProviderIndex] = useState(0);
    const [season, setSeason] = useState(1);
    const [episode, setEpisode] = useState(1);
    const [totalEps, setTotalEps] = useState<number | undefined>(undefined);

    const { rows } = useCatalog();
    const rawId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
    const allMovies = rows.flatMap(row => row.movies);

    // Multi-tier lookup guarantees we always find the exact movie or series,
    // whether clicked via card-XX-YY-TMDB, tmdb_id, movie/tv prefix, or legacy slug.
    const movie = useMemo(() => {
        if (!rawId) return allMovies[0] ?? { id: '', imageUrl: '', title: '' };

        // 1. Exact card id match
        let found = allMovies.find(m => m.id === rawId);
        if (found) return found;

        // 2. Extract TMDB from card-XX-YY-<tmdb>
        const cardMatch = rawId.match(/^card-\d{2}-\d{2}-(.+)$/);
        const tmdbFromId = cardMatch ? cardMatch[1] : null;
        if (tmdbFromId && tmdbFromId !== 'unk') {
            found = allMovies.find(m => m.tmdb_id && String(m.tmdb_id) === tmdbFromId);
            if (found) return found;
        }

        // 3. Match rawId directly against tmdb_id
        found = allMovies.find(m => m.tmdb_id && String(m.tmdb_id) === rawId);
        if (found) return found;

        // 4. Match movie-<n> or tv-<n>
        const prefixMatch = rawId.match(/^(?:movie|tv)-(\d+)$/);
        if (prefixMatch) {
            found = allMovies.find(m => m.tmdb_id && String(m.tmdb_id) === prefixMatch[1]);
            if (found) return found;
        }

        // 5. Partial id match (e.g. fp-<slug>)
        found = allMovies.find(m => m.id && (m.id.includes(rawId) || rawId.includes(m.id)));
        if (found) return found;

        return allMovies[0] ?? { id: rawId, imageUrl: '', title: '' };
    }, [allMovies, rawId]);

    const handleSelectRelated = useCallback((related: Movie) => {
        if (!related.id || related.id === movie.id) return;
        // Replace rather than stack another transparent detail modal on top.
        // The keyed detail view starts at the top with fresh trailer/episode state.
        setPlayerOpen(false);
        setProviderIndex(0);
        setSeason(1);
        setEpisode(1);
        setTotalEps(undefined);
        scrollOffset.value = 0;
        router.replace({ pathname: '/movie/[id]', params: { id: related.id } });
    }, [movie.id, router, scrollOffset]);

    const handleHapticFeedback = useCallback(() => {
        impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, []);

    const goBack = useCallback(() => {
        if (playerOpen) {
            setPlayerOpen(false);
            return;
        }
        if (!isClosing.current) {
            isClosing.current = true;
            handleHapticFeedback();
            requestAnimationFrame(() => {
                router.back();
            });
        }
    }, [router, handleHapticFeedback, playerOpen]);

    const handleScale = useCallback((newScale: number) => {
        try {
            setScale(newScale);
        } catch (error) {
            console.log('Scale error:', error);
        }
    }, [setScale]);

    const calculateGestureAngle = (x: number, y: number) => {
        'worklet';
        const angle = Math.abs(Math.atan2(y, x) * (180 / Math.PI));
        return angle;
    };

    // When the player is open, disable drag-to-dismiss (only close via X/Esc)
    const panGesture = Gesture.Pan()
        .onStart((event) => {
            'worklet';
            if (playerOpen) return;
            initialGestureX.value = event.x;
            initialGestureY.value = event.y;
            isHorizontalGesture.value = false;
            if (scrollOffset.value <= 0) {
                isDragging.value = true;
            }
        })
        .onUpdate((event) => {
            'worklet';
            if (playerOpen) return;
            const dx = event.translationX;
            const dy = event.translationY;
            const angle = calculateGestureAngle(dx, dy);
            if (ENABLE_HORIZONTAL_DRAG_CLOSE && !isHorizontalGesture.value && !isScrolling.value) {
                if (Math.abs(dx) > 10) {
                    if (angle < DIRECTION_LOCK_ANGLE) {
                        isHorizontalGesture.value = true;
                    }
                }
            }
            if (ENABLE_HORIZONTAL_DRAG_CLOSE && isHorizontalGesture.value) {
                translateX.value = dx;
                translateY.value = dy;
                blurIntensity.value = Math.max(0, 20 - (Math.abs(dx) / 10));
                if (Math.abs(dx) / 300 > 0.2) statusBarStyle.value = 'dark';
                else statusBarStyle.value = 'light';
            } else if (scrollOffset.value <= 0 && isDragging.value) {
                translateY.value = Math.max(0, dy);
                blurIntensity.value = Math.max(0, 20 - (dy / 20));
                if (dy / 600 > 0.5) statusBarStyle.value = 'dark';
                else statusBarStyle.value = 'light';
            }
        })
        .onEnd((event) => {
            'worklet';
            isDragging.value = false;
            if (playerOpen) return;
            if (ENABLE_HORIZONTAL_DRAG_CLOSE && isHorizontalGesture.value) {
                const dx = event.translationX;
                const dy = event.translationY;
                const totalDistance = Math.sqrt(dx * dx + dy * dy);
                const shouldClose = totalDistance > HORIZONTAL_DRAG_THRESHOLD;
                if (shouldClose) {
                    translateX.value = withTiming(dx * 2, { duration: 300 });
                    translateY.value = withTiming(dy * 2, { duration: 300 });
                    runOnJS(handleScale)(1);
                    runOnJS(handleHapticFeedback)();
                    runOnJS(goBack)();
                } else {
                    translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
                    translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
                    runOnJS(handleScale)(SCALE_FACTOR);
                }
            } else if (scrollOffset.value <= 0) {
                const shouldClose = event.translationY > DRAG_THRESHOLD;
                if (shouldClose) {
                    translateY.value = withTiming(event.translationY + 100, { duration: 300 });
                    runOnJS(handleScale)(1);
                    runOnJS(handleHapticFeedback)();
                    runOnJS(goBack)();
                } else {
                    translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
                    runOnJS(handleScale)(SCALE_FACTOR);
                }
            }
        })
        .onFinalize(() => {
            'worklet';
            isDragging.value = false;
            isHorizontalGesture.value = false;
        });

    const scrollGesture = Gesture.Native()
        .onBegin(() => {
            'worklet';
            isScrolling.value = true;
            if (!isDragging.value) translateY.value = 0;
        })
        .onEnd(() => {
            'worklet';
            isScrolling.value = false;
        });

    const composedGestures = Gesture.Simultaneous(panGesture, scrollGesture);

    const ScrollComponent = useCallback((props: any) => {
        const scrollView = (
            <Animated.ScrollView
                {...props}
                scrollEnabled={!playerOpen}
                onScroll={(event) => {
                    'worklet';
                    scrollOffset.value = event.nativeEvent.contentOffset.y;
                    if (!isDragging.value && translateY.value !== 0) translateY.value = 0;
                    props.onScroll?.(event);
                }}
                scrollEventThrottle={16}
                bounces={false}
            />
        );
        if (IS_WEB) return scrollView;
        return <GestureDetector gesture={composedGestures}>{scrollView}</GestureDetector>;
    }, [composedGestures, playerOpen]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: translateY.value },
            { translateX: translateX.value },
        ],
        opacity: withSpring(1),
    }));

    useEffect(() => {
        if (!IS_WEB) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') goBack();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [goBack]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            try { setScale(SCALE_FACTOR); } catch (error) { console.log('Scale error:', error); }
        }, 0);
        return () => {
            clearTimeout(timeout);
            try { setScale(1); } catch (error) { console.log('Cleanup scale error:', error); }
        };
    }, []);

    // Parse tmdb id from the catalog card id. Card ids in the current catalog are
    // "card-<row>-<pos>-<tmdb>" (always unique per tile). Also supports legacy
    // formats: raw numeric string, movie-<n>/tv-<n>, fp-<slug> (no embed).
    const parsedTmdb = (() => {
        if (movie.tmdb_id) return String(movie.tmdb_id);
        const mid = movie.id;
        if (typeof mid !== 'string') return undefined;
        let m = mid.match(/^card-\d{2}-\d{2}-(\d+)$/);
        if (m) return m[1];
        if (/^\d+$/.test(mid)) return mid;
        m = mid.match(/^(?:movie|tv)-(\d+)$/);
        if (m) return m[1];
        return undefined;
    })();
    const isSeries = movie.mediaType === 'tv'
        || (movie.mediaType !== 'movie' && movie.type === 'SERIES');
    const mediaType: 'movie' | 'tv' =
        movie.mediaType ??
        (isSeries || (typeof movie.id === 'string' && (movie.id.includes('tv-') || movie.id.startsWith('tv-')))
            ? 'tv'
            : 'movie');

    // Cycle order: default provider → other built-in providers → custom (if embed_url set)
    const settings = loadSettings();
    const cycle: ProviderId[] = useMemo(() => {
        const list: ProviderId[] = [];
        const def = movie.embed_provider ?? settings.defaultProvider;
        list.push(def);
        for (const p of PROVIDERS) if (p.id !== def) list.push(p.id);
        if (movie.embed_url) list.push('custom');
        return Array.from(new Set(list));
    }, [movie.embed_provider, movie.embed_url, settings.defaultProvider]);

    const currentProvider: ProviderId = cycle[providerIndex] ?? 'nxsha';
    const directPreviewUrl = movie.videoUrl && !PLACEHOLDER_VIDEO_URL.test(movie.videoUrl)
        ? movie.videoUrl.replace(/^http:/i, 'https:')
        : undefined;
    const hasProviderPlayback = Boolean(movie.embed_url || parsedTmdb || movie.imdb_id);
    const directFallback = !hasProviderPlayback && Boolean(directPreviewUrl);
    const hasPlayablePlayback = hasProviderPlayback || directFallback;

    const buildSrc = useCallback(() => {
        if (directFallback) return directPreviewUrl || '';
        try {
            return buildEmbedUrl(
                currentProvider,
                mediaType,
                {
                    tmdbId: parsedTmdb,
                    imdbId: movie.imdb_id,
                    season: mediaType === 'tv' ? season : undefined,
                    episode: mediaType === 'tv' ? episode : undefined,
                    strictHindi: settings.strictHindi && currentProvider === 'nxsha',
                    embed_url: currentProvider === 'custom' ? movie.embed_url : undefined,
                },
                templateOverridesFor(settings, currentProvider),
            );
        } catch {
            return '';
        }
    }, [currentProvider, directFallback, directPreviewUrl, mediaType, parsedTmdb, movie.imdb_id, movie.embed_url, season, episode, settings]);

    const getEpisodeCountForSeason = useCallback((targetSeason: number) => {
        return movie.seasonEpisodeCounts?.[targetSeason - 1]
            ?? movie.seasons?.find(s => s.season_number === targetSeason)?.episodes?.length
            ?? movie.seasons?.find(s => s.season_number === targetSeason)?.episode_count
            ?? movie.seasons?.[targetSeason - 1]?.episodes?.length
            ?? movie.seasons?.[targetSeason - 1]?.episode_count
            ?? movie.episodeCount;
    }, [movie.seasonEpisodeCounts, movie.seasons, movie.episodeCount]);

    const officialNetflixUrl = movie.netflixUrl
        || (movie.netflixId ? `https://www.netflix.com/in/title/${movie.netflixId}` : undefined)
        || `https://www.netflix.com/search?q=${encodeURIComponent(String(movie.title ?? '').trim())}`;

    const openOfficialTitle = useCallback(() => {
        if (IS_WEB) {
            window.open(officialNetflixUrl, '_blank', 'noopener');
        } else {
            Linking.openURL(officialNetflixUrl).catch(() => {});
        }
    }, [officialNetflixUrl]);

    const handlePlayFull = useCallback(() => {
        if (!hasPlayablePlayback) {
            openOfficialTitle();
            return;
        }
        const initialSeason = mediaType === 'tv' ? movie.seasons?.[0]?.season_number ?? 1 : 1;
        setProviderIndex(0);
        setSeason(initialSeason);
        setEpisode(1);
        setTotalEps(mediaType === 'tv' ? getEpisodeCountForSeason(initialSeason) : undefined);
        setPlayerOpen(true);
        try {
            markWatched({
                id: `${movie.id}${mediaType === 'tv' ? `-s${initialSeason}-e${1}` : ''}`,
                titleId: String(movie.id),
                title: movie.title,
                type: mediaType,
                tmdbId: parsedTmdb,
                imdbId: movie.imdb_id,
                provider: currentProvider,
                season: mediaType === 'tv' ? initialSeason : undefined,
                episode: mediaType === 'tv' ? 1 : undefined,
            });
        } catch {}
    }, [movie, parsedTmdb, mediaType, currentProvider, hasPlayablePlayback, openOfficialTitle, getEpisodeCountForSeason]);

    const handleSelectSeason = useCallback((selectedSeason: number) => {
        if (mediaType !== 'tv') return;
        setSeason(selectedSeason);
        setEpisode(1);
        setTotalEps(getEpisodeCountForSeason(selectedSeason));
    }, [mediaType, getEpisodeCountForSeason]);

    const handlePlayEpisode = useCallback((selectedSeason: number, selectedEpisode: number) => {
        if (!hasPlayablePlayback) {
            openOfficialTitle();
            return;
        }
        if (mediaType !== 'tv') {
            handlePlayFull();
            return;
        }
        setProviderIndex(0);
        setSeason(selectedSeason);
        setEpisode(selectedEpisode);
        setTotalEps(getEpisodeCountForSeason(selectedSeason));
        setPlayerOpen(true);
    }, [mediaType, handlePlayFull, hasPlayablePlayback, openOfficialTitle, getEpisodeCountForSeason]);

    const handleSwitchProvider = useCallback(() => {
        if (cycle.length <= 1) return;
        setProviderIndex(i => (i + 1) % cycle.length);
    }, [cycle]);

    const handleNextEpisode = useCallback(() => {
        if (mediaType !== 'tv') return;
        if (totalEps && episode + 1 > totalEps) return;
        setEpisode(e => e + 1);
    }, [mediaType, episode, totalEps]);

    const handlePrevEpisode = useCallback(() => {
        if (mediaType !== 'tv' || episode <= 1) return;
        setEpisode(e => e - 1);
    }, [mediaType, episode]);

    const movieProps = {
        id: movie.id,
        title: movie.title || '',
        imageUrl: movie.imageUrl || '',
        ...(directPreviewUrl ? { video_url: directPreviewUrl } : {}),
        year: movie.year || '2024',
        duration: movie.duration || (isSeries ? '1 Season' : '2h 30m'),
        runtime: movie.runtime,
        episodeCount: movie.episodeCount,
        seasonEpisodeCounts: movie.seasonEpisodeCounts,
        seasons: movie.seasons,
        type: movie.type,
        rating: movie.rating || 'PG-13',
        description: movie.description || 'No description available',
        cast: movie.cast || ['Cast not available'],
        director: movie.director || 'Unknown Director',
        ranking_text: movie.ranking_text || '#1 in Movies Today',
        youtubeId: movie.youtubeId,
        tmdb_id: parsedTmdb,
        imdb_id: movie.imdb_id,
        embed_provider: movie.embed_provider,
        embed_url: movie.embed_url,
        netflixId: movie.netflixId,
        netflixUrl: movie.netflixUrl,
        mediaType,
    };

    const src = playerOpen && hasPlayablePlayback ? buildSrc() : '';

    if (IS_WEB) {
        return (
            <ThemedView style={styles.container}>
                <StatusBar animated={true} style="light" />
                <Pressable style={webStyles.backdrop} onPress={goBack} />
                <Animated.View style={[webStyles.modal, animatedStyle]}>
                    <View style={{ flex: 1, position: 'relative' }}>
                        <ExpandedPlayer
                            key={String(movie.id)}
                            onClose={goBack}
                            scrollComponent={ScrollComponent}
                            movie={movieProps}
                            onPlayFull={handlePlayFull}
                            onPlayEpisode={handlePlayEpisode}
                            currentSeason={season}
                            onSelectSeason={handleSelectSeason}
                            onSelectRelated={handleSelectRelated}
                        />
                        {playerOpen && src ? (
                            <View style={webStyles.playerLayer} pointerEvents="box-none">
                                <View style={StyleSheet.absoluteFill} pointerEvents="auto">
                                    <EmbedPlayer
                                        src={src}
                                        title={movie.title}
                                        onClose={handleCloseInline}
                                        onSwitchProvider={!directFallback && cycle.length > 1 ? handleSwitchProvider : undefined}
                                        onNextEpisode={mediaType === 'tv' && (!totalEps || episode < totalEps) ? handleNextEpisode : undefined}
                                        onPrevEpisode={mediaType === 'tv' && episode > 1 ? handlePrevEpisode : undefined}
                                        isTv={mediaType === 'tv'}
                                        fallbackUrl={officialNetflixUrl}
                                    />
                                </View>
                            </View>
                        ) : null}
                    </View>
                </Animated.View>
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container}>
            <StatusBar animated={true} style={statusBarStyle.value} />
            <Animated.View style={[styles.modalContent, animatedStyle]}>
                <ExpandedPlayer
                    key={String(movie.id)}
                    onClose={goBack}
                    scrollComponent={ScrollComponent}
                    movie={movieProps}
                    onPlayFull={handlePlayFull}
                    onPlayEpisode={handlePlayEpisode}
                    currentSeason={season}
                    onSelectSeason={handleSelectSeason}
                    onSelectRelated={handleSelectRelated}
                />
                {playerOpen && src ? (
                    <View style={styles.nativePlayerLayer} pointerEvents="box-none">
                        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
                            <EmbedPlayer
                                src={src}
                                title={movie.title}
                                onClose={handleCloseInline}
                                onSwitchProvider={!directFallback && cycle.length > 1 ? handleSwitchProvider : undefined}
                                onNextEpisode={mediaType === 'tv' && (!totalEps || episode < totalEps) ? handleNextEpisode : undefined}
                                onPrevEpisode={mediaType === 'tv' && episode > 1 ? handlePrevEpisode : undefined}
                                isTv={mediaType === 'tv'}
                                fallbackUrl={officialNetflixUrl}
                            />
                        </View>
                    </View>
                ) : null}
            </Animated.View>
        </ThemedView>
    );

    function handleCloseInline() {
        setPlayerOpen(false);
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    modalContent: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    nativePlayerLayer: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000',
        zIndex: 200,
    },
});

const webStyles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
    },
    modal: {
        position: 'absolute',
        top: '4%',
        alignSelf: 'center',
        width: '94%',
        maxWidth: 980,
        height: '92%',
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#181818',
    },
    playerLayer: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000',
        zIndex: 200,
    },
});
