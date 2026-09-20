import React from 'react';
import { Platform, useWindowDimensions, View, StyleSheet } from 'react-native';

/**
 * On wide (desktop) browsers the mobile-first UI would stretch across the
 * whole viewport and look broken. WebFrame centers the app in a phone-like
 * frame so the web preview looks intentional and premium, while phones and
 * narrow windows keep the full-screen experience.
 */
export function WebFrame({ children }: { children: React.ReactNode }) {
    const { width } = useWindowDimensions();

    if (Platform.OS !== 'web' || width < 700) {
        return <>{children}</>;
    }

    return (
        <View style={styles.backdrop}>
            <View style={styles.frame}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
    },
    frame: {
        width: 420,
        height: '94%',
        maxHeight: 920,
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#262626',
        backgroundColor: '#000',
        // Deep drop shadow: boxShadow on web, shadow* props on native
        ...(Platform.select({
            web: { boxShadow: '0px 20px 50px rgba(0, 0, 0, 0.9)' },
            default: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 20 },
                shadowOpacity: 0.9,
                shadowRadius: 50,
            },
        }) as any),
        elevation: 24,
    },
});
