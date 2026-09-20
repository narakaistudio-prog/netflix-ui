import { Platform, Pressable, View, StyleSheet } from 'react-native';

export const VisionContainer = ({ style, ...props }: any) => (
  <View style={[styles.visionContainer, style]} {...props} />
);

/**
 * Adds a Netflix-desktop style hover zoom on web (and visionOS), plus a
 * pointer cursor. The smooth transition comes from the `[data-hoverable]`
 * CSS rule injected in `app/+html.tsx`.
 */
export const HoverableView = ({ style, ...props }: any) => (
  <Pressable
    data-hoverable="true"
    style={({ hovered }: any) => [
      styles.hoverableView,
      hovered && styles.hoverableViewHovered,
      style,
    ]}
    {...props}
  />
);

const styles = StyleSheet.create({
  visionContainer: (Platform.select as any)({
    visionOS: {
      padding: 20,
      borderRadius: 20,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.2,
      shadowRadius: 10,
    },
    default: {},
  }),
  hoverableView: (Platform.select as any)({
    visionOS: {
      transform: [{ scale: 1 }],
    },
    default: {},
  }),
  hoverableViewHovered: (Platform.select as any)({
    visionOS: {
      transform: [{ scale: 1.05 }],
    },
    web: {
      transform: [{ scale: 1.06 }],
      zIndex: 10,
    },
    default: {},
  }),
});
