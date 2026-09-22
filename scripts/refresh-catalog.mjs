#!/usr/bin/env node
/**
 * Daily Netflix India catalog refresh.
 *
 * Public discovery needs no key:
 *  1. Crawls a public Netflix availability sitemap and filters India rows
 *  2. Supplements the broad catalog with JustWatch's current Netflix India
 *     popularity pages (new releases, Korean series, anime and movies)
 *  3. Falls back to FlixPatrol's daily India TOP 10 if the broad source fails
 *  4. Reads each discovered title's poster, plot, rating and availability data
 *  5. Optionally enriches titles with OMDb metadata and episode details
 *  6. Rewrites data/movies.json so the bundled catalog never goes stale
 *
 * OMDb is an optional server-side enricher; the public discovery fallback
 * always remains available.
 *
 * Usage: node scripts/refresh-catalog.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
// Jina's Cloudflare front door can reject a browser-shaped Chrome UA; use its
// neutral reader UA for proxy requests instead of reusing the source headers.
const JINA_HEADERS = { 'user-agent': 'Mozilla/5.0' };
const REQUEST_TIMEOUT_MS = 20_000;
const FULL_SOURCE = 'https://isitinmycountry.com';
// HTTPS-origin reads are more reliable than Jina's HTTP-origin route when the
// public site is behind Cloudflare; keep the HTTP form as a compatibility retry.
const FULL_PROXY_SOURCES = [
    'https://r.jina.ai/https://isitinmycountry.com',
    'https://r.jina.ai/http://isitinmycountry.com',
];
const FULL_PAGE_CONCURRENCY = 8;
const FULL_ROW_SIZE = 48;
const JUSTWATCH_CATALOG_PAGE_SIZE = 40;
const JUSTWATCH_MAX_CATALOG_PAGES = 6;
const BLOCKED_TOP10_TITLES = new Set(['365 dni']);
const BLOCKED_CATALOG_TITLE_PATTERN = /\b365\s*(?:dni|days)\b/i;
const MATURE_ROW_TITLE = 'Mature & Adult Content';
const MATURE_TITLE_PATTERNS = [
    'sapio',
    'nowlater',
    'bugso',
    'mahjongnights',
    '20yearoldvirgins',
    'thestoryo',
    'womeninthedark',
    'hernamewaschrista',
    'luststories',
    'desire',
    'burningbetrayal',
    '365days',
    'eroticstories',
    'sexlife',
    'darkdesire',
    'mastram',
    'obsession',
    'toohottohandle',
    'sexycentral',
    'superdrags',
    'morethemerrier',
    'bigsexyvalentinesdayspecial',
    'mrsplaymen',
    'sexexplained',
    'sexeducation',
    'thescandal',
    'lovedeathrobots',
];
const MATURE_DESCRIPTION_PATTERN = /sexual perversion|sex workers?|sexual tension|sex and intimacy|lose (?:their|her|his) virginity|bondage|adult animated|repressed desire/i;
const TOP10_REPLACEMENTS = [
    {
        title: 'Alpha',
        mediaType: 'movie',
        url: 'https://www.justwatch.com/in/movie/alpha-2025-0',
    },
    {
        title: 'Cocktail 2',
        mediaType: 'movie',
        url: 'https://www.justwatch.com/in/movie/cocktail-2-2026',
    },
];

// Netflix's official genre pages contain many Originals that do not appear in
// the popularity-sorted JustWatch page. Keep this small editorial seed
// server-side, enrich it with OMDb when available, and place it in dedicated
// shelves instead of pretending it is today's popularity chart.
const NETFLIX_CURATED_ROW_TITLES = new Set([
    'Netflix Originals & Series',
    'Netflix Korean Originals',
    'Netflix Anime & Animation',
    'Netflix Original Movies',
    'Netflix Documentaries',
]);

const NETFLIX_CURATED_SEEDS = [
    // Netflix Originals and series
    ['Arcane', 'tv', 'Netflix Originals & Series'],
    ['The Sandman', 'tv', 'Netflix Originals & Series'],
    ['The Umbrella Academy', 'tv', 'Netflix Originals & Series'],
    ['The Lincoln Lawyer', 'tv', 'Netflix Originals & Series'],
    ['The Night Agent', 'tv', 'Netflix Originals & Series'],
    ['The Recruit', 'tv', 'Netflix Originals & Series'],
    ['The Diplomat', 'tv', 'Netflix Originals & Series'],
    ['Virgin River', 'tv', 'Netflix Originals & Series'],
    ['Emily in Paris', 'tv', 'Netflix Originals & Series'],
    ['Love Is Blind', 'tv', 'Netflix Originals & Series'],
    ['The Circle', 'tv', 'Netflix Originals & Series'],
    ["The Queen's Gambit", 'tv', 'Netflix Originals & Series'],
    ['Ozark', 'tv', 'Netflix Originals & Series'],
    ['Narcos', 'tv', 'Netflix Originals & Series'],
    ['The Haunting of Hill House', 'tv', 'Netflix Originals & Series'],
    ['The Haunting of Bly Manor', 'tv', 'Netflix Originals & Series'],
    ['Midnight Mass', 'tv', 'Netflix Originals & Series'],
    ['Russian Doll', 'tv', 'Netflix Originals & Series'],
    ['Maid', 'tv', 'Netflix Originals & Series'],
    ['Unbelievable', 'tv', 'Netflix Originals & Series'],
    ['The Watcher', 'tv', 'Netflix Originals & Series'],
    ['Beef', 'tv', 'Netflix Originals & Series'],
    ['One Day', 'tv', 'Netflix Originals & Series'],
    ['The OA', 'tv', 'Netflix Originals & Series'],
    ['The End of the F***ing World', 'tv', 'Netflix Originals & Series'],
    ['BoJack Horseman', 'tv', 'Netflix Originals & Series'],
    ['Big Mouth', 'tv', 'Netflix Originals & Series'],
    ['The Dragon Prince', 'tv', 'Netflix Originals & Series'],
    ['Blood of Zeus', 'tv', 'Netflix Originals & Series'],
    ['Aggretsuko', 'tv', 'Netflix Originals & Series'],
    ['Hilda', 'tv', 'Netflix Originals & Series'],
    ['Kipo and the Age of Wonderbeasts', 'tv', 'Netflix Originals & Series'],
    ['Maya and the Three', 'tv', 'Netflix Originals & Series'],
    ['Avatar: The Last Airbender', 'tv', 'Netflix Originals & Series'],

    // Korean Netflix Originals, including established catalogue favourites
    ['Kingdom', 'tv', 'Netflix Korean Originals'],
    ['My Name', 'tv', 'Netflix Korean Originals'],
    ['Hellbound', 'tv', 'Netflix Korean Originals'],
    ['Sweet Home', 'tv', 'Netflix Korean Originals'],
    ['D.P.', 'tv', 'Netflix Korean Originals'],
    ['Extraordinary Attorney Woo', 'tv', 'Netflix Korean Originals'],
    ['Crash Landing on You', 'tv', 'Netflix Korean Originals'],
    ['Business Proposal', 'tv', 'Netflix Korean Originals'],
    ['Hometown Cha-Cha-Cha', 'tv', 'Netflix Korean Originals'],
    ['Alchemy of Souls', 'tv', 'Netflix Korean Originals'],
    ['Twenty-Five Twenty-One', 'tv', 'Netflix Korean Originals'],
    ['Itaewon Class', 'tv', 'Netflix Korean Originals'],
    ['Start-Up', 'tv', 'Netflix Korean Originals'],
    ['Hospital Playlist', 'tv', 'Netflix Korean Originals'],
    ['Reply 1988', 'tv', 'Netflix Korean Originals'],
    ['Mr. Queen', 'tv', 'Netflix Korean Originals'],
    ['True Beauty', 'tv', 'Netflix Korean Originals'],
    ['The King: Eternal Monarch', 'tv', 'Netflix Korean Originals'],
    ['The Uncanny Counter', 'tv', 'Netflix Korean Originals'],
    ['Bloodhounds', 'tv', 'Netflix Korean Originals'],

    // Anime and animated Netflix titles from the official Anime shelf
    ['One-Punch Man', 'tv', 'Netflix Anime & Animation'],
    ['Jujutsu Kaisen', 'tv', 'Netflix Anime & Animation'],
    ['One Piece', 'tv', 'Netflix Anime & Animation'],
    ['Naruto', 'tv', 'Netflix Anime & Animation'],
    ['Hajime no Ippo: The Fighting!', 'tv', 'Netflix Anime & Animation'],
    ['DEATH NOTE', 'tv', 'Netflix Anime & Animation'],
    ['My Hero Academia', 'tv', 'Netflix Anime & Animation'],
    ['Demon Slayer: Kimetsu no Yaiba', 'tv', 'Netflix Anime & Animation'],
    ['Black Clover', 'tv', 'Netflix Anime & Animation'],
    ['That Time I Got Reincarnated as a Slime', 'tv', 'Netflix Anime & Animation'],
    ['The Disastrous Life of Saiki K.', 'tv', 'Netflix Anime & Animation'],
    ['VINLAND SAGA', 'tv', 'Netflix Anime & Animation'],
    ['Haikyu!!', 'tv', 'Netflix Anime & Animation'],
    ['InuYasha', 'tv', 'Netflix Anime & Animation'],
    ['Puella Magi Madoka Magica', 'tv', 'Netflix Anime & Animation'],
    ['Gurren Lagann', 'tv', 'Netflix Anime & Animation'],
    ['Mobile Suit Gundam Seed', 'tv', 'Netflix Anime & Animation'],
    ['Violet Evergarden', 'tv', 'Netflix Anime & Animation'],
    ['PLUTO', 'tv', 'Netflix Anime & Animation'],
    ['Terminator Zero', 'tv', 'Netflix Anime & Animation'],
    ['Devil May Cry', 'tv', 'Netflix Anime & Animation'],
    ['Devilman Crybaby', 'tv', 'Netflix Anime & Animation'],
    ['The Fragrant Flower Blooms With Dignity', 'tv', 'Netflix Anime & Animation'],
    ['Blue Box', 'tv', 'Netflix Anime & Animation'],
    ['Rising Impact', 'tv', 'Netflix Anime & Animation'],
    ['Blue Lock', 'tv', 'Netflix Anime & Animation'],
    ['Hunter X Hunter (2011)', 'tv', 'Netflix Anime & Animation'],
    ['Daemons of the Shadow Realm', 'tv', 'Netflix Anime & Animation'],
    ['Record of Ragnarok', 'tv', 'Netflix Anime & Animation'],
    ['BAKI-DOU: The Invincible Samurai', 'tv', 'Netflix Anime & Animation'],
    ['The Seven Deadly Sins', 'tv', 'Netflix Anime & Animation'],
    ['Chainsmoker Cat', 'tv', 'Netflix Anime & Animation'],
    ["JoJo's Bizarre Adventure", 'tv', 'Netflix Anime & Animation'],
    ['Assassination Classroom', 'tv', 'Netflix Anime & Animation'],
    ['Shangri-La Frontier', 'tv', 'Netflix Anime & Animation'],
    ['Tougen Anki', 'tv', 'Netflix Anime & Animation'],
    ['Cyberpunk: Edgerunners', 'tv', 'Netflix Anime & Animation'],
    ['Mob Psycho 100', 'tv', 'Netflix Anime & Animation'],
    ['Overlord', 'tv', 'Netflix Anime & Animation'],
    ['Baki', 'tv', 'Netflix Anime & Animation'],
    ['SAKAMOTO DAYS', 'tv', 'Netflix Anime & Animation'],
    ['Kengan Ashura', 'tv', 'Netflix Anime & Animation'],
    ['BEASTARS', 'tv', 'Netflix Anime & Animation'],
    ['Dr. Stone', 'tv', 'Netflix Anime & Animation'],
    ['The Apothecary Diaries', 'tv', 'Netflix Anime & Animation'],
    ['Magic and Muscles', 'tv', 'Netflix Anime & Animation'],
    ['Baki Hanma', 'tv', 'Netflix Anime & Animation'],
    ["Kuroko's Basketball", 'tv', 'Netflix Anime & Animation'],
    ['Delicious in Dungeon', 'tv', 'Netflix Anime & Animation'],
    ['Fullmetal Alchemist: Brotherhood', 'tv', 'Netflix Anime & Animation'],
    ['My Dress-Up Darling', 'tv', 'Netflix Anime & Animation'],
    ['Frieren: Beyond Journey\'s End', 'tv', 'Netflix Anime & Animation'],
    ['Wind Breaker', 'tv', 'Netflix Anime & Animation'],
    ['DAN DA DAN', 'tv', 'Netflix Anime & Animation'],
    ['Kakegurui', 'tv', 'Netflix Anime & Animation'],
    ['The Rising of the Shield Hero', 'tv', 'Netflix Anime & Animation'],
    ['Neon Genesis Evangelion', 'tv', 'Netflix Anime & Animation'],
    ['Castlevania: Nocturne', 'tv', 'Netflix Anime & Animation'],
    ['Rurouni Kenshin', 'tv', 'Netflix Anime & Animation'],
    ['My Happy Marriage', 'tv', 'Netflix Anime & Animation'],
    ['Detective Conan', 'tv', 'Netflix Anime & Animation'],
    ['Blue Eye Samurai', 'tv', 'Netflix Anime & Animation'],
    ['Castlevania', 'tv', 'Netflix Anime & Animation'],
    ['KPop Demon Hunters', 'movie', 'Netflix Anime & Animation'],
    ['The Sea Beast', 'movie', 'Netflix Anime & Animation'],
    ['Nimona', 'movie', 'Netflix Anime & Animation'],
    ['Klaus', 'movie', 'Netflix Anime & Animation'],
    ['The Mitchells vs. the Machines', 'movie', 'Netflix Anime & Animation'],

    // Netflix Original films
    ['Glass Onion: A Knives Out Mystery', 'movie', 'Netflix Original Movies'],
    ['Red Notice', 'movie', 'Netflix Original Movies'],
    ['Extraction', 'movie', 'Netflix Original Movies'],
    ['Extraction 2', 'movie', 'Netflix Original Movies'],
    ['The Gray Man', 'movie', 'Netflix Original Movies'],
    ['Army of the Dead', 'movie', 'Netflix Original Movies'],
    ['Rebel Moon - Part One: A Child of Fire', 'movie', 'Netflix Original Movies'],
    ['Damsel', 'movie', 'Netflix Original Movies'],
    ['The Killer', 'movie', 'Netflix Original Movies'],
    ['Maestro', 'movie', 'Netflix Original Movies'],
    ['Society of the Snow', 'movie', 'Netflix Original Movies'],
    ['All Quiet on the Western Front', 'movie', 'Netflix Original Movies'],
    ['Roma', 'movie', 'Netflix Original Movies'],
    ['The Irishman', 'movie', 'Netflix Original Movies'],
    ['Marriage Story', 'movie', 'Netflix Original Movies'],
    ['The Old Guard', 'movie', 'Netflix Original Movies'],
    ['Bird Box', 'movie', 'Netflix Original Movies'],
    ["Don't Look Up", 'movie', 'Netflix Original Movies'],
    ['The Platform', 'movie', 'Netflix Original Movies'],
    ['The Mother', 'movie', 'Netflix Original Movies'],
    ['Heart of Stone', 'movie', 'Netflix Original Movies'],
    ['The Beautiful Game', 'movie', 'Netflix Original Movies'],
    ['The Electric State', 'movie', 'Netflix Original Movies'],
    ['The Adam Project', 'movie', 'Netflix Original Movies'],
    ['Enola Holmes', 'movie', 'Netflix Original Movies'],
    ['Murder Mystery', 'movie', 'Netflix Original Movies'],
    ['To All the Boys I\'ve Loved Before', 'movie', 'Netflix Original Movies'],
    ['Okja', 'movie', 'Netflix Original Movies'],
    ["Guillermo del Toro's Pinocchio", 'movie', 'Netflix Original Movies'],
    ['The Power of the Dog', 'movie', 'Netflix Original Movies'],
    ['Beasts of No Nation', 'movie', 'Netflix Original Movies'],
    ['The Two Popes', 'movie', 'Netflix Original Movies'],

    // Netflix documentary originals
    ['Our Planet', 'tv', 'Netflix Documentaries'],
    ['Night on Earth', 'tv', 'Netflix Documentaries'],
    ['Formula 1: Drive to Survive', 'tv', 'Netflix Documentaries'],
    ['Beckham', 'tv', 'Netflix Documentaries'],
    ["Chef's Table", 'tv', 'Netflix Documentaries'],
    ['Making a Murderer', 'tv', 'Netflix Documentaries'],
    ['The Last Dance', 'tv', 'Netflix Documentaries'],
    ['Our Great National Parks', 'tv', 'Netflix Documentaries'],
    ['The Social Dilemma', 'movie', 'Netflix Documentaries'],
    ['My Octopus Teacher', 'movie', 'Netflix Documentaries'],
    ['David Attenborough: A Life on Our Planet', 'movie', 'Netflix Documentaries'],
];

// Stable IDs copied from Netflix's official Anime genre page. They are kept
// alongside the editorial title seed so a title remains traceable even when
// OMDb has no exact spelling/region match.
const NETFLIX_OFFICIAL_IDS = {
    'One-Punch Man': '80117291',
    'Jujutsu Kaisen': '81278456',
    'One Piece': '80107103',
    Naruto: '70205012',
    'Hajime no Ippo: The Fighting!': '80995578',
    'DEATH NOTE': '70204970',
    'My Hero Academia': '80135674',
    'Demon Slayer: Kimetsu no Yaiba': '81091393',
    'Blue Lock': '81640753',
    'Hunter X Hunter (2011)': '70300472',
    'Black Clover': '80238012',
    'Daemons of the Shadow Realm': '82719204',
    'Record of Ragnarok': '81281579',
    'BAKI-DOU: The Invincible Samurai': '81922765',
    'The Seven Deadly Sins': '80050063',
    'That Time I Got Reincarnated as a Slime': '81028712',
    'Chainsmoker Cat': '82760630',
    "JoJo's Bizarre Adventure": '80179831',
    'The Disastrous Life of Saiki K.': '80117781',
    'Assassination Classroom': '80045948',
    'Shangri-La Frontier': '81727242',
    'VINLAND SAGA': '81249833',
    'Tougen Anki': '81969861',
    'Haikyu!!': '80090673',
    'Cyberpunk: Edgerunners': '81054853',
    'Mob Psycho 100': '80179798',
    Overlord: '80132110',
    BAKI: '80204451',
    'SAKAMOTO DAYS': '81663325',
    'KENGAN ASHURA': '80992228',
    BEASTARS: '81054847',
    'Dr. Stone': '81046193',
    'The Apothecary Diaries': '81712068',
    'Magic and Muscles': '81685164',
    'Baki Hanma': '81236338',
    "Kuroko's Basketball": '80063153',
    'Delicious in Dungeon': '81564899',
    'Fullmetal Alchemist: Brotherhood': '70204981',
    'My Dress-Up Darling': '81569754',
    'Castlevania': '80095241',
    "Frieren: Beyond Journey's End": '81726714',
    'Wind Breaker': '81771389',
    'DAN DA DAN': '81736884',
    Kakegurui: '80175351',
    'The Rising of the Shield Hero': '81058649',
    'Blood of Zeus': '81001988',
    'Neon Genesis Evangelion': '81033445',
    'Castlevania: Nocturne': '81436901',
    'Rurouni Kenshin': '81705252',
    'My Happy Marriage': '81564905',
    'Detective Conan': '80090370',
    'Rising Impact': '81563026',
    InuYasha: '70204995',
    'Puella Magi Madoka Magica': '70302572',
    'Gurren Lagann': '70213196',
    'Mobile Suit Gundam Seed': '80146549',
    'Blue Eye Samurai': '81144203',
    Arcane: '81435684',
    PLUTO: '81712066',
    'KPop Demon Hunters': '81498621',
    'The Sandman': '81150303',
    'The Umbrella Academy': '80186863',
    Aggretsuko: '80198505',
    Hilda: '80115346',
    'Kipo and the Age of Wonderbeasts': '80221553',
    'Maya and the Three': '80244283',
    'Glass Onion: A Knives Out Mystery': '81458416',
    Damsel: '80991090',
    'The Killer': '80234448',
    'Rebel Moon - Part One: A Child of Fire': '81464239',
    'The Lincoln Lawyer': '81303831',
    'The Recruit': '81396545',
    'The Diplomat': '81288983',
    'Virgin River': '80240027',
    'Emily in Paris': '81037371',
    'Avatar: The Last Airbender': '80237957',
    'Terminator Zero': '81217220',
    'Devil May Cry': '81506915',
    'Devilman Crybaby': '80174974',
    Nimona: '81444554',
    Klaus: '80183187',
    Maestro: '81171868',
    'Society of the Snow': '81268316',
    'The Irishman': '80175798',
    'Marriage Story': '80223779',
    'Bird Box': '80196789',
    "Don't Look Up": '81252357',
};

const SAMPLE_VIDEOS = [
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
];

// Netflix's daily chart scraper does not expose episode metadata, so retain
// known counts for recurring chart titles instead of falling back to a movie
// runtime in the series detail sheet.
const SERIES_EPISODE_COUNTS = {
    'Chumbak': 16,
    "India's Got Latent": 20,
    'Crew Girl': 8,
    'Monster: The Lizzie Borden Story': 8,
    'Operation Safed Sagar: The Untold Story of the Kargil War': 6,
    'Musafir Cafe': 8,
    'The Gentlemen': 16,
    'The Scandal': 8,
    'WWE SmackDown': 1419,
};

const SERIES_SEASON_EPISODES = {
    'Chumbak': [16],
    "India's Got Latent": [12, 8],
    'Crew Girl': [8],
    'Monster: The Lizzie Borden Story': [8],
    'Operation Safed Sagar: The Untold Story of the Kargil War': [6],
    'Musafir Cafe': [8],
    'The Gentlemen': [8, 8],
    'The Scandal': [8],
    'WWE SmackDown': [19, 52, 52, 52, 52, 53, 52, 52, 52, 52, 52, 53, 52, 52, 52, 52, 53, 52, 52, 52, 52, 52, 53, 52, 52, 52, 52, 44],
};

// Netflix's reader sometimes exposes only the first selected season for a
// limited series. Keep this audited, real episode list as a deterministic
// fallback rather than inventing Episode 1 or showing a bare count.
const CURATED_EPISODE_FALLBACKS = {
    'Maya and the Three': {
        seasons: [{
            season_number: 1,
            name: 'Season 1',
            episode_count: 9,
            episodes: [
                'Chapter 1: Quinceañera',
                'Chapter 2: The Prophecy',
                'Chapter 3: The Rooster',
                'Chapter 4: The Skull',
                'Chapter 5: The Puma',
                'Chapter 6: Maya and the Three',
                'Chapter 7: The Divine Gate',
                'Chapter 8: The Bat and the Owl',
                'Chapter 9: The Sun and the Moon',
            ].map((name, index) => ({ season: 1, episode: index + 1, name })),
        }],
        seasonEpisodeCounts: [9],
        episodeCount: 9,
        duration: '1 Season',
    },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const POSTERS_DIR = join(ROOT, 'assets', 'posters');

/**
 * Poster hosts (FlixPatrol cache, etc.) block browser hotlinking with 403s,
 * so poster art is downloaded into the repo and referenced as `local:<id>`.
 * The app bundles these files — posters can never break again.
 */
