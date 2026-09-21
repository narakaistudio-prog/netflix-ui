import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { styles } from '@/styles';
import { FeaturedMovie } from '@/types/movie';
import { SafeImage } from '@/components/SafeImage';
import { getLocalPoster } from '@/assets/posters';

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
    /** 'billboard' renders the full-bleed Netflix.com hero banner (web desktop design). */
    variant?: 'mobile' | 'billboard';
    description?: string;
}

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
        const billboardHeight = Math.max(540, Math.min(windowHeight * 0.8, 760));
        // Use high-res billboard image if available, fallback to movie thumbnail
        const billboardSrc =
            movie.title?.toLowerCase().includes('jawan')
                ? getLocalPoster('billboard-jawan') || { uri: movie.thumbnail }
                : movie.title?.toLowerCase().includes('extraction')
                ? getLocalPoster('billboard-extraction') || { uri: movie.thumbnail }
                : { uri: movie.thumbnail };

        return (
            <View style={[web.container, { height: billboardHeight }]}>
                {/* Full-bleed Backdrop Image */}
                <SafeImage
                    source={billboardSrc}
                    style={web.backdrop}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                />

                {/* Left vignette gradient for text readability */}
                <LinearGradient
                    colors={[
                        'rgba(20,20,20,0.95)',
                        'rgba(20,20,20,0.7)',
                        'rgba(20,20,20,0.3)',
                        'transparent',
                    ]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 0.7, y: 0.5 }}
                    style={StyleSheet.absoluteFill}
                />

                {/* Bottom gradient seamlessly blending into Netflix India page background */}
                <LinearGradient
                    colors={[
                        'transparent',
                        'rgba(20,20,20,0.4)',
                        'rgba(20,20,20,0.85)',
                        '#141414',
                    ]}
                    locations={[0, 0.45, 0.75, 1]}
                    style={StyleSheet.absoluteFill}
                />

                {/* Top gradient for nav bar */}
                <LinearGradient
                    colors={['rgba(0,0,0,0.7)', 'transparent']}
                    locations={[0, 0.3]}
                    style={StyleSheet.absoluteFill}
                />

                {/* Right side poster display */}
                <View style={web.posterRight} pointerEvents="none">
                    <SafeImage
                        source={{ uri: movie.thumbnail }}
                        style={web.rightPosterImage}
                        fallbackLabel={movie.title}
                    />
                </View>

                {/* Cinematic Left Content Panel */}
                <View style={web.content}>
                    {/* Netflix Original N Badge */}
                    <View style={web.brandRow}>
                        <Text style={web.brandN}>N</Text>
                        <Text style={web.brandLabel}>
                            {movie.typeLabel === 'SERIES' ? 'SERIES' : 'FILM'}
                        </Text>
                    </View>

                    {/* Movie Title */}
                    <Text style={web.title} numberOfLines={2}>
                        {movie.title}
                    </Text>

                    {/* Red Top 10 Ranking Badge */}
                    <View style={web.rankRow}>
                        <View style={web.top10Badge}>
                            <Text style={web.top10Text}>TOP</Text>
                            <Text style={web.top10Number}>10</Text>
                        </View>
                        <Text style={web.rankingText}>
                            {movie.ranking || '#1 in Movies Today'}
                        </Text>
                    </View>

                    {/* Metadata Row */}
                    <View style={web.metaRow}>
                        <Text style={web.match}>98% Match</Text>
                        <Text style={web.metaItem}>{movie.year || '2023'}</Text>
                        <View style={web.ratingBox}>
                            <Text style={web.ratingText}>U/A 16+</Text>
                        </View>
                        <Text style={web.metaItem}>{movie.durationLabel || '2h 49m'}</Text>
                        <View style={web.badge4k}>
                            <Text style={web.badge4kText}>Ultra HD 4K</Text>
                        </View>
                        <View style={web.badge4k}>
                            <Text style={web.badge4kText}>5.1 Audio</Text>
                        </View>
                    </View>

                    {/* Synopsis */}
                    <Text numberOfLines={3} style={web.description}>
                        {description ||
                            'A man driven by a personal vendetta to rectify the evils in society, while keeping a promise made years ago, faces a monstrous outlaw with no fear.'}
                    </Text>

                    {/* Action Buttons */}
                    <View style={web.buttonRow}>
                        <Pressable
                            style={({ pressed, hovered }: any) => [
                                web.playBtn,
                                (pressed || hovered) && web.playBtnHover,
                            ]}
                            onPress={() => onPlay?.()}
                        >
                            <Ionicons name="play" size={26} color="#000" />
                            <Text style={web.playBtnText}>Play</Text>
                        </Pressable>

                        <Pressable
                            style={({ pressed, hovered }: any) => [
                                web.infoBtn,
                                (pressed || hovered) && web.infoBtnHover,
                            ]}
                            onPress={() => onPlay?.()}
                        >
                            <Ionicons name="information-circle-outline" size={26} color="#fff" />
                            <Text style={web.infoBtnText}>More Info</Text>
                        </Pressable>
                    </View>
                </View>

                {/* Right Edge Maturity Rating Tag */}
                <View style={web.maturityBadge}>
                    <Text style={web.maturityText}>U/A 16+</Text>
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
    container: {
        width: '100%',
        position: 'relative',
        backgroundColor: '#141414',
        marginBottom: 20,
        overflow: 'hidden',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
    },
    posterRight: {
        position: 'absolute',
        right: '8%',
        top: '18%',
        bottom: '18%',
        aspectRatio: 2 / 3,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0,0,0,0.85)',
        zIndex: 1,
    } as any,
    rightPosterImage: {
        width: '100%',
        height: '100%',
    },
    content: {
        position: 'absolute',
        left: 48,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        maxWidth: 620,
        zIndex: 5,
        paddingTop: 40,
        gap: 14,
    },
    brandRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    brandN: {
        color: '#E50914',
        fontSize: 32,
        fontWeight: '900',
        letterSpacing: -1,
    },
    brandLabel: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
        letterSpacing: 4,
    },
    title: {
        color: '#ffffff',
        fontSize: 64,
        fontWeight: '900',
        letterSpacing: -1.5,
        textShadowColor: 'rgba(0, 0, 0, 0.8)',
        textShadowOffset: { width: 2, height: 2 },
        textShadowRadius: 8,
        lineHeight: 70,
    },
    rankRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    top10Badge: {
        backgroundColor: '#E50914',
        borderRadius: 2,
        paddingHorizontal: 6,
        paddingVertical: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    top10Text: {
        color: '#fff',
        fontSize: 9,
        fontWeight: '900',
        lineHeight: 9,
    },
    top10Number: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '900',
        lineHeight: 12,
    },
    rankingText: {
        color: '#ffffff',
        fontSize: 19,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    match: {
        color: '#46d369',
        fontSize: 16,
        fontWeight: '800',
    },
    metaItem: {
        color: '#d2d2d2',
        fontSize: 15,
        fontWeight: '600',
    },
    ratingBox: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.4)',
        borderRadius: 2,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    ratingText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
    badge4k: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.4)',
        borderRadius: 2,
        paddingHorizontal: 5,
        paddingVertical: 1,
    },
    badge4kText: {
        color: '#e5e5e5',
        fontSize: 11,
        fontWeight: '600',
    },
    description: {
        color: '#e5e5e5',
        fontSize: 16,
        lineHeight: 24,
        textShadowColor: 'rgba(0,0,0,0.7)',
        textShadowOffset: { width: 1, height: 1 },
        textShadowRadius: 4,
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginTop: 8,
    },
    playBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#ffffff',
        borderRadius: 4,
        paddingHorizontal: 28,
        paddingVertical: 11,
    },
    playBtnHover: {
        backgroundColor: 'rgba(255,255,255,0.75)',
    },
    playBtnText: {
        color: '#000000',
        fontSize: 18,
        fontWeight: '800',
    },
    infoBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(109, 109, 110, 0.7)',
        borderRadius: 4,
        paddingHorizontal: 26,
        paddingVertical: 11,
    },
    infoBtnHover: {
        backgroundColor: 'rgba(109, 109, 110, 0.45)',
    },
    infoBtnText: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '700',
    },
    maturityBadge: {
        position: 'absolute',
        right: 0,
        bottom: 80,
        backgroundColor: 'rgba(51, 51, 51, 0.6)',
        borderLeftWidth: 3,
        borderLeftColor: '#dcdcdc',
        paddingVertical: 6,
        paddingHorizontal: 14,
        paddingRight: 48,
    },
    maturityText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
});
