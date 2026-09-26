/**
 * Anime Stream Service - Multi-Server & Dedicated Hindi Dub Resolver
 *
 * AutoEmbed provides global English/Sub streams.
 * Nxsha (GbruHindi) and VidSrc provide dedicated Hindi Dubbed anime streams.
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
    crSlug?: string;
}

/**
 * Curated AniList + TMDB + IMDb metadata for top anime
 */
export const ANIME_METADATA_MAP: Record<string, AnimeMeta> = {
    'jujutsu kaisen': { tmdbId: '95479', imdbId: 'tt12343534', anilistId: '113415', mediaType: 'tv', crSlug: 'jujutsu-kaisen' },
    'demon slayer': { tmdbId: '85937', imdbId: 'tt9335498', anilistId: '101922', mediaType: 'tv', crSlug: 'demon-slayer-kimetsu-no-yaiba' },
    'kimetsu no yaiba': { tmdbId: '85937', imdbId: 'tt9335498', anilistId: '101922', mediaType: 'tv', crSlug: 'demon-slayer-kimetsu-no-yaiba' },
    'solo leveling': { tmdbId: '209867', imdbId: 'tt21209876', anilistId: '151807', mediaType: 'tv', crSlug: 'solo-leveling' },
    'naruto': { tmdbId: '46260', imdbId: 'tt0409591', anilistId: '20', mediaType: 'tv', crSlug: 'naruto' },
    'naruto shippuden': { tmdbId: '31910', imdbId: 'tt0988824', anilistId: '1735', mediaType: 'tv', crSlug: 'naruto-shippuden' },
    'one piece': { tmdbId: '37854', imdbId: 'tt0388629', anilistId: '21', mediaType: 'tv', crSlug: 'one-piece' },
    'attack on titan': { tmdbId: '1429', imdbId: 'tt2560140', anilistId: '16498', mediaType: 'tv', crSlug: 'attack-on-titan' },
    'shingeki no kyojin': { tmdbId: '1429', imdbId: 'tt2560140', anilistId: '16498', mediaType: 'tv', crSlug: 'attack-on-titan' },
    'death note': { tmdbId: '13916', imdbId: 'tt0877057', anilistId: '1535', mediaType: 'tv', crSlug: 'death-note' },
    'dragon ball super': { tmdbId: '62715', imdbId: 'tt4644488', anilistId: '21175', mediaType: 'tv', crSlug: 'dragon-ball-super' },
    'dragon ball z': { tmdbId: '12971', imdbId: 'tt0214341', anilistId: '813', mediaType: 'tv', crSlug: 'dragon-ball-z' },
    'chainsaw man': { tmdbId: '114410', imdbId: 'tt13616990', anilistId: '127230', mediaType: 'tv', crSlug: 'chainsaw-man' },
    'my hero academia': { tmdbId: '65930', imdbId: 'tt5626028', anilistId: '21459', mediaType: 'tv', crSlug: 'my-hero-academia' },
    'boku no hero academia': { tmdbId: '65930', imdbId: 'tt5626028', anilistId: '21459', mediaType: 'tv', crSlug: 'my-hero-academia' },
    'bleach': { tmdbId: '30984', imdbId: 'tt0434665', anilistId: '269', mediaType: 'tv', crSlug: 'bleach' },
    'bleach: thousand-year blood war': { tmdbId: '103540', imdbId: 'tt14995574', anilistId: '114446', mediaType: 'tv', crSlug: 'bleach-thousand-year-blood-war' },
    'tokyo ghoul': { tmdbId: '61374', imdbId: 'tt3741634', anilistId: '20605', mediaType: 'tv', crSlug: 'tokyo-ghoul' },
    'spy x family': { tmdbId: '120089', imdbId: 'tt13706018', anilistId: '140960', mediaType: 'tv', crSlug: 'spy-x-family' },
    'vinland saga': { tmdbId: '89108', imdbId: 'tt10233448', anilistId: '101348', mediaType: 'tv', crSlug: 'vinland-saga' },
    'hunter x hunter': { tmdbId: '46298', imdbId: 'tt2098220', anilistId: '11061', mediaType: 'tv', crSlug: 'hunter-x-hunter' },
    'black clover': { tmdbId: '73223', imdbId: 'tt7441658', anilistId: '97940', mediaType: 'tv', crSlug: 'black-clover' },
    'dr. stone': { tmdbId: '86031', imdbId: 'tt9679542', anilistId: '105333', mediaType: 'tv', crSlug: 'dr-stone' },
    'blue lock': { tmdbId: '136283', imdbId: 'tt15234190', anilistId: '137822', mediaType: 'tv', crSlug: 'blue-lock' },
    'wind breaker': { tmdbId: '241257', imdbId: 'tt27388708', anilistId: '163270', mediaType: 'tv', crSlug: 'wind-breaker' },
    'kaiju no. 8': { tmdbId: '207347', imdbId: 'tt21611090', anilistId: '153288', mediaType: 'tv', crSlug: 'kaiju-no-8' },
    'mashle': { tmdbId: '205324', imdbId: 'tt21213038', anilistId: '151801', mediaType: 'tv', crSlug: 'mashle-magic-and-muscles' },
    'classroom of the elite': { tmdbId: '72636', imdbId: 'tt7024340', anilistId: '98659', mediaType: 'tv', crSlug: 'classroom-of-the-elite' },
    'hell\'s paradise': { tmdbId: '117465', imdbId: 'tt14094364', anilistId: '128893', mediaType: 'tv', crSlug: 'hells-paradise' },
    'jigokuraku': { tmdbId: '117465', imdbId: 'tt14094364', anilistId: '128893', mediaType: 'tv', crSlug: 'hells-paradise' },
    'fullmetal alchemist: brotherhood': { tmdbId: '31911', imdbId: 'tt1355642', anilistId: '5114', mediaType: 'tv', crSlug: 'fullmetal-alchemist-brotherhood' },
    'cyberpunk: edgerunners': { tmdbId: '105248', imdbId: 'tt12590266', anilistId: '120377', mediaType: 'tv', crSlug: 'cyberpunk-edgerunners' },
    'sword art online': { tmdbId: '45782', imdbId: 'tt2250192', anilistId: '11757', mediaType: 'tv', crSlug: 'sword-art-online' },
    'mob psycho 100': { tmdbId: '67070', imdbId: 'tt5897304', anilistId: '21507', mediaType: 'tv', crSlug: 'mob-psycho-100' },
    'one punch man': { tmdbId: '63926', imdbId: 'tt4508902', anilistId: '21087', mediaType: 'tv', crSlug: 'one-punch-man' },
    'overlord': { tmdbId: '64196', imdbId: 'tt5161082', anilistId: '20832', mediaType: 'tv', crSlug: 'overlord' },
    're:zero': { tmdbId: '65942', imdbId: 'tt5607616', anilistId: '21355', mediaType: 'tv', crSlug: 're-zero-starting-life-in-another-world-' },
    'haikyu!!': { tmdbId: '60863', imdbId: 'tt3505030', anilistId: '20464', mediaType: 'tv', crSlug: 'haikyu' },
    'fate/stay night: unlimited blade works': { tmdbId: '61415', imdbId: 'tt3980712', anilistId: '19603', mediaType: 'tv', crSlug: 'fatestay-night-unlimited-blade-works' },
    'your name': { tmdbId: '372058', imdbId: 'tt5311514', anilistId: '21519', mediaType: 'movie', crSlug: 'your-name' },
    'suzume': { tmdbId: '916224', imdbId: 'tt16428256', anilistId: '142385', mediaType: 'movie', crSlug: 'suzume' },
    'weathering with you': { tmdbId: '568160', imdbId: 'tt9426210', anilistId: '106286', mediaType: 'movie', crSlug: 'weathering-with-you' },
    'a silent voice': { tmdbId: '378064', imdbId: 'tt5323662', anilistId: '20954', mediaType: 'movie', crSlug: 'a-silent-voice' },
    'spirited away': { tmdbId: '129', imdbId: 'tt0245429', anilistId: '199', mediaType: 'movie', crSlug: 'spirited-away' },
    'demon slayer: mugen train': { tmdbId: '635302', imdbId: 'tt11032374', anilistId: '112151', mediaType: 'movie', crSlug: 'demon-slayer-kimetsu-no-yaiba-the-movie-mugen-train' },
    'jujutsu kaisen 0': { tmdbId: '810693', imdbId: 'tt14331144', anilistId: '131573', mediaType: 'movie', crSlug: 'jujutsu-kaisen-0' },
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
 * Resolves metadata (tmdbId, anilistId, mediaType) for a given title
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

    if (explicitTmdbId) {
        return {
            tmdbId: String(explicitTmdbId),
            anilistId: '113415',
            mediaType: 'tv',
        };
    }

    return { tmdbId: '95479', imdbId: 'tt12343534', anilistId: '113415', mediaType: 'tv', crSlug: 'jujutsu-kaisen' };
}