function findBundledPosterId(item) {
    const mediaPrefix = item.mediaType === 'tv' || item.type === 'SERIES' ? 'tv' : 'movie';
    const slug = slugify(item.title);
    if (!slug || !existsSync(POSTERS_DIR)) return '';
    const candidates = new Set([
        item.id,
        `jw-catalog-${mediaPrefix}-${slug}`,
        `jw-${slug}`,
        `fp-${slug}`,
        `${mediaPrefix}-${slug}`,
    ].filter(Boolean));
    const walk = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) {
                const nested = walk(absolute);
                if (nested) return nested;
            }
            const basename = entry.name.replace(/\.[^.]+$/, '');
            if (candidates.has(basename)) return basename;
        }
        return '';
    };
    return walk(POSTERS_DIR);
}

async function savePoster(item, fallbackImageUrl = '') {
    const src = item.imageUrl || '';
    if (!/^https?:\/\//.test(src) || !/^(fp|jw|movie|tv)-/.test(item.id)) {
        const bundledPosterId = findBundledPosterId(item);
        if (bundledPosterId) item.imageUrl = `local:${bundledPosterId}`;
        else if (fallbackImageUrl) item.imageUrl = fallbackImageUrl;
        return;
    }
    const ext = (src.match(/\.(jpe?g|png|webp)/i)?.[1] || 'jpg').replace('jpeg', 'jpg');
    const attempts = [
        { ...UA, referer: `${new URL(src).origin}/` },
        UA,
        { 'user-agent': UA['user-agent'], accept: 'image/avif,image/webp,image/*,*/*' },
    ];
    for (const headers of attempts) {
        try {
            const res = await fetch(src, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 2000) throw new Error('suspiciously small');
            mkdirSync(POSTERS_DIR, { recursive: true });
            const posterFilename = `${item.id}.${ext}`;
            writeFileSync(join(POSTERS_DIR, posterFilename), buf);
            // Remove an older extension for this same title so the generated
            // poster index never contains duplicate keys with random ordering.
            for (const filename of readdirSync(POSTERS_DIR)) {
                if (filename.startsWith(`${item.id}.`) && filename !== posterFilename) {
                    unlinkSync(join(POSTERS_DIR, filename));
                }
            }
            item.imageUrl = `local:${item.id}`;
            return;
        } catch (e) {
            console.log(`poster attempt failed for ${item.id} (${e.message})`);
        }
    }
    const kept = existsSync(POSTERS_DIR)
        && readdirSync(POSTERS_DIR).some(f => f.startsWith(`${item.id}.`));
    if (kept) item.imageUrl = `local:${item.id}`;
    else if (fallbackImageUrl) item.imageUrl = fallbackImageUrl;
    else console.log(`poster download failed for ${item.id} — keeping remote URL`);
}

