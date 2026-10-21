import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, Platform, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '@/components/SafeImage';
import { EmbedPlayer } from '@/components/EmbedPlayer';
import { MovieboxPagePlayer } from '@/components/MovieboxPagePlayer';
import { buildEmbedUrl, NETFLIX_NXSHA_MOVIE, NETFLIX_NXSHA_TV } from '@/lib/embeds';
import {
    getRecentlyWatched,
    markWatched,
    removeWatched,
    updateWatchPosition,
    watchEntryId,
} from '@/lib/recentlyWatched';
import { formatClock } from '@/lib/continueWatching';
import { formatRuntime, getTvSeasons } from '@/lib/tvEpisodes';
import { MOVIEBOX_SERVER_LABEL } from '@/lib/moviebox';
import { movieboxKeyForTitle, resolveMovieboxLink } from '@/lib/movieboxLinks';
import { useMovieboxAvailable } from '@/hooks/useMovieboxAvailable';
import { isPhoneUserAgent } from '@/lib/phonePlayer';
import type { Movie } from '@/types/movie';

const IS_WEB = Platform.OS === 'web';
const PANEL_BG = '#181818';
const MUTED = '#a3a3a3';

type Props = {
    movie: Movie | null;
    /** Other titles from the same shelf, shown as "More Like This". */
    related?: Movie[];
    onClose: () => void;
    /** Opens another title's details inside this modal. */
    onSelect?: (movie: Movie) => void;
    /** Episode to open with — Continue Watching resumes the exact episode. */
    initialEpisode?: { season: number; episode: number } | null;
    /** Start playing as soon as the modal opens (Continue Watching resume). */
    autoPlay?: boolean;
    /** Position (seconds) the media continues from. */
    resumeAt?: number;
};

/** Official Netflix title page, used when no player source can be built. */
function officialUrlFor(movie: Movie): string {
    return movie.netflixUrl
        || (movie.netflixId ? `https://www.netflix.com/in/title/${movie.netflixId}` : '')
        || `https://www.netflix.com/search?q=${encodeURIComponent(String(movie.title ?? '').trim())}`;
}

/**
 * Title details shown over the row when a card is pressed: full-width backdrop
 * with a fade into the panel, title and Play on the image, then year, runtime,
 * description, cast and genres. Play starts the player inside this modal, and
 * closing the player returns to these details.
 */
