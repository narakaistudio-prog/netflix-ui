import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { isPhoneWidth } from '@/lib/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '@/hooks/useCatalog';
import { DeferredMovieList } from '@/components/MovieList/DeferredMovieList';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';
import { animeRowLabel, isAnimeMovieRow, isAnimeRow } from '@/lib/anime';
import type { MovieRow } from '@/types/movie';

const IS_WEB = Platform.OS === 'web';

/**
 * The Anime section: every row from the Netflix Anime genre page, with the same
 * title modal as the other rows. Titles and images come from nxsha.
 */
export function AnimeBrowseScreen() {
    const { rows } = useCatalog();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    // Desktop keeps the 48px gutter; phones use 16px.
    const sidePad = IS_WEB && !isPhoneWidth(windowWidth) ? 48 : 16;
    // Anime series rows first (Netflix Anime page), then the Anime Movies page rows as a group.
    const { seriesRows, movieRows } = useMemo(() => {
        const animeSource = rows.filter(isAnimeRow);
        const withLabel = (row: MovieRow): MovieRow => ({ ...row, rowTitle: animeRowLabel(row.rowTitle) });
        return {
            seriesRows: animeSource.filter(row => !isAnimeMovieRow(row)).map(withLabel),
            movieRows: animeSource.filter(isAnimeMovieRow).map(withLabel),
        };
    }, [rows]);
    const uniqueTitleCount = useMemo(
        () => new Set([...seriesRows, ...movieRows].flatMap(row => row.movies.map(item => item.netflixId ?? item.id))).size,
        [seriesRows, movieRows],
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
                <View style={[page.header, { paddingHorizontal: sidePad }]}>
                    <Text style={page.title}>Anime</Text>
                    <Text style={page.subtitle}>Anime series and films from the Netflix India Anime collection</Text>
                    <Text style={page.count}>{uniqueTitleCount} titles available</Text>
                </View>

                <View style={page.shelves}>
                    {seriesRows.map((row, index) => (
                        <DeferredMovieList key={`series-${row.rowTitle}-${index}`} eager={index === 0} {...row} />
                    ))}
                    {movieRows.length > 0 && (
                        <View style={page.group}>
                            <Text style={[page.groupTitle, { paddingHorizontal: sidePad }]}>Anime Movies</Text>
                            <Text style={page.groupSubtitle}>Anime films from the Netflix India Anime Movies collection</Text>
                        </View>
                    )}
                    {movieRows.map((row, index) => (
                        <DeferredMovieList key={`movie-${row.rowTitle}-${index}`} eager={false} {...row} />
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
    group: {
        width: '100%',
        maxWidth: 1240,
        alignSelf: 'center',
        paddingHorizontal: IS_WEB ? 48 : 16,
        marginTop: 28,
        marginBottom: 4,
    },
    groupTitle: {
        color: '#fff',
        fontSize: IS_WEB ? 24 : 20,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    groupSubtitle: {
        color: '#b3b3b3',
        fontSize: IS_WEB ? 14 : 12,
        lineHeight: 20,
        marginTop: 4,
    },
});
