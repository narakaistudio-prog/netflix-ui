import React, { useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { Image, ImageSource } from 'expo-image';

interface SafeImageProps {
    source: ImageSource;
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
 * The catalog data references many third-party image hosts; whenever one of
 * them 404s or is blocked, a broken-image box would ruin the UI. SafeImage
 * swaps in a dark card with the Netflix "N" so the layout always looks
 * intentional.
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

    if (failed) {
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

    return (
        <Image
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
        backgroundColor: '#161616',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#242424',
    },
    fallbackN: {
        color: '#E50914',
        fontSize: 30,
        fontWeight: '900',
        lineHeight: 34,
    },
    fallbackLabel: {
        color: '#8c8c8c',
        fontSize: 10,
        fontWeight: '600',
        marginTop: 4,
        marginHorizontal: 6,
        textAlign: 'center',
    },
});
