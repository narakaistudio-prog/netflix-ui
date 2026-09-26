/**
 * Anime Stream Service - Dedicated AnimeSalt (Hindi Dub) & AutoEmbed Resolver
 *
 * Integrates India's top Hindi Dub Anime platform (AnimeSalt) for 100% genuine Hindi audio
 * alongside AutoEmbed for high-speed Western streaming.
 */

export interface AnimeAudioTrack {
    id: 'hindi' | 'japanese' | 'english';
    label: string;
    lang: string;
    flag: string;
    streamUrl: string;
    embedUrl: string;
    format: 'embed';
}

export interface AnimeServerSource {
    id: string;
    name: string;
    badge: string;
    url: string;
    isHindiDub?: boolean;
}

export interface AnimeSubtitleTrack {
    id: string;
    label: string;
    lang: string;
    src?: string;
    default?: boolean;
}

export interface AnimeStreamSource {
    title: string;
    animeTitle: string;
    tmdbId: string;
    imdbId?: string;
    anilistId: string;
    season: number;
    episode: number;
    episodeTitle?: string;
    mediaType: 'movie' | 'tv';
    crunchyrollOfficialUrl: string;
    servers: AnimeServerSource[];
    audioTracks: AnimeAudioTrack[];
    subtitles: AnimeSubtitleTrack[];
    qualities: { label: string; url: string; resolution: string }[];
    fallbackStreamUrl: string;
    currentStreamUrl: string;
}

export interface AnimeMeta {
    tmdbId: string;
    imdbId?: string;
    anilistId: string;
    mediaType: 'movie' | 'tv';
    saltSlug: string;
    crSlug?: string;
}

/**
 * Curated AniList + TMDB + AnimeSalt Slugs for All Top Anime
 */
