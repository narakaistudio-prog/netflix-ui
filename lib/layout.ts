/**
 * Phone layout on the web. Screens narrower than this get the app-style layout:
 * a compact top bar with a bottom tab bar, smaller hero and posters, and no
 * desktop side arrows. Matches the breakpoint WebFrame uses for the phone frame.
 */
export const PHONE_MAX_WIDTH = 700;

/** Height of the bottom tab bar on phone web (the content area leaves room for it). */
export const PHONE_TAB_BAR_HEIGHT = 62;

export function isPhoneWidth(width: number): boolean {
    return width < PHONE_MAX_WIDTH;
}

/** Routes that are full-screen on their own and never show the phone bottom bar. */
const BOTTOM_BAR_HIDDEN_ROUTES = ['/crunchyroll', '/movie', '/downloads'];

/** True when the phone bottom bar should be on screen for this route (web, phone width). */
export function showsPhoneTabBar(pathname: string, isPhone: boolean, isWeb: boolean): boolean {
    if (!isWeb || !isPhone) return false;
    // Whole path segments only: '/movies' (the Movies tab) must not match '/movie'.
    return !BOTTOM_BAR_HIDDEN_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'));
}
