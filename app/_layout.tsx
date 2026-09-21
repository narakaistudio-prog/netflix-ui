import {DarkTheme, DefaultTheme, ThemeProvider} from '@react-navigation/native';
import {Stack} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {useEffect, useState} from 'react';
import {Platform, StyleSheet, useColorScheme, View} from 'react-native';
import {RootScaleProvider} from '@/contexts/RootScaleContext';
import {useRootScale} from '@/contexts/RootScaleContext';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {OverlayProvider} from '@/components/Overlay/OverlayProvider';
import {useRouter, usePathname} from 'expo-router';
import {BlurView} from 'expo-blur';
import {killStrayMedia} from '@/utils/killMedia';

/**
 * Web safety net: every time the route changes, force-kill any media that
 * somehow survived a closed player (stray embed iframes, <video> elements),
 * so background audio can never leak across screens.
 */
function WebMediaWatchdog() {
    const pathname = usePathname();
    useEffect(() => {
        if (Platform.OS === 'web') killStrayMedia();
    }, [pathname]);
    return null;
}
import {WhoIsWatching} from '@/components/WhoIsWatching';
import {UserProvider} from '@/contexts/UserContext';
import {useUser} from '@/contexts/UserContext';
import useCachedResources from '@/hooks/useCachedResources';
import { useVisionOS } from '@/hooks/useVisionOS';
import { WebNavBar } from '@/components/WebNavBar';

function AnimatedStack() {
    const {scale} = useRootScale();
    const router = useRouter();
    const [isModalActive, setIsModalActive] = useState(false);
    const [canBlur, setCanBlur] = useState(false);
    const {selectedProfile, selectProfile} = useUser();
    const colorScheme = useColorScheme();
    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {scale: scale.value},
                {
                    translateY: (1 - scale.value) * -150,
                },
            ],
        };
    });
    const { isVisionOS } = useVisionOS();

    // return <WhoIsWatching onProfileSelect={selectProfile} />;


    if (!selectedProfile) {
        return <WhoIsWatching onProfileSelect={selectProfile}/>;
    }

    return (
        <View style={[
            styles.container,
            isVisionOS && { backgroundColor: 'transparent' }
        ]}>


            {/* On web the backdrop-filter frost would blur the whole page
                (including the dialog); the website uses a solid backdrop. */}
            {(isModalActive && canBlur) && Platform.OS !== 'web' && (
                <BlurView
                    intensity={50}
                    style={[
                        StyleSheet.absoluteFill,
                        {zIndex: 1}
                    ]}
                    tint={colorScheme === 'dark' ? 'dark' : 'light'}
                />
            )}
            <Animated.View style={[styles.stackContainer, animatedStyle]}>
                <Stack>
                    <Stack.Screen name="(tabs)" options={{headerShown: false}}/>
                    <Stack.Screen
                        name="movie/[id]"
                        options={{
                            presentation: 'transparentModal',
                            headerShown: false,
                            contentStyle: {
                                backgroundColor: 'transparent',
                            },
                        }}
                        listeners={{
                            focus: () => {
                                setIsModalActive(true);
                                setCanBlur(true);
                            },
                            beforeRemove: () => {
                                setIsModalActive(false);
                                setCanBlur(false);
                            },
                        }}
                    />
                    <Stack.Screen
                        name="switch-profile"
                        options={{
                            presentation: 'transparentModal',
                            headerShown: false,
                            contentStyle: {
                                backgroundColor: 'transparent',
                            },
                        }}
                        listeners={{
                            focus: () => {
                                setIsModalActive(true);
                                setCanBlur(false);
                            },
                            beforeRemove: () => {
                                setIsModalActive(false);
                                setCanBlur(false);
                            },
                        }}
                    />
                    <Stack.Screen
                        name="search"
                        options={{
                            // presentation: 'card',
                            // animation: 'none',
                            headerShown: false,
                            contentStyle: {
                                backgroundColor: 'transparent',
                            },
                        }}

                    />

                    <Stack.Screen
                        name="downloads"
                        options={{
                            // presentation: 'card',
                            // animation: 'none',
                            headerShown: false,
                            contentStyle: {
                                backgroundColor: 'transparent',
                            },
                        }}

                    />

                    <Stack.Screen name="+not-found"/>
                </Stack>

            </Animated.View>

            {/* {!selectedProfile && (
        <WhoIsWatching onProfileSelect={selectProfile} />
      )} */}


        </View>
    );
}

export default function RootLayout() {
    const colorScheme = useColorScheme();
    const isLoaded = useCachedResources();

    useEffect(() => {
        SplashScreen.hideAsync();
    }, []);

    if (!isLoaded) {
        return null; // Early return after all hooks are called
    }


    return (
        <UserProvider>
            <GestureHandlerRootView style={styles.container}>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                    <RootScaleProvider>
                        <OverlayProvider>
                            <WebMediaWatchdog/>
                            <AnimatedStack/>
                            <WebNavBar/>
                        </OverlayProvider>
                    </RootScaleProvider>
                </ThemeProvider>
            </GestureHandlerRootView>
        </UserProvider>
    );
}
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    stackContainer: {
        flex: 1,
        overflow: 'hidden',
        borderRadius: 5,
    },
});

