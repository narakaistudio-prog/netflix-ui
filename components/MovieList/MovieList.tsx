import React, { useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { styles } from '@/styles';
import { Movie, MovieRow } from '@/types/movie';
import { useVisionOS } from '@/hooks/useVisionOS';
import { HoverableView } from '@/components/ui/VisionContainer';
import { SafeImage } from '@/components/SafeImage';
import { Ionicons } from '@expo/vector-icons';

const IS_WEB = Platform.OS === 'web';
const ROW_PADDING = IS_WEB ? 48 : 16;
const ROW_GAP = 10;

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
            transition={200}
            fallbackLabel={item.title}
        />
    </Pressable>
);

/**
 * 2026 Netflix web tile: rounded landscape card with blurred artwork behind a
 * crisp poster, metadata tag along the bottom and quick actions on hover.
 */
const WebTile = ({ item, index, isTop10, cardWidth, onPress }: {
    item: Movie;
    index: number;
    isTop10: boolean;
    cardWidth: number;
    onPress: () => void;
}) => {
    const [hovered, setHovered] = useState(false);

    if (isTop10) {
        return (
            <Pressable
                onPress={onPress}
                onHoverIn={() => setHovered(true)}
                onHoverOut={() => setHovered(false)}
                style={[top10.wrap, { width: cardWidth }, hovered && top10.wrapHover]}
            >
                <View style={top10.row}>
                    <Text style={top10.number}>{index + 1}</Text>
                    <View style={top10.posterBox}>
                        <SafeImage
                            source={{ uri: item.imageUrl }}
                            style={top10.poster}
                            transition={200}
                            fallbackLabel={item.title}
                        />
                        <View style={top10.badge}>
                            <Text style={top10.badgeText}>TOP 10</Text>
                        </View>
                    </View>
                </View>
                {item.ranking_text ? (
                    <Text style={tile.tag} numberOfLines={1}>{item.ranking_text}</Text>
                ) : null}
            </Pressable>
        );
    }

    return (
        <Pressable
            onPress={onPress}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            style={[tile.card, { width: cardWidth }, hovered && tile.cardHover]}
        >
            <SafeImage
                source={{ uri: item.imageUrl }}
                style={[StyleSheet.absoluteFill, { opacity: 0.85, transform: [{ scale: 1.15 }] }]}
                contentFit="cover"
                cachePolicy="memory-disk"
            />
            <View style={tile.dim} />
            <SafeImage
                source={{ uri: item.imageUrl }}
                style={tile.poster}
                contentFit="cover"
                transition={200}
                fallbackLabel={item.title}
            />
            <View style={tile.bottom}>
                <Text style={tile.tag} numberOfLines={1}>
                    {item.ranking_text ?? (item.year ? String(item.year) : 'Recently Added')}
                </Text>
                {hovered ? (
                    <View style={tile.actions}>
                        <View style={tile.actionSolid}>
                            <Ionicons name="play" size={13} color="#000" />
                        </View>
                        <View style={tile.actionGhost}>
                            <Ionicons name="add" size={13} color="#fff" />
                        </View>
                        <View style={tile.actionGhost}>
                            <Ionicons name="thumbs-up-outline" size={13} color="#fff" />
                        </View>
                    </View>
                ) : null}
            </View>
        </Pressable>
    );
};

