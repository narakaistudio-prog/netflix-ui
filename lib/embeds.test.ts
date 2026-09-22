import {
    buildEmbedUrl,
    extractImdbId,
    detectProviderFromUrl,
    validateCustomTemplate,
    buildDownloadUrl,
    buildNhdSubtitlesUrl,
    DEFAULT_NXSHA_MOVIE,
    DEFAULT_NXSHA_TV,
    DEFAULT_NHD_MOVIE,
    DEFAULT_NHD_TV,
} from './embeds';

describe('extractImdbId', () => {
    it('extracts a tt-id from plain text', () => {
        expect(extractImdbId('See https://imdb.com/title/tt1375666/')).toBe('tt1375666');
    });
    it('matches 7-10 digit tt-ids', () => {
        expect(extractImdbId('tt1234567')).toBe('tt1234567');
        expect(extractImdbId('tt0076759')).toBe('tt0076759');
    });
    it('returns null for garbage / too short / no tt', () => {
        expect(extractImdbId(null)).toBeNull();
        expect(extractImdbId('')).toBeNull();
        expect(extractImdbId('tt123')).toBeNull();
        expect(extractImdbId('nope')).toBeNull();
    });
    it('lowercases the id', () => {
        expect(extractImdbId('TT1375666')).toBe('tt1375666');
    });
});

describe('detectProviderFromUrl', () => {
    it('detects nxsha main & mirror', () => {
        expect(detectProviderFromUrl('https://nxsha.space/embed/movie/tt1')).toBe('nxsha');
        expect(detectProviderFromUrl('https://web.nxsha.app/embed/tv/1/1/1')).toBe('nxsha');
    });
    it('detects nhd main & mirror', () => {
        expect(detectProviderFromUrl('https://nhdapi.com/movie/tt1')).toBe('nhd');
        expect(detectProviderFromUrl('https://nhdapi.st/tv/1/1/1')).toBe('nhd');
    });
    it('falls back to custom / null for unknowns', () => {
        expect(detectProviderFromUrl('https://example.com/embed?id=1')).toBe('custom');
        expect(detectProviderFromUrl('not a url')).toBeNull();
        expect(detectProviderFromUrl('')).toBeNull();
    });
});

describe('validateCustomTemplate', () => {
    it('requires {id}', () => {
        expect(validateCustomTemplate('https://x.com/movie', 'movie').ok).toBe(false);
        expect(validateCustomTemplate('https://x.com/movie/{id}', 'movie').ok).toBe(true);
    });
    it('requires {s} and {e} for tv', () => {
        expect(validateCustomTemplate('https://x.com/tv/{id}/{e}', 'tv').ok).toBe(false);
        expect(validateCustomTemplate('https://x.com/tv/{id}/{s}/{e}', 'tv').ok).toBe(true);
    });
    it('rejects non-URLs', () => {
        expect(validateCustomTemplate('javascript:alert(1)', 'movie').ok).toBe(false);
    });
});

describe('buildEmbedUrl', () => {
    it('builds default nxsha movie URL using imdb id when present', () => {
        const url = buildEmbedUrl('nxsha', 'movie', { imdbId: 'tt1375666' });
        expect(url).toContain('nxsha.space/embed/movie/tt1375666');
        expect(url).toContain('server=GbruHindi');
        expect(url).toContain('lang=hi');
        expect(url).toContain('sub=hi');
        expect(url).toContain('color=netflix');
        expect(url).toContain('disable_app_ad=true');
        expect(url).toContain('disable_dl_button=true');
        // NOT strict by default
        expect(url).not.toContain('one_server=true');
    });

    it('falls back to tmdb id when no imdb', () => {
        const url = buildEmbedUrl('nxsha', 'movie', { tmdbId: 12345 });
        expect(url).toContain('/embed/movie/12345');
    });

    it('builds nxsha tv URL with season/episode', () => {
        const url = buildEmbedUrl('nxsha', 'tv', { tmdbId: 123, season: 2, episode: 5 });
        expect(url).toContain('/embed/tv/123/2/5');
    });

    it('appends one_server=true when strictHindi is on for nxsha', () => {
        const url = buildEmbedUrl('nxsha', 'movie', { tmdbId: 1, strictHindi: true });
        expect(url).toContain('one_server=true');
    });

    it('does NOT add one_server to NHD', () => {
        const url = buildEmbedUrl('nhd', 'movie', { tmdbId: 1, strictHindi: true });
        expect(url).not.toContain('one_server');
    });

    it('builds nhd movie / tv URLs', () => {
        expect(buildEmbedUrl('nhd', 'movie', { imdbId: 'tt1234567' })).toBe(
            'https://nhdapi.com/movie/tt1234567',
        );
        expect(buildEmbedUrl('nhd', 'tv', { tmdbId: 99, season: 1, episode: 1 })).toBe(
            'https://nhdapi.com/tv/99/1/1',
        );
    });

    it('uses manual embed_url verbatim', () => {
        const manual = 'https://example.com/play?x=1';
        expect(
            buildEmbedUrl('nxsha', 'movie', { tmdbId: 1, embed_url: manual }),
        ).toBe(manual);
    });

    it('supports template overrides', () => {
        const url = buildEmbedUrl(
            'nxsha',
            'movie',
            { tmdbId: 1 },
            { movieTemplate: 'https://web.nxsha.app/embed/movie/{id}?server=Neon' },
        );
        expect(url).toBe('https://web.nxsha.app/embed/movie/1?server=Neon');
    });

    it('uses {tmdb} placeholder when present in custom template', () => {
        const url = buildEmbedUrl(
            'custom',
            'movie',
            { tmdbId: 555, imdbId: 'tt0076759' },
            { movieTemplate: 'https://x.com/m/{tmdb}?imdb={id}' },
        );
        expect(url).toContain('/m/555?imdb=tt0076759');
    });

    it('throws when no id is available', () => {
        expect(() => buildEmbedUrl('nhd', 'movie', {})).toThrow();
    });

    it('throws on invalid tv season/episode', () => {
        expect(() => buildEmbedUrl('nhd', 'tv', { tmdbId: 1, season: 0, episode: 1 })).toThrow();
    });

    it('matches the default templates documented in the brief', () => {
        expect(DEFAULT_NXSHA_MOVIE).toContain('server=GbruHindi');
        expect(DEFAULT_NXSHA_TV).toContain('/embed/tv/{id}/{s}/{e}');
        expect(DEFAULT_NHD_MOVIE).toBe('https://nhdapi.com/movie/{id}');
        expect(DEFAULT_NHD_TV).toBe('https://nhdapi.com/tv/{id}/{s}/{e}');
    });
});

describe('helpers', () => {
    it('builds download URLs', () => {
        expect(buildDownloadUrl('nxsha', 'movie', { tmdbId: 123 })).toBe(
            'https://nxsha.space/dl/movie/123',
        );
        expect(buildDownloadUrl('nhd', 'tv', { tmdbId: 1, season: 2, episode: 3 })).toBe(
            'https://nhdapi.com/dl/tv/1/2/3',
        );
    });

    it('builds NHD subtitles urls', () => {
        expect(buildNhdSubtitlesUrl('movie', 555)).toBe(
            'https://nhdapi.com/api/subtitles?mediaType=movie&tmdbId=555',
        );
        expect(buildNhdSubtitlesUrl('tv', 555, 1, 2)).toBe(
            'https://nhdapi.com/api/subtitles?mediaType=tv&tmdbId=555&season=1&episode=2',
        );
    });
});
