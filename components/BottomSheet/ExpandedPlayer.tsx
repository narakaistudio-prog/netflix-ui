import { Platform, View, StyleSheet, Text, Image, Pressable, Dimensions, ScrollView, Linking, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ThemedText } from '@/components/ThemedText';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { useState, useRef, createElement, useEffect } from 'react';
import { expandedPlayerStyles as styles } from '@/styles/expanded-player';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '@/hooks/useCatalog';
import { Slider } from 'react-native-awesome-slider';
import { useSharedValue } from 'react-native-reanimated';
import { newStyles } from '@/styles/new';
import { SafeImage } from '@/components/SafeImage';
import { resolveTrailerMp4 } from '@/services/trailerStream';
import type { Episode, Movie } from '@/types/movie';

const IS_WEB = Platform.OS === 'web';
// YouTube's iframe player dies with "Error 153" inside hosted preview frames,
// so trailers now ALWAYS stream as plain MP4 video. IN_FRAME is only used to
// pick the last-resort fallback when every stream server is down.
const IN_FRAME = (() => {
    if (!IS_WEB || typeof window === 'undefined') return false;
    try {
        return window.top !== window.self;
    } catch {
        return true; // cross-origin frame access => nested
    }
})();

interface MovieData {
    id?: string | number;
    title: string;
    imageUrl: string;
    video_url?: string;
    year?: string;
    duration?: string;
    rating?: string;
    description?: string;
    cast?: string[];
    director?: string;
    ranking_text?: string;
    youtubeId?: string;
    type?: string;
    // Embed fields (optional — if present, the Play button launches the iframe embed)
    mediaType?: 'movie' | 'tv';
    tmdb_id?: string | number;
    imdb_id?: string;
    embed_provider?: 'nxsha' | 'nhd' | 'custom';
    embed_url?: string;
    initialSeason?: number;
    initialEpisode?: number;
    totalEpisodesInSeason?: number;
    episodeCount?: number;
    seasonEpisodeCounts?: number[];
    seasons?: Array<{
        season_number?: number;
        episode_count?: number;
        episodes?: Episode[];
    }>;
}

interface ExpandedPlayerProps {
    scrollComponent: (props: any) => React.ReactElement;
    movie: MovieData & Partial<Movie>;
    onClose?: () => void;
    /** Called when Play is tapped; parent mounts the EmbedPlayer overlay. */
    onPlayFull?: (movie: MovieData) => void;
    /** Called when a specific episode row is tapped. */
    onPlayEpisode?: (season: number, episode: number) => void;
    /** Currently selected season in the parent player. */
    currentSeason?: number;
    /** Changes the selected season without starting playback. */
    onSelectSeason?: (season: number) => void;
}

interface PlaybackStatus {
    isLoaded: boolean;
    positionMillis: number;
    durationMillis: number;
}

interface VideoRef {
    setOnPlaybackStatusUpdate: (callback: (status: PlaybackStatus) => void) => void;
    setPositionAsync: (position: number) => void;
}




