/**
 * Geometry for the Crunchyroll page's "back to Netflix" control.
 *
 * The control lives in the app's chrome (so TV remotes can focus it) but is
 * drawn over the page's own nav row — right after the "Request" item, the
 * mirror of how the Crunchyroll entry sits beside My List in the app navbar.
 *
 * Coordinates are computed in the *document* space of the embedded page, so
 * scrolling the page (or the shell) never nudges the control: once placed it
 * stays put. Kept dependency-free so it is unit-testable without a layout
 * engine.
 */

/**
 * Height of the clickable area of the control. Must match `styles.backChip`
 * in CrunchyrollView.web.tsx (the red NETFLIX wordmark).
 */
export const EXIT_CHIP_HEIGHT = 34;

/** Gap between the "Request" nav item and the wordmark. */
export const EXIT_CHIP_GAP = 12;

export interface RectLike {
    left: number;
    right: number;
    top: number;
    height: number;
}

/**
 * Where the wordmark sits, in viewport coordinates.
 *
 * `scroll` is the embedded page's current scroll offset; adding it converts
 * the nav item's viewport rect into document space, which makes the result
 * independent of how far the page happens to be scrolled when we measure.
 */
export function exitChipPosition(
    frameRect: RectLike,
    navRect: RectLike,
    scroll: { x?: number; y?: number } = {},
): { left: number; top: number } {
    const scrollX = scroll.x ?? 0;
    const scrollY = scroll.y ?? 0;
    return {
        left: Math.round(frameRect.left + navRect.right + scrollX + EXIT_CHIP_GAP),
        top: Math.round(frameRect.top + navRect.top + scrollY + navRect.height / 2 - EXIT_CHIP_HEIGHT / 2),
    };
}
