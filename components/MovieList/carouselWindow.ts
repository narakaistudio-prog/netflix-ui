/** Keep a bounded number of web cards mounted while preserving the full scroll width. */
export const WEB_CARD_WIDTH = 175;
export const WEB_CARD_GAP = 12;
export const WEB_CAROUSEL_WINDOW = 32;
const OVERSCAN_CARDS = 4;

export function getCarouselWindow(total: number, scrollX: number) {
    const firstVisible = Math.floor(Math.max(0, scrollX) / (WEB_CARD_WIDTH + WEB_CARD_GAP));
    const start = Math.min(
        Math.max(0, firstVisible - OVERSCAN_CARDS),
        Math.max(0, total - WEB_CAROUSEL_WINDOW),
    );
    return { start, end: Math.min(total, start + WEB_CAROUSEL_WINDOW) };
}

export function spacerWidth(cardCount: number) {
    return cardCount > 0
        ? cardCount * WEB_CARD_WIDTH + (cardCount - 1) * WEB_CARD_GAP
        : 0;
}
