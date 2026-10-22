// Server 2 (M2Box) ka pure hissa: link parse, canonical watch-page URL, aur
// "sirf player" crop ka naap-tol. DOM ka kaam moviebox-server.test.tsx me hai.
import {
    buildMovieboxFrameProxyUrl,
    buildMovieboxPageUrl,
    getMovieboxCrop,
    isMovieboxUrl,
    MOVIEBOX_PHONE_BAR_HEIGHT,
    MOVIEBOX_PHONE_BOX_ASPECT,
    getMovieboxPhoneBoxHeight,
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
        // sirf player mode: 968 × 545 = 16:9
        expect(MOVIEBOX_STAGE_PLAYER_WIDTH).toBe(968);
        expect(MOVIEBOX_STAGE_PLAYER_HEIGHT).toBe(545);
        const ratio = MOVIEBOX_STAGE_PLAYER_WIDTH / MOVIEBOX_STAGE_PLAYER_HEIGHT;
        expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.02);
    });

    it('shows only the player — Resources panel bahar reh jata hai', () => {
        const crop = getMovieboxCrop(1440, 900);
        expect(crop.stacked).toBe(false);
        expect(crop.stageWidth).toBe(1536);
        // naapa gaya: video stage-x 128.6 → 1088.6 (960 wide), panel wahin se
        expect(crop.stageVisibleWidth).toBe(968);
        expect(crop.cropLeft + crop.stageVisibleWidth).toBeLessThanOrEqual(1089);
        expect(crop.cropTop).toBe(117);
        expect(crop.cropLeft).toBe(120);
        // title strip stage-y 663 se — window 662 par band
        expect(crop.stageVisibleHeight).toBe(545);
        expect(crop.scale).toBeCloseTo(1440 / 968, 6);
        expect(crop.frameWidth).toBe(1440);
        expect(crop.height).toBe(811);
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
        expect(crop.frameWidth).toBe(533);
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

    it('keepa player-only crop in a small window too (PC par window chhoti ho)', () => {
        // Chrome window 900px se chhoti hui to pehle site ka POORA mobile page
        // dikhne lagta tha (Refresh/Download/Prev/Next, title, description,
        // bottom nav). Ab har width par wahi stage crop chalta hai.
        const crop = getMovieboxCrop(420, 900);
        expect(crop.stacked).toBe(false);
        expect(crop.stageWidth).toBe(1536);
        expect(crop.cropLeft).toBe(120);
        expect(crop.cropTop).toBe(117);
        expect(crop.stageVisibleWidth).toBe(968);
        expect(crop.stageVisibleHeight).toBe(545);
        expect(crop.frameWidth).toBe(420);
        expect(crop.scale).toBeCloseTo(420 / 968, 6);
        expect(crop.height).toBe(Math.round(545 * (420 / 968)));
    });

    it('phone par site ka mobile layout — native scale (bade touch controls)', () => {
        // owner: "player ke andar ke control bahut chote hai" — 1536 stage ko
        // phone par chhota karne se site ke controls ~8px reh jate the.
        const crop = getMovieboxCrop(390, 244, { phone: true });
        expect(crop.stageWidth).toBe(390);
        // native ke barabar (contain ki wajah se sub-pixel neeche hi rehta hai)
        expect(crop.scale).toBeCloseTo(1, 2);
        expect(crop.cropLeft).toBe(0);
        // header 104 + 4px andar
        expect(crop.cropTop).toBe(108);
        const playerW = 390 - 24;
        // video (16:9) + site ka control bar — bar aadha na kate.
        const contentHeight = (playerW * 9) / 16 + MOVIEBOX_PHONE_BAR_HEIGHT - 4;
        expect(crop.height).toBeGreaterThanOrEqual(Math.round(contentHeight) - 1);
        expect(crop.stacked).toBe(false);
        // Site ki fixed bottom nav viewport ke neeche — player ke upar nahi.
        expect(crop.viewportHeight).toBeGreaterThan(crop.height + crop.cropTop + 200);
    });

    /**
     * Owner: "moviebox ke player ka ratio wahi humesha ke liye fix rahe, kabhi
     * na badle". Ye test hi wo lock hai — phone par har chaudai/unchai par
     * dabba exactly MOVIEBOX_PHONE_BOX_ASPECT (16:10) hi rahega.
     */
    it('phone player ka ratio PERMANENT lock — har screen par 16:10', () => {
        const widths = [320, 360, 375, 390, 414, 430, 479];
        const heights = [480, 568, 640, 667, 740, 844, 932, 1200];
        for (const width of widths) {
            for (const height of heights) {
                const crop = getMovieboxCrop(width, height, { phone: true });
                const ratio = crop.frameWidth / crop.height;
                expect(Math.abs(ratio - MOVIEBOX_PHONE_BOX_ASPECT)).toBeLessThan(
                    MOVIEBOX_PHONE_BOX_ASPECT * 0.005,
                );
                // Site ka content (header ke baad) poora dabbe me fit hota hai —
                // na video katta hai, na site ka control bar.
                const contentHeight = ((width - 24) * 9) / 16 + MOVIEBOX_PHONE_BAR_HEIGHT - 4;
                // contain: content scale hokar dabbe me poora baithta hai
                expect(contentHeight * crop.scale).toBeLessThanOrEqual(crop.height + 1);
                expect(crop.stageVisibleHeight).toBeGreaterThanOrEqual(contentHeight - 1);
                // Site ka header kabhi player ke upar nahi.
                expect(crop.cropTop).toBe(108);
            }
        }
    });

    it('phone par host ki unchai badalne se ratio nahi badalta', () => {
        const tall = getMovieboxCrop(390, 844, { phone: true });
        const medium = getMovieboxCrop(390, 400, { phone: true });
        expect(tall.frameWidth).toBe(medium.frameWidth);
        expect(tall.height).toBe(medium.height);
        expect(tall.height).toBe(getMovieboxPhoneBoxHeight(390));
        expect(getMovieboxPhoneBoxHeight(390) / 390).toBeCloseTo(1 / MOVIEBOX_PHONE_BOX_ASPECT, 2);
    });

    it('phone par dabbe se chhota host — poora dabba chhota hota hai, shape wahi', () => {
        const short = getMovieboxCrop(390, 200, { phone: true });
        expect(short.frameWidth).toBeLessThan(390);
        expect(short.height).toBe(200);
        expect(short.frameWidth / short.height).toBeCloseTo(MOVIEBOX_PHONE_BOX_ASPECT, 2);
    });

    it('landscape fullscreen par wahi desktop stage crop (mobile nav nahi)', () => {
        // Fullscreen me phone ka dabba ghuma hua hota hai (chaudai ~844) —
        // wahan stage scale hi bade controls deta hai, mobile layout nahi.
        const crop = getMovieboxCrop(844, 390, { phone: true });
        expect(crop.stageWidth).toBe(1536);
        expect(crop.viewportHeight).toBeUndefined();
    });

    it('keeps the site mobile layout only for the search page', () => {
        const crop = getMovieboxCrop(420, 900, { resources: true });
        expect(crop.stacked).toBe(true);
        expect(crop.scale).toBe(1);
        expect(crop.cropLeft).toBe(0);
        expect(crop.stageWidth).toBe(420);
        expect(crop.stageVisibleHeight).toBe(Math.round((396 * 9) / 16 + 16 + 320));
        expect(crop.cropTop).toBe(104);
    });

    it('steps the search-page top crop down with the width', () => {
        expect(getMovieboxCrop(800, 800, { resources: true }).cropTop).toBe(112);
        expect(getMovieboxCrop(700, 800, { resources: true }).cropTop).toBe(108);
        expect(getMovieboxCrop(400, 800, { resources: true }).cropTop).toBe(104);
    });

    it('falls back to the desktop player box before layout is measured', () => {
        const crop = getMovieboxCrop(0, 0);
        expect(crop.stacked).toBe(false);
        expect(crop.frameWidth).toBe(1416);
        expect(crop.scale).toBeCloseTo(1416 / 968, 6);
        expect(crop.height).toBe(Math.round(545 * (1416 / 968)));
    });

    it('player mode never goes stacked, at any width', () => {
        for (const width of [320, 420, 760, 899, 900, 1440, 1920]) {
            expect(getMovieboxCrop(width, 800).stacked).toBe(false);
        }
        // sirf search page hi 900px par switch karta hai
        expect(getMovieboxCrop(900, 800, { resources: true }).stacked).toBe(false);
        expect(getMovieboxCrop(899, 800, { resources: true }).stacked).toBe(true);
    });
});

describe('buildMovieboxFrameProxyUrl', () => {
    it('encodes the watch page for /api/moviebox-frame', () => {
        expect(buildMovieboxFrameProxyUrl(PAGE)).toBe(
            `/api/moviebox-frame?url=${encodeURIComponent(PAGE)}`,
        );
    });
});
