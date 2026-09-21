import React, { useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, ImageStyle, Platform, Image as RNImage, ImageSourcePropType } from 'react-native';
import { Image as ExpoImage, ImageSource } from 'expo-image';

interface SafeImageProps {
    source: ImageSource | ImageSourcePropType | any;
    style?: StyleProp<ViewStyle> | StyleProp<ImageStyle>;
    contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
    transition?: number;
    cachePolicy?: 'memory' | 'disk' | 'memory-disk' | 'none';
    /** Blurs the image (used for ambient/backdrop art on web). */
    blurRadius?: number;
    /** Text shown inside the Netflix-style fallback card (e.g. the title). */
    fallbackLabel?: string;
    /** Render nothing at all when the image fails instead of the fallback card. */
    hideOnError?: boolean;
}

/**
 * Image with a graceful Netflix-style fallback.
 *
 * Ensures that broken, empty, or unreachable image URLs never produce
 * an empty transparent box — always swaps in a dark card with the
 * Netflix red "N" badge and the title text.
 *
 * On Web, uses React Native Web's Image component to prevent expo-image's
 * CSS cross-dissolve opacity:0 bug with locally bundled assets.
 */
export function SafeImage({
    source,
    style,
    contentFit = 'cover',
    transition,
    cachePolicy = 'memory-disk',
    blurRadius,
    fallbackLabel,
    hideOnError = false,
}: SafeImageProps) {
    const [failed, setFailed] = useState(false);

    // Check if source is empty or invalid
    const uri =
        typeof source === 'object' && source !== null && 'uri' in source
            ? (source as any).uri
            : undefined;
    const isInvalid =
        !source ||
        (typeof source === 'object' && typeof uri === 'string' && uri.trim() === '');

    if (failed || isInvalid) {
        if (hideOnError) {
            return <View style={style as StyleProp<ViewStyle>} />;
        }
        return (
            <View style={[style as StyleProp<ViewStyle>, styles.fallback]}>
                <Text style={styles.fallbackN}>N</Text>
                {fallbackLabel ? (
                    <Text numberOfLines={2} style={styles.fallbackLabel}>
                        {fallbackLabel}
                    </Text>
                ) : null}
            </View>
        );
    }

    if (Platform.OS === 'web') {
        const resizeMode = contentFit === 'contain' ? 'contain' : 'cover';
        return (
            <RNImage
                source={source as any}
                style={[style as StyleProp<ImageStyle>, { opacity: 1 }]}
                resizeMode={resizeMode}
                blurRadius={blurRadius}
                onError={() => setFailed(true)}
            />
        );
    }

    return (
        <ExpoImage
            source={source}
            style={style as StyleProp<ImageStyle>}
            contentFit={contentFit}
            transition={transition}
            cachePolicy={cachePolicy}
            blurRadius={blurRadius}
            onError={() => setFailed(true)}
        />
    );
}

const styles = StyleSheet.create({
    fallback: {
        backgroundColor: '#1a1a24',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#2d2d3a',
    },
    fallbackN: {
        color: '#E50914',
        fontSize: 32,
        fontWeight: '900',
        lineHeight: 36,
    },
    fallbackLabel: {
        color: '#ffffffcc',
        fontSize: 11,
        fontWeight: '700',
        marginTop: 6,
        marginHorizontal: 8,
        textAlign: 'center',
    },
});
