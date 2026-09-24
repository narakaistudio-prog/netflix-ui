import React from 'react';
import { usePathname } from 'expo-router';
import { TAB_SCREENS } from '@/app/(tabs)/_layout';
import { CatalogBrowseScreen } from '@/components/CatalogBrowseScreen';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';

export default function TVShowsScreen() {
    const pathname = usePathname();
    const currentTabIndex = TAB_SCREENS.findIndex(screen => screen.name === 'tv');
    const activeTabIndex = TAB_SCREENS.findIndex(screen =>
        pathname === `/${screen.name}` || (screen.name === 'index' && pathname === '/')
    );
    const slideDirection = activeTabIndex > currentTabIndex ? 'right' : 'left';

    return (
        <TabScreenWrapper
            isActive={pathname === '/tv'}
            slideDirection={slideDirection}
        >
            <CatalogBrowseScreen kind="tv" routePath="/tv" />
        </TabScreenWrapper>
    );
}