export function MovieList({ rowTitle, movies, type }: MovieRow) {
    const router = useRouter();
    const isTop10 = type === 'top_10';
    const { isVisionOS } = useVisionOS();
    const { width: windowWidth } = useWindowDimensions();
    const listRef = useRef<FlatList<Movie>>(null);
    const offsetX = useRef(0);
    const [contentWidth, setContentWidth] = useState(0);

    const perView = isTop10 ? 5 : 4;
    const cardWidth = isTop10
        ? (windowWidth - ROW_PADDING * 2 - (perView - 1) * ROW_GAP) / perView
        : (windowWidth - ROW_PADDING * 2 - (perView - 1) * ROW_GAP) / perView;

    const pageStep = windowWidth * 0.8;
    const pages = Math.max(1, Math.ceil(contentWidth / pageStep));
    const [page, setPage] = useState(0);

    const scrollByPage = (dir: 1 | -1) => {
        const next = Math.max(0, offsetX.current + dir * pageStep);
        listRef.current?.scrollToOffset({ offset: next, animated: true });
    };

    const openMovie = (item: Movie) => router.push({
        pathname: '/movie/[id]',
        params: { id: item.id },
    });

    const renderItem = ({ item, index }: { item: Movie; index: number }) => {
        if (IS_WEB) {
            return (
                <WebTile
                    key={`${item.id}-${index}`}
                    item={item}
                    index={index}
                    isTop10={isTop10}
                    cardWidth={cardWidth}
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
        <View style={[styles.container, IS_WEB && rowStyles.rowContainer]}>
            {IS_WEB ? (
                <View style={rowStyles.headerRow}>
                    <Text style={[styles.sectionTitle, rowStyles.sectionTitle]}>{rowTitle}</Text>
                    <Pressable
                        style={({ hovered }: any) => [rowStyles.explore, hovered && rowStyles.exploreHover]}
                        onPress={() => router.push({
                            pathname: '/browse/[rowTitle]',
                            params: { rowTitle },
                        })}
                    >
                        <Text style={rowStyles.exploreText}>Explore All</Text>
                        <Ionicons name="chevron-forward" size={12} color="#b3b3b3" />
                    </Pressable>
                </View>
            ) : (
                <Text style={styles.sectionTitle}>{rowTitle}</Text>
            )}
            <View style={IS_WEB ? rowStyles.rowWrapper : undefined}>
                <FlatList
                    ref={listRef}
                    horizontal
                    data={movies}
                    renderItem={renderItem}
                    keyExtractor={(item, index) => `${item.id}-${index}`}
                    showsHorizontalScrollIndicator={false}
                    onScroll={(e) => {
                        offsetX.current = e.nativeEvent.contentOffset.x;
                        setPage(Math.min(pages - 1, Math.round(offsetX.current / pageStep)));
                    }}
                    scrollEventThrottle={16}
                    onContentSizeChange={(w) => setContentWidth(w)}
                    contentContainerStyle={[
                        styles.contentList,
                        isTop10 && styles.top10List,
                        IS_WEB && {
                            paddingHorizontal: ROW_PADDING,
                            columnGap: isTop10 ? 34 : 14,
                            paddingTop: 6,
                            paddingBottom: 10,
                        },
                    ]}
                />
                {IS_WEB && (
                    <>
                        <Pressable
                            style={({ hovered }: any) => [
                                rowStyles.arrow,
                                rowStyles.arrowLeft,
                                hovered && { backgroundColor: 'rgba(20,20,20,0.85)' },
                            ]}
                            onPress={() => scrollByPage(-1)}
                        >
                            <Ionicons name="chevron-back" size={30} color="#fff" />
                        </Pressable>
                        <Pressable
                            style={({ hovered }: any) => [
                                rowStyles.arrow,
                                rowStyles.arrowRight,
                                hovered && { backgroundColor: 'rgba(20,20,20,0.85)' },
                            ]}
                            onPress={() => scrollByPage(1)}
                        >
                            <Ionicons name="chevron-forward" size={30} color="#fff" />
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

const tile = StyleSheet.create({
    card: {
        aspectRatio: 16 / 9,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#181818',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardHover: {
        transform: [{ scale: 1.05 }],
        zIndex: 30,
        ...Platform.select({
            web: { boxShadow: '0 16px 40px rgba(0,0,0,0.7)' } as any,
            default: {} as any,
        }),
    },
    dim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    poster: {
        height: '88%',
        aspectRatio: 2 / 3,
        borderRadius: 6,
        backgroundColor: '#222',
    },
    bottom: {
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    tag: {
        color: '#e0e0e0',
        fontSize: 10.5,
        fontWeight: '700',
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        overflow: 'hidden',
        flexShrink: 1,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    actionSolid: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionGhost: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.6)',
        backgroundColor: 'rgba(42,42,42,0.7)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});

const top10 = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        gap: 6,
    },
    wrapHover: {
        transform: [{ scale: 1.04 }],
        zIndex: 30,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    number: {
        fontFamily: 'arialic',
        fontSize: 140,
        lineHeight: 140,
        fontWeight: '900',
        color: '#242424',
        marginLeft: -4,
        marginRight: -20,
    },
    posterBox: {
        width: 150,
        aspectRatio: 2 / 3,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#181818',
    },
    poster: {
        width: '100%',
        height: '100%',
    },
    badge: {
        position: 'absolute',
        top: 6,
        left: 6,
        backgroundColor: '#E50914',
        borderRadius: 3,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    badgeText: {
        color: '#fff',
        fontSize: 8.5,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
});

const rowStyles = StyleSheet.create({
    rowContainer: {
        flex: 'none' as any,
        marginBottom: 46,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 48,
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 22,
        fontWeight: '800',
        paddingHorizontal: 0,
        marginLeft: 0,
        marginTop: 0,
        marginBottom: 0,
    },
    explore: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: 4,
    },
    exploreHover: {
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    exploreText: {
        color: '#b3b3b3',
        fontSize: 12.5,
        fontWeight: '700',
    },
    rowWrapper: {
        position: 'relative',
    },
    arrow: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 44,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)',
        zIndex: 20,
        borderRadius: 6,
    },
    arrowLeft: {
        left: 0,
        borderTopRightRadius: 6,
        borderBottomRightRadius: 6,
    },
    arrowRight: {
        right: 0,
        borderTopLeftRadius: 6,
        borderBottomLeftRadius: 6,
    },
    pager: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        marginTop: 10,
    },
    pagerBox: {
        width: 16,
        height: 3,
        borderRadius: 2,
        backgroundColor: '#3a3a3a',
    },
    pagerBoxActive: {
        backgroundColor: '#e5e5e5',
    },
});
