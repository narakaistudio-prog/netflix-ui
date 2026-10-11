/**
 * Placement maths for the Crunchyroll page's "back to Netflix" chip.
 *
 * The chip lives in the app's chrome (so TV remotes can still focus it) but it
 * is drawn inside the page's own nav row: right after the "Request" item,
 * mirroring how the Crunchyroll entry sits beside My List in the app navbar.
 *
 * Kept dependency-free so it stays unit-testable without a layout engine.
 */

/** Chip height — must match `styles.backPill` in CrunchyrollView.web.tsx. */
export const EXIT_CHIP_HEIGHT = 34;

/** Gap between the "Request" nav item and the chip. */
export const EXIT_CHIP_GAP = 12;

export interface RectLike {
    left: number;
    right: number;
    top: number;
    height: number;
}

/** Vertical centre of the nav row, horizontally just right of the anchor. */
export function exitChipPosition(frameRect: RectLike, navRect: RectLike): { left: number; top: number } {
    return {
        left: Math.round(frameRect.left + navRect.right + EXIT_CHIP_GAP),
        top: Math.round(frameRect.top + navRect.top + navRect.height / 2 - EXIT_CHIP_HEIGHT / 2),
    };
}
