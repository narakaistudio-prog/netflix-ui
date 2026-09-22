import React from 'react';
import { usePathname } from 'expo-router';
import { TAB_SCREENS } from '@/app/(tabs)/_layout';
import { CatalogBrowseScreen } from '@/components/CatalogBrowseScreen';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';

export default function MoviesScreen() {
    const pathname = usePathname();
    const currentTabIndex = TAB_SCREENS.findIndex(screen => screen.name === 'movies');
    const activeTabIndex = TAB_SCREENS.findIndex(screen =>
        pathname === `/${screen.name}` || (screen.name === 'index' && pathname === '/')
    );
    const slideDirection = activeTabIndex > currentTabIndex ? 'right' : 'left';

    return (
        <TabScreenWrapper
            isActive={pathname === '/movies'}
            slideDirection={slideDirection}
        >
            <CatalogBrowseScreen kind="movie" />
        </TabScreenWrapper>
    );
}
