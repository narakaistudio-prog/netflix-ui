import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MovieRow } from '@/types/movie';
import { useCatalog } from '@/hooks/useCatalog';
import { MovieList } from '@/components/MovieList/MovieList';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';

export type CatalogKind = 'movie' | 'tv';

const IS_WEB = Platform.OS === 'web';

function isBroadCatalogRow(row: MovieRow) {
    return row.rowTitle.startsWith('Netflix India ');
}

/**
 * Build the same kind of editorial shelves Netflix uses on a Movies/TV page:
 * today's Top 10 first, then curated shelves, then every title from the
 * refreshed Netflix India catalog. Each shelf remains a normal MovieList so
 * its arrows, poster hover state and Explore All action work consistently.
 */
export function getCatalogSections(rows: MovieRow[], kind: CatalogKind): MovieRow[] {
    const matchingRows = rows
        .filter(row => row.movies.some(item => item.mediaType === kind))
        .map(row => ({
            ...row,
            movies: row.movies.filter(item => item.mediaType === kind),
        }))
        .filter(row => row.movies.length > 0);

    const top10 = matchingRows.filter(row => row.type === 'top_10');
    const curated = matchingRows.filter(row => row.type !== 'top_10' && !isBroadCatalogRow(row));
    const broadCatalog = matchingRows.filter(row => isBroadCatalogRow(row));

    return [...top10, ...curated, ...broadCatalog];
}

function getPageCopy(kind: CatalogKind) {
    if (kind === 'movie') {
        return {
            title: 'Movies',
            subtitle: 'Top picks, Indian favourites, and the complete Netflix India movie catalog',
        };
    }

    return {
        title: 'TV Shows',
        subtitle: 'Binge-worthy series, current favourites, and the complete Netflix India TV catalog',
    };
}

export function CatalogBrowseScreen({ kind }: { kind: CatalogKind }) {
    const { rows } = useCatalog();
    const insets = useSafeAreaInsets();
    const sections = useMemo(() => getCatalogSections(rows, kind), [rows, kind]);
    const copy = getPageCopy(kind);
    const uniqueTitleCount = useMemo(
        () => new Set(sections.flatMap(section => section.movies.map(item => item.id))).size,
        [sections],
    );

    return (
        <View style={page.container}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    page.content,
                    IS_WEB
                        ? { paddingTop: WEB_NAV_HEIGHT + 34, paddingBottom: 90 }
                        : { paddingTop: insets.top + 24, paddingBottom: 42 },
                ]}
            >
                <View style={page.header}>
                    <Text style={page.title}>{copy.title}</Text>
                    <Text style={page.subtitle}>{copy.subtitle}</Text>
                    <Text style={page.count}>{uniqueTitleCount} titles available in Netflix India</Text>
                </View>

                <View style={page.shelves}>
                    {sections.map(section => (
                        <MovieList key={section.rowTitle} {...section} />
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
