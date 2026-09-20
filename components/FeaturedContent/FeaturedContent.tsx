import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { styles } from '@/styles';
import { FeaturedMovie } from '@/types/movie';
import { SafeImage } from '@/components/SafeImage';

interface FeaturedContentProps {
    movie: FeaturedMovie & {
        year?: string;
        typeLabel?: string;
        durationLabel?: string;
        ranking?: string;
    };
    imageStyle: any;
    categoriesStyle: any;
    buttonsStyle: any;
    topMargin: number;
    onPlay?: () => void;
    /** 'billboard' renders the floating rounded Netflix.com hero (web, 2026 design). */
    variant?: 'mobile' | 'billboard';
    description?: string;
}

const hashSeed = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
};

export function FeaturedContent({
    movie,
    imageStyle,
    categoriesStyle,
    buttonsStyle,
    topMargin,
    onPlay,
    variant = 'mobile',
    description,
}: FeaturedContentProps) {
    const [thumbFailed, setThumbFailed] = useState(false);
    const [logoFailed, setLogoFailed] = useState(false);
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();

    if (variant === 'billboard') {
        const seed = hashSeed(movie.title ?? '');
        const hue = seed % 360;
        const match = 90 + (seed % 10);
        return (
            <View style={web.wrap}>
                <LinearGradient
                    colors={[`hsl(${hue}, 42%, 10%)`, '#0b0b0d', '#000000']}
                    locations={[0, 0.5, 1]}
                    style={StyleSheet.absoluteFill}
                />
                <View style={[web.hero, { height: Math.min(windowHeight * 0.78, 720) }]}>
                    {thumbFailed ? (
                        <View style={[StyleSheet.absoluteFill, web.heroFallback]}>
                            <Text style={web.heroFallbackN}>N</Text>
                        </View>
                    ) : (
                        <SafeImage
                            source={{ uri: movie.thumbnail }}
                            style={[
                                StyleSheet.absoluteFill,
                                { opacity: 0.5, transform: [{ scale: 1.4 }] },
                            ]}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                        />
                    )}
                    <View style={web.heroDim} />
                    <LinearGradient
                        colors={['rgba(0,0,0,0.88)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.2)']}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={StyleSheet.absoluteFill}
                    />
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.8)']}
                        locations={[0.55, 1]}
                        style={StyleSheet.absoluteFill}
                    />

                    <View style={web.posterWrap} pointerEvents="none">
                        {movie.ranking ? (
                            <View style={web.top10Badge}>
                                <Text style={web.top10BadgeText}>TOP 10</Text>
                            </View>
                        ) : null}
                        <SafeImage
                            source={{ uri: movie.thumbnail }}
                            style={web.poster}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            fallbackLabel={movie.title}
                        />
                    </View>

                    <View style={web.content}>
                        <View style={web.brandRow}>
                            <Text style={web.brandN}>N</Text>
                            <Text style={web.brandLabel}>{movie.typeLabel ?? 'FILM'}</Text>
                        </View>
                        <Text style={web.title} numberOfLines={2}>
                            {movie.title}
                        </Text>
                        <View style={web.metaRow}>
                            <Text style={web.match}>{match}% Match</Text>
                            {movie.year ? <Text style={web.metaItem}>{movie.year}</Text> : null}
                            <View style={web.chipBox}>
                                <Text style={web.chipText}>U/A 16+</Text>
                            </View>
                            {movie.durationLabel ? (
                                <Text style={web.metaItem}>{movie.durationLabel}</Text>
                            ) : null}
                            <View style={web.chipBox}>
                                <Text style={web.chipText}>HD</Text>
                            </View>
                        </View>
                        {description ? (
                            <Text numberOfLines={3} style={web.description}>
                                {description}
                            </Text>
                        ) : null}
                        <View style={web.buttons}>
                            <Pressable
                                style={({ pressed, hovered }: any) => [
                                    web.playBtn,
                                    (pressed || hovered) && { backgroundColor: '#e0e0e0' },
                                ]}
                                onPress={() => onPlay?.()}
                            >
                                <Ionicons name="play" size={24} color="#000" />
                                <Text style={web.playText}>Play</Text>
                            </Pressable>
                            <Pressable
                                style={({ pressed, hovered }: any) => [
                                    web.moreBtn,
                                    (pressed || hovered) && { backgroundColor: 'rgba(109,109,110,0.6)' },
                                ]}
                                onPress={() => onPlay?.()}
                            >
                                <Ionicons name="information-circle-outline" size={24} color="#fff" />
                                <Text style={web.moreText}>More Info</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.featuredContent, { marginTop: topMargin }]}>
            <View style={styles.featuredWrapper}>

                <View style={styles.featuredImageContainer}>
                    {thumbFailed ? (
                        <Animated.View
                            style={[
                                styles.featuredImage,
                                imageStyle,
                                {
                                    backgroundColor: '#141420',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                },
                            ]}
                        >
                            <Text style={{ color: '#E50914', fontSize: 72, fontWeight: '900' }}>N</Text>
                        </Animated.View>
                    ) : (
                        <Animated.Image
                            source={{ uri: movie.thumbnail }}
                            style={[styles.featuredImage, imageStyle]}
                            onError={() => setThumbFailed(true)}
                        />
                    )}
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.8)']}
                        style={styles.featuredGradient}
                    />
                    {logoFailed ? (
                        <Text style={styles.featuredFallbackTitle}>{movie.title}</Text>
                    ) : (
                        <Animated.Image
                            source={{ uri: movie.logo }}
                            style={styles.featuredLogo}
                            onError={() => setLogoFailed(true)}
                        />
                    )}
                </View>

                <View style={styles.featuredOverlay}>
                    <Animated.View style={[styles.featuredCategories, categoriesStyle]}>
                        <Text style={styles.categoriesText}>
                            {movie.categories.join(' • ')}
                        </Text>
                    </Animated.View>

                    <Animated.View style={[styles.featuredButtons, buttonsStyle]}>
                        <Pressable
                            style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.75 }]}
                            onPress={() => onPlay?.()}
                        >
                            <Ionicons name="play" size={24} color="#000" />
                            <Text style={styles.playButtonText}>Play</Text>
                        </Pressable>
                        <Pressable style={({ pressed }) => [styles.myListButton, pressed && { opacity: 0.75 }]}>
                            <Ionicons name="add" size={24} color="#fff" />
                            <Text style={styles.myListButtonText}>My List</Text>
                        </Pressable>
                    </Animated.View>
                </View>
            </View>
        </View>
    );
}