export function MovieDetailModal({
    movie,
    related = [],
    onClose,
    onSelect,
    initialEpisode = null,
    autoPlay = false,
    resumeAt = 0,
}: Props) {
    const { width, height } = useWindowDimensions();
    /**
     * Phone par player poora screen leta hai (landscape) — panel ki 92% height
     * aur 1000px max-width uske raste me nahi aate.
     */
    const isPhoneWeb =
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        isPhoneUserAgent(navigator.userAgent);
    const [playing, setPlaying] = useState(false);
    /** Episode chosen from the list (TV). Null plays the first episode. */
    const [episodeRef, setEpisodeRef] = useState<{ season: number; episode: number } | null>(null);
    const [season, setSeason] = useState(1);
    const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
    /** Continue Watching entry of the media that is playing right now. */
    const [activeEntry, setActiveEntry] = useState<{
        id: string;
        season: number;
        episode: number;
    } | null>(null);
    /** Short message shown over the player ("Resuming S1 EP3 at 6:12"). */
    const [playerNotice, setPlayerNotice] = useState<string | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Position the media continues from — 0 means "from the beginning". */
    const [resumeSec, setResumeSec] = useState(resumeAt);
    /**
     * Which playback server is on: the regular embed providers, or M2Box
     * (MovieBox ka poora watch page, sirf-player crop me).
     */
    /**
     * Default **MovieBox** (owner: "ab se default me moviebox hi rahega first
     * server"). Link na mile to `activeServer` khud Nxsha par gir jata hai.
     */
    const [server, setServer] = useState<'primary' | 'moviebox'>('moviebox');
    /** Badalta hai jab is browser me is title ka M2Box link save ho jaye. */
    const [movieboxRevision, setMovieboxRevision] = useState(0);

    /** movie ke liye M2Box link (row ka apna, ya browser me saved). */
    const movieboxEntry = useMemo(
        () => resolveMovieboxLink(movie),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [movie?.id, movie?.tmdb_id, movie?.mediaType, movie?.embed_url, movie?.videoUrl, movieboxRevision],
    );
    /** Row ne khud m2box link diya hai — tab M2Box hi pehla server hai. */
    const rowIsMoviebox = movieboxEntry?.source === 'row';
    /** Manual embed override jo m2box page nahi hai. */
    const primaryEmbedUrl = movie?.embed_url && !rowIsMoviebox ? movie.embed_url : undefined;
    const movieboxLinkKey = movieboxKeyForTitle(movie ?? { id: '' });

    /**
     * MovieBox par ye title hai ya nahi — Server 2 ka option sirf tab, jab link
     * sach me mile (row/baked/saved ya live resolve). Warna Nxsha hi rehta hai
     * aur switch ka option dikhta hi nahi.
     */
    const movieboxAvailability = useMovieboxAvailable(movie, {
        known: Boolean(movieboxEntry),
        linkKey: movieboxLinkKey,
        onResolved: () => setMovieboxRevision((n) => n + 1),
    });
    const movieboxAvailable = Boolean(movieboxEntry) || movieboxAvailability.available;

    /** Play daba par MovieBox ka jawab pending tha — jawab aate hi wahi karo. */
    const pendingPlayRef = useRef<{ season: number; episode: number } | null>(null);

    /** Pending play ka jawab aa gaya — ab sahi rasta chuno. */
    useEffect(() => {
        if (!movie) return;
        const pending = pendingPlayRef.current;
        if (!pending || movieboxAvailability.checking) return;
        pendingPlayRef.current = null;
        if (movieboxAvailable) {
            setActiveEntry(null);
            setServer('moviebox');
            setPlaying(true);
            return;
        }
        // MovieBox par bhi nahi hai — official Netflix.
        const url = officialUrlFor(movie);
        if (IS_WEB) {
            window.open(url, '_blank', 'noopener');
        } else {
            Linking.openURL(url).catch(() => {});
        }
    }, [movieboxAvailability.checking, movieboxAvailable, movie]);


    /** Show a short message over the player, the way the Crunchyroll page does. */
    const announce = useCallback((message: string | null) => {
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        setPlayerNotice(message);
        if (!message) return;
        noticeTimer.current = setTimeout(() => setPlayerNotice(null), 4000);
    }, []);

    // A different title (or closing the modal) always starts from the details view.
    useEffect(() => {
        setServer('moviebox');
        setPlaying(autoPlay);
        setEpisodeRef(initialEpisode ?? null);
        setSeason(initialEpisode?.season ?? 1);
        setSeasonMenuOpen(false);
        setResumeSec(resumeAt);
        if (autoPlay && movie) {
            // Resuming from the Continue Watching row: the position of the
            // entry that is being continued is the one we keep updating.
            const isSeries = movie.mediaType === 'tv';
            const ep = initialEpisode ?? { season: 1, episode: 1 };
            setActiveEntry({
                id: watchEntryId(movie.id, isSeries ? 'tv' : 'movie', ep.season, ep.episode),
                season: ep.season,
                episode: ep.episode,
            });
            // Announce the resume point, exactly like the Crunchyroll page does.
            const where = isSeries ? `S${ep.season} EP${ep.episode}` : 'Movie';
            announce(resumeAt >= 30 ? `Resuming ${where} at ${formatClock(resumeAt)}` : null);
        } else {
            setActiveEntry(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [movie?.id, autoPlay, initialEpisode?.season, initialEpisode?.episode]);

    const seasons = useMemo(
        () => (movie?.mediaType === 'tv' ? getTvSeasons(movie.tmdb_id) : []),
        [movie],
    );
    const currentSeason = seasons.find((s) => s.season_number === season) ?? seasons[0];

    const src = useMemo(() => {
        if (!movie) return '';
        // Row ka link hi m2box page hai → wo M2Box server chalata hai, koi embed nahi.
        if (rowIsMoviebox) return '';
        try {
            const provider = movie.embed_provider || 'nxsha';
            // Netflix titles play in the Netflix-accent nxsha player.
            // Netflix shows (mediaType 'tv') open their first episode in the same accent player.
            if (movie.mediaType === 'tv') {
                const ep = episodeRef ?? { season: 1, episode: 1 };
                return buildEmbedUrl(
                    provider,
                    'tv',
                    { tmdbId: movie.tmdb_id, imdbId: movie.imdb_id, embed_url: primaryEmbedUrl, season: ep.season, episode: ep.episode },
                    provider === 'nxsha' ? { tvTemplate: NETFLIX_NXSHA_TV } : {},
                );
            }
            return buildEmbedUrl(
                provider,
                'movie',
                { tmdbId: movie.tmdb_id, imdbId: movie.imdb_id, embed_url: primaryEmbedUrl },
                provider === 'nxsha' ? { movieTemplate: NETFLIX_NXSHA_MOVIE } : {},
            );
        } catch {
            return '';
        }
    }, [movie, episodeRef, primaryEmbedUrl, rowIsMoviebox]);

    const panelWidth = Math.min(1000, width * 0.94);
    const wide = panelWidth > 640;
    const fiveUp = panelWidth > 880;
    const heroHeight = Math.min(panelWidth * 0.56, height * (IS_WEB ? 0.62 : 0.4));

    if (!movie) {
        return <Modal visible={false} transparent onRequestClose={onClose} />;
    }

    const image = movie.backdropUrl || movie.imageUrl || '';
    const isSeries = movie.type === 'SERIES';
    const meta = [movie.year, movie.duration || (isSeries ? '1 Season' : '')].filter(Boolean);
    const cast = (movie.cast || []).filter((name) => name && name !== 'Cast not available');
    const genres = movie.genres || [];

    /** MovieBox available na ho to server hamesha Server 1 (Nxsha). */
    const activeServer: 'primary' | 'moviebox' = movieboxAvailable ? server : 'primary';

    const handlePlay = (episode?: { season: number; episode: number }) => {
        if (src) {
            const isSeries = movie.mediaType === 'tv';
            const ep = episode ?? episodeRef ?? { season: 1, episode: 1 };
            if (episode) setEpisodeRef(episode);
            // A series is remembered per episode, so resuming never lands on
            // the wrong one.
            const entryId = watchEntryId(movie.id, isSeries ? 'tv' : 'movie', ep.season, ep.episode);
            // A title that was started before continues from where it was
            // left — the same rule the Crunchyroll page follows.
            const saved = getRecentlyWatched().find((e) => e.id === entryId);
            const from = saved?.positionSec ?? 0;
            setResumeSec(from);
            const where = isSeries ? `S${ep.season} EP${ep.episode}` : 'Movie';
            announce(from >= 30 ? `Resuming ${where} at ${formatClock(from)}` : null);
            try {
                markWatched({
                    id: entryId,
                    titleId: movie.id,
                    title: movie.title,
                    type: isSeries ? 'tv' : 'movie',
                    tmdbId: movie.tmdb_id,
                    imdbId: movie.imdb_id,
                    season: isSeries ? ep.season : undefined,
                    episode: isSeries ? ep.episode : undefined,
                    provider: movie.embed_provider || 'nxsha',
                    imageUrl: movie.imageUrl,
                    backdropUrl: movie.backdropUrl,
                    year: movie.year,
                });
            } catch {}
            setActiveEntry({ id: entryId, season: ep.season, episode: ep.episode });
            // Jo server abhi chal raha hai wahi chipka do — warna MovieBox ki
            // availability baad me resolve hone par video ke beech player badal
            // jata (play dabne ke baad server apne aap nahi badalna chahiye).
            setServer(activeServer);
            setPlaying(true);
            return;
        }
        // Koi primary embed nahi bana — lekin M2Box ka link hai to Server 2
        // seedha chalao (yahi un titles ka rasta hai jinpe Nxsha ke paas id
        // hi nahi hoti). Jawab pending ho to official par mat bhejo.
        if (movieboxAvailability.checking) {
            pendingPlayRef.current = episode ?? episodeRef ?? { season: 1, episode: 1 };
            return;
        }
        if (movieboxAvailable) {
            if (episode) setEpisodeRef(episode);
            setActiveEntry(null);
            setServer('moviebox');
            setPlaying(true);
            return;
        }
        // No playable id for this title: send the viewer to Netflix instead.
        const url = officialUrlFor(movie);
        if (IS_WEB) {
            window.open(url, '_blank', 'noopener');
        } else {
            Linking.openURL(url).catch(() => {});
        }
    };

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="Close details" />
                <View
                    style={[
                        styles.panel,
                        { width: panelWidth },
                        // Phone par player poora screen (landscape) leta hai.
                        playing && isPhoneWeb && styles.panelPhonePlayer,
                    ]}
                >
                    <ScrollView key={movie.id} bounces={false} showsVerticalScrollIndicator={false}>
                        <View style={[styles.hero, { height: heroHeight }]}>
                            {image ? (
                                <SafeImage
                                    source={{ uri: image }}
                                    style={{ width: '100%', height: '100%' } as any}
                                    fallbackLabel={movie.title}
                                    loading="eager"
                                />
                            ) : (
                                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#222' }]} />
                            )}
                            <LinearGradient
                                colors={['rgba(24,24,24,0)', 'rgba(24,24,24,0.7)', PANEL_BG]}
                                locations={[0.3, 0.75, 1]}
                                style={StyleSheet.absoluteFillObject}
                                pointerEvents="none"
                            />

                            <Pressable
                                onPress={onClose}
                                style={styles.closeButton}
                                accessibilityLabel="Close details"
                            >
                                <Ionicons name="close" size={22} color="#fff" />
                            </Pressable>

                            <View style={styles.heroContent}>
                                <Text style={styles.title} numberOfLines={2}>{movie.title || ''}</Text>
                                <Pressable
                                    onPress={() => handlePlay()}
                                    style={styles.playButton}
                                    accessibilityLabel={`Play ${movie.title || ''}`}
                                >
                                    <Ionicons name="play" size={20} color="#000" />
                                    <Text style={styles.playText}>Play</Text>
                                </Pressable>
                            </View>
                        </View>

                        <View style={[styles.body, wide && styles.bodyWide]}>
                            <View style={[styles.main, wide && styles.mainWide]}>
                                <View style={styles.metaRow}>
                                    {movie.ranking_text ? <Text style={styles.rank}>{movie.ranking_text}</Text> : null}
                                    {meta.map((item) => (
                                        <Text key={item} style={styles.metaText}>{item}</Text>
                                    ))}
                                    <Text style={styles.hdBadge}>HD</Text>
                                </View>
                                {movie.description ? (
                                    <Text style={styles.description}>{movie.description}</Text>
                                ) : null}
                            </View>

                            <View style={[styles.side, wide && styles.sideWide]}>
                                {cast.length > 0 ? (
                                    <Text style={styles.sideText}>
                                        <Text style={styles.sideLabel}>Cast: </Text>
                                        {cast.join(', ')}
                                    </Text>
                                ) : null}
                                {genres.length > 0 ? (
                                    <Text style={styles.sideText}>
                                        <Text style={styles.sideLabel}>Genres: </Text>
                                        {genres.join(', ')}
                                    </Text>
                                ) : null}
                            </View>
                        </View>

                        {/* Server chunna — owner ke naap par description ke
                            neeche, "Episodes" ke upar. **Hindi = MovieBox**,
                            **Multi = Nxsha**. MovieBox link na ho to ye option
                            dikhta hi nahi (Nxsha hi chalta hai). */}
                        {movieboxAvailable ? (
                            <View style={[styles.serverRow, wide && styles.serverRowWide]}>
                                <Text style={styles.serverRowLabel}>Server</Text>
                                <Pressable
                                    onPress={() => setServer('moviebox')}
                                    style={[
                                        styles.serverChip,
                                        activeServer === 'moviebox' && styles.serverChipActive,
                                    ]}
                                    accessibilityLabel="Hindi server (M2Box)"
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: activeServer === 'moviebox' }}
                                    {...({ dataSet: { selected: activeServer === 'moviebox' ? '1' : '0' } } as any)}
                                    testID="server-hindi"
                                >
                                    <Text
                                        style={[
                                            styles.serverChipText,
                                            activeServer === 'moviebox' && styles.serverChipTextActive,
                                        ]}
                                    >
                                        Hindi
                                    </Text>
                                </Pressable>
                                <Pressable
                                    onPress={() => setServer('primary')}
                                    style={[
                                        styles.serverChip,
                                        activeServer === 'primary' && styles.serverChipActive,
                                    ]}
                                    accessibilityLabel="Multi server (Nxsha)"
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: activeServer === 'primary' }}
                                    {...({ dataSet: { selected: activeServer === 'primary' ? '1' : '0' } } as any)}
                                    testID="server-multi"
                                >
                                    <Text
                                        style={[
                                            styles.serverChipText,
                                            activeServer === 'primary' && styles.serverChipTextActive,
                                        ]}
                                    >
                                        Multi
                                    </Text>
                                </Pressable>
                            </View>
                        ) : null}

                        {currentSeason ? (
                            <View style={[styles.episodes, wide && styles.episodesWide]}>
                                <View style={styles.episodesHeader}>
                                    <Text style={styles.moreTitle}>Episodes</Text>
                                    {seasons.length > 1 ? (
                                        <Pressable
                                            onPress={() => setSeasonMenuOpen((open) => !open)}
                                            style={styles.seasonButton}
                                            accessibilityLabel="Choose season"
                                        >
                                            <Text style={styles.seasonButtonText}>
                                                {`${currentSeason.name || `Season ${currentSeason.season_number}`} (${currentSeason.episode_count} EP)`}
                                            </Text>
                                            <Ionicons name={seasonMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#fff" />
                                        </Pressable>
                                    ) : (
                                        <Text style={styles.metaText}>{`${currentSeason.episode_count} EP`}</Text>
                                    )}
                                </View>

                                {seasonMenuOpen && seasons.length > 1 ? (
                                    <View style={styles.seasonMenu}>
                                        {seasons.map((item) => (
                                            <Pressable
                                                key={item.season_number}
                                                onPress={() => {
                                                    setSeason(item.season_number);
                                                    setSeasonMenuOpen(false);
                                                }}
                                                style={[styles.seasonOption, item.season_number === currentSeason.season_number && styles.seasonOptionActive]}
                                                accessibilityLabel={`Season ${item.season_number}`}
                                            >
                                                <Text style={styles.seasonOptionText}>
                                                    {`${item.name || `Season ${item.season_number}`} (${item.episode_count} EP)`}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                ) : null}

                                {currentSeason.episodes.map((ep) => (
                                    <Pressable
                                        key={`${ep.season}-${ep.episode}`}
                                        onPress={() => handlePlay({ season: ep.season, episode: ep.episode })}
                                        style={styles.episodeRow}
                                        accessibilityLabel={`Play episode ${ep.episode}: ${ep.name}`}
                                    >
                                        <Text style={styles.episodeNumber}>{ep.episode}</Text>
                                        <View style={styles.episodeThumb}>
                                            <SafeImage
                                                source={{ uri: ep.still || image }}
                                                style={{ width: '100%', height: '100%' } as any}
                                                fallbackLabel={ep.name}
                                            />
                                            <View style={styles.episodePlayBadge} pointerEvents="none">
                                                <Ionicons name="play" size={14} color="#fff" />
                                            </View>
                                        </View>
                                        <View style={styles.episodeInfo}>
                                            <View style={styles.episodeTop}>
                                                <Text style={styles.episodeName} numberOfLines={1}>{ep.name}</Text>
                                                {ep.runtime ? <Text style={styles.episodeRuntime}>{formatRuntime(ep.runtime)}</Text> : null}
                                            </View>
                                            {ep.overview ? (
                                                <Text style={styles.episodeOverview} numberOfLines={3}>{ep.overview}</Text>
                                            ) : null}
                                        </View>
                                    </Pressable>
                                ))}
                            </View>
                        ) : null}

                        {related.length > 0 ? (
                            <View style={styles.more}>
                                <Text style={styles.moreTitle}>More Like This</Text>
                                <View style={styles.moreGrid}>
                                    {related.map((item) => (
                                        <Pressable
                                            key={item.id}
                                            onPress={() => onSelect?.(item)}
                                            style={[styles.moreItem, fiveUp ? styles.moreItemFive : wide ? styles.moreItemWide : styles.moreItemNarrow]}
                                            accessibilityLabel={`Open ${item.title || ''}`}
                                        >
                                            <SafeImage
                                                source={{ uri: item.imageUrl }}
                                                style={styles.morePoster as any}
                                                fallbackLabel={item.title}
                                                loading="eager"
                                            />
                                            <Text style={styles.moreItemTitle} numberOfLines={2}>{item.title || ''}</Text>
                                            {item.year ? <Text style={styles.moreItemMeta}>{item.year}</Text> : null}
                                        </Pressable>
                                    ))}
                                </View>
                            </View>
                        ) : null}
                    </ScrollView>
                </View>

                {playing && (src || activeServer === 'moviebox') ? (
                    <View style={styles.playerLayer}>
                        {activeServer === 'moviebox' ? (
                            <MovieboxPagePlayer
                                linkKey={movieboxLinkKey}
                                initialLink={movieboxEntry?.link ?? null}
                                title={movie.title}
                                year={movie.year}
                                mediaType={movie.mediaType === 'tv' ? 'tv' : 'movie'}
                                season={movie.mediaType === 'tv' ? episodeRef?.season : undefined}
                                episode={movie.mediaType === 'tv' ? episodeRef?.episode : undefined}
                                episodeCount={
                                    movie.mediaType === 'tv' ? currentSeason?.episode_count : undefined
                                }
                                episodeTitle={
                                    movie.mediaType === 'tv'
                                        ? currentSeason?.episodes?.find(
                                              (item) =>
                                                  item.episode ===
                                                  (episodeRef?.episode ?? 1),
                                          )?.name
                                        : undefined
                                }
                                onEpisodeChange={(next) => {
                                    // Agla episode chal raha hai — modal ka apna
                                    // state bhi wahi rahe (player band karke
                                    // dobara kholne par sahi episode khule).
                                    setEpisodeRef(next);
                                }}
                                onClose={() => setPlaying(false)}
                                onLinkSaved={() => setMovieboxRevision((n) => n + 1)}
                            />
                        ) : (
                            <EmbedPlayer
                                src={src}
                                title={episodeRef && movie.mediaType === 'tv' ? `${movie.title} · S${episodeRef.season} E${episodeRef.episode}` : movie.title}
                                onClose={() => setPlaying(false)}
                                fallbackUrl={officialUrlFor(movie)}
                                resumeAt={resumeSec}
                                serverName="Nxsha"
                                onProgress={(info) => {
                                    if (!activeEntry) return;
                                    updateWatchPosition(activeEntry.id, info.seconds, info.duration);
                                }}
                                onEnded={() => {
                                    if (!activeEntry) return;
                                    // The media finished: it leaves the row, the
                                    // same way the Crunchyroll page does it.
                                    removeWatched(activeEntry.id);
                                    announce('Marked as watched');
                                }}
                            />
                        )}
                        {playerNotice ? (
                            <View style={styles.playerNotice} pointerEvents="none">
                                <Ionicons name="play-circle" size={16} color="#fff" />
                                <Text style={styles.playerNoticeText}>{playerNotice}</Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
    },
    panel: {
        maxHeight: '92%',
        backgroundColor: PANEL_BG,
        borderRadius: 8,
        overflow: 'hidden',
    },
    /**
     * Phone + player khula: panel hi poora viewport, bina clipping ke — ghuma
     * hua (landscape) player modal ki 92% height me phansa na rahe.
     */
    panelPhonePlayer: {
        width: '100%',
        height: '100%',
        maxHeight: '100%',
        borderRadius: 0,
        overflow: 'visible',
    },
    playerLayer: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000',
        zIndex: 20,
    },
    playerNotice: {
        position: 'absolute',
        top: 64,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(0,0,0,0.72)',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        zIndex: 30,
    },
    playerNoticeText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    hero: {
        width: '100%',
        backgroundColor: '#000',
    },
    closeButton: {
        position: 'absolute',
        top: 12,
        right: 12,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    heroContent: {
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: 16,
        gap: 14,
    },
    title: {
        color: '#fff',
        fontSize: 34,
        fontWeight: '800',
        textShadowColor: 'rgba(0,0,0,0.6)',
        textShadowRadius: 8,
    },
    playButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 4,
        paddingVertical: 8,
        paddingHorizontal: 22,
    },
    playText: {
        color: '#000',
        fontSize: 18,
        fontWeight: '700',
    },
    body: {
        paddingHorizontal: 24,
        paddingBottom: 24,
        gap: 16,
    },
    bodyWide: {
        flexDirection: 'row',
        gap: 28,
    },
    main: {
        gap: 12,
    },
    mainWide: {
        flex: 3,
    },
    side: {
        gap: 10,
    },
    sideWide: {
        flex: 2,
    },
    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
    },
    rank: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    metaText: {
        color: MUTED,
        fontSize: 15,
    },
    hdBadge: {
        color: MUTED,
        fontSize: 12,
        borderWidth: 1,
        borderColor: MUTED,
        borderRadius: 3,
        paddingHorizontal: 5,
        paddingVertical: 1,
    },
    description: {
        color: '#e5e5e5',
        fontSize: 16,
        lineHeight: 24,
    },
    sideText: {
        color: '#e5e5e5',
        fontSize: 14,
        lineHeight: 20,
    },
    sideLabel: {
        color: MUTED,
    },
    /** Hindi / Multi — server chunne wali patti (moviebox / nxsha). */
    serverRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    serverRowWide: {
        paddingHorizontal: 40,
    },
    serverRowLabel: {
        color: '#9a9a9a',
        fontSize: 13,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginRight: 6,
    },
    serverChip: {
        paddingHorizontal: 18,
        paddingVertical: 8,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.4)',
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    serverChipActive: {
        backgroundColor: '#fff',
        borderColor: '#fff',
    },
    serverChipText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
    serverChipTextActive: {
        color: '#000',
    },
    episodes: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 8,
    },
    episodesWide: {
        paddingHorizontal: 40,
    },
    episodesHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        zIndex: 5,
    },
    seasonButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.6)',
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    seasonButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    seasonMenu: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        borderRadius: 4,
        backgroundColor: '#222',
        marginBottom: 12,
        overflow: 'hidden',
    },
    seasonOption: {
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    seasonOptionActive: {
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    seasonOptionText: {
        color: '#fff',
        fontSize: 14,
    },
    episodeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
    },
    episodeNumber: {
        color: MUTED,
        fontSize: 20,
        width: 24,
        textAlign: 'center',
    },
    episodeThumb: {
        width: 150,
        aspectRatio: 16 / 9,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#222',
    },
    episodePlayBadge: {
        position: 'absolute',
        left: 6,
        bottom: 6,
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    episodeInfo: {
        flex: 1,
        minWidth: 0,
    },
    episodeTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    episodeName: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
        flex: 1,
    },
    episodeRuntime: {
        color: MUTED,
        fontSize: 13,
    },
    episodeOverview: {
        color: MUTED,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 4,
    },
    more: {
        paddingHorizontal: 24,
        paddingBottom: 28,
        gap: 14,
    },
    moreTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '700',
    },
    moreGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    moreItem: {
        gap: 6,
    },
    moreItemFive: {
        width: '18.5%',
    },
    moreItemWide: {
        width: '31.5%',
    },
    moreItemNarrow: {
        // Three per row on phones: 3 x 30% plus two 12px gaps fits even in a 331px panel.
        width: '30%',
    },
    morePoster: {
        width: '100%',
        aspectRatio: 2 / 3,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#222',
    },
    moreItemTitle: {
        color: '#e5e5e5',
        fontSize: 14,
        fontWeight: '600',
    },
    moreItemMeta: {
        color: MUTED,
        fontSize: 12,
    },
});