/** Rewrite assets/posters/index.ts so the bundle always ships every poster. */
function writePosterIndex() {
    if (!existsSync(POSTERS_DIR)) return;

    const files = [];
    const walk = (directory, relativeDirectory = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolute = join(directory, entry.name);
            const relative = join(relativeDirectory, entry.name).replaceAll('\\', '/');
            const isPoster = ['.jpg', '.jpeg', '.png', '.webp']
                .some(extension => entry.name.toLowerCase().endsWith(extension));
            if (entry.isDirectory()) walk(absolute, relative);
            else if (isPoster) files.push({ absolute, relative });
        }
    };
    walk(POSTERS_DIR);
    files.sort((a, b) => a.relative.localeCompare(b.relative));

    const aliases = new Map();
    for (const file of files) {
        const basename = file.relative
            .slice(file.relative.lastIndexOf('/') + 1)
            .replace(/\.[^.]+$/, '');
        // The catalog uses local:<filename-without-extension>. If two folders
        // ever contain the same basename, the first deterministic entry wins.
        if (!aliases.has(basename)) aliases.set(basename, file);
    }

    const uriEntries = [...aliases.entries()]
        .flatMap(([key, file]) => [
            `    ${JSON.stringify(key)}: ${JSON.stringify(`/assets/posters/${file.relative}`)},`,
            `    ${JSON.stringify(`local:${key}`)}: ${JSON.stringify(`/assets/posters/${file.relative}`)},`,
        ])
        .join('\n');
    const nativeEntries = [...aliases.entries()]
        .flatMap(([key, file]) => [
            `    ${JSON.stringify(key)}: require(${JSON.stringify(`./${file.relative}`)}),`,
            `    ${JSON.stringify(`local:${key}`)}: require(${JSON.stringify(`./${file.relative}`)}),`,
        ])
        .join('\n');

    const output = [
        '/**',
        ' * Poster art bundled with the app, keyed by catalog id.',
        ' *',
        ' * Catalog JSON references these via local:<id> imageUrl values so posters',
        ' * always load from the app bundle — third-party poster hosts block hotlinking',
        ' * and would render broken cards. The refresh script rewrites this map',
        ' * whenever it downloads fresh poster art.',
        ' */',
        "import { Platform, ImageSourcePropType } from 'react-native';",
        '',
        'export const LOCAL_POSTER_URIS: Record<string, string> = {',
        uriEntries,
        '};',
        '',
        'export const LOCAL_POSTERS: Record<string, ImageSourcePropType> = {',
        nativeEntries,
        '};',
        '',
        'export function getLocalPoster(key?: string | number): any {',
        '    if (!key) return undefined;',
        '    const strKey = String(key).trim();',
        "    const cleanKey = strKey.replace(/^local:/, '');",
        '',
        "    if (Platform.OS === 'web') {",
        '        const uri =',
        '            LOCAL_POSTER_URIS[strKey] ||',
        '            LOCAL_POSTER_URIS[cleanKey] ||',
        "            LOCAL_POSTER_URIS['real-' + cleanKey] ||",
        "            LOCAL_POSTER_URIS['movie-' + cleanKey] ||",
        "            LOCAL_POSTER_URIS['tv-' + cleanKey] ||",
        "            LOCAL_POSTER_URIS['billboard-' + cleanKey];",
        '        if (uri) return { uri };',
        '    }',
        '',
        '    return (',
        '        LOCAL_POSTERS[strKey] ||',
        '        LOCAL_POSTERS[cleanKey] ||',
        "        LOCAL_POSTERS['real-' + cleanKey] ||",
        "        LOCAL_POSTERS['movie-' + cleanKey] ||",
        "        LOCAL_POSTERS['tv-' + cleanKey] ||",
        "        LOCAL_POSTERS['billboard-' + cleanKey]",
        '    );',
        '}',
    ].join('\n');

    writeFileSync(join(POSTERS_DIR, 'index.ts'), `${output}\n`);
}

if (process.argv.includes('--rebuild-poster-index')) {
    writePosterIndex();
    console.log('Poster index rebuilt.');
    process.exit(0);
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function getHtml(url) {
    const res = await fetchWithTimeout(url, { headers: UA, redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.text();
}

/** IsItInMyCountry can reject GitHub-hosted IPs; Jina is a public reader fallback. */
function isUsableFullSourceResponse(url, body) {
    const content = String(body || '');
    if (url.endsWith('/sitemap.xml')) return /\/title\//i.test(content);
    // Cloudflare sometimes returns a successful challenge page instead of an
    // HTTP error. Treat that as unavailable so the Jina reader is attempted.
    return /availability by country/i.test(content)
        && !/please enable cookies|worker exceeded resource limits|error 1102/i.test(content);
}

/** Read a secondary public page through Jina without pretending it is the
 * IsItInMyCountry source. Used only for the current Top 10 presentation rows. */
async function getJinaReaderPage(url) {
    // JustWatch's pagination is occasionally rendered differently between its
    // HTTP and HTTPS origins. Try the requested origin first, then the other
    // form, while always keeping the Jina reader as the public proxy.
    const targetUrls = [
        url,
        url.replace(/^http:/i, 'https:'),
        url.replace(/^https:/i, 'http:'),
    ].filter((candidate, index, all) => all.indexOf(candidate) === index);
    let lastError;
    for (const targetUrl of targetUrls) {
        const proxyUrl = `https://r.jina.ai/${targetUrl}`;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const response = await fetchWithTimeout(proxyUrl, { headers: JINA_HEADERS });
                if (!response.ok) throw new Error(`Jina HTTP ${response.status}`);
                const body = await response.text();
                if (/performing security verification|please enable cookies|error 1102/i.test(body)) {
                    throw new Error('Jina returned a challenge page');
                }
                return body;
            } catch (error) {
                lastError = error;
                if (attempt < 2) await sleep(350 * (attempt + 1));
            }
        }
    }
    throw lastError ?? new Error('Jina reader failed');
}

async function getFullSourcePage(url) {
    let directError;
    try {
        const directBody = await getHtml(url);
        if (isUsableFullSourceResponse(url, directBody)) return directBody;
        directError = new Error('direct response was a challenge or empty page');
    } catch (error) {
        directError = error;
    }

    const path = url.replace(/^https?:\/\/isitinmycountry\.com/, '');
    let proxyError;
    for (const proxySource of FULL_PROXY_SOURCES) {
        const proxyUrl = `${proxySource}${path}`;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const response = await fetchWithTimeout(proxyUrl, { headers: JINA_HEADERS });
                if (!response.ok) throw new Error(`proxy HTTP ${response.status}`);
                const proxyBody = await response.text();
                if (isUsableFullSourceResponse(url, proxyBody)) return proxyBody;
                throw new Error('proxy returned a challenge or empty page');
            } catch (error) {
                proxyError = error;
                if (attempt < 2) await sleep(350 * (attempt + 1));
            }
        }
    }
    throw new Error(`direct ${directError.message}; proxy ${proxyError?.message || 'failed'}`);
}

const meta = (html, prop) => {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propertyMatch = html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'));
    const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'));
    return propertyMatch?.[1] ?? nameMatch?.[1];
};

