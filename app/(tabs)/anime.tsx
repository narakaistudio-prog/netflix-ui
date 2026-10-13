import React from 'react';
import { usePathname } from 'expo-router';
import { TAB_SCREENS } from '@/app/(tabs)/_layout';
import { AnimeBrowseScreen } from '@/components/AnimeBrowseScreen';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';

export default function AnimeScreen() {
    const pathname = usePathname();
    const currentTabIndex = TAB_SCREENS.findIndex(screen => screen.name === 'anime');
    const activeTabIndex = TAB_SCREENS.findIndex(screen =>
        pathname === `/${screen.name}` || (screen.name === 'index' && pathname === '/')
    );
    const slideDirection = activeTabIndex > currentTabIndex ? 'right' : 'left';

    return (
        <TabScreenWrapper
            isActive={pathname === '/anime'}
            slideDirection={slideDirection}
        >
            <AnimeBrowseScreen />
        </TabScreenWrapper>
    );
}
