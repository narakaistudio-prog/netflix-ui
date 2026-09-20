import { useState, useEffect } from 'react';
import { Platform } from 'react-native';

export const useEyeTracking = () => {
  const [eyePosition, setEyePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if ((Platform.OS as string) !== 'visionOS') return;

    // Eye tracking is only conceptually available on visionOS; the manager
    // is provided by the native side when present.
    const manager: any = (globalThis as any).eyeTrackingManager;
    if (!manager) return;

    const subscription = manager.subscribe((position: { x: number; y: number }) => {
      setEyePosition(position);
    });

    return () => subscription?.unsubscribe?.();
  }, []);

  return eyePosition;
};
