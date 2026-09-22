import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    StyleProp,
    ViewStyle,
    ImageStyle,
    Platform,
    ImageSourcePropType,
} from 'react-native';
import { Image as ExpoImage, ImageSource } from 'expo-image';
import { getLocalPoster, LOCAL_POSTER_URIS } from '@/assets/posters';

interface SafeImageProps {
    source: ImageSource | ImageSourcePropType | any;
    style?: StyleProp<ViewStyle> | StyleProp<ImageStyle>;
    contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
    transition?: number;
    cachePolicy?: 'memory' | 'disk' | 'memory-disk' | 'none';
    blurRadius?: number;
    fallbackLabel?: string;
    hideOnError?: boolean;
}

/**
 * Image with graceful fallback and instant native web rendering.
 *
 * On Web, renders an authentic <img> tag directly using web-accessible
 * asset URLs. This guarantees 100% reliable rendering without relying
 * on React Native Web's background-image loader or asset registry.
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

    if (Platform.OS === 'web') {
        const rawUri =
            typeof source === 'object' && source !== null && 'uri' in source
                ? (source as any).uri
                : typeof source === 'string'
                ? source
                : undefined;

        let imgSrc: string | undefined;

        if (typeof rawUri === 'string' && rawUri.trim()) {
            if (rawUri.startsWith('http') || rawUri.startsWith('/') || rawUri.startsWith('data:')) {
                imgSrc = rawUri;
            } else {
                const local = getLocalPoster(rawUri) || (fallbackLabel ? getLocalPoster(fallbackLabel) : undefined);
                imgSrc = local?.uri ?? (LOCAL_POSTER_URIS[rawUri] || LOCAL_POSTER_URIS[rawUri.replace(/^local:/, '')]);
            }
        } else if (source && typeof source === 'object' && typeof source.uri === 'string') {
            imgSrc = source.uri;
        }

        if (!imgSrc || failed) {
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

        const objectFit = contentFit === 'contain' ? 'contain' : 'cover';
        return (
            <img
                src={imgSrc}
                alt={fallbackLabel || 'poster'}
                loading="eager"
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit,
                    display: 'block',
                    borderRadius: 'inherit',
                } as any}
                onError={() => setFailed(true)}
            />
        );
    }

    let finalSource = source;
    const raw =
        typeof source === 'object' && source !== null && 'uri' in source
            ? (source as any).uri
            : typeof source === 'string'
            ? source
            : undefined;

    if (typeof raw === 'string' && (raw.startsWith('local:') || !raw.startsWith('http'))) {
        const local = getLocalPoster(raw) ?? (fallbackLabel ? getLocalPoster(fallbackLabel) : undefined);
        if (local) finalSource = local;
    }

    if (failed || !finalSource) {
        if (hideOnError) return <View style={style as StyleProp<ViewStyle>} />;
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
        <ExpoImage
            source={finalSource}
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
