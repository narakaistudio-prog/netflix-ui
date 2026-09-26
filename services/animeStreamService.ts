/**
 * Anime Stream Service & Clean Hindi Dub Embed Resolver
 *
 * Provides a rich multi-server Hindi Dub anime embed engine
 * backed by AutoEmbed, Nxsha GbruHindi, VidSrc Dub, and VidNest AniList resolvers.
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
    anilistId: string;
    mediaType: 'movie' | 'tv';
    crSlug?: string;
}

/**
 * Curated AniList + TMDB metadata for top anime
 */
export const ANIME_METADATA_MAP: Record<string, AnimeMeta> = {
    'jujutsu kaisen': { tmdbId: '95479', anilistId: '113415', mediaType: 'tv', crSlug: 'jujutsu-kaisen' },
    'demon slayer': { tmdbId: '85937', anilistId: '101922', mediaType: 'tv', crSlug: 'demon-slayer-kimetsu-no-yaiba' },
    'kimetsu no yaiba': { tmdbId: '85937', anilistId: '101922', mediaType: 'tv', crSlug: 'demon-slayer-kimetsu-no-yaiba' },
    'solo leveling': { tmdbId: '209867', anilistId: '151807', mediaType: 'tv', crSlug: 'solo-leveling' },
    'naruto': { tmdbId: '46260', anilistId: '20', mediaType: 'tv', crSlug: 'naruto' },
    'naruto shippuden': { tmdbId: '31910', anilistId: '1735', mediaType: 'tv', crSlug: 'naruto-shippuden' },
    'one piece': { tmdbId: '37854', anilistId: '21', mediaType: 'tv', crSlug: 'one-piece' },
    'attack on titan': { tmdbId: '1429', anilistId: '16498', mediaType: 'tv', crSlug: 'attack-on-titan' },
    'shingeki no kyojin': { tmdbId: '1429', anilistId: '16498', mediaType: 'tv', crSlug: 'attack-on-titan' },
    'death note': { tmdbId: '13916', anilistId: '1535', mediaType: 'tv', crSlug: 'death-note' },
    'dragon ball super': { tmdbId: '62715', anilistId: '21175', mediaType: 'tv', crSlug: 'dragon-ball-super' },
    'dragon ball z': { tmdbId: '12971', anilistId: '813', mediaType: 'tv', crSlug: 'dragon-ball-z' },
    'chainsaw man': { tmdbId: '114410', anilistId: '127230', mediaType: 'tv', crSlug: 'chainsaw-man' },
    'my hero academia': { tmdbId: '65930', anilistId: '21459', mediaType: 'tv', crSlug: 'my-hero-academia' },
    'boku no hero academia': { tmdbId: '65930', anilistId: '21459', mediaType: 'tv', crSlug: 'my-hero-academia' },
    'bleach': { tmdbId: '30984', anilistId: '269', mediaType: 'tv', crSlug: 'bleach' },
    'bleach: thousand-year blood war': { tmdbId: '103540', anilistId: '114446', mediaType: 'tv', crSlug: 'bleach-thousand-year-blood-war' },
    'tokyo ghoul': { tmdbId: '61374', anilistId: '20605', mediaType: 'tv', crSlug: 'tokyo-ghoul' },
    'spy x family': { tmdbId: '120089', anilistId: '140960', mediaType: 'tv', crSlug: 'spy-x-family' },
    'vinland saga': { tmdbId: '89108', anilistId: '101348', mediaType: 'tv', crSlug: 'vinland-saga' },
    'hunter x hunter': { tmdbId: '46298', anilistId: '11061', mediaType: 'tv', crSlug: 'hunter-x-hunter' },
    'black clover': { tmdbId: '73223', anilistId: '97940', mediaType: 'tv', crSlug: 'black-clover' },
    'dr. stone': { tmdbId: '86031', anilistId: '105333', mediaType: 'tv', crSlug: 'dr-stone' },
    'blue lock': { tmdbId: '136283', anilistId: '137822', mediaType: 'tv', crSlug: 'blue-lock' },
    'wind breaker': { tmdbId: '241257', anilistId: '163270', mediaType: 'tv', crSlug: 'wind-breaker' },
    'kaiju no. 8': { tmdbId: '207347', anilistId: '153288', mediaType: 'tv', crSlug: 'kaiju-no-8' },
    'mashle': { tmdbId: '205324', anilistId: '151801', mediaType: 'tv', crSlug: 'mashle-magic-and-muscles' },
    'classroom of the elite': { tmdbId: '72636', anilistId: '98659', mediaType: 'tv', crSlug: 'classroom-of-the-elite' },
    'hell\'s paradise': { tmdbId: '117465', anilistId: '128893', mediaType: 'tv', crSlug: 'hells-paradise' },
    'jigokuraku': { tmdbId: '117465', anilistId: '128893', mediaType: 'tv', crSlug: 'hells-paradise' },
    'fullmetal alchemist: brotherhood': { tmdbId: '31911', anilistId: '5114', mediaType: 'tv', crSlug: 'fullmetal-alchemist-brotherhood' },
    'cyberpunk: edgerunners': { tmdbId: '105248', anilistId: '120377', mediaType: 'tv', crSlug: 'cyberpunk-edgerunners' },
    'sword art online': { tmdbId: '45782', anilistId: '11757', mediaType: 'tv', crSlug: 'sword-art-online' },
    'mob psycho 100': { tmdbId: '67070', anilistId: '21507', mediaType: 'tv', crSlug: 'mob-psycho-100' },
    'one punch man': { tmdbId: '63926', anilistId: '21087', mediaType: 'tv', crSlug: 'one-punch-man' },
    'overlord': { tmdbId: '64196', anilistId: '20832', mediaType: 'tv', crSlug: 'overlord' },
    're:zero': { tmdbId: '65942', anilistId: '21355', mediaType: 'tv', crSlug: 're-zero-starting-life-in-another-world-' },
    'haikyu!!': { tmdbId: '60863', anilistId: '20464', mediaType: 'tv', crSlug: 'haikyu' },
    'fate/stay night: unlimited blade works': { tmdbId: '61415', anilistId: '19603', mediaType: 'tv', crSlug: 'fatestay-night-unlimited-blade-works' },
    'your name': { tmdbId: '372058', anilistId: '21519', mediaType: 'movie', crSlug: 'your-name' },
    'suzume': { tmdbId: '916224', anilistId: '142385', mediaType: 'movie', crSlug: 'suzume' },
    'weathering with you': { tmdbId: '568160', anilistId: '106286', mediaType: 'movie', crSlug: 'weathering-with-you' },
    'a silent voice': { tmdbId: '378064', anilistId: '20954', mediaType: 'movie', crSlug: 'a-silent-voice' },
    'spirited away': { tmdbId: '129', anilistId: '199', mediaType: 'movie', crSlug: 'spirited-away' },
    'demon slayer: mugen train': { tmdbId: '635302', anilistId: '112151', mediaType: 'movie', crSlug: 'demon-slayer-kimetsu-no-yaiba-the-movie-mugen-train' },
    'jujutsu kaisen 0': { tmdbId: '810693', anilistId: '131573', mediaType: 'movie', crSlug: 'jujutsu-kaisen-0' },
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

    return { tmdbId: '95479', anilistId: '113415', mediaType: 'tv', crSlug: 'jujutsu-kaisen' };
}