export const ANIME_METADATA_MAP: Record<string, AnimeMeta> = {
    'jujutsu kaisen': {
        tmdbId: '95479',
        imdbId: 'tt12343534',
        anilistId: '113415',
        mediaType: 'tv',
        saltSlug: 'jujutsu-kaisen',
        crSlug: 'jujutsu-kaisen',
    },
    'demon slayer': {
        tmdbId: '85937',
        imdbId: 'tt9335498',
        anilistId: '101922',
        mediaType: 'tv',
        saltSlug: 'demon-slayer-kimetsu-no-yaiba',
        crSlug: 'demon-slayer-kimetsu-no-yaiba',
    },
    'kimetsu no yaiba': {
        tmdbId: '85937',
        imdbId: 'tt9335498',
        anilistId: '101922',
        mediaType: 'tv',
        saltSlug: 'demon-slayer-kimetsu-no-yaiba',
        crSlug: 'demon-slayer-kimetsu-no-yaiba',
    },
    'solo leveling': {
        tmdbId: '209867',
        imdbId: 'tt21209876',
        anilistId: '151807',
        mediaType: 'tv',
        saltSlug: 'solo-leveling',
        crSlug: 'solo-leveling',
    },
    'naruto': {
        tmdbId: '46260',
        imdbId: 'tt0409591',
        anilistId: '20',
        mediaType: 'tv',
        saltSlug: 'naruto',
        crSlug: 'naruto',
    },
    'naruto shippuden': {
        tmdbId: '31910',
        imdbId: 'tt0988824',
        anilistId: '1735',
        mediaType: 'tv',
        saltSlug: 'naruto-shippuden',
        crSlug: 'naruto-shippuden',
    },
    'one piece': {
        tmdbId: '37854',
        imdbId: 'tt0388629',
        anilistId: '21',
        mediaType: 'tv',
        saltSlug: 'one-piece',
        crSlug: 'one-piece',
    },
    'attack on titan': {
        tmdbId: '1429',
        imdbId: 'tt2560140',
        anilistId: '16498',
        mediaType: 'tv',
        saltSlug: 'attack-on-titan',
        crSlug: 'attack-on-titan',
    },
    'shingeki no kyojin': {
        tmdbId: '1429',
        imdbId: 'tt2560140',
        anilistId: '16498',
        mediaType: 'tv',
        saltSlug: 'attack-on-titan',
        crSlug: 'attack-on-titan',
    },
    'death note': {
        tmdbId: '13916',
        imdbId: 'tt0877057',
        anilistId: '1535',
        mediaType: 'tv',
        saltSlug: 'death-note',
        crSlug: 'death-note',
    },
    'dragon ball super': {
        tmdbId: '62715',
        imdbId: 'tt4644488',
        anilistId: '21175',
        mediaType: 'tv',
        saltSlug: 'dragon-ball-super',
        crSlug: 'dragon-ball-super',
    },
    'dragon ball z': {
        tmdbId: '12971',
        imdbId: 'tt0214341',
        anilistId: '813',
        mediaType: 'tv',
        saltSlug: 'dragon-ball-z',
        crSlug: 'dragon-ball-z',
    },
    'chainsaw man': {
        tmdbId: '114410',
        imdbId: 'tt13616990',
        anilistId: '127230',
        mediaType: 'tv',
        saltSlug: 'chainsaw-man',
        crSlug: 'chainsaw-man',
    },
    'my hero academia': {
        tmdbId: '65930',
        imdbId: 'tt5626028',
        anilistId: '21459',
        mediaType: 'tv',
        saltSlug: 'my-hero-academia',
        crSlug: 'my-hero-academia',
    },
    'boku no hero academia': {
        tmdbId: '65930',
        imdbId: 'tt5626028',
        anilistId: '21459',
        mediaType: 'tv',
        saltSlug: 'my-hero-academia',
        crSlug: 'my-hero-academia',
    },
    'bleach': {
        tmdbId: '30984',
        imdbId: 'tt0434665',
        anilistId: '269',
        mediaType: 'tv',
        saltSlug: 'bleach',
        crSlug: 'bleach',
    },
    'bleach: thousand-year blood war': {
        tmdbId: '103540',
        imdbId: 'tt14995574',
        anilistId: '114446',
        mediaType: 'tv',
        saltSlug: 'bleach-thousand-year-blood-war',
        crSlug: 'bleach-thousand-year-blood-war',
    },
    'tokyo ghoul': {
        tmdbId: '61374',
        imdbId: 'tt3741634',
        anilistId: '20605',
        mediaType: 'tv',
        saltSlug: 'tokyo-ghoul',
        crSlug: 'tokyo-ghoul',
    },
    'spy x family': {
        tmdbId: '120089',
        imdbId: 'tt13706018',
        anilistId: '140960',
        mediaType: 'tv',
        saltSlug: 'spy-x-family',
        crSlug: 'spy-x-family',
    },
    'vinland saga': {
        tmdbId: '89108',
        imdbId: 'tt10233448',
        anilistId: '101348',
        mediaType: 'tv',
        saltSlug: 'vinland-saga',
        crSlug: 'vinland-saga',
    },
    'hunter x hunter': {
        tmdbId: '46298',
        imdbId: 'tt2098220',
        anilistId: '11061',
        mediaType: 'tv',
        saltSlug: 'hunter-x-hunter',
        crSlug: 'hunter-x-hunter',
    },
    'black clover': {
        tmdbId: '73223',
        imdbId: 'tt7441658',
        anilistId: '97940',
        mediaType: 'tv',
        saltSlug: 'black-clover',
        crSlug: 'black-clover',
    },
    'dr. stone': {
        tmdbId: '86031',
        imdbId: 'tt9679542',
        anilistId: '105333',
        mediaType: 'tv',
        saltSlug: 'dr-stone',
        crSlug: 'dr-stone',
    },
    'blue lock': {
        tmdbId: '136283',
        imdbId: 'tt15234190',
        anilistId: '137822',
        mediaType: 'tv',
        saltSlug: 'blue-lock',
        crSlug: 'blue-lock',
    },
    'wind breaker': {
        tmdbId: '241257',
        imdbId: 'tt27388708',
        anilistId: '163270',
        mediaType: 'tv',
        saltSlug: 'wind-breaker',
        crSlug: 'wind-breaker',
    },
    'kaiju no. 8': {
        tmdbId: '207347',
        imdbId: 'tt21611090',
        anilistId: '153288',
        mediaType: 'tv',
        saltSlug: 'kaiju-no-8',
        crSlug: 'kaiju-no-8',
    },
    'mashle': {
        tmdbId: '205324',
        imdbId: 'tt21213038',
        anilistId: '151801',
        mediaType: 'tv',
        saltSlug: 'mashle-magic-and-muscles',
        crSlug: 'mashle-magic-and-muscles',
    },
    'classroom of the elite': {
        tmdbId: '72636',
        imdbId: 'tt7024340',
        anilistId: '98659',
        mediaType: 'tv',
        saltSlug: 'classroom-of-the-elite',
        crSlug: 'classroom-of-the-elite',
    },
    'hell\'s paradise': {
        tmdbId: '117465',
        imdbId: 'tt14094364',
        anilistId: '128893',
        mediaType: 'tv',
        saltSlug: 'hells-paradise',
        crSlug: 'hells-paradise',
    },
    'jigokuraku': {
        tmdbId: '117465',
        imdbId: 'tt14094364',
        anilistId: '128893',
        mediaType: 'tv',
        saltSlug: 'hells-paradise',
        crSlug: 'hells-paradise',
    },
    'fullmetal alchemist: brotherhood': {
        tmdbId: '31911',
        imdbId: 'tt1355642',
        anilistId: '5114',
        mediaType: 'tv',
        saltSlug: 'fullmetal-alchemist-brotherhood',
        crSlug: 'fullmetal-alchemist-brotherhood',
    },
    'cyberpunk: edgerunners': {
        tmdbId: '105248',
        imdbId: 'tt12590266',
        anilistId: '120377',
        mediaType: 'tv',
        saltSlug: 'cyberpunk-edgerunners',
        crSlug: 'cyberpunk-edgerunners',
    },
    'sword art online': {
        tmdbId: '45782',
        imdbId: 'tt2250192',
        anilistId: '11757',
        mediaType: 'tv',
        saltSlug: 'sword-art-online',
        crSlug: 'sword-art-online',
    },
    'mob psycho 100': {
        tmdbId: '67070',
        imdbId: 'tt5897304',
        anilistId: '21507',
        mediaType: 'tv',
        saltSlug: 'mob-psycho-100',
        crSlug: 'mob-psycho-100',
    },
    'one punch man': {
        tmdbId: '63926',
        imdbId: 'tt4508902',
        anilistId: '21087',
        mediaType: 'tv',
        saltSlug: 'one-punch-man',
        crSlug: 'one-punch-man',
    },
    'overlord': {
        tmdbId: '64196',
        imdbId: 'tt5161082',
        anilistId: '20832',
        mediaType: 'tv',
        saltSlug: 'overlord',
        crSlug: 'overlord',
    },
    're:zero': {
        tmdbId: '65942',
        imdbId: 'tt5607616',
        anilistId: '21355',
        mediaType: 'tv',
        saltSlug: 're-zero-starting-life-in-another-world',
        crSlug: 're-zero-starting-life-in-another-world-',
    },
    'haikyu!!': {
        tmdbId: '60863',
        imdbId: 'tt3505030',
        anilistId: '20464',
        mediaType: 'tv',
        saltSlug: 'haikyu',
        crSlug: 'haikyu',
    },
    'jujutsu kaisen 0': {
        tmdbId: '810693',
        imdbId: 'tt14331144',
        anilistId: '131573',
        mediaType: 'movie',
        saltSlug: 'jujutsu-kaisen-0-movie',
        crSlug: 'jujutsu-kaisen-0',
    },
};

