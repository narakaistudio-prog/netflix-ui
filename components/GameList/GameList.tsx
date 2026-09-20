import React from 'react';
import { Platform, View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { styles } from '@/styles';
import { Movie, MovieRow } from '@/types/movie';
import { SafeImage } from '@/components/SafeImage';

const GameItem = ({ item, router }: { item: Movie; router: any }) => (
    <Pressable
        onPress={() => router.push({
            pathname: '/movie/[id]',
            params: { id: item.id }
        })}
        style={styles.contentItem}
    >
        <SafeImage source={{ uri: item.imageUrl }} style={[styles.thumbnail, { width: 120, aspectRatio: 1 }]} transition={200} fallbackLabel={item.title} />
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.type}>{item.type}</Text>
    </Pressable>
);

export function GameList({ rowTitle, movies }: MovieRow) {
    const router = useRouter();

    const isWeb = Platform.OS === 'web';

    return (
        <View style={styles.movieRow}>
            <Text style={[styles.sectionTitle, isWeb && webStyles.sectionTitle]}>{rowTitle}</Text>
            <FlatList
                horizontal

                data={movies}
                renderItem={(props) => <GameItem {...props} router={router} />}
                keyExtractor={item => item.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.contentList, isWeb && { paddingHorizontal: 48 }]}
            />
        </View>
    );
}

const webStyles = StyleSheet.create({
    sectionTitle: {
        paddingHorizontal: 48,
        fontSize: 20,
        fontWeight: '700',
    },
});
