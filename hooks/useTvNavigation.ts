import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { spatialNav, isTvDevice } from '@/lib/spatialNavigation';

export function useTvMode() {
    const [isTv, setIsTv] = useState(() => (Platform.OS === 'web' ? spatialNav.isTvMode() : false));

    useEffect(() => {
        if (Platform.OS !== 'web') return;
        const unsubscribe = spatialNav.subscribe(active => {
            setIsTv(active);
        });
        return unsubscribe;
    }, []);

    const toggleTvMode = useCallback(() => {
        if (Platform.OS !== 'web') return;
        spatialNav.setTvMode(!spatialNav.isTvMode());
    }, []);

    return {
        isTvMode: isTv,
        isTvDevice: Platform.OS === 'web' ? isTvDevice() : false,
        setTvMode: (active: boolean) => spatialNav.setTvMode(active),
        toggleTvMode,
    };
}

export function useTvBackHandler(handler: () => boolean, enabled: boolean = true) {
    useEffect(() => {
        if (Platform.OS !== 'web' || !enabled) return;
        const unsubscribe = spatialNav.pushBackHandler(handler);
        return unsubscribe;
    }, [handler, enabled]);
}
