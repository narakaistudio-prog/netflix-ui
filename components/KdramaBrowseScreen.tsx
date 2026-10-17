import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { isPhoneWidth } from '@/lib/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '@/hooks/useCatalog';
import { DeferredMovieList } from '@/components/MovieList/DeferredMovieList';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';
import { isKdramaRow, kdramaRowLabel } from '@/lib/kdrama';
import type { MovieRow } from '@/types/movie';

const IS_WEB = Platform.OS === 'web';

/**
 * The K-Dramas section: every row from the Netflix K-Dramas genre
 * page (genre 2638104), with the same title modal as the other rows.
 * Titles and images come from nxsha (or the offline catalog bundle).
 */
export function KdramaBrowseScreen() {
    const { rows } = useCatalog();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    // Desktop keeps the 48px gutter; phones use 16px.
    const sidePad = IS_WEB && !isPhoneWidth(windowWidth) ? 48 : 16;
    const kdramaRows = useMemo(
        () =>
            rows
                .filter(isKdramaRow)
                .map(row => ({ ...row, rowTitle: kdramaRowLabel(row.rowTitle) })),
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
                    <Text style={page.subtitle}>
                        Korean series from the Netflix India K-Dramas collection (genre 2638104)
                    </Text>
                    <Text style={page.count}>{uniqueTitleCount} titles available</Text>
                </View>

                <View style={page.shelves}>
                    {kdramaRows.map((row, index) => (
                        <DeferredMovieList
                            key={`kdrama-${row.rowTitle}-${index}`}
                            eager={index === 0}
                            {...row}
                        />
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