/**
 * Returns true if the title is identified as an Anime title
 */
export function isAnimeTitle(title?: string): boolean {
    if (!title) return false;
    const lower = title.toLowerCase().trim();
    for (const key of Object.keys(ANIME_METADATA_MAP)) {
        if (lower.includes(key) || key.includes(lower)) return true;
    }
    const animeKeywords = [
        'anime', 'shippuden', 'jujutsu', 'kaisen', 'kimetsu', 'yaiba', 'titan', 'bleach',
        'dragon ball', 'chainsaw', 'hero academia', 'tokyo ghoul', 'spy x family', 'vinland',
        'hunter x hunter', 'death note', 'boruto', 'black clover', 'dr. stone', 'blue lock',
        'mashle', 'kaiju', 'wind breaker', 'solo leveling', 'naruto', 'one piece',
    ];
    return animeKeywords.some(kw => lower.includes(kw));
}

/**
 * Resolves metadata (tmdbId, anilistId, mediaType, saltSlug) for a given title
 */
export function getAnimeMeta(title: string, explicitTmdbId?: string | number): AnimeMeta {
    if (explicitTmdbId) {
        const idStr = String(explicitTmdbId);
        for (const meta of Object.values(ANIME_METADATA_MAP)) {
            if (meta.tmdbId === idStr) return meta;
        }
    }

    const lower = title.toLowerCase().trim();
    for (const [key, meta] of Object.entries(ANIME_METADATA_MAP)) {
        if (lower.includes(key) || key.includes(lower)) {
            return meta;
        }
    }

    const fallbackSlug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    if (explicitTmdbId) {
        return {
            tmdbId: String(explicitTmdbId),
            anilistId: '113415',
            mediaType: 'tv',
            saltSlug: fallbackSlug || 'jujutsu-kaisen',
        };
    }

    return {
        tmdbId: '95479',
        imdbId: 'tt12343534',
        anilistId: '113415',
        mediaType: 'tv',
        saltSlug: 'jujutsu-kaisen',
        crSlug: 'jujutsu-kaisen',
    };
}

