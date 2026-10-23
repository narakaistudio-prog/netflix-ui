import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

    test('the bottom bar stays off the Crunchyroll page and full-screen detail routes', () => {
        // Crunchyroll brings its own bottom navigation, so the
        // Netflix bar must not cover it.
        expect(showsPhoneTabBar('/crunchyroll', true, true)).toBe(false);
        expect(showsPhoneTabBar('/movie/netflix-genre-1', true, true)).toBe(false);
        // Fake profile switcher aur admin screen ab exist nahi karte (owner: hata do).
        expect(existsSync(join(__dirname, '..', 'app', 'switch-profile.tsx'))).toBe(false);
        expect(existsSync(join(__dirname, '..', 'app', 'admin', 'index.tsx'))).toBe(false);
    });
});
