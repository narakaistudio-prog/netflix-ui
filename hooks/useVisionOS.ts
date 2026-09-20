import { Platform } from 'react-native';
import { useWindowDimensions } from 'react-native';

export const useVisionOS = () => {
  const isVisionOS = (Platform.OS as string) === 'visionOS';
  const { width, height } = useWindowDimensions();

  return {
    isVisionOS,
    windowSize: { width, height },
    // Add more visionOS-specific utilities as needed
  };
};
