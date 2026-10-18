import { isPhoneWidth, PHONE_MAX_WIDTH, showsPhoneTabBar } from '@/lib/layout';

describe('phone layout rules', () => {
    test('phones are narrower than the breakpoint; desktop is not', () => {
        expect(isPhoneWidth(390)).toBe(true);
        expect(isPhoneWidth(PHONE_MAX_WIDTH - 1)).toBe(true);
        expect(isPhoneWidth(PHONE_MAX_WIDTH)).toBe(false);
        expect(isPhoneWidth(1280)).toBe(false);
    });

    test('the bottom bar shows on phone web pages, not on desktop', () => {
        expect(showsPhoneTabBar('/', true, true)).toBe(true);
        expect(showsPhoneTabBar('/movies', true, true)).toBe(true);
        expect(showsPhoneTabBar('/browse/movies', true, true)).toBe(true);
        expect(showsPhoneTabBar('/kdramas', true, true)).toBe(true);
        expect(showsPhoneTabBar('/', false, true)).toBe(false);
        expect(showsPhoneTabBar('/', true, false)).toBe(false);
    });

    test('the bottom bar stays off full-screen detail routes, but follows the Crunchyroll page', () => {
        // The Crunchyroll section keeps the phone bar so Android users can
        // hop back to Netflix without a browser back button.
        expect(showsPhoneTabBar('/crunchyroll', true, true)).toBe(true);
        expect(showsPhoneTabBar('/movie/netflix-genre-1', true, true)).toBe(false);
        expect(showsPhoneTabBar('/switch-profile', true, true)).toBe(false);
    });
});
