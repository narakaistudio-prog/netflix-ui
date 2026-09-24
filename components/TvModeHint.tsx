import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTvMode } from '@/hooks/useTvNavigation';

/**
 * Small self-hiding pill that proves TV mode really is on and tells the user how
 * the remote works right now — key mode (D-pad sends arrow keys) or pointer mode
 * (the TV browser moves its own arrow and the app follows it with the focus ring).
 *
 * It never blocks input: `pointer-events: none` + data-tv-ignore so the spatial
 * navigation engine skips it.
 */
export function TvModeHint() {
    const { isTvMode, inputSource } = useTvMode();
    const [visible, setVisible] = useState(false);
    const [mode, setMode] = useState<'keys' | 'pointer' | 'none'>('none');

    // Show for a moment when TV mode turns on, and again on the first remote
    // press so the user immediately sees that the remote reached the site —
    // and which style (arrow keys vs TV pointer) their TV is using.
    useEffect(() => {
        if (Platform.OS !== 'web' || !isTvMode) {
            setVisible(false);
            return;
        }
        setVisible(true);
        const timer = setTimeout(() => setVisible(false), 9000);
        return () => clearTimeout(timer);
    }, [isTvMode]);

    useEffect(() => {
        if (Platform.OS !== 'web' || !isTvMode || inputSource === 'none') return;
        setMode(inputSource === 'keys' ? 'keys' : 'pointer');
        setVisible(true);
        const timer = setTimeout(() => setVisible(false), 6000);
        return () => clearTimeout(timer);
    }, [isTvMode, inputSource]);

    if (Platform.OS !== 'web' || !isTvMode || !visible) return null;

    const message =
        mode === 'pointer'
            ? 'TV pointer mode — TV ka arrow jis card par jaayega, white ring usi par aayega. OK = select.'
            : mode === 'keys'
            ? 'TV Mode: D-pad se up/down/left/right, OK se select karein.'
            : 'TV Mode ON — remote ke arrow ya pointer se navigate karein.';

    return (
        <View
            style={styles.wrap}
            pointerEvents="none"
            {...({ dataSet: { tvIgnore: 'true' } } as any)}
        >
            <View style={styles.pill}>
                <Ionicons name="tv-outline" size={16} color="#fff" />
                <Text style={styles.text}>{message}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'fixed' as any,
        bottom: 28,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 90000,
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        maxWidth: '90%',
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 24,
        backgroundColor: 'rgba(20, 20, 20, 0.94)',
        borderWidth: 1,
        borderColor: '#3a3a3a',
    },
    text: {
        color: '#f2f2f2',
        fontSize: 14,
        fontWeight: '600',
        flexShrink: 1,
    },
});
