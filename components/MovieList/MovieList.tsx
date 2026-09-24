import React, { useEffect, useId, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { styles } from '@/styles';
import { Movie, MovieRow } from '@/types/movie';
import { useVisionOS } from '@/hooks/useVisionOS';
import { HoverableView } from '@/components/ui/VisionContainer';
import { SafeImage } from '@/components/SafeImage';
import { Ionicons } from '@expo/vector-icons';
import { getCarouselWindow, spacerWidth, WEB_CARD_GAP, WEB_CARD_WIDTH, WEB_CAROUSEL_WINDOW } from './carouselWindow';

const IS_WEB = Platform.OS === 'web';
const ROW_PADDING = IS_WEB ? 48 : 16;

/** TV mode uses the native-style ring, not desktop hover cards/box-shadows. */
const isTvRemoteMode = () =>
    IS_WEB && typeof document !== 'undefined' && document.body.classList.contains('tv-remote-mode');

const NumberBackground = ({ number }: { number: number }) => {
    const num = (number).toString().padStart(2, '0');

    return (
        <View style={styles.numberContainer}>
            <Text style={[styles.numberText, {
                color: 'white',
                opacity: 0.15,
                fontSize: 200,
                fontFamily: 'arialic',
            }]}>{num}</Text>
        </View>
    );
};

const MovieItem = ({ item, router, index, isTop10 }: {
    item: Movie;
    router: any;
    index: number;
    isTop10: boolean;
}) => (
    <Pressable
        onPress={() => router.push({
            pathname: '/movie/[id]',
            params: { id: item.id }
        })}
        style={[
            styles.contentItem,
            isTop10 && styles.top10Item
        ]}
    >
        {isTop10 && <NumberBackground number={index + 1} />}
        <SafeImage
            source={{ uri: item.imageUrl }}
            style={[
                styles.thumbnail,
                isTop10 && styles.top10Thumbnail
            ]}
            fallbackLabel={item.title}
        />
    </Pressable>
);

/**
 * Authentic Netflix India Top 10 Card:
 * Stylized large rank number on the left with 2:3 vertical poster on the right.
 */
const WebTop10Card = ({ item, index, rowTitle = 'top_10', onPress }: {
    item: Movie;
    index: number;
    rowTitle?: string;
    onPress: () => void;
}) => {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const num = index + 1;
    const isActive = !isTvRemoteMode() && (hovered || focused);

    return (
        <Pressable
            onPress={onPress}
            onHoverIn={() => { if (!isTvRemoteMode()) setHovered(true); }}
            onHoverOut={() => { if (!isTvRemoteMode()) setHovered(false); }}
            onFocus={() => { if (!isTvRemoteMode()) setFocused(true); }}
            onBlur={() => { if (!isTvRemoteMode()) setFocused(false); }}
            tabIndex={0}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title || 'title'}`}
            testID={`movie-card-${item.id}`}
            {...({
                dataSet: {
                    tvFocusable: 'true',
                    tvCard: 'true',
                    tvRow: rowTitle,
                    tvIndex: String(index),
                },
            } as any)}
            style={[top10.wrap, isActive && top10.wrapHover]}
        >
            <View style={top10.row}>
                {/* Netflix Stylized Rank Number */}
                <View style={top10.numberBox}>
                    <Text style={top10.number}>{num}</Text>
                </View>

                {/* Vertical Poster Card */}
                <View style={[top10.posterBox, isActive && top10.posterBoxHover]}>
                    <SafeImage
                        source={{ uri: item.imageUrl }}
                        style={top10.poster}
                        fallbackLabel={item.title}
                    />
                    <View style={top10.badge}>
                        <Text style={top10.badgeText}>TOP 10</Text>
                    </View>

                    {isActive && (
                        <View style={top10.quickOverlay} {...({ dataSet: { tvCardOverlay: 'true' } } as any)}>
                            <View style={card.playCircle}>
                                <Ionicons name="play" size={16} color="#000" />
                            </View>
                            <Text style={top10.hoverTitle} numberOfLines={1}>
                                {item.title}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </Pressable>
    );
};

/**
 * Authentic Netflix India Vertical Poster Card:
 * Full 2:3 aspect ratio poster with hover zoom and quick action bar.
 */
const WebPosterCard = ({ item, index = 0, rowTitle = 'row', onPress }: {
    item: Movie;
    index?: number;
    rowTitle?: string;
    onPress: () => void;
}) => {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const isActive = !isTvRemoteMode() && (hovered || focused);

    return (
        <Pressable
            onPress={onPress}
            onHoverIn={() => { if (!isTvRemoteMode()) setHovered(true); }}
            onHoverOut={() => { if (!isTvRemoteMode()) setHovered(false); }}
            onFocus={() => { if (!isTvRemoteMode()) setFocused(true); }}
            onBlur={() => { if (!isTvRemoteMode()) setFocused(false); }}
            tabIndex={0}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title || 'title'}`}
            testID={`movie-card-${item.id}`}
            {...({
                dataSet: {
                    tvFocusable: 'true',
                    tvCard: 'true',
                    tvRow: rowTitle,
                    tvIndex: String(index),
                },
            } as any)}
            style={[card.wrap, isActive && card.wrapHover]}
        >
            <View style={[card.posterBox, isActive && card.posterBoxHover]}>
                <SafeImage
                    source={{ uri: item.imageUrl }}
                    style={card.poster}
                    fallbackLabel={item.title}
                />

                {/* Subtle top N badge */}
                <View style={card.nBadge}>
                    <Text style={card.nBadgeText}>N</Text>
                </View>

                {/* Hover overlay with action buttons and title */}
                {isActive && (
                    <View style={card.hoverOverlay} {...({ dataSet: { tvCardOverlay: 'true' } } as any)}>
                        <View style={card.actionsRow}>
                            <View style={card.playCircle}>
                                <Ionicons name="play" size={16} color="#000" />
                            </View>
                            <View style={card.iconCircle}>
                                <Ionicons name="add" size={16} color="#fff" />
                            </View>
                            <View style={card.iconCircle}>
                                <Ionicons name="thumbs-up-outline" size={14} color="#fff" />
                            </View>
                        </View>

                        <Text style={card.title} numberOfLines={1}>
                            {item.title}
                        </Text>

                        <View style={card.metaRow}>
                            <Text style={card.matchText}>98% Match</Text>
                            <View style={card.ratingBox}>
                                <Text style={card.ratingText}>U/A 16+</Text>
                            </View>
                            <Text style={card.durationText}>
                                {item.duration || (item.type === 'SERIES' ? '1 Season' : '2h 10m')}
                            </Text>
                        </View>
                    </View>
                )}
            </View>
        </Pressable>
    );
};

