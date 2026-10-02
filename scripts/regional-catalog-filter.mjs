/**
 * Regional catalog policy for this build of the UI.
 *
 * The product brief for this deployment is "Indian + Korean + Anime only":
 * English/Hollywood (and other non-target international) titles must not be
 * shown anywhere in the app. The daily refresh keeps pulling the full Netflix
 * India catalog, so the policy lives here as a reusable filter instead of a
 * one-off hand edit of data/movies.json.
 *
 * Classification is title based (the upstream sources expose no language
 * field):
 *   - KEEP_INDIAN / KEEP_KOREAN / KEEP_ANIME are curated allow-lists.
 *   - Anything not on a list is treated as non-target content and dropped.
 *
 * Usage:
 *   node scripts/regional-catalog-filter.mjs           # rewrite data/movies.json
 *   import { applyRegionalPolicy } from './regional-catalog-filter.mjs'
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const KEEP_INDIAN = [
    '72 HOURS', 'Alpha', 'Andhra King Taluka', 'Animal', 'Baby Do Die Do', 'Bajrangi Bhaijaan',
    'Beast', 'Best of the Best', 'Bharathanyam 2 Mohiniyattam', 'Bheed', 'Bhooth Bangla', 'Bigg Boss',
    'Billu', 'Border 2', 'Bāhubali: The Beginning', 'Chak De! India', 'Chalte Chalte',
    'Chatha Pacha: The Ring of Rowdies', 'Chennai Express', 'Chhaava', 'Chhota Bheem: Master of Shaolin',
    'Chumbak', 'Cirkus', 'Cocktail 2', 'Crew', 'Crew Girl', 'Daawat-e-Ishq', 'Dangal', 'David',
    'Dear Zindagi', 'Delhi Crime', 'Detective Ujjwalan', 'Dhamaal 4', 'Dhoom 2', 'Dhoom 3',
    'Dhurandhar', 'Dhurandhar: The Revenge', 'Dil Chahta Hai', 'Dil Dhadakne Do', 'Dilwale',
    'Dilwale Dulhania Le Jayenge', 'Don', 'Dragon', 'Dude', 'Dum Laga Ke Haisha', 'Duniya',
    'Emergency', 'Fighter', 'Fukrey', 'G.D.N', 'Gandhari', 'Gangubai Kathiawadi', 'Gatta Kusthi',
    'Gatta Kusthi 2', 'Gunjan Saxena: The Kargil Girl', 'Guns & Gulaabs', 'Guntur Kaaram',
    'Hanuman Ansh', 'Happy Patel - Khatarnak Jasoos', 'Heeramandi', 'Heeramandi: The Diamond Bazaar',
    'Hello Bachhon', 'Hey! Sinamika', 'Idhayam Murali', 'Ikka', "India's Got Latent", 'Iratta',
    'Irumudi', 'Jaat', 'Jack', 'Jamtara - Sabka Number Ayega', 'Jawan', 'Jogi', 'Kaantha',
    'Kalagathalaivan', 'Kalki 2898-AD', 'Kantara', 'Karthik Calling Karthik', 'Khakee: The Bihar Chapter',
    'Korean Kanakaraju', 'Kota Factory', 'Kurukshetra', 'LSD 2: Love Sex aur Dhokha 2', 'Laila Majnu',
    'Luck by Chance', 'Lucky Baskhar', 'Lust Stories', 'Lust Stories 2', 'Lust Stories 3', 'Maa',
    'Maamla Legal Hai', 'Maharaja', 'Mahavatar Narsimha', 'Main Hoon Na', 'Main Vaapas Aaunga',
    'Mallari', 'Mandala Murders', 'Mastram', 'Meiyazhagan', 'Mimi', 'Mirzapur', 'Mirzapur: The Movie',
    'Mismatched', 'Modha Rathri', 'Mohabbatein', 'Monica, O My Darling', 'Mr. Bachchan', 'Musafir Cafe',
    'Oh Darling Yeh Hai India', 'Oho Enthan Baby', 'Ok Jaanu',
    'Operation Safed Sagar: The Untold Story of the Kargil War', 'PK', 'Pati Patni Aur Woh Do',
    'Pattathu Arasan', 'Peddi', 'Perusu', 'Pushpa: The Rule - Part 2', 'Pyaar Prema Kalyanam', 'RRR',
    'Raakaasa', 'Rab Ne Bana Di Jodi', 'Radhe Shyam', 'Raja Shivaji', 'Ram Jaane', 'Rao Bahadur',
    'Saaho', 'Sacred Games', 'Saiyaara', 'Salaam Namaste', 'Salaar', 'Salaar: Part 1 - Ceasefire',
    'Sarbath', 'Saripodhaa Sanivaaram', 'Shaque: Trust No One', 'She', 'Shehzada', 'Shyam Singha Roy',
    'Sing Geetham', 'Skater Girl', 'Sohni Mahiwal', 'Son of Sardaar 2', 'Sorga Vaasal', 'Stolen',
    'Student of the Year 2', 'Sui Dhaaga - Made in India', 'Sultan', 'Super Subbu', 'Taj Mahal 1989',
    'Talaash', "Taskaree: The Smuggler's Web", 'Tere Ishk Mein', 'Thambi', 'Thank You for Coming',
    'The Ba***ds of Bollywood', 'The Ghazi Attack', 'The Great Indian Kapil Show', 'The Railway Men',
    'The Railway Men - The Untold Story of Bhopal 1984', 'The Romantics', 'The Sky Is Pink',
    'Thottappan', 'Titli', 'Tu Yaa Main', 'Tuesdays & Fridays', 'Tughlaq Durbar', 'Typewriter',
    'Upstarts', 'Uriyadi 2', 'Veer-Zaara', 'Veere Di Wedding', 'Vijay 69', 'Vishwanath & Sons',
    'Waiting Hai', 'War 2', 'Zakir Khan: Papa Yaar', 'Zindagi Na Milegi Dobara',
];

export const KEEP_KOREAN = [
    "A Good Lawyer's Wife", 'A Model Family', 'Agent Kim Reactivated', 'Alchemy of Souls',
    'All of Us Are Dead', 'Along with the Gods: The Two Worlds', 'Badly in Love',
    'Banjjagineun Woteomellon', 'Be Melodramatic', 'Black Knight', 'Bloodhounds', 'Business Proposal',
    'Crash Landing on You', 'D.P.', 'Destined with You', 'Doctor Slump', 'Doctor Stranger',
    'Dr. Romantic', 'Everything About My Wife', 'Extraordinary Attorney Woo',
    'Forecasting Love and Weather', 'Forgotten', 'Guardian: The Lonely and Great God', 'Hellbound',
    'Hello Ghost', 'Her Private Life', 'Hometown Cha-Cha-Cha', 'Hospital Playlist', "I'm not a robot",
    'Inspector Koo', "It's Okay to Not Be Okay", 'Itaewon Class', 'Jjajangmyeon Rhapsody',
    'KPop Demon Hunters', 'KPop Demon Hunters Lyric Videos', 'Kingdom', 'Kingdom: Ashin of the North',
    'Kongsuni and Friends', 'Korean Cold Noodle Rhapsody', 'Larva Family', 'Lee Su-geun: The Sense Coach',
    "Let's Go! Pororo Rangers", 'Like Flowers in Sand', 'Lookism', 'Love After Divorce',
    'Love Next Door', 'Made in Korea', 'Mercy for None', 'Misty', 'Move to Heaven', 'Mr. Plankton',
    'Mr. Queen', 'Mujigae', 'My Demon', 'My Name', 'Oh My Venus', 'Okja', 'One Spring Night',
    'Our Blooming Youth', 'Our Sticky Love', 'Queen of Tears', 'Reply 1988', 'Seoul Vibe', 'Signal',
    'Sing Again', 'Sisyphus', 'Song of the Bandits', 'Space Sweepers', 'Squid Game', 'Start-Up',
    'Strong Girl Nam-soon', 'Sweet Home', 'Tale of the Nine Tailed', "Tayo's Singalong Show",
    'Technoboys', 'That Winter, the Wind Blows', 'The 8 Show', 'The Drug King', 'The Early Spring',
    'The Game: You Never Play Alone', 'The Glory', 'The Good Detective', 'The Great Flood',
    'The King: Eternal Monarch', 'The Raincoat Killer: Chasing a Predator in Korea', 'The Silent Sea',
    'The Trauma Code: Heroes on Call', 'The Uncanny Counter', 'The WONDERfools', 'The Winning Try',
    'Time to Hunt', 'Trigger', 'True Beauty', 'Tune in for Love', 'Twenty-Five Twenty-One', 'Vincenzo',
    'Weak Hero', 'When Life Gives You Tangerines', 'Wonderland', 'Yeoshingangrim',
];

export const KEEP_ANIME = [
    'Aggretsuko', 'Alice in Borderland', 'Assassination Classroom', 'BAKI-DOU: The Invincible Samurai',
    'BEASTARS', 'Baki', 'Baki Hanma', 'Black Clover', 'Bleach', 'Bleach: Sennen Kessen-hen', 'Blue Box',
    'Blue Eye Samurai', 'Blue Lock', 'Boruto: Naruto Next Generations', 'Castlevania',
    'Castlevania: Nocturne', 'Chainsmoker Cat', 'Classroom of the Elite', 'Cyberpunk: Edgerunners',
    'Daemons of the Shadow Realm', 'Death Note', 'Delicious in Dungeon', 'Demon Slayer: Kimetsu no Yaiba',
    'Detective Conan', 'Detective Conan : Countdown to Heaven', 'Devil May Cry', 'Devilman Crybaby',
    'Doctor-X: Surgeon Michiko Daimon', 'Dr. STONE', 'Dragon Ball Z', 'Earwig and the Witch', 'Erased',
    'Fermat’s Cuisine', "Food Wars!: Shokugeki no Soma", "Frieren: Beyond Journey's End",
    "Frieren: Beyond the Journey's End", 'From Up on Poppy Hill', 'Fruits Basket',
    'Fullmetal Alchemist: Brotherhood', 'GODZILLA City on the Edge of Battle', 'Godzilla Minus One',
    'Grave of the Fireflies', 'Haikyu!!', 'Hunter x Hunter', 'InuYasha', "JoJo's Bizarre Adventure",
    'Jujutsu Kaisen', 'Just a Bit Espers', 'K-foodie meets J-foodie', 'Kakegurui', 'Kengan Ashura',
    'Kimetsu no Yaiba', 'Koinaka', "Kuroko's Basketball", 'Kusuriya no Hitorigoto',
    'Last Samurai Standing', "Let's Get Divorced", 'Little Witch Academia', 'Million-Follower Detective',
    'Mob Psycho 100', 'Mobile Suit Gundam Seed', 'Mushoku Tensei: Jobless Reincarnation',
    'My Dress-Up Darling', 'My Happy Marriage', 'My Hero Academia', 'My Hero Academia: Vigilantes',
    'My Housekeeper Nagisa-san', "My Husband Won't Fit", 'Naruto', 'Naruto: Shippûden',
    'Neon Genesis Evangelion', 'Nodame Cantabile', 'ONE PIECE', 'One Piece Film: Gold',
    'One Punch Man: Wanpanman', 'One-Punch Man', 'Overlord', 'PLUTO',
    'Re:Zero kara Hajimeru Isekai Seikatsu', 'Record of Ragnarok', 'Rising Impact',
    'Rurouni Kenshin Part I: Origins', 'SAKAMOTO DAYS', 'SPY x FAMILY', 'Saitama Host Club',
    'Seven Deadly Sins', 'Shaman King Flowers', 'Smoking Behind the Supermarket with You',
    'Spice and Wolf: Merchant Meets The Wise Wolf', 'Spirited Away', 'Stand by Me Doraemon', 'THE DAYS',
    'THE FABLE', 'Tales from Earthsea', 'Tekken: Bloodline', 'Tensei Shitara Suraimu Datta Ken',
    'Terminator Zero', 'That Time I Got Reincarnated as a Slime', 'The 19th Medical Chart',
    'The Apothecary Diaries', 'The Black Swindler', 'The Black Swindler (2022)', 'The Boy and the Heron',
    'The Cat Returns', 'The Fragrant Flower Blooms with Dignity',
    'The Makanai: Cooking for the Maiko House', 'The Naked Director',
    "The Reason Why Raeliana Ended up at the Duke's Mansion", 'The Rising of the Shield Hero',
    'The Seven Deadly Sins', 'The Seven Deadly Sins the Movie: Prisoners of the Sky',
    'The Violence Action', 'Ties of Shooting Stars', 'Tis Time for "Torture," Princess', 'Tokyo Ghoul',
    'Tokyo Override', 'Tougen Anki', 'Ultramarine Magmell', 'Usogui', 'Vinland Saga',
    'Violet Evergarden', 'Wind Breaker', 'Witch Hat Atelier', 'Your Turn to Kill', 'Yu Yu Hakusho',
];

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const toSet = (list) => new Set(list.map(norm));

const INDIAN = toSet(KEEP_INDIAN);
const KOREAN = toSet(KEEP_KOREAN);
const ANIME = toSet(KEEP_ANIME);

/** 'indian' | 'korean' | 'anime' | null (null = drop it) */
export function classifyTitle(title) {
    const key = norm(title);
    if (!key) return null;
    if (INDIAN.has(key)) return 'indian';
    if (KOREAN.has(key)) return 'korean';
    if (ANIME.has(key)) return 'anime';
    return null;
}

