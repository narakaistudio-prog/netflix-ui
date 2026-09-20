import { useCallback } from 'react';
import { Platform } from 'react-native';

export const useVisionGestures = () => {
  const handleHover = useCallback((event: any) => {
    if ((Platform.OS as string) !== 'visionOS') return;
    // Handle hover effects
  }, []);

  const handleSelect = useCallback((event: any) => {
    if ((Platform.OS as string) !== 'visionOS') return;
    // Handle selection
  }, []);

  return {
    handleHover,
    handleSelect,
  };
};
