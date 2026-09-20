import React, { useRef, useState } from 'react';
import {
    FlatList,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '@/components/SafeImage';
import { SavedSeries } from '@/types/series';
import { providerLabel } from '@/services/embedProviders';

const IS_WEB = Platform.OS === 'web';
const ROW_PADDING = IS_WEB ? 48 : 16;
const ROW_GAP = 12;

/**
 * The "My Series" row on Home — series an admin added from an IMDb ID.
 * One card per series (poster + season count); tapping opens the series
 * screen (season picker -> episode grid -> iframe player).
 */
export function SeriesList({
    title = 'My Series',
    items,
}: {
    title?: string;
    items: SavedSeries[];
}) {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const perView = IS_WEB ? 4 : 3;
    const cardWidth =
        (width - ROW_PADDING * 2 - (perView - 1) * ROW_GAP) / perView;

    const openSeries = (series: SavedSeries) =>
        router.push({
            pathname: '/series/[id]',
            params: { id: series.id },
        });

    return (
        <View style={[styles.row, IS_WEB && styles.rowWeb]}>
            {IS_WEB ? (
                <View style={styles.headerRow}>
                    <Text style={styles.headerTitle}>{title}</Text>
                    <Pressable
                        style={({ hovered }: any) => [
                            styles.manage,
                            hovered && styles.manageHover,
                        ]}
                        onPress={() => router.push('/admin')}
                    >
                        <Ionicons name="add" size={13} color="#b3b3b3" />
                        <Text style={styles.manageText}>Add series</Text>
                    </Pressable>
                </View>
            ) : (
                <Text style={styles.sectionTitle}>{title}</Text>
            )}

            <FlatList
                horizontal
                data={items}
                keyExtractor={item => item.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[
                    styles.list,
                    IS_WEB && {
                        paddingHorizontal: ROW_PADDING,
                        columnGap: ROW_GAP,
                        paddingTop: 4,
                        paddingBottom: 10,
                    },
                ]}
                renderItem={({ item }) => (
                    <Pressable
                        onPress={() => openSeries(item)}
                        onHoverIn={undefined}
                        style={({ hovered }: any) => [
                            styles.card,
                            IS_WEB && { width: cardWidth },
                            hovered && styles.cardHover,
                        ]}
                    >
                        <View style={styles.cardArt}>
                            <SafeImage
                                source={{ uri: item.poster || item.banner || '' }}
                                style={styles.poster}
                                transition={200}
                                fallbackLabel={item.name}
                            />
                            <View style={styles.tag}>
                                <Text style={styles.tagText} numberOfLines={1}>
                                    {item.seasons.length} Season
                                    {item.seasons.length > 1 ? 's' : ''} ·{' '}
                                    {providerLabel(item)}
                                </Text>
                            </View>
                        </View>
                        {!IS_WEB ? (
                            <Text style={styles.cardTitle} numberOfLines={1}>
                                {item.name}
                            </Text>
                        ) : null}
                    </Pressable>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        marginBottom: 30,
    },
    rowWeb: {
        marginBottom: 46,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 48,
        marginBottom: 10,
    },
    headerTitle: {
        color: '#fff',
        fontSize: 22,
        fontWeight: '800',
    },
    manage: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    manageHover: {
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    manageText: {
        color: '#b3b3b3',
        fontSize: 12.5,
        fontWeight: '700',
    },
    sectionTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        marginLeft: 16,
        marginBottom: 10,
    },
    list: {
        paddingHorizontal: 16,
        paddingRight: 28,
    },
    card: {
        width: 120,
        marginRight: 12,
    },
    cardHover: {
        transform: [{ scale: 1.04 }],
        zIndex: 20,
        ...Platform.select({
            web: { boxShadow: '0 14px 34px rgba(0,0,0,0.7)' } as any,
            default: {} as any,
        }),
    },
    cardArt: {
        width: '100%',
        aspectRatio: 2 / 3,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#181818',
    },
    poster: {
        width: '100%',
        height: '100%',
    },
    tag: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.65)',
        paddingHorizontal: 6,
        paddingVertical: 4,
    },
    tagText: {
        color: '#e0e0e0',
        fontSize: 9.5,
        fontWeight: '700',
    },
    cardTitle: {
        color: '#fff',
        fontSize: 13,
        fontWeight: 'bold',
        marginTop: 7,
    },
});
