import { Tabs, useRouter, usePathname } from 'expo-router';
import React from 'react';
import { TabBarIcon } from '@/components/navigation/TabBarIcon';
import { Platform, StyleSheet, Image, View, Pressable } from 'react-native';
import { impactAsync, ImpactFeedbackStyle } from '@/utils/haptics';
import { useUser } from '@/contexts/UserContext';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';
import { ProfileBadge } from '@/components/ProfileBadge';
import { Home } from '@/icons/Home';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { BottomTabBar } from '@react-navigation/bottom-tabs';

// Helper component for cross-platform icons
function TabIcon({ ionIcon, color }: { ionIcon: 'person' | 'home-sharp' | 'play-square'; color: string }) {
  return <TabBarIcon name={ionIcon} color={color} />;
}

// Netflix profile badge component (DP-less)
function ProfileImage({ focused }: { focused: boolean }) {
  const { selectedProfile } = useUser();

  return (
    <React.Fragment>
      <ProfileBadge
        name={selectedProfile?.name ?? '?'}
        id={selectedProfile?.id}
        size={24}
        borderRadius={4}
        style={{
          opacity: focused ? 1 : 0.5,
          borderWidth: 2,
          borderColor: focused ? 'white' : 'transparent',
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: -20,
          alignSelf: 'center',
          width: 5,
          height: 5,
          borderRadius: 2,
          backgroundColor: '#db0000',
        }}
      />
    </React.Fragment>
  );
}

export const TAB_SCREENS = [
  {
    name: 'index',
    title: 'Home',
    icon: ({ color, focused }: { color: string; focused: boolean }) => (
      <Home color={color} isActive={focused} />
    ),
  },
  {
    name: 'new',
    title: 'New & Hot',
    icon: ({ color, focused }: { color: string; focused: boolean }) => (
      <ExpoImage
        source={focused ? require('../../assets/images/replace-these/new-netflix.png') : require('../../assets/images/replace-these/new-netflix-outline.png')}
        style={{ width: 24, height: 24 }}
        cachePolicy="memory-disk"
        contentFit="contain"
      />
    ),
  },
  {
    name: '(profile)/profile',
    title: 'My Netflix',
    icon: ({ focused }: { focused: boolean }) => (
      <ProfileImage focused={focused} />
    ),
  },
];

const TAB_BAR_HEIGHT = Platform.select({ web: 64, default: 84 });
const TAB_BAR_BOTTOM_PAD = Platform.select({ web: 8, default: 30 });

const styles = StyleSheet.create({
  blurView: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: TAB_BAR_HEIGHT,
  }
});

export default function TabLayout() {
  const pathname = usePathname();
  const handleTabPress = () => {
    impactAsync(ImpactFeedbackStyle.Light);
  };

  return (
    <Tabs
      tabBar={(props: any) =>
        Platform.OS === 'web' ? null : <BottomTabBar {...props} />
      }
      screenOptions={{
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#ffffff3f',
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 0,
          elevation: 0,
          height: TAB_BAR_HEIGHT,
          paddingTop: 0,
          paddingBottom: TAB_BAR_BOTTOM_PAD,
          backgroundColor: 'transparent',
        },
        tabBarBackground: () => (
          <BlurView
            tint="dark"
            intensity={99}
            style={styles.blurView}
          />
        ),
        tabBarLabelStyle: {
          marginBottom: 10,
        },
        tabBarButton: (props) => (
          <Pressable
            {...props}
            onPress={(e) => {
              handleTabPress();
              props.onPress?.(e);
            }}
          />
        ),
      }}>
      {TAB_SCREENS.map((screen) => (
        <Tabs.Screen
          key={screen.name}
          name={screen.name}
          options={{
            title: screen.title,
            tabBarIcon: screen.icon,
          }}
        />
      ))}

    </Tabs>
  );
}
