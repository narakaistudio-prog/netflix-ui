import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';

/**
 * DP-less profile badge.
 *
 * Profiles don't carry display pictures — this renders a Netflix-style
 * colored tile with the profile's initial instead of any avatar image.
 */

const PALETTE = [
    '#E50914', // Netflix red
    '#0078FF', // blue
    '#F5B711', // amber
    '#2FBF71', // green
    '#8B5CF6', // violet
    '#F25C7A', // pink
];

function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
}

interface ProfileBadgeProps {
    name: string;
    /** Stable id used to derive the tile color (falls back to name). */
    id?: string;
    /** Fixed square size in px. When omitted the badge fills its parent. */
    size?: number;
    /** Font size for the initial. Defaults to ~45% of `size`. */
    fontSize?: number;
    borderRadius?: number;
    style?: StyleProp<ViewStyle>;
}

export function ProfileBadge({
    name,
    id,
    size,
    fontSize,
    borderRadius,
    style,
}: ProfileBadgeProps) {
    const initial = (name || '?').trim().charAt(0).toUpperCase();
    const backgroundColor = PALETTE[hashString(id ?? name) % PALETTE.length];

    const sizeStyle: ViewStyle = size
        ? { width: size, height: size }
        : { width: '100%', height: '100%' };

    return (
        <View
            style={[
                mStyles.badge,
                sizeStyle,
                {
                    backgroundColor,
                    borderRadius: borderRadius ?? (size ? size * 0.12 : 8),
                },
                style,
            ]}
        >
            <Text
                style={[
                    mStyles.initial,
                    { fontSize: fontSize ?? (size ? size * 0.45 : 32) },
                ]}
            >
                {initial}
            </Text>
        </View>
    );
}

const mStyles = StyleSheet.create({
    badge: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    initial: {
        color: '#fff',
        fontWeight: '700',
        lineHeight: undefined,
    },
});
