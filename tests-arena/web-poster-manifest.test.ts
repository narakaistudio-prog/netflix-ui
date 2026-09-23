import { getLocalPoster, LOCAL_POSTER_URIS } from '../assets/posters';

test('web resolves local posters from URLs without importing native image assets', () => {
    expect(require.resolve('../assets/posters')).toContain('index.web.ts');
    const uri = '/assets/posters/catalog/billboard-jawan.jpg';
    expect(LOCAL_POSTER_URIS['local:billboard-jawan']).toBe(uri);
    expect(getLocalPoster('local:billboard-jawan')).toEqual({ uri });
    expect(getLocalPoster('billboard-jawan')).toEqual({ uri });
    expect(getLocalPoster('a-poster-that-does-not-exist')).toBeUndefined();
});
