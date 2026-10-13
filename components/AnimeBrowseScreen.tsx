import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '@/hooks/useCatalog';
import { DeferredMovieList } from '@/components/MovieList/DeferredMovieList';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';
import { animeRowLabel, isAnimeRow } from '@/lib/anime';

const IS_WEB = Platform.OS === 'web';

/**
 * The Anime section: every row from the Netflix Anime genre page, with the same
 * title modal as the other rows. Titles and images come from nxsha.
 */
export function AnimeBrowseScreen() {
    const { rows } = useCatalog();
    const insets = useSafeAreaInsets();
    const animeRows = useMemo(
        () => rows.filter(isAnimeRow).map(row => ({ ...row, rowTitle: animeRowLabel(row.rowTitle) })),
        [rows],
    );
    const uniqueTitleCount = useMemo(
        () => new Set(animeRows.flatMap(row => row.movies.map(item => item.id))).size,
        [animeRows],
    );

    return (
        <View style={page.container}>
            <ScrollView
                {...({ dataSet: { tvScrollContainer: 'true' } } as any)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    page.content,
                    IS_WEB
                        ? { paddingTop: WEB_NAV_HEIGHT + 34, paddingBottom: 90 }
                        : { paddingTop: insets.top + 24, paddingBottom: 42 },
                ]}
            >
                <View style={page.header}>
                    <Text style={page.title}>Anime</Text>
                    <Text style={page.subtitle}>Anime series and films from the Netflix India Anime collection</Text>
                    <Text style={page.count}>{uniqueTitleCount} titles available</Text>
                </View>

                <View style={page.shelves}>
                    {animeRows.map((row, index) => (
                        <DeferredMovieList key={`${row.rowTitle}-${index}`} eager={index === 0} {...row} />
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

const page = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    content: {
        minHeight: '100%',
    },
    header: {
        width: '100%',
        maxWidth: 1240,
        alignSelf: 'center',
        paddingHorizontal: IS_WEB ? 48 : 16,
        marginBottom: 24,
    },
    title: {
        color: '#fff',
        fontSize: IS_WEB ? 36 : 28,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    subtitle: {
        color: '#b3b3b3',
        fontSize: IS_WEB ? 15 : 13,
        lineHeight: 21,
        marginTop: 6,
        maxWidth: 720,
    },
    count: {
        color: '#6f6f6f',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 8,
    },
    shelves: {
        width: '100%',
    },
});