function parseNetflixOfficialEpisodeMetadata(markdown) {
    const source = String(markdown || '');
    const episodeStart = source.search(/^##\s+Episodes\b/im);
    if (episodeStart < 0) return {};
    // Netflix's reader sometimes places the `## Trailers` heading before the
    // episode bullets, so do not use that heading as the end delimiter.
    const episodeSection = source.slice(episodeStart)
        .split(/\n##\s+(?:More Details|Watch offline|Audio|Subtitles|Cast|You Might Also Like)\b/i)[0];
    const inlineBulletPattern = /(?:^|\n|\s)\-\s+((?:\d+h\s*)?\d+m)\s+(\d+)\.\s+([\s\S]*?)(?=\s+\-\s+(?:\d+h\s*)?\d+m\s+\d+\.\s+|\s*$)/gi;
    // Some Netflix reader responses preserve each real episode still as an
    // image line, then put the number/title on the next line. Keep that shape
    // too so official episode stills are not discarded.
    const richBulletPattern = /(?:^|\n)\s*\-\s+(?:!\[[^\]]*\]\(([^)]+)\))?\s*((?:\d+h\s*)?\d+m)[ \t]*(?:\n[ \t]*)+([0-9]+)\\?\.[ \t]+([^\n]+)(?:\n[ \t]*)+([\s\S]*?)(?=\n\s*\-\s+|\s*$)/gi;
    const parseBullets = (section, seasonNumber) => {
        const inline = [...section.matchAll(inlineBulletPattern)].map(match => ({
            season: seasonNumber,
            episode: Number.parseInt(match[2], 10),
            raw: match[3],
        }));
        const rich = [...section.matchAll(richBulletPattern)].map(match => ({
            season: seasonNumber,
            episode: Number.parseInt(match[3], 10),
            name: match[4].trim(),
            still_path: match[1],
            raw: match[5],
        }));
        const parsed = [...rich, ...inline]
            .filter((episode, index, all) => all.findIndex(candidate => (
                candidate.season === episode.season && candidate.episode === episode.episode
            )) === index)
            .map(episode => {
                const raw = String(episode.raw || '')
                    .replace(/\s+(?:##|####)\s+.*$/s, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                const sentenceBoundary = raw.search(/(?<=[.!?])\s+(?=[A-Z0-9])/);
                return {
                    season: episode.season,
                    episode: episode.episode,
                    name: episode.name || (sentenceBoundary > 0 ? raw.slice(0, sentenceBoundary) : raw)
                        .trim().slice(0, 180) || `Episode ${episode.episode}`,
                    ...(episode.still_path ? { still_path: episode.still_path } : {}),
                };
            });
        return parsed;
    };

    const firstBulletIndex = episodeSection.search(/(?:^|\n)\s*\-\s+/);
    const seasonMarkers = [...episodeSection.matchAll(/Season\s+(\d+)/gi)]
        .filter(marker => firstBulletIndex < 0 || marker.index < firstBulletIndex);
    // The reader exposes a season selector before the currently selected
    // season's real episode list. Those selector labels are not delimiters;
    // attach the parsed list to the first selected season instead of dropping
    // every episode between `Season 1Season 2...` labels.
    const selectedSeason = Number.parseInt(seasonMarkers[0]?.[1] || '1', 10);
    const episodes = parseBullets(episodeSection, selectedSeason);
    if (!episodes.length) return {};

    const grouped = new Map();
    for (const episode of episodes) {
        if (!grouped.has(episode.season)) grouped.set(episode.season, []);
        grouped.get(episode.season).push(episode);
    }
    const seasons = [...grouped.entries()].map(([seasonNumber, seasonEpisodes]) => ({
        season_number: seasonNumber,
        name: `Season ${seasonNumber}`,
        episode_count: seasonEpisodes.length,
        episodes: seasonEpisodes,
    }));
    const seasonEpisodeCounts = seasons.map(season => season.episode_count);
    return {
        seasons,
        seasonEpisodeCounts,
        episodeCount: seasonEpisodeCounts.reduce((total, count) => total + count, 0),
        duration: `${seasons.length} Season${seasons.length === 1 ? '' : 's'}`,
    };
}

async function getNetflixOfficialMetadata(netflixId, kind = 'movie') {
    if (!netflixId) return {};
    let metadata = {};
    try {
        const html = await getHtml(`https://www.netflix.com/in/title/${netflixId}`);
        metadata = {
            imageUrl: meta(html, 'og:image') || meta(html, 'twitter:image') || '',
            description: decodeHtml(meta(html, 'og:description') || ''),
        };
    } catch (error) {
        console.log(`Netflix official metadata unavailable for ${netflixId} (${error.message})`);
    }
    if (kind === 'tv') {
        try {
            const markdown = await getJinaReaderPage(`https://www.netflix.com/in/title/${netflixId}`);
            metadata = { ...metadata, ...parseNetflixOfficialEpisodeMetadata(markdown) };
        } catch (error) {
            console.log(`Netflix official episode list unavailable for ${netflixId} (${error.message})`);
        }
    }
    return metadata;
}

const tvMazeCache = new Map();
async function getTvMazeEpisodeMetadata(title) {
    const key = normalizeLookupTitle(title);
    if (!key) return {};
    if (tvMazeCache.has(key)) return tvMazeCache.get(key);
    try {
        const url = new URL('https://api.tvmaze.com/singlesearch/shows');
        url.searchParams.set('q', title);
        url.searchParams.set('embed', 'episodes');
        const response = await fetchWithTimeout(url, { headers: UA });
        if (!response.ok) throw new Error(`TVMaze HTTP ${response.status}`);
        const show = await response.json();
        if (!show?.name || normalizeLookupTitle(show.name) !== key) {
            tvMazeCache.set(key, {});
            return {};
        }
        const episodes = Array.isArray(show._embedded?.episodes)
            ? show._embedded.episodes
                .filter(episode => episode?.season > 0 && episode?.number > 0)
                .map(episode => ({
                    season: episode.season,
                    episode: episode.number,
                    name: episode.name || '',
                    ...(episode.image?.original || episode.image?.medium
                        ? { still_path: episode.image.original || episode.image.medium }
                        : {}),
                }))
                .filter(episode => episode.name && !/^(?:episode\s+\d+|tba|to be announced)$/i.test(episode.name.trim()))
            : [];
        if (!episodes.length) {
            tvMazeCache.set(key, {});
            return {};
        }
        const grouped = new Map();
        for (const episode of episodes) {
            if (!grouped.has(episode.season)) grouped.set(episode.season, []);
            grouped.get(episode.season).push(episode);
        }
        const seasons = [...grouped.entries()].map(([seasonNumber, seasonEpisodes]) => ({
            season_number: seasonNumber,
            name: `Season ${seasonNumber}`,
            episode_count: seasonEpisodes.length,
            episodes: seasonEpisodes,
        }));
        const seasonEpisodeCounts = seasons.map(season => season.episode_count);
        const metadata = seasons.length
            ? {
                seasons,
                seasonEpisodeCounts,
                episodeCount: seasonEpisodeCounts.reduce((total, count) => total + count, 0),
                ...(show.image?.original ? { imageUrl: show.image.original } : {}),
                ...(show.summary ? { description: decodeHtml(show.summary) } : {}),
            }
            : {};
        tvMazeCache.set(key, metadata);
        return metadata;
    } catch (error) {
        console.log(`TVMaze episode enrichment skipped for ${title} (${error.message})`);
        tvMazeCache.set(key, {});
        return {};
    }
}

const jikanCache = new Map();
async function getJikanEpisodeMetadata(title) {
    const key = normalizeLookupTitle(title);
    if (!key) return {};
    if (jikanCache.has(key)) return jikanCache.get(key);
    try {
        const searchUrl = new URL('https://api.jikan.moe/v4/anime');
        searchUrl.searchParams.set('q', title);
        searchUrl.searchParams.set('limit', '5');
        const searchResponse = await fetchWithTimeout(searchUrl, { headers: UA });
        if (!searchResponse.ok) throw new Error(`Jikan search HTTP ${searchResponse.status}`);
        const search = await searchResponse.json();
        const match = search.data?.find(anime => [
            anime.title,
            anime.title_english,
            ...(anime.title_synonyms || []),
        ].some(candidate => normalizeLookupTitle(candidate) === key));
        if (!match?.mal_id) {
            jikanCache.set(key, {});
            return {};
        }

        const episodes = [];
        const firstEpisodeUrl = `https://api.jikan.moe/v4/anime/${match.mal_id}/episodes?page=1`;
        const firstResponse = await fetchWithTimeout(firstEpisodeUrl, { headers: UA });
        if (!firstResponse.ok) throw new Error(`Jikan episodes HTTP ${firstResponse.status}`);
        const firstPage = await firstResponse.json();
        const pages = Math.min(firstPage.pagination?.last_visible_page || 1, 5);
        const pagesData = [firstPage];
        for (let page = 2; page <= pages; page += 1) {
            await sleep(250);
            const pageResponse = await fetchWithTimeout(
                `https://api.jikan.moe/v4/anime/${match.mal_id}/episodes?page=${page}`,
                { headers: UA },
            );
            if (!pageResponse.ok) break;
            pagesData.push(await pageResponse.json());
        }
        for (const page of pagesData) {
            for (const episode of page.data || []) {
                if (!episode?.mal_id || !episode.title) continue;
                episodes.push({
                    season: 1,
                    episode: episode.mal_id,
                    name: episode.title,
                    ...(episode.images?.jpg?.image_url ? { still_path: episode.images.jpg.image_url } : {}),
                });
            }
        }
        const uniqueEpisodes = episodes.filter((episode, index, all) => (
            all.findIndex(candidate => candidate.episode === episode.episode) === index
        ));
        if (!uniqueEpisodes.length) {
            jikanCache.set(key, {});
            return {};
        }
        const metadata = {
            seasons: [{
                season_number: 1,
                name: 'Season 1',
                episode_count: uniqueEpisodes.length,
                episodes: uniqueEpisodes,
            }],
            seasonEpisodeCounts: [uniqueEpisodes.length],
            episodeCount: uniqueEpisodes.length,
        };
        jikanCache.set(key, metadata);
        return metadata;
    } catch (error) {
        console.log(`Jikan episode enrichment skipped for ${title} (${error.message})`);
        jikanCache.set(key, {});
        return {};
    }
}

const decodeHtml = (value) => String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

const htmlToText = (html) => decodeHtml(
    html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' '),
);

const OMDB_API_KEY = process.env.OMDB_API_KEY || '';
const OMDB_MAX_REQUESTS = Number.parseInt(process.env.OMDB_MAX_REQUESTS || '900', 10);
let omdbRequests = 0;
const omdbCache = new Map();

/**
 * OMDb is used only to enrich titles already discovered from a public
 * Netflix availability source. It is never required for the key-less fallback.
 */
async function getOmdb(params) {
    if (!OMDB_API_KEY) return null;
    const cacheKey = JSON.stringify(params);
    if (omdbCache.has(cacheKey)) return omdbCache.get(cacheKey);
    if (omdbRequests >= OMDB_MAX_REQUESTS) return null;
    omdbRequests += 1;

    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', OMDB_API_KEY);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`OMDb HTTP ${response.status}`);
    const payload = await response.json();
    const result = payload.Response === 'False' ? null : payload;
    omdbCache.set(cacheKey, result);
    return result;
}

const firstYear = (value) => {
    const match = String(value || '').match(/\d{4}/);
    return match ? match[0] : undefined;
};

const parseNumber = (value) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeLookupTitle = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const slugify = value => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const netflixOfficialIdByTitle = new Map(
    Object.entries(NETFLIX_OFFICIAL_IDS)
        .map(([title, id]) => [normalizeLookupTitle(title), id]),
);
const getNetflixOfficialId = title => netflixOfficialIdByTitle.get(normalizeLookupTitle(title));
const isBlockedCatalogTitle = item => BLOCKED_CATALOG_TITLE_PATTERN.test(String(item?.title || ''));

function isMatureCatalogItem(item) {
    const normalizedTitle = normalizeLookupTitle(item.title);
    if (MATURE_TITLE_PATTERNS.some(pattern => normalizedTitle.includes(pattern.replace(/[^a-z0-9]+/g, '')))) {
        return true;
    }
    return MATURE_DESCRIPTION_PATTERN.test(
        [item.description, item.rated, item.rating].filter(Boolean).join(' '),
    );
}

/** Remove mature titles from every normal shelf and append one dedicated row. */
function moveMatureToBottom(rows) {
    const matureItems = [];
    const matureKeys = new Set();
    const addMature = item => {
        if (isBlockedCatalogTitle(item)) return;
        const key = normalizeLookupTitle(item.title) || item.id;
        if (!key || matureKeys.has(key)) return;
        matureKeys.add(key);
        matureItems.push(item);
    };
    const cleanedRows = rows
        .map(row => {
            if (row.rowTitle === MATURE_ROW_TITLE) {
                (row.movies ?? []).filter(item => !isBlockedCatalogTitle(item)).forEach(addMature);
                return null;
            }
            const movies = (row.movies ?? []).filter(item => {
                if (isBlockedCatalogTitle(item)) return false;
                if (isMatureCatalogItem(item)) {
                    addMature(item);
                    return false;
                }
                return true;
            });
            return movies.length ? { ...row, movies } : null;
        })
        .filter(Boolean);

    return matureItems.length
        ? [...cleanedRows, { rowTitle: MATURE_ROW_TITLE, type: 'normal', movies: matureItems }]
        : cleanedRows;
}

async function getOmdbMetadata(item, kind) {
    if (!OMDB_API_KEY) return {};

    try {
        let detail = await getOmdb({
            t: item.title,
            type: kind === 'tv' ? 'series' : 'movie',
            plot: 'full',
        });
        // Exact OMDb title lookup misses punctuation/region variants. Search
        // only for an exact normalized title (and prefer the catalog year) so
        // provider IDs are improved without silently attaching a wrong movie.
        if (!detail?.imdbID) {
            const search = await getOmdb({
                s: item.title,
                type: kind === 'tv' ? 'series' : 'movie',
            });
            const expectedTitle = normalizeLookupTitle(item.title);
            const expectedYear = firstYear(item.year);
            const candidate = search?.Search?.find(result => (
                normalizeLookupTitle(result.Title) === expectedTitle
                && (!expectedYear || firstYear(result.Year) === expectedYear)
            )) ?? search?.Search?.find(result => (
                normalizeLookupTitle(result.Title) === expectedTitle
            ));
            if (candidate?.imdbID) {
                detail = await getOmdb({ i: candidate.imdbID, plot: 'full' });
            }
        }
        if (!detail?.imdbID) return {};

        const metadata = {
            ...(detail.imdbID ? { imdb_id: detail.imdbID } : {}),
            ...(detail.Poster && detail.Poster !== 'N/A' ? { imageUrl: detail.Poster } : {}),
            ...(firstYear(detail.Year) ? { year: firstYear(detail.Year) } : {}),
            ...(detail.Plot && detail.Plot !== 'N/A' ? { description: detail.Plot } : {}),
            ...(detail.Actors && detail.Actors !== 'N/A'
                ? { cast: detail.Actors.split(',').map(value => value.trim()).filter(Boolean) }
                : {}),
            ...(detail.Director && detail.Director !== 'N/A' ? { director: detail.Director } : {}),
            ...(detail.imdbRating && detail.imdbRating !== 'N/A'
                ? { rating: detail.imdbRating }
                : detail.Rated && detail.Rated !== 'N/A'
                    ? { rating: detail.Rated }
                    : {}),
            ...(detail.Rated && detail.Rated !== 'N/A' ? { rated: detail.Rated } : {}),
        };

        if (kind === 'tv') {
            const totalSeasons = parseNumber(detail.totalSeasons);
            if (totalSeasons) {
                metadata.duration = `${totalSeasons} Season${totalSeasons === 1 ? '' : 's'}`;
            }
            if (detail.Runtime && detail.Runtime !== 'N/A') {
                metadata.runtime = detail.Runtime;
            }

            if (detail.imdbID && totalSeasons) {
                const seasonResults = await Promise.all(
                    Array.from({ length: totalSeasons }, (_, index) => (
                        getOmdb({ i: detail.imdbID, Season: index + 1 })
                    )),
                );
                const seasons = seasonResults.map((season, seasonIndex) => {
                    const episodes = Array.isArray(season?.Episodes)
                        ? season.Episodes.map((episode, episodeIndex) => ({
                            season: seasonIndex + 1,
                            episode: parseNumber(episode.Episode) ?? episodeIndex + 1,
                            name: episode.Title && episode.Title !== 'N/A'
                                ? episode.Title
                                : `Episode ${episodeIndex + 1}`,
                        }))
                        : [];
                    return {
                        season_number: seasonIndex + 1,
                        name: `Season ${seasonIndex + 1}`,
                        episode_count: episodes.length,
                        ...(episodes.length ? { episodes } : {}),
                    };
                });
                const seasonEpisodeCounts = seasons.map(season => season.episode_count);
                if (seasonEpisodeCounts.some(Boolean)) {
                    metadata.seasons = seasons.filter(season => season.episode_count > 0);
                    metadata.seasonEpisodeCounts = seasonEpisodeCounts;
                    metadata.episodeCount = seasonEpisodeCounts.reduce((sum, count) => sum + count, 0);
                }
            }
        } else if (detail.Runtime && detail.Runtime !== 'N/A') {
            metadata.duration = detail.Runtime;
        }

        return metadata;
    } catch (error) {
        console.log(`OMDb enrichment skipped for ${item.title} (${error.message})`);
        return {};
    }
}

async function mapConcurrent(items, concurrency, mapper, onProgress) {
    const results = new Array(items.length);
    let cursor = 0;
    let completed = 0;
    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
            completed += 1;
            if (onProgress && (completed % 100 === 0 || completed === items.length)) {
                onProgress(completed, items.length);
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
    );
    return results;
}

function parseFullCatalogTitle(slug, html) {
    const text = htmlToText(html);
    const availabilityStart = text.search(/Availability by Country/i);
    const header = text.slice(0, availabilityStart > 0 ? availabilityStart : 900);
    const indiaStart = text.search(/\bIndia\s+Seasons\b/i);
    if (indiaStart < 0) return null;
    const india = text.slice(indiaStart, indiaStart + 600);
    const details = header.match(/(\d{4})\s*(?:·\s*)?(Series|Movie)\s*(?:·\s*)?([0-9]+(?:\s*(?:min|m|h|hr|hrs|hour|hours)(?:\s+[0-9]+\s*(?:min|m|h|hr|hrs|hour|hours))?)?)/i);
    if (!details) return null;

    const type = details[2].toLowerCase() === 'series' ? 'tv' : 'movie';
    const seasonRange = india.match(/S\s*1\s*[–—-]\s*S?\s*(\d+)/i);
    const headerSeasonCount = header.match(/\b(\d+)\s+Seasons?\b/i)?.[1];
    const seasonCount = seasonRange
        ? Number.parseInt(seasonRange[1], 10)
        : Number.parseInt(headerSeasonCount || '1', 10);
    const episodeMatch = india.match(/([\d,]+)\s+ep\./i);
    const episodeCount = episodeMatch
        ? Number.parseInt(episodeMatch[1].replace(/,/g, ''), 10)
        : undefined;
    const titleFromHeading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
        || html.match(/^Title:\s*(.*?)\s+—/im)?.[1];
    const title = decodeHtml(titleFromHeading || meta(html, 'og:title') || slug.replace(/-/g, ' '))
        .replace(/\s*[|—]\s*Netflix.*$/i, '')
        .trim();
    const runtime = details[3].trim();
    const netflixId = html.match(/netflix\.com\/title\/(\d+)/i)?.[1];
    const markdownPoster = html.match(/!\[[^\]]*poster[^\]]*\]\(([^)]+)\)/i)?.[1]
        || html.match(/!\[Image 1[^\]]*\]\(([^)]+)\)/i)?.[1];
    const metadataLineIndex = html.split(/\r?\n/).findIndex(line => (
        line.includes(details[1]) && new RegExp(`\\b${details[2]}\\b`, 'i').test(line)
    ));
    const markdownDescription = metadataLineIndex >= 0
        ? html.split(/\r?\n/).slice(metadataLineIndex + 1)
            .map(line => line.trim())
            .find(line => line && !line.startsWith('#') && !line.startsWith('!['))
        : undefined;
    const item = {
        id: `iinm-${slug}`,
        title,
        type: type === 'tv' ? 'SERIES' : 'FILM',
        mediaType: type,
        imageUrl: meta(html, 'og:image') || markdownPoster || '',
        description: meta(html, 'og:description') || markdownDescription,
        year: details[1],
        rating: header.match(new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*·)?\\s+${details[1]}(?:\\s*·)?`))?.[1],
        duration: type === 'tv'
            ? `${Math.max(seasonCount || 1, 1)} Season${seasonCount === 1 ? '' : 's'}`
            : runtime,
        ...(type === 'tv' && runtime ? { runtime } : {}),
        ...(episodeCount ? { episodeCount } : {}),
        ...(type === 'tv' && seasonCount === 1 && episodeCount ? { seasonEpisodeCounts: [episodeCount] } : {}),
        ...(netflixId ? { netflix_id: netflixId } : {}),
        videoUrl: SAMPLE_VIDEOS[slug.length % SAMPLE_VIDEOS.length],
    };
    return item;
}

function fullCatalogRows(label, items) {
    return Array.from({ length: Math.ceil(items.length / FULL_ROW_SIZE) }, (_, index) => {
        const start = index * FULL_ROW_SIZE;
        const end = Math.min(start + FULL_ROW_SIZE, items.length);
        return {
            rowTitle: `${label} ${start + 1}–${end}`,
            type: 'normal',
            movies: items.slice(start, end),
        };
    });
}

/** Current Netflix India presentation rows from JustWatch's daily provider
 * page. The broad title discovery still comes from IsItInMyCountry; this is
 * only the small, current Top 10 supplement used for the hero and first rows.
 */
async function scrapeJustWatchTop10(existingItems) {
    const markdown = await getJinaReaderPage('https://www.justwatch.com/in/provider/netflix');
    const start = markdown.indexOf('## Top 10 Movies & TV shows on Netflix');
    const end = markdown.indexOf('## All movies & TV shows on Netflix', start + 1);
    if (start < 0 || end <= start) throw new Error('JustWatch Top 10 section not found');
    const section = markdown.slice(start, end);
    const entries = [];
    const pattern = /(?:^|\n)(10|[1-9])\s+\n+\[!\[Image\s+\d+:\s*([^\]]+)\]\(([^)]+)\)[\s\S]*?\]\((https:\/\/www\.justwatch\.com\/in\/(?:movie|tv-show)\/[^)]+)\)/gi;
    for (const match of section.matchAll(pattern)) {
        entries.push({
            rank: Number.parseInt(match[1], 10),
            title: match[2].trim(),
            poster: match[3],
            url: match[4],
            mediaType: match[4].includes('/tv-show/') ? 'tv' : 'movie',
        });
    }
    const filteredEntries = entries.filter(entry => (
        !BLOCKED_TOP10_TITLES.has(entry.title)
        && !isBlockedCatalogTitle(entry)
        && !isMatureCatalogItem({ title: entry.title })
    ));
    const occupiedRanks = new Set(filteredEntries.map(entry => entry.rank));
    for (const replacement of TOP10_REPLACEMENTS) {
        if (filteredEntries.length >= 10) break;
        if (filteredEntries.some(entry => normalizeLookupTitle(entry.title) === normalizeLookupTitle(replacement.title))) {
            continue;
        }
        const rank = Array.from({ length: 10 }, (_, index) => index + 1)
            .find(candidate => !occupiedRanks.has(candidate));
        if (!rank) break;
        filteredEntries.push({
            ...replacement,
            rank,
            poster: '',
        });
        occupiedRanks.add(rank);
    }
    filteredEntries.sort((a, b) => a.rank - b.rank);
    entries.length = 0;
    entries.push(...filteredEntries);
    if (entries.length < 8) throw new Error(`JustWatch Top 10 too small (${entries.length})`);

    const existingByTitle = new Map(
        existingItems.map(item => [normalizeLookupTitle(item.title), item]),
    );
    const resolved = await Promise.all(entries.map(async entry => {
        const known = existingByTitle.get(normalizeLookupTitle(entry.title));
        if (known) {
            let enrichedKnown = known;
            if (!known.imdb_id && !known.tmdb_id) {
                const omdb = await getOmdbMetadata(known, entry.mediaType);
                enrichedKnown = {
                    ...known,
                    ...omdb,
                    imageUrl: known.imageUrl || omdb.imageUrl || '',
                    description: known.description || omdb.description,
                    rating: known.rating || omdb.rating,
                };
            }
            return {
                ...enrichedKnown,
                ranking_text: `#${entry.rank} in India Today`,
            };
        }
        const slug = entry.url.split('/').filter(Boolean).pop() || `rank-${entry.rank}`;
        const base = {
            id: `jw-${slug}`,
            title: entry.title,
            type: entry.mediaType === 'tv' ? 'SERIES' : 'FILM',
            mediaType: entry.mediaType,
            imageUrl: entry.poster,
            ranking_text: `#${entry.rank} in India Today`,
            videoUrl: SAMPLE_VIDEOS[entry.rank % SAMPLE_VIDEOS.length],
        };
        const omdb = await getOmdbMetadata(base, entry.mediaType);
        return {
            ...base,
            ...omdb,
            imageUrl: base.imageUrl || omdb.imageUrl || '',
            description: base.description || omdb.description,
            rating: base.rating || omdb.rating,
        };
    }));
    return {
        movieItems: resolved.filter(item => item.mediaType === 'movie'),
        showItems: resolved.filter(item => item.mediaType === 'tv'),
    };
}

