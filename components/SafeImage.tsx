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
    /** The hero may load immediately; posters elsewhere wait until near the viewport. */
    loading?: 'eager' | 'lazy';
    /**
     * A second real image URL (e.g. a live-resolved TVMaze/TMDB poster) to
     * try when the primary `source` is missing or fails to load, before
     * falling back to the generic "N" placeholder. Always a plain http(s)
     * URL — never a `local:`/bundled-asset reference.
     */
    fallbackUri?: string;
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
    loading = 'lazy',
    fallbackUri,
}: SafeImageProps) {
    // 0 = try the primary source, 1 = try fallbackUri, 2 = give up (placeholder).
    const [stage, setStage] = useState(0);
    const failed = stage >= 2;

    if (Platform.OS === 'web') {
        const rawUri =
            typeof source === 'object' && source !== null && 'uri' in source
                ? (source as any).uri
                : typeof source === 'string'
                ? source
                : undefined;

        let imgSrc: string | undefined;

        if (stage === 0) {
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
            if (!imgSrc && fallbackUri) {
                // Primary resolved to nothing at all — skip straight to the
                // live fallback instead of flashing the placeholder first.
                imgSrc = fallbackUri;
            }
        } else if (stage === 1) {
            imgSrc = fallbackUri;
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
        // The <img> must live in a sized frame. A raw image ignores the RN style
        // and expands to its intrinsic size — that is what blew search results
        // up into full-bleed cards.
        return (
            <View style={[style as StyleProp<ViewStyle>, styles.frame]}>
                <img
                    key={`${stage}:${imgSrc}`}
                    src={imgSrc}
                    alt={fallbackLabel || 'poster'}
                    loading={loading}
                    decoding="async"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit,
                        display: 'block',
                    } as any}
                    onError={() => setStage(s => (s === 0 && fallbackUri ? 1 : 2))}
                />
            </View>
        );
    }

    let finalSource = source;
    const raw =
        typeof source === 'object' && source !== null && 'uri' in source
            ? (source as any).uri
            : typeof source === 'string'
            ? source
            : undefined;

    if (stage === 0) {
        if (typeof raw === 'string' && (raw.startsWith('local:') || !raw.startsWith('http'))) {
            const local = getLocalPoster(raw) ?? (fallbackLabel ? getLocalPoster(fallbackLabel) : undefined);
            if (local) finalSource = local;
            else if (fallbackUri) finalSource = { uri: fallbackUri };
        } else if (!raw && fallbackUri) {
            finalSource = { uri: fallbackUri };
        }
    } else if (stage === 1) {
        finalSource = fallbackUri ? { uri: fallbackUri } : undefined;
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
            key={stage}
            source={finalSource}
            style={style as StyleProp<ImageStyle>}
            contentFit={contentFit}
            transition={transition}
            cachePolicy={cachePolicy}
            blurRadius={blurRadius}
            onError={() => setStage(s => (s === 0 && fallbackUri ? 1 : 2))}
        />
    );
}

const styles = StyleSheet.create({
    frame: {
        overflow: 'hidden',
        position: 'relative',
    },
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
