import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { isPhoneWidth } from '@/lib/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '@/hooks/useCatalog';
import { DeferredMovieList } from '@/components/MovieList/DeferredMovieList';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';
import { KDRAMA_ROW_PREFIX, isKdramaRow, kdramaRowLabel } from '@/lib/kdrama';
import type { MovieRow } from '@/types/movie';

const IS_WEB = Platform.OS === 'web';

/**
 * The K-Dramas section: every row from the Netflix K-Dramas genre page
 * (2638104), with the same title modal as the other rows. Titles and images
 * come from nxsha.
 */
export function KdramaBrowseScreen() {
    const { rows } = useCatalog();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    // Desktop keeps the 48px gutter; phones use 16px.
    const sidePad = IS_WEB && !isPhoneWidth(windowWidth) ? 48 : 16;
    const kdramaRows = useMemo(
        () => rows
            .filter(isKdramaRow)
            .map((row: MovieRow): MovieRow => ({ ...row, rowTitle: kdramaRowLabel(row.rowTitle) })),
        [rows],
    );
    const uniqueTitleCount = useMemo(
        () => new Set(kdramaRows.flatMap(row => row.movies.map(item => item.netflixId ?? item.id))).size,
        [kdramaRows],
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
                    <Text style={page.title}>K-Dramas</Text>
                    <Text style={page.subtitle}>Korean dramas from the Netflix India K-Dramas collection</Text>
                    <Text style={page.count}>{uniqueTitleCount} titles available</Text>
                </View>

                <View style={page.shelves}>
                    {kdramaRows.map((row, index) => (
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
    },
    content: {
        paddingBottom: 42,
    },
    header: {
        marginBottom: 4,
    },
    title: {
        color: '#fff',
        fontSize: 28,
        fontWeight: '800',
    },
    subtitle: {
        color: '#cbc6d4',
        fontSize: 13,
        marginTop: 4,
    },
    count: {
        color: '#8b8694',
        fontSize: 11,
        marginTop: 6,
        letterSpacing: 0.4,
    },
    shelves: {
        gap: 6,
    },
});
