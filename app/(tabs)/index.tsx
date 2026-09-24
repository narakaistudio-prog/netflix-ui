import React, { useMemo, useRef } from 'react';
import { Platform, View, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  withTiming,
} from 'react-native-reanimated';
import { styles } from '@/styles';
import { AnimatedHeader } from '@/components/Header/AnimatedHeader';
import { FeaturedContent } from '@/components/FeaturedContent/FeaturedContent';
import { DeferredMovieList } from '@/components/MovieList/DeferredMovieList';
import { useDeviceMotion } from '@/hooks/useDeviceMotion';
import { MovieRow } from '@/types/movie';
import { useCatalog } from '@/hooks/useCatalog';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';
import { usePathname, useRouter } from 'expo-router';
import { useUser } from '@/contexts/UserContext';
import { TAB_SCREENS } from '@/app/(tabs)/_layout';
import { useScrollToTop } from '@react-navigation/native';
import { useVisionOS } from '@/hooks/useVisionOS';
import { VisionContainer, HoverableView } from '@/components/ui/VisionContainer';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const IS_WEB = Platform.OS === 'web';

export default function HomeScreen() {
  const { rows: movies } = useCatalog();
  // Keep the Home contract independent of refresh-row insertion order.
  // Current editorial shelves may be refreshed separately, but Top 10 stays
  // immediately below the hero like Netflix.
  const orderedMovies = useMemo(() => [
    ...movies.filter(row => row.type === 'top_10'),
    ...movies.filter(row => row.type !== 'top_10'),
  ], [movies]);
  const insets = useSafeAreaInsets();
  // The web billboard does not use tilt transforms; don't start a continuous
  // device-orientation listener just to animate values no one can see.
  const { tiltX, tiltY } = useDeviceMotion(!IS_WEB);
  const { isVisionOS } = useVisionOS();
  const router = useRouter();
  const { selectedProfile } = useUser();

  const allMovies = orderedMovies.flatMap(row => row.movies);
  // Hero = today's #1 title in India (first Top 10 row), always current
  const featuredMovie: any =
    orderedMovies.find(r => r.type === 'top_10')?.movies[0] ?? allMovies[0] ?? { id: '1', imageUrl: '' };

  const SCROLL_THRESHOLD = 4;
  const SLIDE_ACTIVATION_POINT = 90; // Point at which sliding can start
  const scrollY = useSharedValue(0);
  const lastScrollY = useSharedValue(0);
  const scrollDirection = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const currentScrollY = event.contentOffset.y;
      const scrollDelta = currentScrollY - lastScrollY.value;

      // Only trigger direction change if we've scrolled past SLIDE_ACTIVATION_POINT
      if (currentScrollY >= SLIDE_ACTIVATION_POINT) {
        if (scrollDelta > SCROLL_THRESHOLD) {
          // Scrolling down - hide tabs
          scrollDirection.value = withTiming(1, { duration: 400 });
        } else if (scrollDelta < -SCROLL_THRESHOLD) {
          // Scrolling up - show tabs
          scrollDirection.value = withTiming(0, { duration: 400 });
        }
      } else {
        // Before SLIDE_ACTIVATION_POINT, always show tabs
        scrollDirection.value = withTiming(0, { duration: 400 });
      }

      lastScrollY.value = currentScrollY;
      scrollY.value = currentScrollY;
    },
  });

  const headerAnimatedProps = useAnimatedProps(() => {
    return {
      intensity: interpolate(
        scrollY.value,
        [0, 90],
        [0, 85],
        'clamp'
      )
    };
  });

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tiltX.value * 0.7 },
      { translateY: tiltY.value * 0.7 },
      { scale: 1.05 },
    ],
  }));

  const categoriesStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tiltX.value * -0.35 },
      { translateY: tiltY.value * -0.35 },
    ],
  }));

  const buttonsStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tiltX.value * -0.45 },
      { translateY: tiltY.value * -0.45 },
    ],
  }));

  const pathname = usePathname();
  const isActive = pathname === '/' || pathname === '/index';

  const currentTabIndex = TAB_SCREENS.findIndex(screen =>
    screen.name === 'index'
  );
  const activeTabIndex = TAB_SCREENS.findIndex(screen =>
    pathname === `/${screen.name}` || (screen.name === 'index' && pathname === '/')
  );

  const slideDirection = activeTabIndex > currentTabIndex ? 'right' : 'left';

  const scrollViewRef = useRef(null);

  useScrollToTop(scrollViewRef);

  return (
    <TabScreenWrapper isActive={isActive} slideDirection={slideDirection}>
      <VisionContainer style={styles.container}>
        <StatusBar style="light" />
        {!IS_WEB && (
          <AnimatedHeader
            headerAnimatedProps={headerAnimatedProps}
            title={`For ${selectedProfile?.name ?? 'You'}`}
            scrollDirection={scrollDirection}
          />
        )}

        <Animated.ScrollView
          ref={scrollViewRef}
          {...({ dataSet: { tvScrollContainer: 'true', tvRoutePage: '/' } } as any)}
          style={[
            styles.scrollView,
            isVisionOS && { paddingHorizontal: 20 }
          ]}
          onScroll={IS_WEB ? undefined : scrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.scrollViewContent, IS_WEB && { paddingBottom: 80, paddingTop: 0 }]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {!IS_WEB && (
            <LinearGradient
              colors={['#202036', '#11111d', '#07070c']}
              locations={[0, 0.4, 0.8]}
              style={[styles.gradient, { height: SCREEN_HEIGHT * 0.8 }]}
            />
          )}

          {(pathname === '/' || pathname === '/index') && (
          <FeaturedContent
            movie={{
              id: featuredMovie.id,
              title: featuredMovie.title ?? '',
              thumbnail: featuredMovie.imageUrl ?? '',
              categories: [],
              typeLabel: featuredMovie.type === 'SERIES' ? 'SERIES' : 'FILM',
              year: featuredMovie.year,
              durationLabel: featuredMovie.type === 'SERIES' ? '1 Season' : '2h 10m',
              ranking: featuredMovie.ranking_text,
            }}
            imageStyle={imageStyle}
            categoriesStyle={categoriesStyle}
            buttonsStyle={buttonsStyle}
            topMargin={IS_WEB ? 0 : insets.top + 90}
            variant={IS_WEB ? 'billboard' : 'mobile'}
            description={featuredMovie.description}
            onPlay={() =>
              router.push({
                pathname: '/movie/[id]',
                params: { id: featuredMovie.id },
              })
            }
          />
          )}

          {orderedMovies.map((row, index) => (
            // Keep just the immediately reachable Top 10 shelves eager. On TV,
            // mounting 5 shelves up front decoded ~100 posters before the
            // first D-pad press; later shelves now hydrate as focus approaches.
            <DeferredMovieList key={row.rowTitle} eager={index < 2} {...row} />
          ))}
        </Animated.ScrollView>
      </VisionContainer>
    </TabScreenWrapper>
  );
}


