import { getLocalPoster, LOCAL_POSTER_URIS } from '../assets/posters';

test('web resolves local posters through index.web.ts without native image imports', () => {
    expect(require.resolve('../assets/posters')).toContain('index.web.ts');
    expect(typeof LOCAL_POSTER_URIS).toBe('object');
    expect(getLocalPoster()).toBeUndefined();
    expect(getLocalPoster('a-poster-that-does-not-exist')).toBeUndefined();
});
