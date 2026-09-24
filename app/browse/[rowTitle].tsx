import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCatalog } from '@/hooks/useCatalog';
import { SafeImage } from '@/components/SafeImage';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';
import { Movie } from '@/types/movie';
import { CatalogBrowseScreen, CatalogKind } from '@/components/CatalogBrowseScreen';
import { useTvBackHandler } from '@/hooks/useTvNavigation';

const IS_WEB = Platform.OS === 'web';

/** "Explore All" destination plus the full Movies/TV Shows shelf pages. */
export default function BrowseRow() {
    const params = useLocalSearchParams<{ rowTitle?: string }>();
    const rowTitle = decodeURIComponent((params.rowTitle as string) ?? '');
    const catalogKind: CatalogKind | null = rowTitle === 'movies'
        ? 'movie'
        : rowTitle === 'tv'
            ? 'tv'
            : null;
    const { rows } = useCatalog();
    const router = useRouter();

    if (catalogKind) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <CatalogBrowseScreen kind={catalogKind} />
            </>
        );
    }

    const row = rows.find(r => r.rowTitle === rowTitle) ?? rows[0];
    const movies: Movie[] = row?.movies ?? [];

    useTvBackHandler(() => {
        router.back();
        return true;
    }, true);

    return (
        <View style={page.container}>
            <Stack.Screen options={{ headerShown: false }} />
            <ScrollView
                contentContainerStyle={[
                    page.content,
                    IS_WEB && { paddingTop: WEB_NAV_HEIGHT + 36, paddingBottom: 90 },
                ]}
            >
                <View style={page.header}>
                    <Pressable
                        style={({ hovered }: any) => [page.backBtn, hovered && page.backBtnHover]}
                        onPress={() => router.back()}
                        tabIndex={0}
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                        {...({ dataSet: { tvFocusable: 'true', tvRow: 'browse-top', tvId: 'browse-back' } } as any)}
                    >
                        <Ionicons name="chevron-back" size={22} color="#fff" />
                    </Pressable>
                    <View style={page.headerText}>
                        <Text style={page.title} numberOfLines={2}>
                            {row?.rowTitle ?? 'Browse'}
                        </Text>
                        <Text style={page.subtitle}>
                            {movies.length} titles • Netflix India
                        </Text>
                    </View>
                </View>

                <View style={page.grid}>
                    {movies.map((item, index) => (
                        <GridCard
                            key={`${item.id}-${index}`}
                            item={item}
                            index={index}
                            isTop10={row?.type === 'top_10'}
                            onPress={() => router.push({
                                pathname: '/movie/[id]',
                                params: { id: item.id },
                            })}
                        />
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

function GridCard({ item, index, isTop10, onPress }: {
    item: Movie;
    index: number;
    isTop10: boolean;
    onPress: () => void;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <Pressable
            onPress={onPress}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            tabIndex={0}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
            {...({
                dataSet: {
                    tvFocusable: 'true',
                    tvRow: 'browse-grid',
                    tvIndex: String(index),
                    ...(index === 0 ? { tvInitial: 'true' } : {}),
                },
            } as any)}
            style={[page.card, hovered && page.cardHover]}
        >
            <View style={page.cardArt}>
                <SafeImage
                    source={{ uri: item.imageUrl }}
                    style={page.poster}
                    fallbackLabel={item.title}
                />
                {isTop10 ? (
                    <View style={page.rankBadge}>
                        <Text style={page.rankBadgeText}>#{index + 1}</Text>
                    </View>
                ) : null}
            </View>
            <Text style={page.cardTitle} numberOfLines={2}>
                {item.title}
            </Text>
            <Text style={page.cardMeta} numberOfLines={1}>
                {item.ranking_text ?? (item.year ? String(item.year) : 'Netflix')}
            </Text>
        </Pressable>
    );
}

const page = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    content: {
        paddingHorizontal: 20,
        paddingTop: 24,
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        maxWidth: 1240,
        marginBottom: 28,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    backBtnHover: {
        backgroundColor: 'rgba(255,255,255,0.2)',
    },
    headerText: {
        flex: 1,
    },
    title: {
        color: '#fff',
        fontSize: 30,
        fontWeight: '800',
    },
    subtitle: {
        color: '#9a9a9a',
        fontSize: 13,
        fontWeight: '600',
        marginTop: 4,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 22,
        justifyContent: 'flex-start',
        width: '100%',
        maxWidth: 1240,
    },
    card: {
        width: 178,
        borderRadius: 10,
        overflow: 'hidden',
    },
    cardHover: {
        transform: [{ scale: 1.04 }],
        ...Platform.select({
            web: { boxShadow: '0 14px 36px rgba(0,0,0,0.7)' } as any,
            default: {} as any,
        }),
    },
    cardArt: {
        width: '100%',
        aspectRatio: 2 / 3,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#181818',
    },
    poster: {
        width: '100%',
        height: '100%',
    },
    rankBadge: {
        position: 'absolute',
        top: 8,
        left: 8,
        backgroundColor: '#E50914',
        borderRadius: 4,
        paddingHorizontal: 7,
        paddingVertical: 3,
    },
    rankBadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
    },
    cardTitle: {
        color: '#fff',
        fontSize: 13.5,
        fontWeight: '700',
        marginTop: 8,
    },
    cardMeta: {
        color: '#8f8f8f',
        fontSize: 11.5,
        fontWeight: '600',
        marginTop: 2,
    },
});
