import {
    buildSeries,
    totalEpisodeCount,
    normalizeImdbId,
} from '@/services/seriesBuilder';
import {
    buildEmbedUrl,
    PROVIDERS,
    CUSTOM_PROVIDER_ID,
} from '@/services/embedProviders';
import { SeriesDraft } from '@/types/series';

const NXSHA = PROVIDERS.find(p => p.id === 'nxsha')!;
const NHD = PROVIDERS.find(p => p.id === 'nhd')!;

const baseDraft: SeriesDraft = {
    name: 'Test Series',
    imdbId: 'tt1234567',
    seasons: 2,
    episodesPerSeason: 3,
    providerId: 'nxsha',
};

describe('normalizeImdbId', () => {
    it('lower-cases and trims', () => {
        expect(normalizeImdbId('  TT1234567  ')).toBe('tt1234567');
    });
});

describe('buildSeries (no metadata)', () => {
    it('generates every episode embed URL by looping seasons x episodes', () => {
        const s = buildSeries(baseDraft);
        expect(s.seasons).toHaveLength(2);
        expect(s.seasons[0].episodes).toHaveLength(3);
        expect(s.seasons[1].episodes).toHaveLength(3);
        expect(totalEpisodeCount(s)).toBe(6);

        // Spot-check S2E2 (the exact proven production string).
        const s2e2 = s.seasons[1].episodes[1];
        expect(s2e2.embedUrl).toBe(
            buildEmbedUrl(NXSHA.template, { id: 'tt1234567', s: 2, e: 2 }),
        );
        expect(s2e2.embedUrl).toBe(
            'https://nxsha.space/embed/tv/tt1234567/2/2?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true',
        );
    });

    it('stores the lower-cased IMDb id and normalizes the name', () => {
        const s = buildSeries({ ...baseDraft, name: '  Spaced  Name  ' });
        expect(s.id).toBe('tt1234567');
        expect(s.imdbId).toBe('tt1234567');
        expect(s.name).toBe('Spaced  Name');
    });

    it('clamps out-of-range counts to safe values', () => {
        const s = buildSeries({ ...baseDraft, seasons: 0, episodesPerSeason: 0 });
        expect(s.seasons).toHaveLength(1);
        expect(s.seasons[0].episodes).toHaveLength(12);
    });

    it('uses the NHD template when that provider is selected', () => {
        const s = buildSeries({ ...baseDraft, providerId: 'nhd' });
        expect(s.seasons[0].episodes[0].embedUrl).toBe(
            'https://nhdapi.com/tv/tt1234567/1/1',
        );
    });
});

describe('buildSeries (custom template)', () => {
    it('uses the admin pasted template verbatim', () => {
        const tpl = 'https://web.nxsha.app/embed/tv/{id}/{s}/{e}?lang=hi';
        const s = buildSeries({ ...baseDraft, providerId: CUSTOM_PROVIDER_ID, template: tpl });
        expect(s.template).toBe(tpl);
        expect(s.seasons[0].episodes[0].embedUrl).toBe(
            'https://web.nxsha.app/embed/tv/tt1234567/1/1?lang=hi',
        );
    });
});

describe('buildSeries (with metadata)', () => {
    it('applies Jikan episode titles + thumbnails and MAL ids per season', () => {
        const s = buildSeries(baseDraft, {
            poster: 'https://poster',
            banner: 'https://banner',
            genres: ['Action', 'Drama'],
            year: '2020',
            seasons: [
                {
                    malId: 111,
                    name: 'Sousou no Frieren',
                    episodes: [
                        { number: 1, title: 'Arrival', thumbnail: 'https://t1' },
                        { number: 2, title: 'Departure', thumbnail: 'https://t2' },
                    ],
                },
                { malId: 222 },
            ],
        });

        // Season 1 uses Jikan episodes (2, not the admin's 3).
        expect(s.seasons[0].episodes).toHaveLength(2);
        expect(s.seasons[0].episodes[0].title).toBe('Arrival');
        expect(s.seasons[0].episodes[0].thumbnail).toBe('https://t1');
        expect(s.seasons[0].malId).toBe(111);
        expect(s.seasons[0].episodes[0].embedUrl).toBe(
            buildEmbedUrl(NXSHA.template, { id: 'tt1234567', s: 1, e: 1 }),
        );

        // Season 2 has no Jikan data -> falls back to admin count (3).
        expect(s.seasons[1].episodes).toHaveLength(3);
        expect(s.seasons[1].episodes[0].title).toBe('Episode 1');

        expect(s.poster).toBe('https://poster');
        expect(s.genres).toEqual(['Action', 'Drama']);
        expect(s.year).toBe('2020');
    });
});