export function MovieList({ rowTitle, movies, type, hideExploreAll }: MovieRow & { hideExploreAll?: boolean }) {
    const router = useRouter();
    const isTop10 = type === 'top_10';
    // Home, Movies and TV Shows are all mounted at the same time and reuse the
    // same rowTitle, so a bare `data-tv-row={rowTitle}` makes the remote treat
    // three different shelves as ONE row — the ring then walks into a screen the
    // user cannot see. Suffix a per-instance id so every shelf is unique.
    const shelfUid = useId().replace(/:/g, '');
    const navRow = `${rowTitle}#${shelfUid}`;
    const { isVisionOS } = useVisionOS();
    const { width: windowWidth } = useWindowDimensions();
    // Web uses a horizontal ScrollView while native uses FlatList; both refs
    // expose different imperative scroll methods.
    const listRef = useRef<any>(null);
    const rowRef = useRef<View>(null);
    const offsetX = useRef(0);
    const [contentWidth, setContentWidth] = useState(0);
    // A shelf can have 200+ titles. Keep its scroll distance, but mount only
    // nearby cards so hydration and the first click don't wait on every poster.
    const [windowStart, setWindowStart] = useState(0);
    const virtualized = IS_WEB && !isTop10 && movies.length > WEB_CAROUSEL_WINDOW;
    const start = virtualized ? Math.min(windowStart, movies.length - WEB_CAROUSEL_WINDOW) : 0;
    const end = virtualized ? Math.min(movies.length, start + WEB_CAROUSEL_WINDOW) : movies.length;

    const pageStep = windowWidth * 0.75;
    const pages = Math.max(1, Math.ceil(contentWidth / pageStep));
    const [page, setPage] = useState(0);

    useEffect(() => {
        if (!virtualized) return;
        const row = rowRef.current as unknown as HTMLElement | null;
        const shelf = row?.closest?.('[data-tv-shelf="true"]');
        if (!shelf) return;
        const reveal = (event: Event) => {
            const index = Number((event as CustomEvent<{ index: number }>).detail?.index);
            if (!Number.isInteger(index) || index < 0 || index >= movies.length) return;
            // Keep the requested poster a little in from the left edge. Set
            // the window AND the scroll position in the same update so a rapid
            // Right press cannot land on an unmounted poster or another row.
            const scroller = row?.querySelector<HTMLElement>('[data-tv-carousel="true"]');
            const viewportWidth = scroller?.clientWidth || windowWidth;
            const nextX = Math.max(0, Math.round(index * (WEB_CARD_WIDTH + WEB_CARD_GAP) - viewportWidth * 0.35));
            setWindowStart(getCarouselWindow(movies.length, nextX).start);
            offsetX.current = nextX;
            if (scroller) scroller.scrollLeft = nextX;
        };
        shelf.addEventListener('arena-tv-reveal-card', reveal);
        return () => shelf.removeEventListener('arena-tv-reveal-card', reveal);
    }, [virtualized, movies.length, windowWidth]);

    const scrollByPage = (dir: 1 | -1) => {
        const next = Math.max(0, offsetX.current + dir * pageStep);
        const list = listRef.current;
        if (!list) return;
        if (IS_WEB && typeof list.scrollTo === 'function') {
            list.scrollTo({ x: next, y: 0, animated: true });
        } else if (typeof list.scrollToOffset === 'function') {
            list.scrollToOffset({ offset: next, animated: true });
        }
    };

    const openMovie = (item: Movie) => router.push({
        pathname: '/movie/[id]',
        params: { id: item.id },
    });

    const renderItem = ({ item, index }: { item: Movie; index: number }) => {
        if (IS_WEB) {
            if (isTop10) {
                return (
                    <WebTop10Card
                        key={`${item.id}-${index}`}
                        item={item}
                        index={index}
                        rowTitle={navRow}
                        onPress={() => openMovie(item)}
                    />
                );
            }
            return (
                <WebPosterCard
                    key={`${item.id}-${index}`}
                    item={item}
                    index={index}
                    rowTitle={navRow}
                    onPress={() => openMovie(item)}
                />
            );
        }
        return (
            <HoverableView key={`${item.id}-${index}`}>
                <MovieItem
                    item={item}
                    router={router}
                    index={index}
                    isTop10={isTop10}
                />
            </HoverableView>
        );
    };

    return (
        <View ref={rowRef} style={[styles.container, IS_WEB && rowStyles.rowContainer]}>
            {IS_WEB ? (
                <View style={rowStyles.headerRow}>
                    <Text style={[styles.sectionTitle, rowStyles.sectionTitle]}>{rowTitle}</Text>
                    {!hideExploreAll ? (
                        <Pressable
                            style={({ hovered }: any) => [rowStyles.explore, hovered && rowStyles.exploreHover]}
                            onPress={() => router.push({
                                pathname: '/browse/[rowTitle]',
                                params: { rowTitle },
                            })}
                            tabIndex={0}
                            accessibilityRole="button"
                            accessibilityLabel={`Explore all titles in ${rowTitle}`}
                            {...({
                                dataSet: {
                                    tvFocusable: 'true',
                                    tvRow: `${navRow}-header`,
                                    tvId: `explore-${rowTitle}`,
                                    // Not part of the page's vertical flow: ArrowUp
                                    // from this shelf must reach the shelf above,
                                    // not this little text link.
                                    tvVerticalIgnore: 'true',
                                },
                            } as any)}
                        >
                            <Text style={rowStyles.exploreText}>Explore All</Text>
                            <Ionicons name="chevron-forward" size={13} color="#54b9c5" />
                        </Pressable>
                    ) : null}
                </View>
            ) : (
                <Text style={styles.sectionTitle}>{rowTitle}</Text>
            )}
            <View style={IS_WEB ? rowStyles.rowWrapper : undefined}>
                {IS_WEB ? (
                    <ScrollView
                        ref={listRef as any}
                        testID={`movie-carousel-${rowTitle}`}
                        {...({ dataSet: { tvCarousel: 'true' } } as any)}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        onScroll={(e: any) => {
                            offsetX.current = e.nativeEvent.contentOffset.x;
                            setPage(Math.min(pages - 1, Math.round(offsetX.current / pageStep)));
                            if (virtualized) {
                                const nextStart = getCarouselWindow(movies.length, offsetX.current).start;
                                setWindowStart(previous => previous === nextStart ? previous : nextStart);
                            }
                        }}
                        scrollEventThrottle={16}
                        onContentSizeChange={(w) => setContentWidth(w)}
                        contentContainerStyle={[
                            styles.contentList,
                            isTop10 && styles.top10List,
                            {
                                paddingHorizontal: ROW_PADDING,
                                columnGap: isTop10 ? 28 : 12,
                                // The TV focus ring is scale(1.06) + a 4px outline
                                // with a 3px offset, i.e. ~15px taller than the
                                // poster. This ScrollView clips overflow, so without
                                // this headroom the top of the ring is cut off.
                                paddingTop: IS_WEB ? 18 : 10,
                                paddingBottom: IS_WEB ? 26 : 22,
                            },
                        ]}
                    >
                        {virtualized && start > 0 ? (
                            <View testID="carousel-spacer-before" style={{ width: spacerWidth(start), flexShrink: 0 }} />
                        ) : null}
                        {movies.slice(start, end).map((item, index) => renderItem({ item, index: start + index }))}
                        {virtualized && end < movies.length ? (
                            <View testID="carousel-spacer-after" style={{ width: spacerWidth(movies.length - end), flexShrink: 0 }} />
                        ) : null}
                    </ScrollView>
                ) : (
                    <FlatList
                        ref={listRef}
                        horizontal
                        data={movies}
                        renderItem={renderItem}
                        keyExtractor={(item, index) => `${item.id}-${index}`}
                        showsHorizontalScrollIndicator={false}
                        initialNumToRender={10}
                        maxToRenderPerBatch={10}
                        onScroll={(e) => {
                            offsetX.current = e.nativeEvent.contentOffset.x;
                            setPage(Math.min(pages - 1, Math.round(offsetX.current / pageStep)));
                        }}
                        scrollEventThrottle={16}
                        onContentSizeChange={(w) => setContentWidth(w)}
                        contentContainerStyle={[
                            styles.contentList,
                            isTop10 && styles.top10List,
                        ]}
                    />
                )}
                {IS_WEB && (
                    <>
                        <Pressable
                            style={({ hovered }: any) => [
                                rowStyles.arrow,
                                rowStyles.arrowLeft,
                                hovered && rowStyles.arrowHover,
                            ]}
                            onPress={() => scrollByPage(-1)}
                            {...({ dataSet: { tvIgnore: 'true' } } as any)}
                        >
                            <Ionicons name="chevron-back" size={32} color="#fff" />
                        </Pressable>
                        <Pressable
                            style={({ hovered }: any) => [
                                rowStyles.arrow,
                                rowStyles.arrowRight,
                                hovered && rowStyles.arrowHover,
                            ]}
                            onPress={() => scrollByPage(1)}
                            {...({ dataSet: { tvIgnore: 'true' } } as any)}
                        >
                            <Ionicons name="chevron-forward" size={32} color="#fff" />
                        </Pressable>
                    </>
                )}
            </View>
            {IS_WEB && pages > 1 ? (
                <View style={rowStyles.pager}>
                    {Array.from({ length: pages }).map((_, i) => (
                        <View key={i} style={[rowStyles.pagerBox, i === page && rowStyles.pagerBoxActive]} />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const card = StyleSheet.create({
    wrap: {
        width: 175,
        cursor: 'pointer' as any,
    },
    wrapHover: {
        transform: [{ scale: 1.08 }],
        zIndex: 40,
        transition: 'transform 0.25s ease',
    } as any,
    posterBox: {
        width: 175,
        height: 255,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#181818',
        position: 'relative',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    } as any,
    posterBoxHover: {
        boxShadow: '0 12px 30px rgba(0,0,0,0.85)',
        borderWidth: 1,
        borderColor: '#E50914',
    } as any,
    poster: {
        width: '100%',
        height: '100%',
    },
    nBadge: {
        position: 'absolute',
        top: 6,
        left: 6,
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderRadius: 2,
        paddingHorizontal: 4,
        paddingVertical: 1,
    },
    nBadgeText: {
        color: '#E50914',
        fontSize: 13,
        fontWeight: '900',
    },
    hoverOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(20,20,20,0.95)',
        padding: 10,
        gap: 6,
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    playCircle: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconCircle: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.5)',
        backgroundColor: 'rgba(40,40,40,0.7)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        color: '#fff',
        fontSize: 12.5,
        fontWeight: '800',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    matchText: {
        color: '#46d369',
        fontSize: 11,
        fontWeight: '700',
    },
    ratingBox: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.4)',
        borderRadius: 2,
        paddingHorizontal: 3,
        paddingVertical: 0.5,
    },
    ratingText: {
        color: '#ddd',
        fontSize: 9.5,
        fontWeight: '600',
    },
    durationText: {
        color: '#aaa',
        fontSize: 10.5,
    },
});

const top10 = StyleSheet.create({
    wrap: {
        flexDirection: 'row',
        alignItems: 'center',
        cursor: 'pointer' as any,
    },
    wrapHover: {
        transform: [{ scale: 1.06 }],
        zIndex: 40,
        transition: 'transform 0.25s ease',
    } as any,
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    numberBox: {
        width: 75,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: -16,
        zIndex: 2,
    },
    number: {
        fontSize: 160,
        lineHeight: 160,
        fontWeight: '900',
        color: '#0f0f0f',
        ...Platform.select({
            web: {
                WebkitTextStroke: '4px #595959',
                fontFamily: 'Impact, "Arial Black", sans-serif',
                userSelect: 'none',
                textShadow: '3px 3px 1px #595959',
            } as any,
            default: {
                textShadowColor: '#595959',
                textShadowOffset: { width: 3, height: 3 },
                textShadowRadius: 1,
            },
        }),
    },
    posterBox: {
        width: 175,
        height: 255,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#181818',
        position: 'relative',
        zIndex: 3,
        boxShadow: '0 4px 14px rgba(0,0,0,0.6)',
    } as any,
    posterBoxHover: {
        boxShadow: '0 12px 30px rgba(0,0,0,0.9)',
        borderWidth: 1,
        borderColor: '#E50914',
    } as any,
    poster: {
        width: '100%',
        height: '100%',
    },
    badge: {
        position: 'absolute',
        top: 6,
        left: 6,
        backgroundColor: '#E50914',
        borderRadius: 2,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    badgeText: {
        color: '#fff',
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    quickOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(20,20,20,0.95)',
        padding: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    hoverTitle: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
        flex: 1,
    },
});

const rowStyles = StyleSheet.create({
    rowContainer: {
        flex: 'none' as any,
        marginBottom: 36,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 12,
        paddingHorizontal: 48,
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#e5e5e5',
        paddingHorizontal: 0,
        marginLeft: 0,
        marginTop: 0,
        marginBottom: 0,
        letterSpacing: -0.3,
    },
    explore: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: 4,
        opacity: 0.85,
    },
    exploreHover: {
        opacity: 1,
    },
    exploreText: {
        color: '#54b9c5',
        fontSize: 12,
        fontWeight: '700',
    },
    rowWrapper: {
        position: 'relative',
    },
    arrow: {
        position: 'absolute',
        top: 10,
        bottom: 22,
        width: 44,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(20,20,20,0.6)',
        zIndex: 50,
        borderRadius: 4,
        cursor: 'pointer' as any,
        transition: 'background-color 0.2s ease',
    } as any,
    arrowHover: {
        backgroundColor: 'rgba(20,20,20,0.92)',
    },
    arrowLeft: {
        left: 0,
    },
    arrowRight: {
        right: 0,
    },
    pager: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        marginTop: 6,
    },
    pagerBox: {
        width: 14,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: '#333333',
    },
    pagerBoxActive: {
        backgroundColor: '#e5e5e5',
    },
});
