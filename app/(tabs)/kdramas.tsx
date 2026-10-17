import React from 'react';
import { usePathname } from 'expo-router';
import { TAB_SCREENS } from '@/app/(tabs)/_layout';
import { KdramaBrowseScreen } from '@/components/KdramaBrowseScreen';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';

export default function KdramaScreen() {
    const pathname = usePathname();
    const currentTabIndex = TAB_SCREENS.findIndex(screen => screen.name === 'kdramas');
    const activeTabIndex = TAB_SCREENS.findIndex(screen =>
        pathname === `/${screen.name}` || (screen.name === 'index' && pathname === '/')
    );
    const slideDirection = activeTabIndex > currentTabIndex ? 'right' : 'left';

    return (
        <TabScreenWrapper
            isActive={pathname === '/kdramas'}
            slideDirection={slideDirection}
        >
            <KdramaBrowseScreen />
        </TabScreenWrapper>
    );
}
