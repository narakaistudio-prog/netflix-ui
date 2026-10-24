import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, Dimensions, View } from 'react-native';
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ThemedView } from '@/components/ThemedView';
import { ExpandedPlayer } from '@/components/BottomSheet/ExpandedPlayer';
import { EmbedPlayer } from '@/components/EmbedPlayer';
import { MovieboxPagePlayer } from '@/components/MovieboxPagePlayer';
import { NetmirrorPlayer } from '@/components/NetmirrorPlayer';
import { useNetmirrorAvailable } from '@/hooks/useNetmirrorAvailable';
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
import { NETMIRROR_LABEL } from '@/lib/netmirror';
import {
    isMovieboxUrl,
    MOVIEBOX_SERVER_LABEL,
} from '@/lib/moviebox';
import { getTvSeasons } from '@/lib/tvEpisodes';
import { movieboxKeyForTitle, resolveMovieboxLink } from '@/lib/movieboxLinks';
import { useMovieboxAvailable } from '@/hooks/useMovieboxAvailable';
import { buildServerCycle, nextServerIn, hasServerSwitcher } from '@/lib/playbackServers';
import {
    getRecentlyWatched,
    markWatched,
    updateWatchPosition,
    watchEntryId,
} from '@/lib/recentlyWatched';
import { useTvBackHandler } from '@/hooks/useTvNavigation';

const IS_WEB = Platform.OS === 'web';
const SCALE_FACTOR = 0.83;

/**
 * Playback "servers": the regular embed providers (Nxsha / NHD / custom) plus
 * M2Box — MovieBox ka koi embed nahi hota, isliye uska poora watch page frame
 * me khol kar sirf player wala hissa dikhaya jata hai (MovieboxPagePlayer).
 */
type PlaybackServerId = ProviderId | 'moviebox' | 'netmirror';

function serverLabel(id: PlaybackServerId): string {
    if (id === 'moviebox') return MOVIEBOX_SERVER_LABEL;
    if (id === 'netmirror') return NETMIRROR_LABEL;
    if (id === 'nxsha') return 'Nxsha';
    if (id === 'nhd') return 'NHD';
    return 'Custom';
}

const DRAG_THRESHOLD = Math.min(Dimensions.get('window').height * 0.20, 150);
const HORIZONTAL_DRAG_THRESHOLD = Math.min(Dimensions.get('window').width * 0.51, 80);
const DIRECTION_LOCK_ANGLE = 45;
const ENABLE_HORIZONTAL_DRAG_CLOSE = true;
// Refresh jobs historically attached generic Google sample clips to every
// catalog item. Those are not title previews and must never be treated as
// playback sources.
const PLACEHOLDER_VIDEO_URL = /commondatastorage\.googleapis\.com\/gtv-videos-bucket\/sample\//i;

/**
 * A full-screen request has to happen directly within the Play press handler.
 * The iframe's own controls are cross-origin, so waiting for its click would
 * lose the browser's user-activation permission. CSS still fills the app if a
 * browser or embedded preview blocks the native Fullscreen API.
 */
function requestPlayerFullscreen() {
    if (!IS_WEB || typeof document === 'undefined') return;
    const root = document.documentElement as any;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) return;
    try {
        const result = request.call(root);
        if (result?.catch) result.catch(() => {});
    } catch {}
}

function exitPlayerFullscreen() {
    if (!IS_WEB || typeof document === 'undefined') return;
    const doc = document as any;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (!exit || !doc.fullscreenElement) return;
    try {
        const result = exit.call(doc);
        if (result?.catch) result.catch(() => {});
    } catch {}
}

