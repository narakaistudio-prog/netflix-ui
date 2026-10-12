import React from 'react';
import { usePathname, useRouter } from 'expo-router';
import { TAB_SCREENS } from '@/app/(tabs)/_layout';
import { TabScreenWrapper } from '@/components/TabScreenWrapper';
import { CrunchyrollView } from '@/components/Crunchyroll/CrunchyrollView';
import { useTvBackHandler } from '@/hooks/useTvNavigation';

/**
 * /crunchyroll — the Crunchyroll OTT section.
 *
 * Reachable from the "Crunchyroll" entry beside "My List" in the web navbar
 * (and the Crunchyroll tab on mobile). Renders the self-contained demo page
 * full-screen so it feels like Crunchyroll itself opened.
 */
export default function CrunchyrollScreen() {
    const pathname = usePathname();
    const router = useRouter();
    const isActive = pathname === '/crunchyroll';
    const currentTabIndex = TAB_SCREENS.findIndex(screen => screen.name === 'crunchyroll');
    const activeTabIndex = TAB_SCREENS.findIndex(screen =>
        pathname === `/${screen.name}` || (screen.name === 'index' && pathname === '/')
    );
    const slideDirection = activeTabIndex > currentTabIndex ? 'right' : 'left';

    useTvBackHandler(() => {
        router.back();
        return true;
    }, isActive);

    return (
        <TabScreenWrapper isActive={isActive} slideDirection={slideDirection}>
            <CrunchyrollView />
        </TabScreenWrapper>
    );
}
