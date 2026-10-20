// Server 2 (M2Box) ka pure hissa: link parse, canonical watch-page URL, aur
// "sirf player" crop ka naap-tol. DOM ka kaam moviebox-server.test.tsx me hai.
import {
    buildMovieboxFrameProxyUrl,
    buildMovieboxPageUrl,
    getMovieboxCrop,
    isMovieboxUrl,
    MOVIEBOX_STAGE_CROP_LEFT,
    MOVIEBOX_STAGE_CROP_TOP,
    MOVIEBOX_STAGE_PLAYER_HEIGHT,
    MOVIEBOX_STAGE_PLAYER_WIDTH,
    MOVIEBOX_STAGE_VISIBLE_HEIGHT,
    MOVIEBOX_STAGE_WIDTH,
    parseMovieboxInput,
} from '../lib/moviebox';

/** Asli link jise guide me naapa gaya (My Demon [Hindi], 26 eps). */
const PAGE =
    'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en';

describe('parseMovieboxInput', () => {
    it('reads slug, subjectId, season and episode from a watch-page link', () => {
        expect(parseMovieboxInput(PAGE)).toMatchObject({
            detailPath: 'my-demon-hindi-SfaaEeePcfa',
            subjectId: '8598850449111924848',
        });
        const withEp = parseMovieboxInput(
            'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&detailSe=2&detailEp=7',
        );
        expect(withEp?.se).toBe(2);
        expect(withEp?.ep).toBe(7);
    });

    it('reads the rotated player-domain SPA link', () => {
        const ref = parseMovieboxInput(
            'https://mzfi.me/spa/videoPlayPage/movies/solo-leveling-hindi-AbC123?type=/movie/detail&id=1234567890&detailSe=1&detailEp=3',
        );
        expect(ref?.detailPath).toBe('solo-leveling-hindi-AbC123');
        expect(ref?.subjectId).toBe('1234567890');
        expect(ref?.se).toBe(1);
        expect(ref?.ep).toBe(3);
    });

    it('accepts a bare slug or a bare subject id', () => {
        expect(parseMovieboxInput('my-demon-hindi-SfaaEeePcfa')?.detailPath).toBe(
            'my-demon-hindi-SfaaEeePcfa',
        );
        expect(parseMovieboxInput('8598850449111924848')?.subjectId).toBe('8598850449111924848');
    });

    it('cleans up links copied from chat/HTML (&amp; and stray quotes)', () => {
        const messy = `"https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&amp;type=/movie/detail"`;
        expect(isMovieboxUrl(messy)).toBe(true);
        expect(parseMovieboxInput(messy)?.subjectId).toBe('8598850449111924848');
        expect(buildMovieboxPageUrl(messy)).toContain(
            '?id=8598850449111924848&type=/movie/detail',
        );
    });

    it('rejects garbage', () => {
        expect(parseMovieboxInput('')).toBeNull();
        expect(parseMovieboxInput(null)).toBeNull();
        expect(parseMovieboxInput('not a link')).toBeNull();
        expect(parseMovieboxInput('javascript:alert(1)')).toBeNull();
        expect(parseMovieboxInput('https://example.com/')).toBeNull();
    });
});

describe('isMovieboxUrl', () => {
    it('knows the known mirrors', () => {
        expect(isMovieboxUrl(PAGE)).toBe(true);
        expect(isMovieboxUrl('https://moviebox.ph/detail/my-demon-hindi-SfaaEeePcfa')).toBe(true);
        expect(isMovieboxUrl('https://www.m2box.co/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848')).toBe(
            true,
        );
    });

    it('knows a rotated player domain by its shape', () => {
        expect(isMovieboxUrl('https://mzfi.me/spa/videoPlayPage/movies/demo-hindi-AbC123?id=1234567890')).toBe(
            true,
        );
        expect(
            isMovieboxUrl('https://random-player.tld/movies/demo-hindi-AbC123?id=1234567890&type=/movie/detail'),
        ).toBe(true);
    });

    it('does not claim other sites', () => {
        expect(isMovieboxUrl('https://nxsha.space/embed/movie/tt1375666')).toBe(false);
        expect(isMovieboxUrl('https://example.com/movies/demo-hindi-AbC123')).toBe(false);
        expect(isMovieboxUrl('')).toBe(false);
    });
});

describe('buildMovieboxPageUrl', () => {
    it('builds the canonical m2box.org watch page', () => {
        expect(buildMovieboxPageUrl(PAGE)).toBe(
            'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en',
        );
    });

    it('lets the row season/episode win over the link', () => {
        const url = buildMovieboxPageUrl(PAGE, { se: 1, ep: 4 });
        expect(url).toContain('detailSe=1');
        expect(url).toContain('detailEp=4');
    });

    it('rewrites a mirror link onto the canonical site when the id is known', () => {
        expect(
            buildMovieboxPageUrl(
                'https://moviebox.ph/detail/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&detailSe=1&detailEp=2',
            ),
        ).toBe(
            'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=1&detailEp=2&lang=en',
        );
    });

    it('leaves a mirror link alone when the numeric id is missing', () => {
        expect(buildMovieboxPageUrl('https://moviebox.ph/detail/my-demon-hindi-SfaaEeePcfa')).toBe(
            'https://moviebox.ph/detail/my-demon-hindi-SfaaEeePcfa',
        );
    });

    it('refuses to frame anything that is not a MovieBox page', () => {
        expect(buildMovieboxPageUrl('https://example.com/watch/123')).toBeNull();
        expect(buildMovieboxPageUrl('')).toBeNull();
    });
});