export function ExpandedPlayer({
    scrollComponent,
    movie,
    onClose,
    onPlayFull,
    onPlayEpisode,
    currentSeason = 1,
    onSelectSeason,
}: ExpandedPlayerProps) {
    const ScrollComponentToUse = scrollComponent || ScrollView;
    const insets = useSafeAreaInsets();
    const videoRef = useRef<Video | null>(null);
    const [isMuted, setIsMuted] = useState(true);
    const [trailerStage, setTrailerStage] = useState<'off' | 'thumb' | 'play'>('off');
    const progress = useSharedValue(0);
    const min = useSharedValue(0);
    const max = useSharedValue(100);
    const [duration, setDuration] = useState(0);
    const { rows } = useCatalog();
    const moreLikeThis = (rows.find(r => r.type !== 'games' && r.movies.length >= 6) ?? rows[0])?.movies.slice(0, 6) ?? [];

    const defaultMovieData = {
        video_url: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
        year: '2024',
        duration: '2h 30m',
        rating: 'PG-13',
        description: 'No description available',
        cast: ['Cast not available'],
        director: 'Unknown Director',
        ranking_text: '#1 in Movies Today',
        title: 'Untitled',
        imageUrl: '',
    };

    const movieData: MovieData = {
        ...defaultMovieData,
        ...Object.fromEntries(
            Object.entries(movie).filter(([_, value]) =>
                value !== null && value !== undefined && value !== ''
            )
        )
    };

    // Catalog items carry `videoUrl`; the player historically used `video_url`
    if ((movie as any).videoUrl) movieData.video_url = (movie as any).videoUrl;

    const isSeries = movieData.mediaType === 'tv'
        || (movieData.mediaType !== 'movie' && movieData.type === 'SERIES');
    const episodeCount = isSeries
        ? movieData.episodeCount
            ?? movieData.totalEpisodesInSeason
            ?? movieData.seasonEpisodeCounts?.reduce((total, count) => total + count, 0)
            ?? movieData.seasons?.reduce((total, season) => (
                total + (season.episode_count ?? season.episodes?.length ?? 0)
            ), 0)
        : undefined;
    const inferredSeasonCount = Number(movieData.duration?.match(/(\d+)\s+Seasons?/i)?.[1] ?? 0);
    const seasonCount = isSeries
        ? Math.max(
            1,
            inferredSeasonCount,
            movieData.seasonEpisodeCounts?.length ?? 0,
            movieData.seasons?.length ?? 0,
        )
        : 0;
    const seasonOptions = Array.from({ length: seasonCount }, (_, index) => index + 1);
    const selectedSeasonData = movieData.seasons?.find(s => s.season_number === currentSeason)
        ?? movieData.seasons?.[currentSeason - 1];
    const currentSeasonEpisodeCount = isSeries
        ? selectedSeasonData?.episodes?.length
            ?? selectedSeasonData?.episode_count
            ?? movieData.seasonEpisodeCounts?.[currentSeason - 1]
            ?? (seasonCount === 1 ? episodeCount : undefined)
        : undefined;
    const episodeLabel = currentSeasonEpisodeCount && currentSeasonEpisodeCount > 0
        ? `${currentSeasonEpisodeCount} Episodes`
        : (episodeCount && episodeCount > 0 ? `${episodeCount} Episodes` : 'Episodes');
    const episodeItems: Episode[] = isSeries
        ? (selectedSeasonData?.episodes?.length
            ? selectedSeasonData.episodes
            : Array.from(
                { length: Math.max(currentSeasonEpisodeCount ?? 1, 1) },
                (_, index) => ({
                    season: currentSeason,
                    episode: index + 1,
                    name: `Episode ${index + 1}`,
                }),
            ))
        : [];

    const onPlaybackStatusUpdate = (status: any) => {
        if (status.isLoaded) {
            progress.value = status.positionMillis;
            setDuration(status.durationMillis);
            max.value = status.durationMillis || 100;
        }
    };

    const onTrailerPress = () => {
        const yt = movieData.youtubeId;
        if (yt) {
            if (IS_WEB) {
                setTrailerStage(s => (s === 'off' ? 'thumb' : 'off'));
            } else {
                Linking.openURL(`https://www.youtube.com/watch?v=${yt}`);
            }
        } else {
            // No YouTube trailer mapped — play the bundled preview clip unmuted
            setTrailerStage('off');
            setIsMuted(false);
            videoRef.current?.replayAsync?.();
        }
    };

    const trailerActive = IS_WEB && trailerStage !== 'off' && !!movieData.youtubeId;

    const startTrailer = () => setTrailerStage('play');

    // If the catalog entry carries an embed id, launch our iframe player;
    // otherwise fall back to opening netflix.com search in a new tab.
    const hasEmbed = Boolean(
        onPlayFull && (movieData.embed_url || movieData.tmdb_id || movieData.imdb_id),
    );
    const handlePlay = () => {
        if (hasEmbed && onPlayFull) {
            onPlayFull(movieData);
            return;
        }
        const q = encodeURIComponent(String(movieData.title ?? '').trim());
        const url = `https://www.netflix.com/search?q=${q}`;
        if (IS_WEB) {
            window.open(url, '_blank', 'noopener');
        } else {
            Linking.openURL(url);
        }
    };

    // On the website a frosted-glass backdrop-filter made the whole dialog
    // look hazy; Netflix's desktop dialog is a solid dark surface instead.
    const RootContainer: any = IS_WEB ? View : BlurView;
    const rootProps: any = IS_WEB
        ? { style: [styles.rootContainer, { backgroundColor: '#181818', borderTopLeftRadius: 0, borderTopRightRadius: 0 }] }
        : { intensity: 85, tint: 'systemThickMaterialDark' as const, style: [styles.rootContainer, { marginTop: insets.top }] };

    return (
        <RootContainer {...rootProps}>
            <View style={[styles.videoContainer, IS_WEB && { height: undefined as any, aspectRatio: 16 / 9 }]}>
                {trailerActive ? (
                    trailerStage === 'play' ? (
                    <TrailerVideo
                        yt={String(movieData.youtubeId)}
                        title={String(movieData.title ?? '')}
                        onBail={() => {
                            setTrailerStage('off');
                            setIsMuted(false);
                            videoRef.current?.replayAsync?.();
                        }}
                    />
                    ) : (
                    <View style={styles.video}>
                        <TrailerThumb yt={String(movieData.youtubeId)} />
                        <Pressable
                            style={StyleSheet.absoluteFill}
                            onPress={startTrailer}
                        >
                            <View style={trailerStyles.center}>
                                <View style={trailerStyles.playCircle}>
                                    <Ionicons name="play" size={30} color="#fff" />
                                </View>
                                <Text style={trailerStyles.label}>
                                    {movieData.title} | Official Trailer
                                </Text>
                            </View>
                        </Pressable>
                    </View>
                    )
                ) : (
                    <View style={[styles.video, { backgroundColor: '#14141c', justifyContent: 'center', alignItems: 'center' }]}>
                        {movieData.imageUrl ? (
                            <SafeImage
                                source={{ uri: movieData.imageUrl }}
                                style={StyleSheet.absoluteFill}
                                contentFit="cover"
                            />
                        ) : null}
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
                        <Pressable
                            style={{ alignItems: 'center', gap: 10, zIndex: 10 }}
                            onPress={handlePlay}
                        >
                            <View style={{
                                width: 68,
                                height: 68,
                                borderRadius: 34,
                                backgroundColor: '#E50914',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderWidth: 2,
                                borderColor: '#fff',
                            }}>
                                <Ionicons name="play" size={36} color="#fff" style={{ marginLeft: 4 }} />
                            </View>
                            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 6 }}>
                                {hasEmbed
                                    ? (isSeries
                                        ? `Play ${movieData.title} (S1:E1)`
                                        : `Play ${movieData.title}`)
                                    : 'Play on Netflix'}
                            </Text>
                        </Pressable>
                    </View>
                )}
                <View style={styles.videoOverlay}>
                    <Pressable
                        style={styles.closeButton}
                        onPress={() => onClose?.()}
                    >
                        <Ionicons name="close-outline" size={26} color="white" />
                    </Pressable>
                </View>
            </View>

            <ScrollComponentToUse
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.contentContainer}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4, marginBottom: 8 }}>
                        <Text style={{
                            color: '#E50914',
                            fontWeight: '900',
                            fontSize: 22,
                            lineHeight: 26,
                            top: -4,
                            position: 'absolute',
                            left: 0,
                        }}>N</Text>
                        <Text style={newStyles.netflixTag}>
                            {isSeries ? 'SERIES' : 'FILM'}
                        </Text>
                    </View>
                    <ThemedText style={styles.title}>{movieData.title}</ThemedText>

                    <View style={styles.metaInfo}>
                        <ThemedText style={styles.year}>{movieData.year}</ThemedText>
                        <ThemedText style={styles.duration}>{movieData.duration}</ThemedText>
                        {episodeCount ? (
                            <ThemedText style={styles.duration}>{episodeCount} Episodes</ThemedText>
                        ) : null}
                        <ThemedText style={styles.rating}>{movieData.rating}</ThemedText>
                        <ThemedText style={styles.quality}>HD</ThemedText>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 18 }}>
                        <Text style={newStyles.trendingTag}>{movieData.ranking_text}</Text>
                    </View>

                    <View style={styles.buttonContainer}>
                        <Pressable style={styles.playButton} onPress={handlePlay}>
                            <Ionicons name="play" size={24} color="black" />
                            <ThemedText style={styles.playButtonText}>
                                {hasEmbed
                                    ? (isSeries ? 'Play S1:E1' : 'Play')
                                    : 'Play on Netflix'}
                            </ThemedText>
                        </Pressable>

                        <Pressable style={styles.downloadButton}>
                            {/* <Ionicons name="download" size={20} color="white" /> */}
                            <SafeImage
                                source={require('../../assets/images/replace-these/download-netflix-transparent.png')}
                                style={{ width: 28, height: 28 }}
                                cachePolicy="memory-disk"
                                contentFit="contain"
                            />
                            <ThemedText style={styles.downloadButtonText}>Download</ThemedText>
                        </Pressable>
                    </View>

                    <ThemedText style={styles.description}>
                        {movieData.description}
                    </ThemedText>

                    {isSeries && (
                        <View style={{ marginTop: 18, marginBottom: 12 }}>
                            {seasonOptions.length > 1 && (
                                <View style={{ marginBottom: 14 }}>
                                    <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 9 }}>Seasons</Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                        {seasonOptions.map((seasonNumber) => {
                                            const selected = seasonNumber === currentSeason;
                                            return (
                                                <Pressable
                                                    key={seasonNumber}
                                                    onPress={() => onSelectSeason?.(seasonNumber)}
                                                    style={{
                                                        flexDirection: 'row',
                                                        alignItems: 'center',
                                                        gap: 5,
                                                        borderRadius: 6,
                                                        paddingVertical: 8,
                                                        paddingHorizontal: 12,
                                                        backgroundColor: selected ? '#fff' : '#2a2a2a',
                                                        borderWidth: 1,
                                                        borderColor: selected ? '#fff' : '#555',
                                                    }}
                                                >
                                                    <Text style={{ color: selected ? '#000' : '#ddd', fontSize: 13, fontWeight: '800' }}>
                                                        Season {seasonNumber}
                                                    </Text>
                                                    {selected ? <Ionicons name="checkmark" size={15} color="#000" /> : null}
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </View>
                            )}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>Episodes</Text>
                                <Text style={{ color: '#aaa', fontSize: 13, fontWeight: '600' }}>{episodeLabel}</Text>
                            </View>
                            {episodeItems.map((episode) => (
                                <Pressable
                                    key={`${episode.season}-${episode.episode}`}
                                    style={({ hovered }: any) => [{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        backgroundColor: hovered ? '#2a2a2a' : '#222',
                                        borderRadius: 8,
                                        padding: 12,
                                        gap: 12,
                                        borderWidth: 1,
                                        borderColor: '#333',
                                        marginBottom: 8,
                                    }]}
                                    onPress={() => {
                                        if (onPlayEpisode) onPlayEpisode(currentSeason, episode.episode);
                                        else handlePlay();
                                    }}
                                >
                                    <View style={{
                                        width: 120,
                                        height: 68,
                                        borderRadius: 6,
                                        overflow: 'hidden',
                                        backgroundColor: '#151515',
                                        position: 'relative',
                                    }}>
                                        <SafeImage
                                            source={{
                                                uri: episode.still_path
                                                    ? (episode.still_path.startsWith('http')
                                                        ? episode.still_path
                                                        : `https://image.tmdb.org/t/p/w300${episode.still_path}`)
                                                    : movieData.imageUrl,
                                            }}
                                            style={StyleSheet.absoluteFill}
                                            contentFit="cover"
                                            fallbackLabel={`${movieData.title} Episode ${episode.episode}`}
                                        />
                                        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' }]}>
                                            <View style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 16,
                                                backgroundColor: 'rgba(229,9,20,0.95)',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}>
                                                <Ionicons name="play" size={16} color="#fff" style={{ marginLeft: 2 }} />
                                            </View>
                                        </View>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                                            Episode {episode.episode}{episode.name && episode.name !== `Episode ${episode.episode}` ? ` • ${episode.name}` : ''}
                                        </Text>
                                        <Text style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                                            Hindi Dub & Subtitles Available
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color="#888" />
                                </Pressable>
                            ))}
                        </View>
                    )}

                    <View style={styles.castInfo}>
                        <ThemedText style={styles.castLabel}>Cast: </ThemedText>
                        <ThemedText style={styles.castText}>
                            {movieData.cast?.join(', ')}
                        </ThemedText>
                    </View>

                    <View style={styles.directorInfo}>
                        <ThemedText style={styles.directorLabel}>Director: </ThemedText>
                        <ThemedText style={styles.directorText}>
                            {movieData.director}
                        </ThemedText>
                    </View>

                    <View style={styles.actionButtons}>
                        <Pressable style={[styles.actionButton, {
                            // backgroundColor: '#000000bb',
                            width: 100,
                            borderBottomWidth: 4,
                            borderBottomColor: '#db0000',
                        }]}>
                            <Ionicons name="add" size={24} color="white" />
                            <ThemedText style={styles.actionButtonText}>My List</ThemedText>
                        </Pressable>
                        <Pressable style={styles.actionButton}>
                            <Ionicons name="thumbs-up-outline" size={24} color="white" />
                            <ThemedText style={styles.actionButtonText}>Rate</ThemedText>
                        </Pressable>
                        <Pressable style={styles.actionButton}>
                            <Ionicons name="send-outline" size={20} color="white" style={{
                                marginBottom: 4,
                                transform: [{ rotate: '320deg' }]
                            }} />
                            <ThemedText style={styles.actionButtonText}>Share</ThemedText>
                        </Pressable>
                    </View>
                </View>

                <View style={styles.moreLikeThis}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
                        <ThemedText style={styles.moreLikeThisTitle}>More Like This</ThemedText>
                        <ThemedText style={[styles.moreLikeThisTitle, { opacity: 0.4 }]}>Trailers & More</ThemedText>
                    </View>
                    <View style={styles.movieGrid}>
                        {moreLikeThis.map((movie: any) => (
                            <View key={movie.id} style={styles.moviePoster}>
                                <SafeImage
                                    source={{ uri: movie.imageUrl }}
                                    style={{ width: '100%', height: '100%', borderRadius: 4 }}
                                    cachePolicy="memory-disk"
                                    transition={200}
                                    fallbackLabel={movie.title}
                                />
                            </View>
                        ))}
                    </View>
                </View>
            </ScrollComponentToUse>
        </RootContainer>
    );
}


