/**
 * Auto landscape + fullscreen for the player, scoped to Android phones.
 *
 * The user asked: the moment Play is tapped on an Android phone, the player
 * should take over the whole screen in landscape. Two worlds:
 *
 *   - Web (their Vercel app in Android Chrome): the container element gets
 *     requestFullscreen() (hides status + nav bars, immersive) and then
 *     screen.orientation.lock('landscape') — Chrome only honours the lock
 *     while in fullscreen. Both run inside the play tap's user activation.
 *   - Native Android (future APK builds): expo-screen-orientation pins
 *     LANDSCAPE while the player is open and restores portrait on close.
 *
 * Everything else — desktop browsers, iOS — is deliberately untouched.
 * Every call fails soft: browsers can refuse fullscreen (e.g. a programmatic
 * open without a gesture), and the player must simply keep working.
 */

import { Platform } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/** Android phone (or tablet) browsing the web app? Desktop and iOS: false. */
export function isAndroidWeb(): boolean {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent);
}

/** Player opened: fullscreen + landscape, best effort. */
export async function enterPlayerFullscreen(host?: HTMLElement | null): Promise<void> {
    if (Platform.OS === 'web') {
        if (!isAndroidWeb()) return;
        try {
            const el = (host ?? document.documentElement) as HTMLElement;
            if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') {
                await el.requestFullscreen({ navigationUI: 'hide' });
            }
        } catch {
            // No user activation (auto-open path) or browser refusal — fine.
        }
        try {
            await (screen.orientation as any)?.lock?.('landscape');
        } catch {
            // Without fullscreen Chrome rejects the lock — the user can still
            // rotate the phone manually.
        }
        return;
    }
    try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch {}
}

/** Player closed: back to the normal screen, best effort. */
export async function exitPlayerFullscreen(): Promise<void> {
    if (Platform.OS === 'web') {
        try {
            (screen.orientation as any)?.unlock?.();
        } catch {}
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
        } catch {}
        return;
    }
    try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {}
}