const web = StyleSheet.create({
    wrap: {
        width: '100%',
        paddingTop: 84,
        paddingBottom: 10,
    },
    hero: {
        marginHorizontal: 48,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#141420',
        ...Platform.select({
            web: { boxShadow: '0 24px 60px rgba(0,0,0,0.65)' } as any,
            default: {} as any,
        }),
    },
    heroFallback: {
        backgroundColor: '#141420',
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroFallbackN: {
        color: '#E50914',
        fontSize: 120,
        fontWeight: '900',
    },
    heroDim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    posterWrap: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: '6%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    poster: {
        height: '82%',
        aspectRatio: 2 / 3,
        borderRadius: 12,
        backgroundColor: '#1a1a1a',
    },
    top10Badge: {
        position: 'absolute',
        top: '5%',
        alignSelf: 'center',
        backgroundColor: '#E50914',
        borderRadius: 4,
        paddingHorizontal: 9,
        paddingVertical: 3,
        zIndex: 5,
    },
    top10BadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 1,
    },
    content: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        paddingLeft: 56,
        paddingRight: 40,
        maxWidth: 640,
        gap: 14,
    },
    brandRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    brandN: {
        color: '#E50914',
        fontSize: 26,
        fontWeight: '900',
    },
    brandLabel: {
        color: '#d2d2d2',
        fontSize: 13,
        fontWeight: '700',
        letterSpacing: 3,
    },
    title: {
        color: '#fff',
        fontSize: 58,
        fontWeight: '900',
        letterSpacing: -1,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    match: {
        color: '#46d369',
        fontWeight: '800',
        fontSize: 15,
    },
    metaItem: {
        color: '#d2d2d2',
        fontSize: 14,
        fontWeight: '600',
    },
    chipBox: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.4)',
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    chipText: {
        color: '#e5e5e5',
        fontSize: 12,
        fontWeight: '600',
    },
    description: {
        color: '#e5e5e5',
        fontSize: 15.5,
        lineHeight: 23,
    },
    buttons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 6,
    },
    playBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#fff',
        borderRadius: 999,
        paddingHorizontal: 30,
        paddingVertical: 12,
    },
    playText: {
        color: '#000',
        fontSize: 17,
        fontWeight: '800',
    },
    moreBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(109, 109, 110, 0.55)',
        borderRadius: 999,
        paddingHorizontal: 26,
        paddingVertical: 12,
    },
    moreText: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '700',
    },
});