/** YouTube trailer thumbnail with graceful quality fallback. */
function TrailerThumb({ yt }: { yt: string }) {
    const [idx, setIdx] = useState(0);
    const urls = [
        `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${yt}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    ];
    return (
        <Image
            source={{ uri: urls[Math.min(idx, urls.length - 1)] }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setIdx(i => Math.min(i + 1, urls.length - 1))}
        />
    );
}

const trailerStyles = StyleSheet.create({
    center: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        backgroundColor: 'rgba(0,0,0,0.25)',
    },
    playCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(229,9,20,0.92)',
        alignItems: 'center',
        justifyContent: 'center',
        ...Platform.select({
            web: { boxShadow: '0 8px 24px rgba(0,0,0,0.6)' } as any,
            default: {} as any,
        }),
    },
    label: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
        paddingHorizontal: 16,
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.8)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    ytCorner: {
        position: 'absolute',
        right: 10,
        bottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: 'rgba(0,0,0,0.7)',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 5,
    },
    ytCornerText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
    },
    noteCard: {
        backgroundColor: '#141414',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 28,
    },
    noteTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '800',
    },
    noteText: {
        color: '#9a9a9a',
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center',
        maxWidth: 460,
    },
    noteBtns: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 6,
    },
    noteBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#fff',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    noteBtnText: {
        color: '#000',
        fontSize: 12,
        fontWeight: '800',
    },
    noteBtnGhost: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    noteBtnGhostText: {
        color: '#e5e5e5',
        fontSize: 12,
        fontWeight: '700',
    },
});

/**
 * Plays the official trailer as a plain MP4 stream (works even in sandboxed
 * iframes where YouTube's iframe player refuses to run).
 */
function TrailerVideo({ yt, title, onBail }: {
    yt: string;
    title: string;
    onBail: () => void;
}) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const videoElRef = useRef<HTMLVideoElement | null>(null);
    const ytFrameRef = useRef<HTMLIFrameElement | null>(null);

    useEffect(() => {
        let alive = true;
        setUrl(null);
        setFailed(false);
        resolveTrailerMp4(yt).then(resolved => {
            if (!alive) return;
            if (resolved) setUrl(resolved);
            else setFailed(true);
        });
        return () => {
            alive = false;
        };
    }, [yt, attempt]);

    // HARD STOP on unmount: pause + unload the <video> element and blank the
    // YouTube fallback iframe, so closing the trailer/movie never leaves
    // sound playing in the background.
    useEffect(() => {
        return () => {
            const v = videoElRef.current;
            if (v) {
                try {
                    v.pause();
                    v.removeAttribute('src');
                    v.load();
                } catch {}
                videoElRef.current = null;
            }
            const f = ytFrameRef.current;
            if (f) {
                try { f.src = 'about:blank'; } catch {}
                ytFrameRef.current = null;
            }
        };
    }, []);

    if (url) {
        return (
            <View style={styles.video}>
                {createElement('video', {
                    key: url,
                    ref: (el: HTMLVideoElement | null) => { videoElRef.current = el; },
                    src: url,
                    autoPlay: true,
                    controls: true,
                    playsInline: true,
                    style: {
                        width: '100%',
                        height: '100%',
                        backgroundColor: '#000',
                        display: 'block',
                        objectFit: 'contain',
                    },
                })}
            </View>
        );
    }

    if (failed) {
        // On a normal (non-iframe) site fall back to the YouTube embed — it
        // configures fine there. Inside sandboxed preview frames it can't
        // (Error 153), so show retry/preview options instead.
        if (!IN_FRAME) {
            return (
                <View style={styles.video}>
                    {createElement('iframe', {
                        ref: (el: HTMLIFrameElement | null) => { ytFrameRef.current = el; },
                        src: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&modestbranding=1`,
                        style: {
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            display: 'block',
                            backgroundColor: '#000',
                        },
                        allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
                        allowFullScreen: true,
                        title: `${title} | Official Trailer`,
                    })}
                </View>
            );
        }
        return (
            <View style={[styles.video, trailerStyles.noteCard]}>
                <Ionicons name="alert-circle-outline" size={30} color="#e5e5e5" />
                <Text style={trailerStyles.noteTitle}>Trailer stream abhi nahi mila</Text>
                <Text style={trailerStyles.noteText}>
                    Public streaming servers busy hain. Retry karo, ya filhaal
                    preview clip dekho.
                </Text>
                <View style={trailerStyles.noteBtns}>
                    <Pressable
                        style={trailerStyles.noteBtn}
                        onPress={() => setAttempt(a => a + 1)}
                    >
                        <Ionicons name="refresh" size={15} color="#000" />
                        <Text style={trailerStyles.noteBtnText}>Retry</Text>
                    </Pressable>
                    <Pressable style={trailerStyles.noteBtnGhost} onPress={onBail}>
                        <Text style={trailerStyles.noteBtnGhostText}>Preview clip dekhein</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.video, trailerStyles.noteCard]}>
            <ActivityIndicator size="large" color="#E50914" />
            <Text style={trailerStyles.noteText}>
                {title ? `${title} — ` : ''}trailer load ho raha hai…
            </Text>
        </View>
    );
}
