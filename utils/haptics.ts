import * as Haptics from 'expo-haptics';

/**
 * Web-safe haptics helpers.
 *
 * `expo-haptics` is not available on web — its web implementation throws an
 * `UnavailabilityError`. When such a call is made without `await`/`.catch()`
 * (e.g. on a tab press), it surfaces in the browser as an
 * "Uncaught (in promise) Error". These wrappers swallow that gracefully so
 * haptics keep working on iOS/Android while web simply no-ops.
 */

export const ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = Haptics.NotificationFeedbackType;

export async function impactAsync(
    style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium
): Promise<void> {
    try {
        await Haptics.impactAsync(style);
    } catch {
        // Haptics unavailable on this platform (web) — safe to ignore.
    }
}

export async function selectionAsync(): Promise<void> {
    try {
        await Haptics.selectionAsync();
    } catch {
        // Haptics unavailable on this platform (web) — safe to ignore.
    }
}

export async function notificationAsync(
    type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success
): Promise<void> {
    try {
        await Haptics.notificationAsync(type);
    } catch {
        // Haptics unavailable on this platform (web) — safe to ignore.
    }
}
