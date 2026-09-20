/**
 * Poster art bundled with the app, keyed by catalog id.
 *
 * Catalog JSON references these via `local:<id>` imageUrl values so posters
 * always load from the app bundle — third-party poster hosts block hotlinking
 * and would render broken cards. `scripts/refresh-catalog.mjs` rewrites this
 * map whenever it downloads fresh poster art.
 */
export const LOCAL_POSTERS: Record<string, any> = {
    'fp-alpha': require('./fp-alpha.jpg'),
    'fp-best-of-the-best-2026': require('./fp-best-of-the-best-2026.jpg'),
    'fp-chumbak': require('./fp-chumbak.jpg'),
    'fp-crew-girl': require('./fp-crew-girl.jpg'),
    'fp-dhamaal-4': require('./fp-dhamaal-4.jpg'),
    'fp-fauda': require('./fp-fauda.jpg'),
    'fp-gandhari': require('./fp-gandhari.jpg'),
    'fp-gdn': require('./fp-gdn.jpg'),
    'fp-indias-got-latent': require('./fp-indias-got-latent.jpg'),
    'fp-irumudi': require('./fp-irumudi.jpg'),
    'fp-korean-kanakaraju': require('./fp-korean-kanakaraju.jpg'),
    'fp-lust-stories-3': require('./fp-lust-stories-3.jpg'),
    'fp-modha-rathri': require('./fp-modha-rathri.jpg'),
    'fp-monster-lizzie-borden': require('./fp-monster-lizzie-borden.jpg'),
    'fp-musafir-cafe': require('./fp-musafir-cafe.jpg'),
    'fp-operation-safed-sagar-the-untold-story-of-the-kargil-war': require('./fp-operation-safed-sagar-the-untold-story-of-the-kargil-war.jpg'),
    'fp-the-early-spring': require('./fp-the-early-spring.png'),
    'fp-the-gentlemen-2024': require('./fp-the-gentlemen-2024.jpg'),
    'fp-vishwanath-sons': require('./fp-vishwanath-sons.jpg'),
    'fp-zakir-khan-papa-yaar': require('./fp-zakir-khan-papa-yaar.jpg'),
};
