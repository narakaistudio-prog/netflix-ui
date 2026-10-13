/**
 * Poster art bundled with the app, keyed by catalog id.
 *
 * Catalog JSON references these via local:<id> imageUrl values so posters
 * always load from the app bundle — third-party poster hosts block hotlinking
 * and would render broken cards. The refresh script rewrites this map
 * whenever it downloads fresh poster art.
 */
import { Platform, ImageSourcePropType } from 'react-native';

export const LOCAL_POSTER_URIS: Record<string, string> = {
};

export const LOCAL_POSTERS: Record<string, ImageSourcePropType> = {
};

export function getLocalPoster(key?: string | number): any {
    if (!key) return undefined;
    const strKey = String(key).trim();
    const cleanKey = strKey.replace(/^local:/, '');

    if (Platform.OS === 'web') {
        const uri =
            LOCAL_POSTER_URIS[strKey] ||
            LOCAL_POSTER_URIS[cleanKey] ||
            LOCAL_POSTER_URIS['real-' + cleanKey] ||
            LOCAL_POSTER_URIS['movie-' + cleanKey] ||
            LOCAL_POSTER_URIS['tv-' + cleanKey] ||
            LOCAL_POSTER_URIS['billboard-' + cleanKey];
        if (uri) return { uri };
    }

    return (
        LOCAL_POSTERS[strKey] ||
        LOCAL_POSTERS[cleanKey] ||
        LOCAL_POSTERS['real-' + cleanKey] ||
        LOCAL_POSTERS['movie-' + cleanKey] ||
        LOCAL_POSTERS['tv-' + cleanKey] ||
        LOCAL_POSTERS['billboard-' + cleanKey]
    );
}
