import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Movie, MovieRow } from '@/types/movie';
import { useCatalog } from '@/hooks/useCatalog';
import { DeferredMovieList } from '@/components/MovieList/DeferredMovieList';
import { WEB_NAV_HEIGHT } from '@/components/WebNavBar';

export type CatalogKind = 'movie' | 'tv';

const IS_WEB = Platform.OS === 'web';
export const MATURE_ROW_TITLE = 'Mature & Adult Content';

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

const KOREAN_TITLES = [
    'all of us are dead',
    'alchemy of souls',
    'business proposal',
    'crash landing on you',
    'daily dose of sunshine',
    'doctor romantic',
    'dr romantic',
    'extraordinary attorney woo',
    'hierarchy',
    'hometown cha cha cha',
    'itaewon class',
    'king the land',
    'love alarm',
    'love next door',
    'my demon',
    'our sticky love',
    'parasyte the grey',
    'queen of tears',
    'romance in the house',
    'squid game',
    'the glory',
    'the king eternal monarch',
    'the silent sea',
    'the uncanny counter',
    'the wonderfools',
    'trigger',
    'vincenzo',
    'weak hero',
    'when life gives you tangerines',
];

const ANIME_TITLES = [
    'bleach',
    'black clover',
    'boruto',
    'demon slayer',
    'death note',
    'dragon ball',
    'haikyu',
    'hunter x hunter',
    'jujutsu kaisen',
    'kimetsu no yaiba',
    'my hero academia',
    'naruto',
    'one piece',
    'the apothecary diaries',
    'that time i got reincarnated as a slime',
    'vinland saga',
];

function normalizedTitle(title?: string) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesCollection(title: string | undefined, collection: string[]) {
    const normalized = normalizedTitle(title);
    return collection.some(item => normalized === item || normalized.includes(item));
}

function uniqueItems(items: Movie[]) {
    const seen = new Set<string>();
    return items.filter(item => {
        const key = item.id || normalizedTitle(item.title);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

type CatalogShelf = MovieRow & { hideExploreAll?: boolean };

function getEditorialShelves(sections: MovieRow[], kind: CatalogKind): CatalogShelf[] {
    const allItems = uniqueItems(
        sections
            .filter(section => section.rowTitle !== MATURE_ROW_TITLE)
            .flatMap(section => section.movies),
    );
    const currentItems = uniqueItems(allItems.filter(item => item.catalogSource === 'justwatch'));
    const newItems = currentItems.length
        ? currentItems.slice(0, 40)
        : uniqueItems(allItems.filter(item => Number.parseInt(String(item.year || ''), 10) >= 2025)).slice(0, 40);
    const shelves: CatalogShelf[] = [];

    if (newItems.length) {
        shelves.push({
            rowTitle: 'New & Recently Added in India',
            type: 'normal',
            movies: newItems,
            hideExploreAll: true,
        });
    }

    if (kind === 'tv') {
        const kDrama = uniqueItems(allItems.filter(item => matchesCollection(item.title, KOREAN_TITLES)));
        if (kDrama.length) {
            shelves.push({
                rowTitle: 'K-Dramas & Korean Series',
                type: 'normal',
                movies: kDrama,
                hideExploreAll: true,
            });
        }
    }

    const anime = uniqueItems(allItems.filter(item => matchesCollection(item.title, ANIME_TITLES)));
    if (anime.length) {
        shelves.push({
            rowTitle: 'Anime & Animation',
            type: 'normal',
            movies: anime,
            hideExploreAll: true,
        });
    }

    return shelves;
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
    const editorialShelves = useMemo(() => getEditorialShelves(sections, kind), [sections, kind]);
    const displaySections = useMemo(() => {
        const top10 = sections.filter(section => section.type === 'top_10');
        const mature = sections.filter(section => section.rowTitle === MATURE_ROW_TITLE);
        const otherSections = sections.filter(
            section => section.type !== 'top_10' && section.rowTitle !== MATURE_ROW_TITLE,
        );
        return [...top10, ...editorialShelves, ...otherSections, ...mature];
    }, [sections, editorialShelves]);
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
                    {displaySections.map((section, index) => (
                        <DeferredMovieList key={`${section.rowTitle}-${index}`} eager={index === 0} {...section} />
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
