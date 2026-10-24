// @ts-nocheck — MovieBox page URL ka `site` override (pure helper).
/**
 * `buildMovieboxPageUrl` kisi bhi MovieBox-family domain par wahi watch page
 * bana deta hai — sirf domain badalta hai, detailPath/subjectId/season/episode
 * wahi rehte hain. (Usi backend ke doosre mirror domain ke liye.)
 */
import { buildMovieboxPageUrl, MOVIEBOX_SITE } from '../lib/moviebox';

const LINK = 'https://m2box.org/movies/mandaadi-hindi-qxUx1r3QHW4?id=4151920426815471968&type=/movie/detail';

describe('buildMovieboxPageUrl — site override', () => {
    it('default m2box.org hi rehta hai', () => {
        const canonical = buildMovieboxPageUrl(LINK);
        expect(canonical).toContain(`${MOVIEBOX_SITE}/movies/`);
        expect(canonical).toContain('id=4151920426815471968');
    });

    it('doosra domain dene par wahi page us domain par banta hai', () => {
        const copy = buildMovieboxPageUrl(LINK, { site: 'https://m2box.co' });
        expect(copy).toContain('https://m2box.co/movies/');
        expect(copy.split('?')[0]).toBe(
            buildMovieboxPageUrl(LINK).split('?')[0].replace(MOVIEBOX_SITE, 'https://m2box.co'),
        );
    });

    it('episode override har domain par lagta hai', () => {
        const copy = buildMovieboxPageUrl(LINK, { site: 'https://m2box.co', se: 2, ep: 5 });
        expect(copy).toContain('detailSe=2');
        expect(copy).toContain('detailEp=5');
    });
});