/**
 * JustWatch publishes a popularity-sorted, paginated Netflix India catalog in
 * addition to its daily Top 10. The broad availability crawl remains the
 * IsItInMyCountry source of truth; these rows only add current titles that the
 * public crawl can lag, including newer Korean, anime and 2025/2026 releases.
 */
function parseJustWatchCatalogPage(markdown, kind) {
    const marker = kind === 'movie' ? '## All movies on Netflix' : '## All TV shows on Netflix';
    const start = markdown.indexOf(marker);
    const section = start >= 0 ? markdown.slice(start) : markdown;
    const pattern = /!\[Image\s+\d+:\s*([^\]]+)\]\((https?:\/\/images\.justwatch\.com\/poster\/[^)]+)\)(?:TV)?\]\((https?:\/\/www\.justwatch\.com\/in\/(movie|tv-show)\/[^)\s]+)\)/gi;
    const items = [];
    for (const match of section.matchAll(pattern)) {
        const mediaType = match[4] === 'tv-show' ? 'tv' : 'movie';
        if (mediaType !== kind) continue;
        const url = match[3];
        const slug = url.split('/').filter(Boolean).pop();
        if (!slug) continue;
        items.push({
            title: match[1].trim(),
            poster: match[2],
            url,
            slug,
            mediaType,
        });
    }
    return items;
}