export function getAnimeTmdbId(title: string, explicitTmdbId?: string | number): { tmdbId: string; mediaType: 'movie' | 'tv'; crSlug?: string } {
    const meta = getAnimeMeta(title, explicitTmdbId);
    return { tmdbId: meta.tmdbId, mediaType: meta.mediaType, crSlug: meta.crSlug };
}

/**
 * Resolves the multi-server Hindi Dub Anime Embed URLs
 */
export function resolveAnimeStream(
    title: string,
    season: number = 1,
    episode: number = 1,
    preferredAudio: 'hindi' | 'japanese' | 'english' = 'hindi',
    explicitTmdbId?: string | number,
): AnimeStreamSource {
    const { tmdbId, anilistId, mediaType, crSlug } = getAnimeMeta(title, explicitTmdbId);
    const s = Math.max(1, season);
    const e = Math.max(1, episode);

    const crunchyrollOfficialUrl = crSlug
        ? `https://www.crunchyroll.com/series/${crSlug}`
        : `https://www.crunchyroll.com/search?q=${encodeURIComponent(title)}`;

    const autoEmbedUrl = mediaType === 'movie'
        ? `https://autoembed.co/movie/tmdb/${tmdbId}`
        : `https://autoembed.co/tv/tmdb/${tmdbId}-${s}-${e}`;

    const nxshaHindiUrl = mediaType === 'movie'
        ? `https://nxsha.space/embed/movie/${tmdbId}?server=GbruHindi`
        : `https://nxsha.space/embed/tv/${tmdbId}/${s}/${e}?server=GbruHindi`;

    const vidsrcDubUrl = mediaType === 'movie'
        ? `https://vidsrc.cc/v2/embed/movie/${tmdbId}`
        : `https://vidsrc.cc/v2/embed/anime/${anilistId}/${e}/dub`;

    const vidnestDubUrl = mediaType === 'movie'
        ? `https://vidnest.fun/movie/${tmdbId}`
        : `https://vidnest.fun/anime/${anilistId}/${e}/dub`;

    const multiEmbedUrl = mediaType === 'movie'
        ? `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`
        : `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`;

    const twoEmbedUrl = mediaType === 'movie'
        ? `https://www.2embed.cc/embed/${tmdbId}`
        : `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`;

    const servers: AnimeServerSource[] = [
        {
            id: 'autoembed',
            name: '⚡ Server 1: AutoEmbed (Hindi / Dual Audio)',
            badge: '1080p Ultra HD • Hindi Dub / Multi-Audio',
            url: autoEmbedUrl,
        },
        {
            id: 'nxsha_hindi',
            name: '🇮🇳 Server 2: Nxsha (Direct Hindi Dub)',
            badge: 'GbruHindi Pure Hindi Track',
            url: nxshaHindiUrl,
        },
        {
            id: 'vidsrc_dub',
            name: '🔥 Server 3: VidSrc Dub (AniList Hindi/Dub)',
            badge: 'AniList Direct Dubbed Mirror',
            url: vidsrcDubUrl,
        },
        {
            id: 'vidnest_dub',
            name: '🎬 Server 4: VidNest Pahe Dub',
            badge: 'AnimePahe Dub Stream',
            url: vidnestDubUrl,
        },
        {
            id: 'multiembed',
            name: '⭐ Server 5: MultiEmbed VIP',
            badge: 'High Speed Dual Audio Mirror',
            url: multiEmbedUrl,
        },
        {
            id: 'twoembed',
            name: '🚀 Server 6: 2Embed HD',
            badge: 'Fast Failover Mirror',
            url: twoEmbedUrl,
        },
    ];

    const audioTracks: AnimeAudioTrack[] = [
        {
            id: 'hindi',
            label: 'Hindi Dub (🇮🇳 हिंदी)',
            lang: 'hi',
            flag: '🇮🇳',
            streamUrl: autoEmbedUrl,
            embedUrl: autoEmbedUrl,
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
            { label: 'Auto (1080p)', url: autoEmbedUrl, resolution: '1080p' },
            { label: '720p HD', url: autoEmbedUrl, resolution: '720p' },
        ],
        fallbackStreamUrl: nxshaHindiUrl,
        currentStreamUrl: autoEmbedUrl,
    };
}
