import { useEffect } from 'react';
import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { DeviceMotionData } from '@/types/movie';

export function useDeviceMotion() {
    const tiltX = useSharedValue(0);
    const tiltY = useSharedValue(0);

    useEffect(() => {
        // On web, expo-sensors' DeviceMotion is not fully implemented: its web
        // module has no `addListener`/`setUpdateInterval` (calling them throws
        // "this._nativeModule.addListener is not a function") and it never
        // emits `rotation` data. Fall back to the browser's deviceorientation
        // event instead; on devices without motion sensors the tilt simply
        // stays neutral.
        if (Platform.OS === 'web') {
            const handleOrientation = (event: DeviceOrientationEvent) => {
                tiltX.value = withSpring((event.gamma ?? 0) * 4);
                tiltY.value = withSpring((event.beta ?? 0) * 4);
            };

            window.addEventListener('deviceorientation', handleOrientation);
            return () => {
                window.removeEventListener('deviceorientation', handleOrientation);
            };
        }

        const subscription = DeviceMotion.addListener((data: DeviceMotionData) => {
            tiltX.value = withSpring(data.rotation.gamma * 4);
            tiltY.value = withSpring(data.rotation.beta * 4);
        });

        DeviceMotion.setUpdateInterval(16);

        return () => {
            subscription.remove();
        };
    }, []);

    return { tiltX, tiltY };
}