export function getAnimeTmdbId(title: string, explicitTmdbId?: string | number): { tmdbId: string; mediaType: 'movie' | 'tv'; crSlug?: string } {
    const meta = getAnimeMeta(title, explicitTmdbId);
    return { tmdbId: meta.tmdbId, mediaType: meta.mediaType, crSlug: meta.crSlug };
}

/**
 * Resolves Multi-Server Streams (Nxsha Hindi Dub, AutoEmbed, VidSrc Dub)
 */
export function resolveAnimeStream(
    title: string,
    season: number = 1,
    episode: number = 1,
    preferredAudio: 'hindi' | 'japanese' | 'english' = 'hindi',
    explicitTmdbId?: string | number,
): AnimeStreamSource {
    const { tmdbId, imdbId, anilistId, mediaType, crSlug } = getAnimeMeta(title, explicitTmdbId);
    const s = Math.max(1, season);
    const e = Math.max(1, episode);

    const crunchyrollOfficialUrl = crSlug
        ? `https://www.crunchyroll.com/series/${crSlug}`
        : `https://www.crunchyroll.com/search?q=${encodeURIComponent(title)}`;

    // 1. Dedicated Hindi Dub Server (GbruHindi)
    const hindiDubUrl = mediaType === 'movie'
        ? `https://nxsha.space/embed/movie/${tmdbId}?server=GbruHindi`
        : `https://nxsha.space/embed/tv/${tmdbId}/${s}/${e}?server=GbruHindi`;

    // 2. AutoEmbed.co TMDB endpoint
    const autoEmbedTmdbUrl = mediaType === 'movie'
        ? `https://autoembed.co/movie/tmdb/${tmdbId}`
        : `https://autoembed.co/tv/tmdb/${tmdbId}-${s}-${e}`;

    // 3. VidSrc Anime Dub
    const vidsrcDubUrl = mediaType === 'movie'
        ? `https://vidsrc.cc/v2/embed/movie/${tmdbId}`
        : `https://vidsrc.cc/v2/embed/anime/${anilistId}/${e}/dub`;

    // 4. AutoEmbed IMDb Mirror
    const autoEmbedImdbUrl = imdbId
        ? (mediaType === 'movie'
            ? `https://autoembed.co/movie/imdb/${imdbId}`
            : `https://autoembed.co/tv/imdb/${imdbId}-${s}-${e}`)
        : autoEmbedTmdbUrl;

    const servers: AnimeServerSource[] = [
        {
            id: 'hindi_dub',
            name: '🇮🇳 Server 1: Pure Hindi Dub (GbruHindi)',
            badge: '100% Hindi Dubbed Audio Track',
            url: hindiDubUrl,
            isHindiDub: true,
        },
        {
            id: 'autoembed_tmdb',
            name: '⚡ Server 2: AutoEmbed (English / Sub)',
            badge: '1080p Ultra HD • AutoEmbed.co',
            url: autoEmbedTmdbUrl,
            isHindiDub: false,
        },
        {
            id: 'vidsrc_dub',
            name: '🔥 Server 3: VidSrc Dub (AniList Anime)',
            badge: 'AniList HD Dub Mirror',
            url: vidsrcDubUrl,
            isHindiDub: true,
        },
        {
            id: 'autoembed_imdb',
            name: '🎬 Server 4: AutoEmbed (IMDb Mirror)',
            badge: 'AutoEmbed Backup Mirror',
            url: autoEmbedImdbUrl,
            isHindiDub: false,
        },
    ];

    const audioTracks: AnimeAudioTrack[] = [
        {
            id: 'hindi',
            label: 'Hindi Dub (🇮🇳 हिंदी)',
            lang: 'hi',
            flag: '🇮🇳',
            streamUrl: hindiDubUrl,
            embedUrl: hindiDubUrl,
            format: 'embed',
        },
        {
            id: 'japanese',
            label: 'Japanese Sub (🇯🇵 日本語)',
            lang: 'ja',
            flag: '🇯🇵',
            streamUrl: autoEmbedTmdbUrl,
            embedUrl: autoEmbedTmdbUrl,
            format: 'embed',
        },
        {
            id: 'english',
            label: 'English Dub (🇺🇸 English)',
            lang: 'en',
            flag: '🇺🇸',
            streamUrl: autoEmbedTmdbUrl,
            embedUrl: autoEmbedTmdbUrl,
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
            { label: 'Auto (1080p)', url: hindiDubUrl, resolution: '1080p' },
            { label: '720p HD', url: hindiDubUrl, resolution: '720p' },
        ],
        fallbackStreamUrl: autoEmbedTmdbUrl,
        currentStreamUrl: hindiDubUrl,
    };
}