export function getAnimeTmdbId(title: string, explicitTmdbId?: string | number): { tmdbId: string; mediaType: 'movie' | 'tv'; crSlug?: string } {
    const meta = getAnimeMeta(title, explicitTmdbId);
    return { tmdbId: meta.tmdbId, mediaType: meta.mediaType, crSlug: meta.crSlug };
}

/**
 * Resolves AnimeSalt Hindi Dub & AutoEmbed Stream Sources
 */
export function resolveAnimeStream(
    title: string,
    season: number = 1,
    episode: number = 1,
    preferredAudio: 'hindi' | 'japanese' | 'english' = 'hindi',
    explicitTmdbId?: string | number,
): AnimeStreamSource {
    const meta = getAnimeMeta(title, explicitTmdbId);
    const { tmdbId, imdbId, anilistId, mediaType, crSlug, saltSlug } = meta;
    const s = Math.max(1, season);
    const e = Math.max(1, episode);

    const crunchyrollOfficialUrl = crSlug
        ? `https://www.crunchyroll.com/series/${crSlug}`
        : `https://www.crunchyroll.com/search?q=${encodeURIComponent(title)}`;

    // 1. AnimeSalt: India's dedicated Hindi, Tamil, Telugu & English Anime Network
    const animeSaltHindiUrl = `https://animesalt.me/tv/${saltSlug}/`;

    // 2. AutoEmbed.co: Fast Western 1080p stream
    const autoEmbedUrl = mediaType === 'movie'
        ? `https://autoembed.co/movie/tmdb/${tmdbId}`
        : `https://autoembed.co/tv/tmdb/${tmdbId}-${s}-${e}`;

    const servers: AnimeServerSource[] = [
        {
            id: 'animesalt_hindi',
            name: '🇮🇳 AnimeSalt (100% Hindi Dub • Multi-Audio)',
            badge: 'Hindi • Tamil • Telugu • English • Japanese',
            url: animeSaltHindiUrl,
            isHindiDub: true,
        },
        {
            id: 'autoembed',
            name: '⚡ AutoEmbed (Fast 1080p • English / Sub)',
            badge: '1080p Ultra HD • 0 Ads',
            url: autoEmbedUrl,
            isHindiDub: false,
        },
    ];

    const audioTracks: AnimeAudioTrack[] = [
        {
            id: 'hindi',
            label: 'Hindi Dub (🇮🇳 हिंदी)',
            lang: 'hi',
            flag: '🇮🇳',
            streamUrl: animeSaltHindiUrl,
            embedUrl: animeSaltHindiUrl,
            format: 'embed',
        },
        {
            id: 'japanese',
            label: 'Japanese Sub (🇯🇵 日本語)',
            lang: 'ja',
            flag: '🇯🇵',
            streamUrl: autoEmbedUrl,
            embedUrl: autoEmbedUrl,
            format: 'embed',
        },
        {
            id: 'english',
            label: 'English Dub (🇺🇸 English)',
            lang: 'en',
            flag: '🇺🇸',
            streamUrl: autoEmbedUrl,
            embedUrl: autoEmbedUrl,
            format: 'embed',
        },
    ];

    const subtitles: AnimeSubtitleTrack[] = [
        { id: 'hi', label: 'Hindi (हिंदी)', lang: 'hi', default: true },
        { id: 'en', label: 'English', lang: 'en' },
    ];

    return {
        title: `${title} - Episode ${e}`,
        animeTitle: title,
        tmdbId,
        imdbId,
        anilistId,
        season: s,
        episode: e,
        episodeTitle: `Episode ${e}`,
        mediaType,
        crunchyrollOfficialUrl,
        servers,
        audioTracks,
        subtitles,
        qualities: [
            { label: 'Auto (1080p)', url: animeSaltHindiUrl, resolution: '1080p' },
            { label: '720p HD', url: animeSaltHindiUrl, resolution: '720p' },
        ],
        fallbackStreamUrl: autoEmbedUrl,
        currentStreamUrl: animeSaltHindiUrl,
    };
}
