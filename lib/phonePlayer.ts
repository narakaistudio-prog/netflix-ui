/**
 * Phone par player: seedha landscape + poora screen.
 * ==================================================
 * Owner: "phone me play dabate hi landscape ho jaye" aur "phone ke liye apna
 * full screen button hata do — player ka apna hi rehne do".
 *
 * Phone browsers me do tarah ki duniya hai:
 *
 *   1. **Android Chrome** — `enterPlayerFullscreen()` (lib/playerFullscreen)
 *      poore player ko fullscreen karta hai aur phir `screen.orientation.lock`
 *      se landscape pin kar deta hai. Wahan window khud hi landscape ho jati
 *      hai, isliye kuch aur nahi karna padta.
 *   2. **iOS Safari / koi bhi browser jahan fullscreen na mile** — `div` par
 *      Fullscreen API hi nahi hota (ya lock fail ho jata hai). Wahan player ko
 *      CSS se 90° ghuma dete hain: layout ka dabba `(viewportHeight ×
 *      viewportWidth)` hota hai aur rotate 90° se wo theek screen par fit ho
 *      jata hai. User ko wahi "landscape player" dikhta hai.
 *
 * Rotation tabhi jab phone **portrait** ho — agar user phone ghuma kar
 * landscape kar de (ya Android ka fullscreen+lock chal jaye) to window khud
 * `width > height` ho jati hai aur rotation apne aap band ho jata hai
 * (double-rotate kabhi nahi).
 *
 * Sab pure functions — test me window/navigator chhedne ki zaroorat nahi.
 */

/** Mobile browser ka user agent? (desktop aur TV: false) */
export function isPhoneUserAgent(ua: string | undefined | null): boolean {
    if (!ua) return false;
    return /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua);
}

export interface LandscapeBox {
    /** Rotated dabbe ki layout chaudai (screen ki unchai). */
    width: number;
    /** Rotated dabbe ki layout unchai (screen ki chaudai). */
    height: number;
    /** Rotation ke baad dabba screen par fit karne ke liye shift. */
    translateX: number;
    translateY: number;
    rotate: '90deg';
}

/**
 * Portrait phone par player ko landscape dikhane wala dabba, warna `null`.
 *
 * `width`/`height` viewport ke hain. Rotation centre ke around hoti hai, isliye
 * `(H−W)/2` aur `(W−H)/2` ka shift lagta hai — CSS me
 * `translateX(..) translateY(..) rotate(90deg)`.
 */
export function landscapeBox(width: number, height: number): LandscapeBox | null {
    if (!width || !height) return null;
    // Landscape (ya square) → kuch nahi.
    if (width >= height) return null;
    return {
        width: height,
        height: width,
        translateX: (width - height) / 2,
        translateY: (height - width) / 2,
        rotate: '90deg',
    };
}

/**
 * Browser ka asli viewport (CSS px). RN ka `useWindowDimensions` jsdom me 0
 * deta hai aur kuch browsers me `visualViewport` (zoom/URL bar) ki wajah se
 * hilti rehti hai — ghuma hua player exactly isi naap par baithta hai.
 */
export function readViewport(): { width: number; height: number } {
    if (typeof window === 'undefined') return { width: 0, height: 0 };
    return { width: window.innerWidth || 0, height: window.innerHeight || 0 };
}
