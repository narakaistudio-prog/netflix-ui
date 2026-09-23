import {
    getCarouselWindow, spacerWidth, WEB_CARD_GAP, WEB_CARD_WIDTH, WEB_CAROUSEL_WINDOW,
} from './carouselWindow';

test('keeps only nearby cards mounted at the start, middle and end of a long shelf', () => {
    const total = 233;
    expect(getCarouselWindow(total, 0)).toEqual({ start: 0, end: WEB_CAROUSEL_WINDOW });
    expect(getCarouselWindow(total, 40 * (WEB_CARD_WIDTH + WEB_CARD_GAP)))
        .toEqual({ start: 36, end: 36 + WEB_CAROUSEL_WINDOW });
    expect(getCarouselWindow(total, 999999))
        .toEqual({ start: total - WEB_CAROUSEL_WINDOW, end: total });
});

test('spacers preserve the full shelf width as the rendered window moves', () => {
    const total = 233;
    const expected = spacerWidth(total);
    for (const scrollX of [0, 187, 40 * 187, 999999]) {
        const { start, end } = getCarouselWindow(total, scrollX);
        const groups = [start, end - start, total - end].filter(count => count > 0);
        const actual = groups.reduce((width, count) => width + spacerWidth(count), 0)
            + (groups.length - 1) * WEB_CARD_GAP;
        expect(actual).toBe(expected);
    }
    expect(getCarouselWindow(7, 0)).toEqual({ start: 0, end: 7 });
});