function setPlayerChromeHidden(hidden: boolean) {
    if (!IS_WEB || typeof document === 'undefined') return;
    if (hidden) document.documentElement.setAttribute('data-player-active', 'true');
    else document.documentElement.removeAttribute('data-player-active');
}

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
    /** Play daba par MovieBox ka jawab aa raha hai — tab official link par mat bhejo. */
    const [pendingPlay, setPendingPlay] = useState<{ season: number; episode: number } | null>(null);
    /** Badalta hai jab is browser me is title ka M2Box link save ho jaye. */
    const [movieboxRevision, setMovieboxRevision] = useState(0);
    const [season, setSeason] = useState(1);
    const [episode, setEpisode] = useState(1);
    /** Continue Watching: the entry being played and the position to resume. */
    const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
    const [resumeAt, setResumeAt] = useState(0);
    useEffect(() => () => setPlayerChromeHidden(false), []);

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
        setPlayerChromeHidden(false);
        setPlayerOpen(false);
        setProviderIndex(0);
        setSeason(1);
        setEpisode(1);
        scrollOffset.value = 0;
        router.replace({ pathname: '/movie/[id]', params: { id: related.id } });
    }, [movie.id, router, scrollOffset]);

    const handleHapticFeedback = useCallback(() => {
        impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, []);

    const goBack = useCallback(() => {
        if (playerOpen) {
            exitPlayerFullscreen();
            setPlayerChromeHidden(false);
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

    useTvBackHandler(() => {
        if (playerOpen) {
            exitPlayerFullscreen();
            setPlayerChromeHidden(false);
            setPlayerOpen(false);
            return true;
        }
        goBack();
        return true;
    }, true);

    useEffect(() => {
        if (!IS_WEB) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.keyCode === 10009) goBack();
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

    /**
     * MovieBox ka link, priority order me:
     *   1. row me hi `embed_url` / `videoUrl` (tab M2Box pehla server banta hai),
     *   2. catalog ke liye baked link (`data/moviebox-links.json`, roz ka
     *      harvester — isliye har title par Server 2 bina paste kiye chalta hai),
     *   3. viewer ne ek baar paste kiya hua link (is browser me yaad,
     *      `lib/movieboxLinks.ts`).
     */
    const movieboxEntry = useMemo(
        () => resolveMovieboxLink(movie),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [movie.id, movie.tmdb_id, movie.mediaType, movie.embed_url, movie.videoUrl, movieboxRevision],
    );
    /** Row ne khud m2box link diya hai — tab M2Box hi pehla server hai. */
    const rowIsMoviebox = movieboxEntry?.source === 'row';
    /** Manual embed override jo m2box page nahi hai (warna wo M2Box ka kaam hai). */
    const primaryEmbedUrl = movie.embed_url && !rowIsMoviebox ? movie.embed_url : undefined;
    const movieboxLinkKey = movieboxKeyForTitle(movie);

    /**
     * MovieBox par ye title hai ya nahi — link row/baked/saved se mile to turant
     * pata, warna background me live resolve. Jawab aane tak M2Box ka option
     * dikhta hi nahi.
     */
    const movieboxAvailability = useMovieboxAvailable(movie, {
        known: Boolean(movieboxEntry),
        linkKey: movieboxLinkKey,
        onResolved: () => setMovieboxRevision(n => n + 1),
    });
    const movieboxAvailable = Boolean(movieboxEntry) || movieboxAvailability.available;

    // Cycle: MovieBox mile to (row-m2box) → default → baaki providers → custom
    // → M2Box. MovieBox na mile to sirf Server 1 — koi aur switch nahi.
    /** NetMirror par ye title hai? (chhota probe — sirf tab chip/cycle me aata hai) */
    const netmirrorAvailability = useNetmirrorAvailable(
        parsedTmdb,
        mediaType,
        mediaType === 'tv' ? season : undefined,
        mediaType === 'tv' ? episode : undefined,
    );

    const settings = loadSettings();
    const cycle: PlaybackServerId[] = useMemo(
        () =>
            buildServerCycle({
                defaultProvider: movie.embed_provider ?? settings.defaultProvider,
                movieboxAvailable,
                rowIsMoviebox,
                customAvailable: Boolean(primaryEmbedUrl),
                netmirrorAvailable: netmirrorAvailability.available,
                providers: PROVIDERS.map(p => p.id),
            }),
        [
            movie.embed_provider,
            movieboxAvailable,
            primaryEmbedUrl,
            rowIsMoviebox,
            settings.defaultProvider,
            netmirrorAvailability.available,
        ],
    );

    // Cycle chhota ho jaye (MovieBox nahi mila) to index phir bhi valid rehna chahiye.
    useEffect(() => {
        if (providerIndex > cycle.length - 1) setProviderIndex(0);
    }, [cycle.length, providerIndex]);

    const currentProvider: PlaybackServerId = cycle[providerIndex] ?? cycle[0] ?? 'nxsha';
    // Dono M2Box servers (asli + copy) wahi cropped page player chalate hain —
    // farq sirf domain ka hai.
    const isMovieboxServer = currentProvider === 'moviebox';
    const isNetmirrorServer = currentProvider === 'netmirror';
    const movieboxIndex = cycle.indexOf('moviebox');
    const directPreviewUrl = movie.videoUrl
        && !PLACEHOLDER_VIDEO_URL.test(movie.videoUrl)
        // m2box link ek page hai, `<video>` ka source nahi.
        && !(movieboxEntry?.fromTitle && isMovieboxUrl(movie.videoUrl))
        ? movie.videoUrl.replace(/^http:/i, 'https:')
        : undefined;
    const hasProviderPlayback = Boolean(primaryEmbedUrl || parsedTmdb || movie.imdb_id);
    const directFallback = !hasProviderPlayback && Boolean(directPreviewUrl);
    const hasPlayablePlayback = hasProviderPlayback || directFallback;

    const buildSrc = useCallback(() => {
        // M2Box ka apna player hai (MovieboxPagePlayer) — yahan URL nahi banta.
        if (isMovieboxServer || isNetmirrorServer) return '';
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
                    embed_url: currentProvider === 'custom' ? primaryEmbedUrl : undefined,
                },
                templateOverridesFor(settings, currentProvider),
            );
        } catch {
            return '';
        }
    }, [currentProvider, directFallback, directPreviewUrl, mediaType, parsedTmdb, movie.imdb_id, primaryEmbedUrl, season, episode, settings]);

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

    /**
     * Remember the title (and the episode of a series) in the Continue
     * Watching row, and continue from the position it was left at.
     */
    const rememberPlayback = useCallback((playSeason: number, playEpisode: number) => {
        const titleId = String(movie.id);
        const entryId = watchEntryId(
            titleId,
            mediaType,
            mediaType === 'tv' ? playSeason : undefined,
            mediaType === 'tv' ? playEpisode : undefined,
        );
        const saved = getRecentlyWatched().find((e) => e.id === entryId);
        setActiveEntryId(entryId);
        setResumeAt(saved?.positionSec ?? 0);
        try {
            markWatched({
                id: entryId,
                titleId,
                title: movie.title,
                type: mediaType,
                tmdbId: parsedTmdb,
                imdbId: movie.imdb_id,
                provider: currentProvider,
                season: mediaType === 'tv' ? playSeason : undefined,
                episode: mediaType === 'tv' ? playEpisode : undefined,
            });
        } catch {}
    }, [movie, parsedTmdb, mediaType, currentProvider]);

    /** Server 2 (M2Box) full-screen player kholo. */
    const openMovieboxPlayer = useCallback(
        (playSeason: number, playEpisode: number) => {
            requestPlayerFullscreen();
            setPlayerChromeHidden(true);
            setProviderIndex(Math.max(0, movieboxIndex));
            setSeason(playSeason);
            setEpisode(playEpisode);
            setPlayerOpen(true);
            rememberPlayback(playSeason, playEpisode);
        },
        [movieboxIndex, rememberPlayback],
    );

    const handlePlayFull = useCallback(() => {
        const initialSeason = mediaType === 'tv' ? movie.seasons?.[0]?.season_number ?? 1 : 1;
        if (!hasPlayablePlayback) {
            // Nxsha/NHD ke paas is title ke liye id hi nahi — M2Box ka link ho
            // to Server 2 chalao, warna official Netflix.
            if (movieboxAvailable) {
                openMovieboxPlayer(initialSeason, 1);
                return;
            }
            // MovieBox ka jawab aa raha hai — tab tak official link par mat bhejo.
            if (movieboxAvailability.checking) {
                setPendingPlay({ season: initialSeason, episode: 1 });
                return;
            }
            openOfficialTitle();
            return;
        }
        requestPlayerFullscreen();
        setPlayerChromeHidden(true);
        // Server 1 hi default — MovieBox ka option sirf tab jab wo available ho.
        setProviderIndex(0);
        setSeason(initialSeason);
        setEpisode(1);
        setPlayerOpen(true);
        rememberPlayback(initialSeason, 1);
    }, [
        movie,
        hasPlayablePlayback,
        movieboxAvailable,
        movieboxAvailability.checking,
        openMovieboxPlayer,
        openOfficialTitle,
        rememberPlayback,
    ]);

    /**
     * Play daba tha par MovieBox ka jawab pending tha — jawab aate hi wahi
     * karo jo us waqt karna chahiye tha.
     */
    useEffect(() => {
        if (!pendingPlay || movieboxAvailability.checking) return;
        const { season: playSeason, episode: playEpisode } = pendingPlay;
        setPendingPlay(null);
        if (movieboxAvailable) openMovieboxPlayer(playSeason, playEpisode);
        else openOfficialTitle();
    }, [pendingPlay, movieboxAvailability.checking, movieboxAvailable, openMovieboxPlayer, openOfficialTitle]);

    const handleSelectSeason = useCallback((selectedSeason: number) => {
        if (mediaType !== 'tv') return;
        setSeason(selectedSeason);
        setEpisode(1);
    }, [mediaType]);

    const handlePlayEpisode = useCallback((selectedSeason: number, selectedEpisode: number) => {
        if (!hasPlayablePlayback) {
            if (movieboxAvailable) {
                openMovieboxPlayer(selectedSeason, selectedEpisode);
                return;
            }
            if (movieboxAvailability.checking) {
                setPendingPlay({ season: selectedSeason, episode: selectedEpisode });
                return;
            }
            openOfficialTitle();
            return;
        }
        if (mediaType !== 'tv') {
            handlePlayFull();
            return;
        }
        requestPlayerFullscreen();
        setPlayerChromeHidden(true);
        setProviderIndex(0);
        setSeason(selectedSeason);
        setEpisode(selectedEpisode);
        setPlayerOpen(true);
        rememberPlayback(selectedSeason, selectedEpisode);
    }, [
        mediaType,
        handlePlayFull,
        hasPlayablePlayback,
        movieboxAvailable,
        movieboxAvailability.checking,
        openMovieboxPlayer,
        openOfficialTitle,
        rememberPlayback,
    ]);

    const handleSwitchProvider = useCallback(() => {
        if (cycle.length <= 1) return;
        setProviderIndex(i => (i + 1) % cycle.length);
    }, [cycle]);

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

    // M2Box ka apna player hai — us waqt `src` khali rehta hai, par player
    // phir bhi khulna chahiye (link paste karne ke liye bhi).
    const src =
        playerOpen && hasPlayablePlayback && !isMovieboxServer && !isNetmirrorServer ? buildSrc() : '';
    const playerVisible = playerOpen && (Boolean(src) || isMovieboxServer || isNetmirrorServer);
    /** Server switcher labels: jo chal raha hai + jo agla hai. */
    const currentServerLabel = serverLabel(currentProvider);
    // MovieBox available na ho to cycle hi ek server ka hai — `nextServer` null
    // rehta hai aur EmbedPlayer/US pill dikhata hi nahi.
    const nextServer = hasServerSwitcher(cycle) ? nextServerIn(cycle, providerIndex) : null;

    /**
     * Is season me total episodes — sirf series par. "Next Episode" button
     * isi se pata karta hai ki agla episode hai ya nahi.
     */
    /** Chalu episode ka naam — player ki bottom strip me dikhta hai. */
    const activeEpisodeTitle = useMemo(() => {
        if (mediaType !== 'tv') return undefined;
        const fromRow = movie.seasons
            ?.find((item) => item.season_number === season)
            ?.episodes?.find((item) => item.episode === episode)?.name;
        if (fromRow) return fromRow;
        return getTvSeasons(movie.tmdb_id)
            .find((item) => item.season_number === season)
            ?.episodes?.find((item) => item.episode === episode)?.name;
    }, [episode, mediaType, movie.seasons, movie.tmdb_id, season]);

    const seasonEpisodeTotal =
        movie.seasonEpisodeCounts?.[season - 1] ??
        movie.seasons?.find((item) => item.season_number === season)?.episode_count;

    const renderPlayer = () => {
        if (isNetmirrorServer) {
            return (
                <NetmirrorPlayer
                    tmdbId={parsedTmdb}
                    mediaType={mediaType}
                    season={mediaType === 'tv' ? season : undefined}
                    episode={mediaType === 'tv' ? episode : undefined}
                    title={movie.title}
                    onClose={handleCloseInline}
                    nextServerName={nextServer ? serverLabel(nextServer) : undefined}
                    onSwitchServer={handleSwitchProvider}
                    onUnavailable={() => {
                        // NetMirror par nahi mila / stream fail — dead button nahi,
                        // seedha Server 1 (Nxsha) par.
                        const nxshaIndex = cycle.indexOf('nxsha');
                        setProviderIndex(nxshaIndex >= 0 ? nxshaIndex : 0);
                    }}
                    onProgress={(info) => {
                        if (!activeEntryId) return;
                        updateWatchPosition(activeEntryId, info.currentTime, info.duration);
                    }}
                />
            );
        }
        if (isMovieboxServer) {
            return (
                <MovieboxPagePlayer
                    linkKey={movieboxLinkKey}
                    initialLink={movieboxEntry?.link ?? null}
                    title={movie.title}
                    year={movie.year}
                    mediaType={mediaType}
                    season={mediaType === 'tv' ? season : undefined}
                    episode={mediaType === 'tv' ? episode : undefined}
                    episodeCount={mediaType === 'tv' ? seasonEpisodeTotal : undefined}
                    episodeTitle={activeEpisodeTitle}
                    onEpisodeChange={(next) => {
                        setEpisode(next.episode);
                        rememberPlayback(next.season, next.episode);
                    }}
                    onClose={handleCloseInline}
                    onLinkSaved={() => setMovieboxRevision((n) => n + 1)}
                />
            );
        }
        return (
            <EmbedPlayer
                src={src}
                title={movie.title}
                onClose={handleCloseInline}
                onSwitchProvider={!directFallback && hasServerSwitcher(cycle) ? handleSwitchProvider : undefined}
                serverName={currentServerLabel}
                nextServerName={nextServer ? serverLabel(nextServer) : undefined}
                fallbackUrl={officialNetflixUrl}
                resumeAt={resumeAt}
                onProgress={(info) => {
                    if (!activeEntryId) return;
                    updateWatchPosition(activeEntryId, info.seconds, info.duration);
                }}
            />
        );
    };

    if (IS_WEB) {
        return (
            <ThemedView style={styles.container}>
                <StatusBar animated={true} style="light" />
                <Pressable style={webStyles.backdrop} onPress={goBack} />
                <Animated.View
                    style={[webStyles.modal, playerOpen && webStyles.playerFullscreen, animatedStyle]}
                    {...({ dataSet: { tvScope: playerOpen ? 'player' : 'modal' } } as any)}
                >
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
                        {playerVisible ? (
                            <View style={webStyles.playerLayer} pointerEvents="box-none">
                                <View style={StyleSheet.absoluteFill} pointerEvents="auto">
                                    {renderPlayer()}
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
                {playerVisible ? (
                    <View style={styles.nativePlayerLayer} pointerEvents="box-none">
                        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
                            {renderPlayer()}
                        </View>
                    </View>
                ) : null}
            </Animated.View>
        </ThemedView>
    );

    function handleCloseInline() {
        exitPlayerFullscreen();
        setPlayerChromeHidden(false);
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
    // Visual fallback when requestFullscreen is unavailable in an embedded preview.
    playerFullscreen: {
        top: 0,
        left: 0,
        alignSelf: 'stretch',
        width: '100%',
        maxWidth: undefined,
        height: '100%',
        borderRadius: 0,
    },
});
