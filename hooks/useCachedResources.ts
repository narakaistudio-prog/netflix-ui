import * as Font from 'expo-font';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export default function useCachedResources() {
    // On web, start as true so SSR pre-renders the full UI and HTML immediately
    const [isLoadingComplete, setLoadingComplete] = useState(Platform.OS === 'web');

    useEffect(() => {
        async function loadResourcesAndDataAsync() {
            try {
                await Font.loadAsync({
                    'arialic': require('../assets/fonts/arialic.ttf'),
                });
            } catch (e) {
                console.warn(e);
            } finally {
                setLoadingComplete(true);
            }
        }

        loadResourcesAndDataAsync();
    }, []);

    return isLoadingComplete;
} 