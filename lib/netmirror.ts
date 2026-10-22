/**
 * NetMirror (net77.cc) — "Other" server
 * ============================================================================
 * Owner: "netflix ke andar ek other karke server banao option aur wo other
 * server https://net77.cc/home iska rahega... ye embed nahi deta hai, ye
 * MovieBox se bhi zyada security me rehta hai... test bas Dhurandhar par."
 *
 * Sach jo humne site par check kiya:
 *   - net77.cc login ke peeche hai (`/home` bhi login page par redirect karta
 *     hai), aur page framing block karta hai — yani hamare app ke andar na
 *     iframe me khulega, na server-side proxy se (proxy me viewer ke cookies
 *     nahi jaate, to proxy ko login page hi milega).
 *   - Isliye "Other" server ka Play button unke **apne** button ka crop hai
 *     (owner ke screenshot se — `assets/netmirror/netmirror-play.png`), aur
 *     dabane par unki site new tab me khulti hai jahan user ka login chalta
 *     hai. Baaki app (details, server chips) barsaab same rehta hai.
 *
 * Test scope: owner ne bola "test bas Dhurandhar par karo" — isliye abhi ye
 * server sirf usi title par dikhta hai (`isNetmirrorTitle`). Baaki titles ke
 * liye kuch nahi badla.
 */

/** Server chip ka label — owner ka diya naam. */
export const NETMIRROR_SERVER_LABEL = 'Other';

/** NetMirror ka home (Dhurandhar abhi uska hero title hai). */
export const NETMIRROR_HOME_URL = 'https://net77.cc/home';

/**
 * Cropped button ka aspect ratio (asset: 316×106 = NetMirror ka asli 158×53
 * button, 2x par). Isse button ki width/height kabhi stretch nahi hoti.
 */
export const NETMIRROR_PLAY_ASPECT = 316 / 106;

/**
 * Title NetMirror wale test ke liye hai ya nahi.
 *
 * Owner: "ye test bas dhurandhar par karna" — isliye normalize karke sirf
 * "dhurandhar" match karte hain (case, punctuation, saal sab chalta hai).
 * Aage jab poore catalog ke liye kholna ho to bas yahan se restriction hatao.
 */
export function isNetmirrorTitle(title?: string | null): boolean {
    const normalized = String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (!normalized) return false;
    return normalized.includes('dhurandhar');
}
