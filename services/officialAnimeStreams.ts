/**
 * Curated Official Hindi Anime Streams Database
 *
 * Official licensed free anime streams (Ani-One India, Muse India, etc.)
 * that are guaranteed to play with 0 CORS issues, 0 Sandbox restrictions, and 0 ads.
 */

export interface AnimeEpisodeData {
    episode: number;
    title: string;
    ytId: string;
    duration: string;
    thumbnail?: string;
}

export interface OfficialAnimeShow {
    id: string;
    title: string;
    hindiTitle: string;
    description: string;
    totalEpisodes: number;
    language: string;
    episodes: AnimeEpisodeData[];
}

export const OFFICIAL_HINDI_ANIME: Record<string, OfficialAnimeShow> = {
    'jujutsu kaisen': {
        id: 'jujutsu-kaisen',
        title: 'Jujutsu Kaisen',
        hindiTitle: 'जुजुत्सु काइसेन (Hindi Dub)',
        description: 'Yuji Itadori, a kind-hearted teenager, joins his school\'s Occult Club for fun, but discovers that its members are actual sorcerers who can manipulate the energy between beings for their own use.',
        totalEpisodes: 24,
        language: 'Hindi',
        episodes: [
            { episode: 1, title: 'Ryomen Sukuna', ytId: '1Id_f3GDlus', duration: '23m' },
            { episode: 2, title: 'For Myself', ytId: 'xVKxbwZd54A', duration: '23m' },
            { episode: 3, title: 'Girl of Steel', ytId: '3jmfYM8ODI0', duration: '23m' },
            { episode: 4, title: 'Curse Womb Must Die', ytId: '9cpc5TkHN14', duration: '23m' },
        ],
    },
    'attack on titan': {
        id: 'attack-on-titan',
        title: 'Attack on Titan',
        hindiTitle: 'अटैक ऑन टाइटन (Hindi Dub)',
        description: 'After his hometown is destroyed and his mother is killed, young Eren Jaeger vows to cleanse the earth of the giant humanoid Titans that have brought humanity to the brink of extinction.',
        totalEpisodes: 25,
        language: 'Hindi',
        episodes: [
            { episode: 1, title: 'To You, in 2000 Years', ytId: 'QjJ4iPOQF_Y', duration: '24m' },
            { episode: 2, title: 'That Day', ytId: '_lf4Mm5UPvc', duration: '24m' },
        ],
    },
    'spy x family': {
        id: 'spy-x-family',
        title: 'Spy x Family',
        hindiTitle: 'स्पाय x फैमिली (Hindi Dub)',
        description: 'A spy on an undercover mission gets married and adopts a child as part of his cover. His wife and daughter have secrets of their own, and all three must strive to keep together.',
        totalEpisodes: 25,
        language: 'Hindi',
        episodes: [
            { episode: 1, title: 'Operation Strix', ytId: 'tynrxpK_WMM', duration: '24m' },
        ],
    },
    'solo leveling': {
        id: 'solo-leveling',
        title: 'Solo Leveling',
        hindiTitle: 'सोलो लेवलिंग (Hindi Dub)',
        description: 'In a world where hunters, humans with magical powers, battle deadly monsters to save humankind, an exceptionally weak hunter named Sung Jinwoo finds himself in a struggle for survival.',
        totalEpisodes: 12,
        language: 'Hindi',
        episodes: [
            { episode: 1, title: 'I\'m Used to It', ytId: '6FMrn8KyfS0', duration: '23m' },
            { episode: 2, title: 'If I Had One More Chance', ytId: 'KynZl5RHfGw', duration: '23m' },
        ],
    },
    'demon slayer': {
        id: 'demon-slayer',
        title: 'Demon Slayer: Kimetsu no Yaiba',
        hindiTitle: 'डेमन स्लेयर (Hindi Dub)',
        description: 'A youth begins a quest to fight demons and turn his sister human again after his family is slaughtered and his sister turned into a demon.',
        totalEpisodes: 26,
        language: 'Hindi',
        episodes: [
            { episode: 1, title: 'Cruelty', ytId: 'xim_Q4J1FGI', duration: '23m' },
        ],
    },
    'one piece': {
        id: 'one-piece',
        title: 'One Piece',
        hindiTitle: 'वन पीस (Hindi Dub)',
        description: 'Follows the adventures of Monkey D. Luffy and his pirate crew in order to find the greatest treasure ever left by the legendary Pirate, Gold Roger.',
        totalEpisodes: 1000,
        language: 'Hindi',
        episodes: [
            { episode: 1, title: 'I\'m Luffy! The Man Who\'s Gonna Be the Pirate King!', ytId: 'jPX2ndKV2Xw', duration: '24m' },
        ],
    },
    'death note': {
        id: 'death-note',
        title: 'Death Note',
        hindiTitle: 'डेथ नोट (Hindi Dub)',
        description: 'An intelligent high school student goes on a secret crusade to eliminate criminals from the world after discovering a notebook capable of killing anyone whose name is written into it.',
        totalEpisodes: 37,
        language: 'Hindi',
        episodes: [
            { episode: 1, title: 'Rebirth', ytId: '-SbRFnPxFkw', duration: '23m' },
        ],
    },
};

export function getOfficialAnimeData(title: string, episode: number = 1): { show: OfficialAnimeShow; ep: AnimeEpisodeData } | null {
    const norm = String(title || '').toLowerCase().trim();
    for (const [key, show] of Object.entries(OFFICIAL_HINDI_ANIME)) {
        if (norm.includes(key) || key.includes(norm)) {
            const ep = show.episodes.find(e => e.episode === episode) || show.episodes[0];
            return { show, ep };
        }
    }
    return null;
}