async function scrapeJustWatchCatalog() {
    const kinds = [
        { kind: 'movie', path: 'movies' },
        { kind: 'tv', path: 'tv-shows' },
    ];
    const result = { movieItems: [], showItems: [] };

    for (const { kind, path } of kinds) {
        const firstUrl = `http://www.justwatch.com/in/provider/netflix/${path}`;
        const firstPage = await getJinaReaderPage(firstUrl);
        const totalMatch = firstPage.match(/\b\d+[–-]\d+\s*\/\s*([\d,]+)\b/);
        const total = totalMatch ? Number.parseInt(totalMatch[1].replace(/,/g, ''), 10) : JUSTWATCH_CATALOG_PAGE_SIZE;
        const pageCount = Math.min(
            JUSTWATCH_MAX_CATALOG_PAGES,
            Math.max(1, Math.ceil(total / JUSTWATCH_CATALOG_PAGE_SIZE)),
        );
        const pages = [firstPage];

        const otherPages = await Promise.all(
            Array.from({ length: pageCount - 1 }, async (_, index) => {
                const pageNumber = index + 2;
                try {
                    return await getJinaReaderPage(`${firstUrl}?page=${pageNumber}`);
                } catch (error) {
                    console.log(`JustWatch ${kind} page ${pageNumber} skipped (${error.message})`);
                    return '';
                }
            }),
        );
        pages.push(...otherPages.filter(Boolean));

        const seen = new Set();
        const parsed = pages
            .flatMap(page => parseJustWatchCatalogPage(page, kind))
            .filter(item => {
                if (!item.url || seen.has(item.url) || BLOCKED_TOP10_TITLES.has(item.title) || isBlockedCatalogTitle(item)) return false;
                seen.add(item.url);
                return true;
            });
        const items = parsed.map((item, index) => ({
            id: `jw-catalog-${kind}-${item.slug}`,
            title: item.title,
            type: kind === 'tv' ? 'SERIES' : 'FILM',
            mediaType: kind,
            imageUrl: item.poster,
            videoUrl: SAMPLE_VIDEOS[index % SAMPLE_VIDEOS.length],
            catalogSource: 'justwatch',
        }));
        if (kind === 'movie') result.movieItems = items;
        else result.showItems = items;
        console.log(`JustWatch current ${kind} catalog: ${items.length} titles from ${pages.length}/${pageCount} pages.`);
    }

    return result;
}

function mergeCatalogItems(baseItems, currentItems) {
    const merged = [...baseItems];
    const indexes = new Map();
    merged.forEach((item, index) => {
        const key = normalizeLookupTitle(item.title);
        if (key && !indexes.has(key)) indexes.set(key, index);
    });

    for (const current of currentItems) {
        const key = normalizeLookupTitle(current.title);
        const existingIndex = indexes.get(key);
        if (existingIndex === undefined) {
            indexes.set(key, merged.length);
            merged.push(current);
            continue;
        }
        const existing = merged[existingIndex];
        // Keep the broad source's description/IDs/episodes while using the
        // current JustWatch poster and catalog identity for this refreshed item.
        merged[existingIndex] = {
            ...existing,
            ...current,
            description: existing.description || current.description,
            imageUrl: current.imageUrl || existing.imageUrl,
        };
    }
    return merged;
}

function netflixCuratedRows(items) {
    const groups = new Map();
    for (const item of items) {
        const collection = item.catalogCollection;
        if (!collection) continue;
        if (!groups.has(collection)) groups.set(collection, []);
        groups.get(collection).push(item);
    }
    return [...groups.entries()].map(([rowTitle, movies]) => ({
        rowTitle,
        type: 'normal',
        movies,
    }));
}

/**
 * Curated Netflix-owned catalogue supplement. These titles are deliberately
 * separate from the live JustWatch rows: they represent Netflix ownership or
 * official Netflix editorial placement, not today's India popularity order.
 */
