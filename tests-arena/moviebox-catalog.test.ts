// @ts-nocheck — Server 2: baked MovieBox links + resolve priority.
/**
 * Ye test do cheezein pin karta hai:
 *   1. `data/moviebox-links.json` (harvester ka output) app me theek padha jata hai
 *   2. link chunne ka order: row → baked catalog → browser me saved
 */
import {
    lookupMovieboxCatalog,
    movieboxCatalogEntry,
    movieboxCatalogSize,
} from '../lib/movieboxCatalog';
import {
    movieboxKeyForTitle,
    removeMovieboxLink,
    resolveMovieboxLink,
    saveMovieboxLink,
} from '../lib/movieboxLinks';

const MANDAADI_URL =
    'https://m2box.org/movies/mandaadi-hindi-qxUx1r3QHW4?id=4151920426815471968&type=/movie/detail&detailSe=&detailEp=&lang=en';

beforeEach(() => {
    localStorage.clear();
});

describe('baked catalog (data/moviebox-links.json)', () => {
    it('is bundled and non-empty', () => {
        expect(movieboxCatalogSize()).toBeGreaterThan(0);
    });

    it('finds a title by tmdb id', () => {
        const entry = movieboxCatalogEntry({ id: 'tudum-top10-india-mandaadi', tmdb_id: '1465943' });
        expect(entry).toBeTruthy();
        expect(entry!.url).toBe(MANDAADI_URL);
        expect(entry!.subjectId).toBe('4151920426815471968');
        expect(entry!.detailPath).toBe('mandaadi-hindi-qxUx1r3QHW4');
        expect(entry!.dub).toBe('hindi');
    });

    it('returns null for titles that were never matched', () => {
        expect(movieboxCatalogEntry({ tmdb_id: '999999999' })).toBeNull();
        expect(movieboxCatalogEntry(null)).toBeNull();
    });
});

describe('lookupMovieboxCatalog (pure)', () => {
    const links = {
        'tmdb:42': { url: MANDAADI_URL, subjectId: '4151920426815471968', detailPath: 'mandaadi-hindi-qxUx1r3QHW4' },
        'id:legacy-card-7': { url: MANDAADI_URL, subjectId: '4151920426815471968', detailPath: 'mandaadi-hindi-qxUx1r3QHW4' },
    };

    it('prefers the tmdb key', () => {
        expect(lookupMovieboxCatalog(links, { tmdb_id: 42, id: 'other' })!.url).toBe(MANDAADI_URL);
    });

    it('falls back to the card id (titles without a tmdb id)', () => {
        expect(lookupMovieboxCatalog(links, { id: 'legacy-card-7' })!.url).toBe(MANDAADI_URL);
    });

    it('ignores entries without a url', () => {
        expect(lookupMovieboxCatalog({ 'tmdb:7': { url: '' } }, { tmdb_id: 7 })).toBeNull();
    });
});

describe('resolveMovieboxLink priority', () => {
    const title = { id: 'tudum-top10-india-mandaadi', tmdb_id: '1465943', mediaType: 'movie' };

    it('uses the baked catalog link automatically (no paste needed)', () => {
        const hit = resolveMovieboxLink(title);
        expect(hit).toBeTruthy();
        expect(hit!.source).toBe('catalog');
        expect(hit!.link).toBe(MANDAADI_URL);
        // baked link M2Box ko PEHLA server nahi banata — Server 1 Nxsha hi rehta hai
        expect(hit!.fromTitle).toBe(true);
    });

    it('a link on the row wins over the baked one', () => {
        const rowUrl =
            'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en';
        const hit = resolveMovieboxLink({ ...title, embed_url: rowUrl });
        expect(hit!.source).toBe('row');
        expect(hit!.link).toBe(rowUrl);
    });

    it('treats a m2box link in videoUrl the same way', () => {
        const rowUrl = 'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848';
        expect(resolveMovieboxLink({ ...title, videoUrl: rowUrl })!.source).toBe('row');
    });

    it('the baked link wins over an older saved one', () => {
        const key = movieboxKeyForTitle(title);
        saveMovieboxLink(key, 'https://m2box.org/movies/old-entry-AbC123?id=1234567890');
        const hit = resolveMovieboxLink(title);
        expect(hit!.source).toBe('catalog');
        expect(hit!.link).toBe(MANDAADI_URL);
    });

    it('falls back to the saved link for titles missing from the catalog', () => {
        const other = { id: 'x', tmdb_id: '999999999', mediaType: 'movie' };
        const key = movieboxKeyForTitle(other);
        const saved = saveMovieboxLink(key, 'https://m2box.org/movies/custom-title-AbC123?id=1234567890', {
            proxy: true,
        });
        expect(saved).toBeTruthy();
        const hit = resolveMovieboxLink(other);
        expect(hit!.source).toBe('saved');
        expect(hit!.proxy).toBe(true);
        removeMovieboxLink(key);
    });

    it('returns null when nothing is known', () => {
        expect(resolveMovieboxLink({ id: 'nothing', tmdb_id: '999999998' })).toBeNull();
    });
});
