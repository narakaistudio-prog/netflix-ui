import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import {
    spatialNav,
    isTvDevice,
    isPointerDrivenDevice,
    setTvPointerPreference,
    getTvPointerPreference,
    type TvPointerPreference,
} from '@/lib/spatialNavigation';

export type TvInputSource = 'none' | 'keys' | 'pointer';

/**
 * Live TV remote status for the TV guide UI.
 *
 * `inputSource` matters a lot on real TVs: a Samsung/LG/Android TV browser can
 * either send real ArrowUp/ArrowDown keydowns ('keys') or move an on-screen
 * pointer arrow with the D-pad ('pointer'). Both are supported, and
 * `pointerPreference` lets the user force the pointer behaviour when their TV
 * hides the browser's own pointer setting.
 */
export function useTvMode() {
    const [isTv, setIsTv] = useState(() => (Platform.OS === 'web' ? spatialNav.isTvMode() : false));
    const [inputSource, setInputSource] = useState<TvInputSource>(() =>
        Platform.OS === 'web' ? spatialNav.getLastInputSource() : 'none'
    );
    const [pointerPreference, setPointerPreferenceState] = useState<TvPointerPreference>(() =>
        Platform.OS === 'web' ? getTvPointerPreference() : 'auto'
    );

    useEffect(() => {
        if (Platform.OS !== 'web') return;
        const unsubscribe = spatialNav.subscribe(active => {
            setIsTv(active);
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const markKeys = (event: KeyboardEvent) => {
            const key = event.key;
            const keyCode = event.keyCode || 0;
            const isRemoteKey =
                key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
                keyCode === 38 || keyCode === 40 || keyCode === 37 || keyCode === 39 ||
                key === 'Enter' || keyCode === 13 ||
                key === 'GoBack' || key === 'Back' || keyCode === 10009;
            if (isRemoteKey) setInputSource(spatialNav.getLastInputSource());
        };
        const markPointer = (event: MouseEvent) => {
            if (!spatialNav.isTvMode() || !spatialNav.isPointerDrivenDevice()) return;
            if (event.clientX === 0 && event.clientY === 0) return;
            setInputSource('pointer');
        };
        window.addEventListener('keydown', markKeys, { capture: true });
        document.addEventListener('mousemove', markPointer, { capture: true, passive: true });
        return () => {
            window.removeEventListener('keydown', markKeys, { capture: true } as any);
            document.removeEventListener('mousemove', markPointer, { capture: true } as any);
        };
    }, []);

    const toggleTvMode = useCallback(() => {
        if (Platform.OS !== 'web') return;
        spatialNav.setTvMode(!spatialNav.isTvMode());
        setInputSource(spatialNav.getLastInputSource());
    }, []);

    const setPointerPreference = useCallback((preference: TvPointerPreference) => {
        if (Platform.OS !== 'web') return;
        setTvPointerPreference(preference);
        setPointerPreferenceState(getTvPointerPreference());
        // Forcing "pointer arrow" also arms TV mode, otherwise nothing would
        // follow the arrow on a TV that auto-detection did not recognise.
        if (preference === 'on' && !spatialNav.isTvMode()) {
            spatialNav.setTvMode(true, true);
        }
    }, []);

    return {
        isTvMode: isTv,
        isTvDevice: Platform.OS === 'web' ? isTvDevice() : false,
        isPointerDriven: Platform.OS === 'web' ? isPointerDrivenDevice() : false,
        inputSource,
        pointerPreference,
        setPointerPreference,
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