describe('getMovieboxCrop', () => {
    it('keeps the measured crop constants', () => {
        expect(MOVIEBOX_STAGE_WIDTH).toBe(1536);
        expect(MOVIEBOX_STAGE_CROP_TOP).toBe(117);
        expect(MOVIEBOX_STAGE_CROP_LEFT).toBe(120);
        // poora page mode (sirf search frame)
        expect(MOVIEBOX_STAGE_VISIBLE_HEIGHT).toBe(545);
        // sirf player mode: 1064 × 600 ≈ 16:9
        expect(MOVIEBOX_STAGE_PLAYER_WIDTH).toBe(1064);
        expect(MOVIEBOX_STAGE_PLAYER_HEIGHT).toBe(600);
        const ratio = MOVIEBOX_STAGE_PLAYER_WIDTH / MOVIEBOX_STAGE_PLAYER_HEIGHT;
        expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.03);
    });

    it('shows only the player — Resources panel bahar reh jata hai', () => {
        const crop = getMovieboxCrop(1440, 900);
        expect(crop.stacked).toBe(false);
        expect(crop.stageWidth).toBe(1536);
        // naapa gaya: page 1416 = video 1060 + 4 + panel 352 (panel ~1190 se)
        expect(crop.stageVisibleWidth).toBe(1064);
        expect(crop.cropLeft + crop.stageVisibleWidth).toBeLessThanOrEqual(1189);
        expect(crop.cropTop).toBe(117);
        expect(crop.cropLeft).toBe(120);
        expect(crop.stageVisibleHeight).toBe(600);
        expect(crop.scale).toBeCloseTo(1440 / 1064, 6);
        expect(crop.frameWidth).toBe(1440);
        expect(crop.height).toBe(812);
    });

    it('keeps the whole 16:9 player at any desktop width', () => {
        for (const width of [960, 1100, 1280, 1440, 1920]) {
            const crop = getMovieboxCrop(width, 1200);
            expect(crop.frameWidth).toBe(width);
            expect(Math.abs(crop.height / crop.frameWidth - 9 / 16)).toBeLessThan(0.02);
        }
    });

    it('contain-fits a short host so the control bar is never cut', () => {
        const crop = getMovieboxCrop(1440, 300);
        expect(crop.height).toBe(300);
        expect(crop.frameWidth).toBe(532);
        expect(Math.abs(crop.height / crop.frameWidth - 9 / 16)).toBeLessThan(0.02);
    });

    it('keeps the full-page crop for the search frame', () => {
        const crop = getMovieboxCrop(1440, 900, { resources: true });
        expect(crop.stageVisibleWidth).toBe(1416);
        expect(crop.stageVisibleHeight).toBe(545);
        expect(crop.scale).toBeCloseTo(1440 / 1416, 6);
        expect(crop.frameWidth).toBe(1440);
        expect(crop.height).toBe(Math.round(545 * (1440 / 1416)));
    });

    it('switches to the stacked mobile layout below 900px', () => {
        const crop = getMovieboxCrop(420, 900);
        expect(crop.stacked).toBe(true);
        expect(crop.scale).toBe(1);
        expect(crop.cropLeft).toBe(0);
        expect(crop.stageWidth).toBe(420);
        // Mobile par side panel nahi hota: player (396×9/16) + 16 saans + grid
        expect(crop.stageVisibleHeight).toBe(Math.round((396 * 9) / 16 + 16 + 320));
        expect(crop.cropTop).toBe(104);
    });

    it('steps the mobile top crop down with the width', () => {
        expect(getMovieboxCrop(800, 800).cropTop).toBe(112);
        expect(getMovieboxCrop(700, 800).cropTop).toBe(108);
        expect(getMovieboxCrop(400, 800).cropTop).toBe(104);
    });

    it('falls back to the desktop player box before layout is measured', () => {
        const crop = getMovieboxCrop(0, 0);
        expect(crop.stacked).toBe(false);
        expect(crop.frameWidth).toBe(1416);
        expect(crop.scale).toBeCloseTo(1416 / 1064, 6);
        expect(crop.height).toBe(Math.round(600 * (1416 / 1064)));
    });

    it('desktop starts exactly at 900px', () => {
        expect(getMovieboxCrop(900, 800).stacked).toBe(false);
        expect(getMovieboxCrop(899, 800).stacked).toBe(true);
    });
});

describe('buildMovieboxFrameProxyUrl', () => {
    it('encodes the watch page for /api/moviebox-frame', () => {
        expect(buildMovieboxFrameProxyUrl(PAGE)).toBe(
            `/api/moviebox-frame?url=${encodeURIComponent(PAGE)}`,
        );
    });
});
