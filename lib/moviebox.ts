/**
 * MovieBox / M2Box — "Server 2" ka dimaag (pure helpers).
 * ==========================================================================
 * MovieBox koi official iframe embed (`/embed/...`) deta hi nahi. Jugaad
 * ye hai: uska POORA watch page ek iframe me kholo, aur dabbe ko is tarah
 * kaat lo ki screen par sirf player + episode list bache — site ka header,
 * sidebar, menu aur neeche wala title/rating sab frame ke bahar reh jaye.
 *
 * Is file me sirf pure hissa hai (link parse, canonical page URL, crop ka
 * naap-tol). Asli DOM kaam `components/MovieboxCroppedFrame.tsx` karta hai.
 *
 * Naap kahan se aaya (asli screenshots par pixel-naap, 20 Oct 2026):
 *   header/menu ka neeche kinara   ≈ 120  →  crop top 117
 *   player ka baayein kinara       ≈ 129  →  crop left 120
 *   player/panel ka neeche kinara  ≈ 654  →  visible height 545 (117 → 662)
 *   title/rating ki patti          ≈ 682  (isliye 662 par window band)
 *
 * ⚠️ Ye number IFRAME KE ANDAR liye gaye screenshot se naape gaye hain.
 * Browser tab me khuli m2box.org se mat naapna — wahan site ki left sidebar
 * khuli hoti hai (player 245 se shuru hota hai), iframe ke andar wo default
 * band rehti hai (player 129 se). Tab se naapne par play/sound wale button
 * kat jate hain.
 */

/** MovieBox ke jaane-maane frontend mirrors (layout ek hi jaisa). */
export const MOVIEBOX_HOSTS = [
    'm2box.org',
    'm2box.co',
    'm2box.app',
    'moviebox.ph',
    'movie-box.co',
    'movieboxonline.net',
    'movieboxhd.net',
    'moviebox.pk',
    'moviebox.ac',
    'officialmoviebox.com',
    'netnaija.film',
    'sflix.film',
    '123moviesfree.club',
    'h5.inmoviebox.com',
    'inmoviebox.com',
] as const;

/** Wo site jiske layout ke liye crop ke number naape gaye hain. */
export const MOVIEBOX_SITE = 'https://m2box.org';

/**
 * Desktop par iframe hamesha is FIXED chaudai par render hota hai ("stage").
 * 1536 isliye: is chaudai par site bilkul waisi khulti hai jaisi m2box.org
 * par dikhti hai — episode guide 5 column me chhote button ke saath. Kam
 * chaudai (1280) par guide 4 column ka bada banta hai, 26+ episodes hone par
 * panel player se lamba ho jata hai, site player ko kheench deti hai aur
 * controls window ke bahar chale jate hain.
 */
export const MOVIEBOX_STAGE_WIDTH = 1536;
/** Stage par upar se kata hissa (header + menu). */
export const MOVIEBOX_STAGE_CROP_TOP = 117;
/** Stage par baayein se kata hissa (site ki band sidebar + saans). */
export const MOVIEBOX_STAGE_CROP_LEFT = 120;
/** Stage par dikhne wala hissa: cropTop (117) se page-y 662 tak. */
export const MOVIEBOX_STAGE_VISIBLE_HEIGHT = 545;

/** Iframe sandbox — `allow-top-navigation` KABHI nahi (tab hijack). */
export const MOVIEBOX_FRAME_SANDBOX =
    'allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts';

/** Player ke buttons (fullscreen / autoplay / PiP) isi `allow` par chalte hain. */
export const MOVIEBOX_FRAME_ALLOW =
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share';

/** Server switcher me dikhne wala naam. */
export const MOVIEBOX_SERVER_LABEL = 'M2Box';

export interface MovieboxRef {
    /** Numeric subject id — watch page ke `?id=` wala lamba number. */
    subjectId?: string;
    /** Slug — URL path ka aakhri hissa (e.g. `my-demon-hindi-SfaaEeePcfa`). */
    detailPath?: string;
    /** Season (`detailSe=`), jab link me diya ho. */
    se?: number;
    /** Episode (`detailEp=`), jab link me diya ho. */
    ep?: number;
    /** Jis mirror host par link mila tha. */
    host?: string;
    /** Jaisa input mila waisa hi (debug ke liye). */
    raw: string;
}

export interface MovieboxCrop {
    /** Screen par dikhne wale dabbe ki chaudai (px). */
    frameWidth: number;
    /** Stage ke hisaab me upar se kata hissa (px). */
    cropTop: number;
    /** Stage ke hisaab me baayein se kata hissa (px). */
    cropLeft: number;
    /** Screen par dikhne wale dabbe ki unchai (px). */
    height: number;
    /** Chhoti chaudai par site episode list player ke NEECHE rakhti hai. */
    stacked: boolean;
    /** Iframe jis fixed chaudai par render hota hai. */
    stageWidth: number;
    /** Stage ko screen ke hisaab se kitna bada/chhota dikhana hai. */
    scale: number;
    /** Stage ke hisaab me dikhne wali chaudai (= stageWidth − cropLeft). */
    stageVisibleWidth: number;
    /** Stage ke hisaab me dikhne wala hissa (iframe ki height = ye + cropTop). */
    stageVisibleHeight: number;
}

