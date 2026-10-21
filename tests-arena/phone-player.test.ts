// @ts-nocheck — pure helpers: phone par landscape player.
import { isPhoneUserAgent, landscapeBox } from '../lib/phonePlayer';

describe('isPhoneUserAgent', () => {
    it('phone browsers ko pehchanta hai', () => {
        expect(isPhoneUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe(true);
        expect(isPhoneUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe(true);
        expect(isPhoneUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    });

    it('desktop / TV ko phone nahi maanta', () => {
        expect(isPhoneUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe(false);
        expect(isPhoneUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(false);
        expect(isPhoneUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36')).toBe(false);
        expect(isPhoneUserAgent(undefined)).toBe(false);
    });
});

describe('landscapeBox', () => {
    it('portrait phone par 90° ghuma hua dabba deta hai (poora screen)', () => {
        const box = landscapeBox(390, 844);
        expect(box).not.toBeNull();
        // layout dabba ulta (chaudai = screen ki unchai)
        expect(box!.width).toBe(844);
        expect(box!.height).toBe(390);
        expect(box!.rotate).toBe('90deg');
        // rotate ke baad theek screen par fit hone ka shift
        expect(box!.translateX).toBe((390 - 844) / 2);
        expect(box!.translateY).toBe((844 - 390) / 2);
    });

    it('landscape ya square me kuch nahi ghumata', () => {
        expect(landscapeBox(844, 390)).toBeNull();
        expect(landscapeBox(500, 500)).toBeNull();
        expect(landscapeBox(0, 844)).toBeNull();
    });
});