async function scrapeNetflixCuratedCatalog(existingItems) {
    const existingByTitle = new Map(
        existingItems
            .filter(item => item?.title)
            .map(item => [normalizeLookupTitle(item.title), item]),
    );
    const seen = new Set();
    const seeds = NETFLIX_CURATED_SEEDS.filter(([title]) => {
        const key = normalizeLookupTitle(title);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const items = await mapConcurrent(
        seeds,
        6,
        async ([title, mediaType, catalogCollection], index) => {
            const known = existingByTitle.get(normalizeLookupTitle(title));
            const netflixId = getNetflixOfficialId(title);
            const officialUrl = netflixId ? `https://www.netflix.com/in/title/${netflixId}` : undefined;
            const needsOfficialEpisodes = mediaType === 'tv' && !Array.isArray(known?.seasons);
            const official = netflixId && (!known?.imageUrl || needsOfficialEpisodes)
                ? await getNetflixOfficialMetadata(netflixId, mediaType)
                : {};
            const tvMazeFallback = mediaType === 'tv'
                && !Array.isArray(known?.seasons)
                && !Array.isArray(official.seasons)
                ? await getTvMazeEpisodeMetadata(title)
                : {};
            const curatedEpisodeFallback = mediaType === 'tv'
                && !Array.isArray(known?.seasons)
                && !Array.isArray(official.seasons)
                ? CURATED_EPISODE_FALLBACKS[title]
                : undefined;
            const episodeFallback = Array.isArray(tvMazeFallback.seasons)
                ? tvMazeFallback
                : curatedEpisodeFallback?.seasons
                    ? curatedEpisodeFallback
                    : mediaType === 'tv'
                        && catalogCollection === 'Netflix Anime & Animation'
                        && !Array.isArray(known?.seasons)
                        && !Array.isArray(official.seasons)
                        ? await getJikanEpisodeMetadata(title)
                        : {};
            if (known) {
                return {
                    ...known,
                    ...official,
                    ...episodeFallback,
                    ...(netflixId ? { netflixId, netflixUrl: officialUrl } : {}),
                    imageUrl: known.imageUrl || official.imageUrl || episodeFallback.imageUrl || '',
                    description: known.description || official.description || episodeFallback.description,
                    catalogSource: 'netflix-original',
                    catalogCollection,
                };
            }
            const base = {
                id: `jw-original-${slugify(title) || `title-${index}`}`,
                title,
                type: mediaType === 'tv' ? 'SERIES' : 'FILM',
                mediaType,
                imageUrl: '',
                videoUrl: SAMPLE_VIDEOS[index % SAMPLE_VIDEOS.length],
                ...(netflixId ? { netflixId, netflixUrl: officialUrl } : {}),
                catalogSource: 'netflix-original',
                catalogCollection,
            };
            const omdb = await getOmdbMetadata(base, mediaType);
            return {
                ...base,
                ...official,
                ...episodeFallback,
                ...omdb,
                catalogSource: 'netflix-original',
                catalogCollection,
                imageUrl: official.imageUrl || omdb.imageUrl || episodeFallback.imageUrl || '',
                description: official.description || omdb.description || episodeFallback.description,
            };
        },
        (completed, total) => console.log(`Netflix curated enrichment: ${completed}/${total}`),
    );
    console.log(`Netflix curated catalogue: ${items.length} seeded titles.`);
    return {
        items,
        movieItems: items.filter(item => item.mediaType === 'movie'),
        showItems: items.filter(item => item.mediaType === 'tv'),
        rows: netflixCuratedRows(items),
    };
}

/**
 * Broad public discovery path. IsItInMyCountry publishes a sitemap of title
 * pages and each page includes an India availability row. It is not an
 * official Netflix API, but it is materially broader than a Top 10 chart.
 */
async function scrapeFullPublicCatalog() {
    const sitemap = await getFullSourcePage(`${FULL_SOURCE}/sitemap.xml`);
    const xmlSlugs = [...sitemap.matchAll(/<loc>\s*https?:\/\/isitinmycountry\.com\/title\/([^<\s/]+)\/?\s*<\/loc>/gi)]
        .map(match => match[1]);
    const markdownSlugs = [...sitemap.matchAll(/\]\(https?:\/\/isitinmycountry\.com\/title\/([^)]*)\)/gi)]
        .map(match => match[1].replace(/\/$/, ''));
    const slugs = [...xmlSlugs, ...markdownSlugs]
        .filter((slug, index, all) => slug && all.indexOf(slug) === index);
    if (slugs.length < 500) throw new Error(`full sitemap too small (${slugs.length} titles)`);

    let pageFailures = 0;
    const pages = await mapConcurrent(
        slugs,
        FULL_PAGE_CONCURRENCY,
        async slug => {
            try {
                return { ok: true, item: parseFullCatalogTitle(slug, await getFullSourcePage(`${FULL_SOURCE}/title/${slug}`)) };
            } catch {
                pageFailures += 1;
                return { ok: false, item: null };
            }
        },
        (completed, total) => console.log(`Full catalog pages: ${completed}/${total}`),
    );
    const fetched = pages.length - pageFailures;
    const items = pages.map(page => page.item).filter(item => item && !isBlockedCatalogTitle(item));
    const movies = items.filter(item => item.mediaType === 'movie');
    const shows = items.filter(item => item.mediaType === 'tv');
    console.log(`Full catalog source: ${slugs.length} sitemap titles, ${fetched} pages fetched, ${items.length} India titles parsed.`);
    if (fetched < slugs.length * 0.60 || movies.length < 100 || shows.length < 30) {
        throw new Error(`full catalog incomplete (${items.length} India titles, ${fetched}/${slugs.length} pages)`);
    }

    // The public page has title-level metadata. Spend the server-side OMDb
    // budget mainly on series so season/episode details can be filled in.
    let seriesEnriched = 0;
    const enriched = await mapConcurrent(
        items,
        6,
        async item => {
            const shouldEnrich = Boolean(OMDB_API_KEY)
                && (item.mediaType === 'tv'
                    || !item.rating
                    || !item.description
                    || (!item.imdb_id && !item.tmdb_id))
                && (item.mediaType !== 'tv' || seriesEnriched++ < 300);
            if (!shouldEnrich) return item;
            const omdb = await getOmdbMetadata(item, item.mediaType);
            return {
                ...item,
                ...omdb,
                // Netflix artwork/plot is the discovery source of truth.
                imageUrl: item.imageUrl || omdb.imageUrl || '',
                description: item.description || omdb.description,
                rating: item.rating || omdb.rating,
            };
        },
        (completed, total) => console.log(`OMDb enrichment: ${completed}/${total}`),
    );
    const fullMovies = enriched.filter(item => item.mediaType === 'movie');
    const fullShows = enriched.filter(item => item.mediaType === 'tv');
    let currentCatalog = { movieItems: [], showItems: [] };
    try {
        currentCatalog = await scrapeJustWatchCatalog();
    } catch (error) {
        console.log(`Current JustWatch catalog supplement unavailable (${error.message}) — keeping broad catalog only.`);
    }
    let curatedCatalog = { items: [], movieItems: [], showItems: [], rows: [] };
    try {
        curatedCatalog = await scrapeNetflixCuratedCatalog([
            ...enriched,
            ...currentCatalog.movieItems,
            ...currentCatalog.showItems,
            ...existing.movies.flatMap(row => row.movies ?? []),
        ]);
    } catch (error) {
        console.log(`Netflix curated catalogue unavailable (${error.message}) — keeping live catalog only.`);
    }
    const mergedMovies = mergeCatalogItems(
        mergeCatalogItems(fullMovies, currentCatalog.movieItems),
        curatedCatalog.movieItems,
    );
    const mergedShows = mergeCatalogItems(
        mergeCatalogItems(fullShows, currentCatalog.showItems),
        curatedCatalog.showItems,
    );
    let top10 = { movieItems: [], showItems: [] };
    try {
        top10 = await scrapeJustWatchTop10([
            ...enriched,
            ...existing.movies.flatMap(row => row.movies ?? []),
        ]);
        console.log(`Current Netflix India Top 10: ${top10.movieItems.length} movies and ${top10.showItems.length} shows.`);
    } catch (error) {
        // Keep the last known chart visible if the daily presentation source
        // is temporarily blocked; the broad catalog remains authoritative.
        console.log(`Current Top 10 supplement unavailable (${error.message}) — keeping previous chart rows.`);
        top10 = {
            movieItems: existing.movies.find(row => row.rowTitle === 'Top 10 Movies in India Today')?.movies ?? [],
            showItems: existing.movies.find(row => row.rowTitle === 'Top 10 TV Shows in India Today')?.movies ?? [],
        };
    }
    return {
        source: 'isitinmycountry+justwatch',
        movieItems: mergedMovies,
        showItems: mergedShows,
        rows: [
            ...(top10.movieItems.length
                ? [{ rowTitle: 'Top 10 Movies in India Today', type: 'top_10', movies: top10.movieItems }]
                : []),
            ...(top10.showItems.length
                ? [{ rowTitle: 'Top 10 TV Shows in India Today', type: 'top_10', movies: top10.showItems }]
                : []),
            ...(currentCatalog.movieItems.length
                ? [{ rowTitle: 'JustWatch Current Movies in India', type: 'normal', movies: currentCatalog.movieItems }]
                : []),
            ...(currentCatalog.showItems.length
                ? [{ rowTitle: 'JustWatch Current TV Shows in India', type: 'normal', movies: currentCatalog.showItems }]
                : []),
            ...curatedCatalog.rows,
            ...fullCatalogRows('Netflix India Movies', mergedMovies),
            ...fullCatalogRows('Netflix India Series', mergedShows),
        ],
        extra: [],
    };
}