const SUBJECT_ID_RE = /^\d{5,25}$/;
const DETAIL_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,160}$/;

export function isMovieboxSubjectId(value: string | null | undefined): boolean {
    return SUBJECT_ID_RE.test(String(value ?? '').trim());
}

export function isMovieboxDetailPath(value: string | null | undefined): boolean {
    return DETAIL_PATH_RE.test(String(value ?? '').trim());
}

function toPositiveInt(value: string | null | undefined): number | undefined {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : undefined;
}

/**
 * Koi bhi MovieBox-ish input todo: slug, subjectId, ya poora link.
 *
 * Samajhne wale roop:
 *   https://m2box.org/movies/<slug>?id=<subjectId>&type=/movie/detail&detailSe=&detailEp=&lang=en
 *   https://<player-domain>/spa/videoPlayPage/movies/<slug>?id=<subjectId>&detailSe=1&detailEp=2
 *   https://moviebox.ph/detail/<slug>
 *   <slug>            (bare detailPath)
 *   <subjectId>       (bare numeric id)
 */
/**
 * Chat/HTML se copy kiye link me `&amp;` aksar aa jata hai, aur aage-peeche
 * quotes/angle brackets bhi. Inhe saaf karo — warna `?id=` param hi nahi milta.
 */
export function cleanMovieboxInput(input: string | null | undefined): string {
    return String(input ?? '')
        .trim()
        .replace(/^[<"']+/, '')
        .replace(/[>"']+$/, '')
        .replace(/&amp;/gi, '&')
        .trim();
}

export function parseMovieboxInput(input: string | null | undefined): MovieboxRef | null {
    const raw = cleanMovieboxInput(input);
    if (!raw) return null;

    if (SUBJECT_ID_RE.test(raw)) return { subjectId: raw, raw };
    if (DETAIL_PATH_RE.test(raw) && /-/.test(raw)) return { detailPath: raw, raw };

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (!/^https?:$/i.test(url.protocol)) return null;

    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    let last = segments.length > 0 ? segments[segments.length - 1] : '';
    try {
        last = decodeURIComponent(last);
    } catch {
        // kharab %-encoding — raw segment hi rakho, regex aage dekh lega
    }

    const subjectIdParam =
        url.searchParams.get('id') ||
        url.searchParams.get('subjectId') ||
        url.searchParams.get('subject_id');
    const detailPathParam = url.searchParams.get('detailPath') || url.searchParams.get('detail_path');

    const ref: MovieboxRef = { host, raw };
    if (subjectIdParam && SUBJECT_ID_RE.test(subjectIdParam)) ref.subjectId = subjectIdParam;

    const detailPath =
        detailPathParam && DETAIL_PATH_RE.test(detailPathParam)
            ? detailPathParam
            : DETAIL_PATH_RE.test(last) && /-/.test(last)
            ? last
            : undefined;
    if (detailPath) ref.detailPath = detailPath;

    const se = toPositiveInt(
        url.searchParams.get('detailSe') ?? url.searchParams.get('se') ?? url.searchParams.get('season'),
    );
    const ep = toPositiveInt(
        url.searchParams.get('detailEp') ?? url.searchParams.get('ep') ?? url.searchParams.get('episode'),
    );
    if (se != null) ref.se = se;
    if (ep != null) ref.ep = ep;

    if (!ref.subjectId && !ref.detailPath) return null;
    return ref;
}

function hostLooksMoviebox(host: string): boolean {
    const h = host.toLowerCase();
    return (MOVIEBOX_HOSTS as readonly string[]).some(
        (known) => h === known || h.endsWith(`.${known}`),
    );
}

/**
 * True jab input MovieBox ki watch/detail page lagti hai.
 *
 * Jaane-maane mirrors ke alawa un rotated player domains ko bhi pakdo jinki
 * shakal player page jaisi hai (`/videoPlayPage/` ya `type=/movie/detail` +
 * numeric id + slug) — player domain har kuch hafton me badalta hai.
 */
export function isMovieboxUrl(input: string | null | undefined): boolean {
    const raw = cleanMovieboxInput(input);
    if (!/^https?:\/\//i.test(raw)) return false;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    const ref = parseMovieboxInput(raw);
    if (!ref?.detailPath && !ref?.subjectId) return false;
    if (hostLooksMoviebox(url.hostname)) return true;
    if (/videoPlayPage/i.test(url.pathname)) return true;
    return (
        url.searchParams.get('type') === '/movie/detail' &&
        isMovieboxSubjectId(url.searchParams.get('id')) &&
        Boolean(ref.detailPath)
    );
}

/**
 * MovieBox par search results ka page — aakhri fallback jab title ka watch page
 * hi na mile (MovieBox par wo title abhi nahi hai). Route site ke apne router
 * se liya gaya: `/en/web/searchResult` (slug ke `?keyword=`).
 */
export function buildMovieboxSearchUrl(keyword: string | null | undefined): string | null {
    const text = String(keyword ?? '').trim();
    if (!text) return null;
    return `${MOVIEBOX_SITE}/en/web/searchResult?keyword=${encodeURIComponent(text)}`;
}

/**
 * Canonical M2Box watch page URL:
 *
 *   https://m2box.org/movies/<slug>?id=<subjectId>&type=/movie/detail&detailSe=<s>&detailEp=<e>&lang=en
 *
 * `input` koi bhi m2box/moviebox link ho sakta hai (mirror SPA link bhi);
 * use parse karke canonical m2box.org page bana diya jata hai. Season/episode
 * opts link ke detailSe/detailEp par jeette hain; dono khali ho to site khud
 * pehla episode kholti hai.
 */
export function buildMovieboxPageUrl(
    input: string | null | undefined,
    opts: { se?: number; ep?: number; site?: string } = {},
): string | null {
    const raw = cleanMovieboxInput(input);
    const ref = parseMovieboxInput(raw);
    if (!ref?.detailPath || !ref?.subjectId) {
        // Sirf tab poora page kholo jab wo sach me MovieBox ka ho — kisi bhi
        // anjaan URL ko iframe me daalna bekar (aur khatarnak) hai.
        return isMovieboxUrl(raw) ? raw : null;
    }
    const site = String(opts.site || MOVIEBOX_SITE).replace(/\/+$/, '');
    const se = opts.se != null ? opts.se : ref.se;
    const ep = opts.ep != null ? opts.ep : ref.ep;
    return (
        `${site}/movies/${encodeURIComponent(ref.detailPath)}` +
        `?id=${encodeURIComponent(ref.subjectId)}&type=/movie/detail` +
        `&detailSe=${se != null ? se : ''}&detailEp=${ep != null ? ep : ''}&lang=en`
    );
}

/**
 * "Sirf Player" crop ka naap-tol.
 *
 * Desktop: iframe fixed stage chaudai par render hota hai, phir poori stage
 * `scale()` se screen ke hisaab se chhoti/badi hoti hai — isliye upar,
 * baayein aur neeche ke kaat har screen par ekdum ek jagah padte hain.
 *
 * Mobile (<900): site episode list player ke NEECHE rakhti hai, isliye stage
 * nahi banta. Iframe screen ki asli chaudai par khulta hai (scale = 1), upar
 * ka kaat thoda kam, aur unchai = player + saans + episode grid ki jagah.
 * Wahan andar scroll khula rehta hai (warna episodes tak pahunchenge kaise).
 */
export function getMovieboxCrop(outerWidth: number, outerHeight: number): MovieboxCrop {
    const w = outerWidth > 0 ? outerWidth : 1416;
    const stacked = w < 900;

    if (!stacked) {
        const stageVisibleWidth = MOVIEBOX_STAGE_WIDTH - MOVIEBOX_STAGE_CROP_LEFT;
        const scale = w / stageVisibleWidth;
        const wanted = MOVIEBOX_STAGE_VISIBLE_HEIGHT * scale;
        const height = outerHeight > 0 ? Math.min(wanted, outerHeight) : wanted;
        return {
            frameWidth: Math.round(w),
            cropTop: MOVIEBOX_STAGE_CROP_TOP,
            cropLeft: MOVIEBOX_STAGE_CROP_LEFT,
            height: Math.round(height),
            stacked,
            stageWidth: MOVIEBOX_STAGE_WIDTH,
            scale,
            stageVisibleWidth,
            stageVisibleHeight: MOVIEBOX_STAGE_VISIBLE_HEIGHT,
        };
    }

    const cropTop = w >= 768 ? 112 : w >= 480 ? 108 : 104;
    const playerW = Math.max(0, w - 24);
    const playerH = (playerW * 9) / 16;
    const wanted = playerH + 16 + 320;
    const height = outerHeight > 0 ? Math.min(wanted, outerHeight) : wanted;
    return {
        frameWidth: Math.round(w),
        cropTop,
        cropLeft: 0,
        height: Math.round(height),
        stacked,
        stageWidth: Math.round(w),
        scale: 1,
        stageVisibleWidth: Math.round(w),
        stageVisibleHeight: Math.round(wanted),
    };
}

/**
 * Hamare frame proxy ka URL (`api/moviebox-frame.mjs`).
 *
 * Pehla rasta hamesha seedha iframe hai. Jis din m2box `X-Frame-Options` /
 * CSP `frame-ancestors` laga de, frame khali aayega — us din ye proxy page ka
 * HTML hamare hi origin se deta hai (frame-rokne wale headers aage nahi
 * jate). Best-effort fallback hai, not the default.
 */
export function buildMovieboxFrameProxyUrl(pageUrl: string, base: string = '/api/moviebox-frame'): string {
    return `${base}?url=${encodeURIComponent(cleanMovieboxInput(pageUrl))}`;
}