const CHUNK = 48;

function uniqueById(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = item.id || norm(item.title);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function chunkRows(label, items) {
    const rows = [];
    for (let i = 0; i < items.length; i += CHUNK) {
        const slice = items.slice(i, i + CHUNK);
        rows.push({
            rowTitle: `${label} ${i + 1}–${i + slice.length}`,
            type: 'normal',
            movies: slice,
        });
    }
    return rows;
}

/**
 * Drop every non Indian / Korean / anime title and reshape the shelves so no
 * row is left empty or renamed-but-irrelevant.
 */
export function applyRegionalPolicy(rows) {
    const tagged = rows.map((row) => ({
        ...row,
        movies: row.movies
            .map((movie) => ({ movie, region: classifyTitle(movie.title) }))
            .filter((entry) => entry.region)
            .map((entry) => entry.movie),
    }));

    const everything = uniqueById(tagged.flatMap((row) => row.movies));
    const pool = (region, kind) =>
        everything.filter(
            (item) => classifyTitle(item.title) === region && (!kind || item.mediaType === kind),
        );

    const koreanSeries = pool('korean', 'tv');
    const koreanMovies = pool('korean', 'movie');
    const anime = pool('anime');
    const indian = pool('indian');

    const isIndiaCatalogRow = (row) => row.rowTitle.startsWith('Netflix India ');
    const catalogMovies = uniqueById(
        tagged.filter((r) => r.rowTitle.startsWith('Netflix India Movies')).flatMap((r) => r.movies),
    );
    const catalogSeries = uniqueById(
        tagged.filter((r) => r.rowTitle.startsWith('Netflix India Series')).flatMap((r) => r.movies),
    );

    // Hollywood/English-only shelves are repurposed into Indian / Korean /
    // anime shelves instead of being left empty.
    const REPLACEMENTS = new Map([
        [
            'Netflix Originals & Series',
            { rowTitle: 'Indian Series & Originals', movies: indian.filter((i) => i.mediaType === 'tv') },
        ],
        ['Netflix Original Movies', { rowTitle: 'Korean Movies', movies: koreanMovies }],
        ['Netflix Documentaries', { rowTitle: 'Anime Movies & Specials', movies: pool('anime', 'movie') }],
        [
            'Action & Hollywood Blockbusters in Hindi',
            { rowTitle: 'Indian Action Blockbusters', movies: indian.filter((i) => i.mediaType === 'movie').slice(0, 30) },
        ],
        [
            'Binge-Worthy International Series',
            { rowTitle: 'Binge-Worthy Korean & Anime Series', movies: uniqueById([...koreanSeries, ...anime.filter((i) => i.mediaType === 'tv')]).slice(0, 30) },
        ],
    ]);

    const out = [];
    let movieChunksDone = false;
    let seriesChunksDone = false;

    for (const row of tagged) {
        if (row.rowTitle.startsWith('Netflix India Movies')) {
            if (!movieChunksDone) {
                out.push(...chunkRows('Netflix India Movies', catalogMovies));
                movieChunksDone = true;
            }
            continue;
        }
        if (row.rowTitle.startsWith('Netflix India Series')) {
            if (!seriesChunksDone) {
                out.push(...chunkRows('Netflix India Series', catalogSeries));
                seriesChunksDone = true;
            }
            continue;
        }

        const replacement = REPLACEMENTS.get(row.rowTitle);
        if (replacement) {
            if (replacement.movies.length) {
                out.push({ rowTitle: replacement.rowTitle, type: row.type ?? 'normal', movies: replacement.movies });
            }
            continue;
        }

        if (row.rowTitle === 'Netflix Korean Originals') {
            out.push({ ...row, rowTitle: 'Korean Series & K-Dramas', movies: uniqueById([...row.movies, ...koreanSeries]) });
            continue;
        }
        if (row.rowTitle === 'Netflix Anime & Animation') {
            out.push({ ...row, movies: uniqueById([...row.movies, ...anime]) });
            continue;
        }

        if (row.movies.length) out.push(row);
    }

    // Never ship an empty shelf.
    return out.filter((row) => row.movies.length > 0 && (isIndiaCatalogRow(row) || row.movies.length >= 1));
}

const isCli = process.argv[1] && process.argv[1].endsWith('regional-catalog-filter.mjs');
if (isCli) {
    const file = join(ROOT, 'data/movies.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const before = data.movies.reduce((sum, row) => sum + row.movies.length, 0);
    const next = applyRegionalPolicy(data.movies);
    const after = next.reduce((sum, row) => sum + row.movies.length, 0);
    writeFileSync(file, JSON.stringify({ movies: next }, null, 4));
    console.log(`rows ${data.movies.length} -> ${next.length}; items ${before} -> ${after}`);
}