/** Scrape today's Netflix India top 10 (movies + TV shows). */
async function scrapeFlixPatrol() {
    const html = await getHtml('https://flixpatrol.com/top10/netflix/india/');
    const lowerHtml = html.toLowerCase();
    const decodeHtml = (value) => value
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();

    const parseSection = (headers) => {
        const starts = headers
            .map(header => lowerHtml.indexOf(header.toLowerCase()))
            .filter(index => index >= 0)
            .sort((a, b) => a - b);
        const start = starts[0];
        if (start === undefined) return [];

        const remaining = html.slice(start);
        const tableOffset = remaining.search(/<table\b/i);
        if (tableOffset < 0) return [];
        const tableStart = start + tableOffset;
        const tableEndOffset = html.slice(tableStart).search(/<\/table>/i);
        if (tableEndOffset < 0) return [];
        const table = html.slice(tableStart, tableStart + tableEndOffset);
        const rows = [...table.matchAll(/<a\b[^>]*href=["']\/title\/([^/"']+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi)];
        const seen = new Set();
        return rows
            .map(match => ({ slug: match[1], title: decodeHtml(match[2]) }))
            .filter(item => item.title && !seen.has(item.slug) && seen.add(item.slug))
            .slice(0, 10)
            .map((item, index) => ({ ...item, rank: index + 1 }));
    };

    const movies = parseSection(['TOP 10 Movies', 'TOP 10 Films']);
    const shows = parseSection(['TOP 10 TV Shows', 'TOP 10 Series']);
    if (!movies.length && !shows.length) throw new Error('no tables parsed');

    const enrich = async (item, kind) => {
        const omdb = await getOmdbMetadata(item, kind);
        const knownSeasonData = kind === 'tv' && SERIES_SEASON_EPISODES[item.title]
            ? { seasonEpisodeCounts: SERIES_SEASON_EPISODES[item.title] }
            : {};
        const knownEpisodeData = kind === 'tv' && SERIES_EPISODE_COUNTS[item.title]
            ? { episodeCount: SERIES_EPISODE_COUNTS[item.title] }
            : {};

        try {
            const page = await getHtml(`https://flixpatrol.com/title/${item.slug}/`);
            await sleep(300);
            return {
                id: `fp-${item.slug}`,
                title: item.title,
                type: kind === 'tv' ? 'SERIES' : 'FILM',
                mediaType: kind,
                ...omdb,
                // Curated mappings are the source of truth for audited series;
                // OMDb still fills every unknown title automatically.
                ...knownEpisodeData,
                ...knownSeasonData,
                imageUrl: meta(page, 'og:image') ?? omdb.imageUrl ?? '',
                description: meta(page, 'og:description') ?? omdb.description,
                ranking_text: `#${item.rank} in India Today`,
                youtubeId: TRAILERS[item.slug] || undefined,
                videoUrl: SAMPLE_VIDEOS[item.rank % SAMPLE_VIDEOS.length],
            };
        } catch {
            return {
                id: `fp-${item.slug}`,
                title: item.title,
                type: kind === 'tv' ? 'SERIES' : 'FILM',
                mediaType: kind,
                ...omdb,
                // Keep audited mappings ahead of external guesses.
                ...knownEpisodeData,
                ...knownSeasonData,
                imageUrl: omdb.imageUrl ?? '',
                ranking_text: `#${item.rank} in India Today`,
                videoUrl: SAMPLE_VIDEOS[item.rank % SAMPLE_VIDEOS.length],
            };
        }
    };

    const [movieItems, showItems] = await Promise.all([
        Promise.all(movies.map(m => enrich(m, 'movie'))),
        Promise.all(shows.map(s => enrich(s, 'tv'))),
    ]);

    return {
        movieItems,
        showItems,
        extra: [
            {
                rowTitle: 'Popular on Netflix',
                type: 'normal',
                movies: [...movieItems.slice(3), ...showItems.slice(3)],
            },
        ],
    };
}

const existing = JSON.parse(readFileSync(join(ROOT, 'data/movies.json'), 'utf8'));
const TRAILERS = JSON.parse(readFileSync(join(ROOT, 'data/trailers.json'), 'utf8'));

/** Refresh the current JustWatch shelves without repeating the slow broad crawl. */
async function refreshCurrentCatalog() {
    const current = await scrapeJustWatchCatalog();
    const existingItems = existing.movies.flatMap(row => row.movies ?? []);
    const knownByTitle = new Map(existingItems.map(item => [
        `${item.mediaType || item.type}:${normalizeLookupTitle(item.title)}`,
        item,
    ]));
    const currentItems = [...current.movieItems, ...current.showItems];
    const prepared = await mapConcurrent(
        currentItems,
        6,
        async item => {
            const known = knownByTitle.get(`${item.mediaType}:${normalizeLookupTitle(item.title)}`);
            const omdb = known?.imdb_id || known?.tmdb_id
                ? {}
                : await getOmdbMetadata(item, item.mediaType);
            return {
                ...known,
                ...item,
                ...omdb,
                // Keep the fresh JustWatch artwork and the old record's
                // playable IDs/episode metadata when the title is known.
                imageUrl: item.imageUrl || known?.imageUrl || omdb.imageUrl || '',
                description: known?.description || omdb.description,
                rating: known?.rating || omdb.rating,
            };
        },
        (completed, total) => console.log(`Current catalog enrichment: ${completed}/${total}`),
    );
    let curatedCatalog = { items: [], movieItems: [], showItems: [], rows: [] };
    try {
        curatedCatalog = await scrapeNetflixCuratedCatalog([...existingItems, ...prepared]);
    } catch (error) {
        console.log(`Netflix curated catalogue unavailable (${error.message}) — keeping existing editorial shelves.`);
    }
    const curatedByTitle = new Map(
        curatedCatalog.items.map(item => [
            `${item.mediaType}:${normalizeLookupTitle(item.title)}`,
            item,
        ]),
    );
    // The same title can appear in a current JustWatch shelf and in a curated
    // Netflix shelf. Copy official episode metadata back to the current object
    // too, because detail navigation resolves the first matching id in row
    // order. This prevents a current card from losing its real episode list.
    const hydratedPrepared = prepared.map(item => {
        const curated = curatedByTitle.get(`${item.mediaType}:${normalizeLookupTitle(item.title)}`);
        if (!curated) return item;
        return {
            ...item,
            ...curated,
            id: item.id,
            catalogSource: item.catalogSource,
            catalogCollection: curated.catalogCollection,
            imageUrl: item.imageUrl || curated.imageUrl || '',
            description: item.description || curated.description,
            rating: item.rating || curated.rating,
        };
    });
    const movieItems = hydratedPrepared.filter(item => item.mediaType === 'movie');
    const showItems = hydratedPrepared.filter(item => item.mediaType === 'tv');
    const rebuilt = new Set([
        'JustWatch Current Movies in India',
        'JustWatch Current TV Shows in India',
        ...NETFLIX_CURATED_ROW_TITLES,
    ]);
    let top10 = {
        movieItems: existing.movies.find(row => row.rowTitle === 'Top 10 Movies in India Today')?.movies ?? [],
        showItems: existing.movies.find(row => row.rowTitle === 'Top 10 TV Shows in India Today')?.movies ?? [],
    };
    try {
        top10 = await scrapeJustWatchTop10([...existingItems, ...hydratedPrepared]);
    } catch (error) {
        console.log(`Current Top 10 refresh unavailable (${error.message}) — keeping previous chart rows.`);
    }
    const top10Rows = [
        ...(top10.movieItems.length
            ? [{ rowTitle: 'Top 10 Movies in India Today', type: 'top_10', movies: top10.movieItems }]
            : []),
        ...(top10.showItems.length
            ? [{ rowTitle: 'Top 10 TV Shows in India Today', type: 'top_10', movies: top10.showItems }]
            : []),
    ];
    const remainingRows = existing.movies.filter(row => row.type !== 'top_10' && !rebuilt.has(row.rowTitle));
    const nextRows = moveMatureToBottom([
        // Preserve the Home contract: Hero, Top 10 Movies, Top 10 TV Shows,
        // then the current shelves and the older broad catalog.
        ...top10Rows,
        ...(movieItems.length
            ? [{ rowTitle: 'JustWatch Current Movies in India', type: 'normal', movies: movieItems }]
            : []),
        ...(showItems.length
            ? [{ rowTitle: 'JustWatch Current TV Shows in India', type: 'normal', movies: showItems }]
            : []),
        ...curatedCatalog.rows,
        ...remainingRows,
    ]);

    await Promise.all([
        ...hydratedPrepared,
        ...curatedCatalog.items,
        ...top10.movieItems,
        ...top10.showItems,
    ].map(item => savePoster(item)));
    writePosterIndex();
    writeFileSync(join(ROOT, 'data/movies.json'), JSON.stringify({ movies: nextRows }, null, 4));
    console.log(`Current catalog refreshed: ${movieItems.length} movies and ${showItems.length} TV titles.`);
}

/** Enrich the last good catalog without repeating the slow public crawl. */
async function enrichExistingCatalog() {
    if (!OMDB_API_KEY) {
        throw new Error('enrich-existing requires the OMDB_API_KEY repository secret');
    }

    const rows = existing.movies ?? [];
    const items = rows.flatMap(row => row.movies ?? []);
    let resolvedIds = 0;
    const enrichedItems = await mapConcurrent(
        items,
        6,
        async item => {
            const needsId = !item.imdb_id && !item.tmdb_id;
            const needsEpisodeDetails = item.mediaType === 'tv' && !Array.isArray(item.seasons);
            if (!needsId && !needsEpisodeDetails) return item;

            const omdb = await getOmdbMetadata(item, item.mediaType === 'tv' ? 'tv' : 'movie');
            const enriched = {
                ...item,
                ...omdb,
                imageUrl: item.imageUrl || omdb.imageUrl || '',
                description: item.description || omdb.description,
                rating: item.rating || omdb.rating,
            };
            if (needsId && (enriched.imdb_id || enriched.tmdb_id)) resolvedIds += 1;
            return enriched;
        },
        (completed, total) => console.log(`Embed ID enrichment: ${completed}/${total}`),
    );

    const byId = new Map(enrichedItems.map(item => [item.id, item]));
    const enrichedRows = rows.map(row => ({
        ...row,
        movies: (row.movies ?? []).map(item => byId.get(item.id) ?? item),
    }));
    await Promise.all(enrichedItems.map(item => savePoster(item)));
    writePosterIndex();
    writeFileSync(join(ROOT, 'data/movies.json'), JSON.stringify({ movies: enrichedRows }, null, 4));
    const playable = enrichedItems.filter(item => item.imdb_id || item.tmdb_id).length;
    console.log(`Existing catalog enriched: ${resolvedIds} new IDs resolved; ${playable}/${enrichedItems.length} titles can use Nxsha/NHD embeds.`);
}

async function refreshTop10Rows() {
    const rows = existing.movies ?? [];
    const items = rows.flatMap(row => row.movies ?? []);
    const top10 = await scrapeJustWatchTop10(items);
    const rebuilt = new Set([
        'Top 10 Movies in India Today',
        'Top 10 TV Shows in India Today',
    ]);
    const remainingRows = rows.filter(row => !rebuilt.has(row.rowTitle));
    const nextRows = moveMatureToBottom([
        ...(top10.movieItems.length
            ? [{ rowTitle: 'Top 10 Movies in India Today', type: 'top_10', movies: top10.movieItems }]
            : []),
        ...(top10.showItems.length
            ? [{ rowTitle: 'Top 10 TV Shows in India Today', type: 'top_10', movies: top10.showItems }]
            : []),
        ...remainingRows,
    ]);
    await Promise.all(top10.movieItems.concat(top10.showItems).map(item => savePoster(item)));
    writePosterIndex();
    writeFileSync(join(ROOT, 'data/movies.json'), JSON.stringify({ movies: nextRows }, null, 4));
    console.log(`Top 10 rows refreshed: ${top10.movieItems.length} movies and ${top10.showItems.length} shows.`);
}

if (process.env.CATALOG_DISCOVERY === 'refresh-current') {
    await refreshCurrentCatalog();
    process.exit(0);
}
if (process.env.CATALOG_DISCOVERY === 'enrich-existing') {
    await enrichExistingCatalog();
    process.exit(0);
}
if (process.env.CATALOG_DISCOVERY === 'refresh-top10') {
    await refreshTop10Rows();
    process.exit(0);
}

let data;
const useFullSource = process.env.CATALOG_DISCOVERY !== 'top10';
if (useFullSource) {
    try {
        data = await scrapeFullPublicCatalog();
        console.log(`Discovered ${data.movieItems.length} movies and ${data.showItems.length} India titles from the public full catalog.`);
    } catch (error) {
        console.log(`Full public catalog unavailable (${error.message}) — trying the daily Top 10.`);
    }
}
if (!data) {
    try {
        data = await scrapeFlixPatrol();
        console.log('Scraped FlixPatrol Netflix India TOP 10 (no API key needed).');
    } catch (error) {
        // A temporary block, DNS failure, or changed HTML must never erase the
        // last known-good catalog. Exiting successfully also keeps the daily
        // GitHub Action green while the next run retries discovery.
        console.log(`Public discovery unavailable (${error.message}) — keeping existing catalog.`);
        process.exit(0);
    }
}

const {
    movieItems: discoveredMovies = [],
    showItems: discoveredShows = [],
    extra = [],
    rows: discoveredRows,
} = data;
const isFullCatalog = Array.isArray(discoveredRows);
const previousMovies = existing.movies.find(r => r.rowTitle === 'Top 10 Movies in India Today')?.movies ?? [];
const previousShows = existing.movies.find(r => r.rowTitle === 'Top 10 Series in India Today')?.movies ?? [];
const movieItems = isFullCatalog || discoveredMovies.length ? discoveredMovies : previousMovies;
const showItems = isFullCatalog || discoveredShows.length ? discoveredShows : previousShows;
if (!movieItems.length && !showItems.length) {
    console.log('Nothing fetched and no previous catalog exists — keeping files unchanged.');
    process.exit(0);
}
if (!isFullCatalog && (!discoveredMovies.length || !discoveredShows.length)) {
    console.log('Discovery returned only one chart; carrying forward the missing chart from the previous catalog.');
}

const REBUILT = new Set([
    'Top 10 Movies in India Today',
    'Top 10 Series in India Today',
    'Top 10 TV Shows in India Today',
    'Popular on Netflix',
    'JustWatch Current Movies in India',
    'JustWatch Current TV Shows in India',
    ...(isFullCatalog ? NETFLIX_CURATED_ROW_TITLES : []),
]);
const isRebuiltRow = row => REBUILT.has(row.rowTitle)
    || /^Netflix India (Movies|Series) \d+[–-]\d+$/.test(row.rowTitle);
const evergreen = existing.movies.filter(
    r => r.type !== 'games' && r.type !== 'top_10' && !isRebuiltRow(r),
);
const sourceRows = discoveredRows ?? [
    { rowTitle: 'Top 10 Movies in India Today', type: 'top_10', movies: movieItems },
    { rowTitle: 'Top 10 Series in India Today', type: 'top_10', movies: showItems },
];

const rows = moveMatureToBottom([
    ...sourceRows,
    ...extra,
    ...evergreen,
].filter(r => r && r.movies?.length));

// If today's source omits artwork or blocks a download, reuse a bundled poster
// from the last successful catalog for the same title before falling back to a
// remote URL. This keeps cards and episode thumbnails non-blank.
const normalizeTitle = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const previousArtwork = new Map();
for (const item of existing.movies.flatMap(r => r.movies ?? [])) {
    if (!item.title || !item.imageUrl) continue;
    const key = normalizeTitle(item.title);
    const oldImage = previousArtwork.get(key);
    // Prefer a bundled asset over an older remote URL when duplicates exist.
    if (!oldImage || String(item.imageUrl).startsWith('local:')) {
        previousArtwork.set(key, item.imageUrl);
    }
}
const allItems = rows.flatMap(r => r.movies);

// Bundle poster art locally (hotlink-proof), then persist the catalog.
await Promise.all(allItems.map(item => (
    savePoster(item, previousArtwork.get(normalizeTitle(item.title)))
)));
writePosterIndex();

writeFileSync(join(ROOT, 'data/movies.json'), JSON.stringify({ movies: rows }, null, 4));
console.log(`Catalog refreshed: ${rows.length} rows (${movieItems.length} movies, ${showItems.length} shows).`);
