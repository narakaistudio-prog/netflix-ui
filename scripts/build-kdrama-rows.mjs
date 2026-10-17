#!/usr/bin/env node
/**
 * Build the K-Drama rows (Netflix genre 2638104) for data/movies.json
 * fully offline, from the curated capture in data/netflix-genre-2638104.txt
 * plus the metadata table below.
 *
 * Why two sources? The txt file mirrors the Netflix genre page's row
 * structure and title order (re-capture it in a logged-in browser with
 * scripts/scrape-netflix-for-you.js). The metadata table holds the facts
 * this sandbox bundles today: year, rating, seasons, genres, cast and a
 * one-line synopsis written for this catalog. Poster art ships as a
 * `local:` placeholder until CI enriches the same rows from Nxsha
 * (scripts/build-netflix-genre-rows.mjs --preset=kdramas), which replaces
 * these rows with Nxsha-matched records that carry real TMDB posters,
 * tmdb ids and episode guides.
 *
 * A title the table does not describe still ships, with just its name —
 * the card and detail views render everything optionally.
 *
 * Usage: node scripts/build-kdrama-rows.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'data', 'netflix-genre-2638104.txt');
const MOVIES = resolve(ROOT, 'data', 'movies.json');
const COLLECTION = 'netflix-genre-2638104';
const ROW_PREFIX = 'K-Drama: ';
const ID_PREFIX = 'kdrama-';
const DRY = process.argv.includes('--dry-run');

/** "Title | 123" lines under "## Row" headers (id optional). */
function parseSource(text) {
    const rows = [];
    let current = null;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.replace(/​/g, '').trim();
        if (!line || (line.startsWith('#') && !line.startsWith('## '))) continue;
        if (line.startsWith('## ')) {
            current = { rowTitle: line.slice(3).trim(), titles: [] };
            rows.push(current);
            continue;
        }
        const m = /^(.+?)\s*(?:\|\s*(\d+))?$/.exec(line);
        if (m && current) current.titles.push({ title: m[1].trim(), netflixId: m[2] || '' });
    }
    return rows;
}

const slug = (title) =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Curated facts for the titles on the K-Dramas genre page. Descriptions
 * are original one-liners written for this catalog; cast lists the
 * top-billed leads. `n` is the verified Netflix title id when known.
 */
const META = {
    'Squid Game': { n: '80100172', y: '2021–2025', r: 'TV-MA', s: '3 Seasons', g: ['Thriller', 'Drama', 'Sci-Fi'], c: ['Lee Jung-jae', 'Park Hae-soo', 'Wi Ha-joon', 'Jung Ho-yeon', 'Lee Byung-hun', 'Im Si-wan', 'Kang Ha-neul'], d: 'Cash-strapped contestants risk their lives in a deadly tournament of childhood games for a massive prize.' },
    'The Glory': { y: '2022–2023', r: 'TV-MA', s: '2 Seasons', g: ['Thriller', 'Drama'], c: ['Song Hye-kyo', 'Lee Do-hyun', 'Lim Ji-yeon', 'Yeom Hye-ran', 'Park Ji-hoo'], d: 'A victim of school bullying plots an elaborate revenge against her tormentors years later.' },
    'Queen of Tears': { y: '2024', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Kim Soo-hyun', 'Kim Ji-won', 'Park Sung-hoon'], d: 'A chaebol heiress and her husband fight to save their marriage and her family\'s company.' },
    'The Trauma Code': { y: '2025', r: 'TV-MA', s: '1 Season', g: ['Action', 'Medical', 'Drama'], c: ['Ju Ji-hoon', 'Choo Young-woo', 'Ha Young', 'Jung Jae-kwang'], d: 'A top trauma surgeon clashes with a rising doctor while treating patients at a disaster-hit hospital.' },
    'Extraordinary Attorney Woo': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Drama', 'Comedy', 'Legal'], c: ['Park Eun-bin', 'Kang Tae-oh', 'Kang Ki-young'], d: 'A rookie lawyer on the autism spectrum navigates law and life at a top Seoul firm.' },
    'Crash Landing on You': { n: '81062352', y: '2019–2020', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama', 'Comedy'], c: ['Hyun Bin', 'Son Ye-jin', 'Seo Ji-hye', 'Kim Jung-hyun'], d: 'A South Korean heiress crash-lands in the North and falls for the army officer sworn to hide her.' },
    'Goblin': { n: '80192098', y: '2016–2017', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Romance'], c: ['Gong Yoo', 'Kim Go-eun', 'Lee Dong-wook', 'Yoo In-na'], d: 'An immortal goblin searches for his mortal bride, the only one who can end his cursed life.' },
    'Descendants of the Sun': { n: '80092091', y: '2016', r: 'TV-14', s: '1 Season', g: ['Romance', 'Action', 'Drama'], c: ['Song Joong-ki', 'Song Hye-kyo', 'Jin Goo', 'Kim Ji-won'], d: 'A special forces captain and a doctor fall in love amid war and disaster relief.' },
    'Alchemy of Souls': { y: '2022–2023', r: 'TV-14', s: '2 Seasons', g: ['Fantasy', 'Romance', 'Action'], c: ['Lee Jae-wook', 'Jung So-min', 'Hwang Min-hyun', 'Shin Se-kyung'], d: 'A powerful mage trapped in a weak body crosses paths with a nobleman who can shift souls.' },
    'Kingdom': { n: '80180175', y: '2019–2020', r: 'TV-MA', s: '2 Seasons', g: ['Horror', 'Thriller', 'Historical'], c: ['Ju Ji-hoon', 'Bae Doona', 'Ryu Seung-ryong', 'Kim Sang-ho'], d: 'A crown prince battles a zombie plague and corrupt court politics in Joseon Korea.' },
    'My Demon': { y: '2023–2024', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Romance'], c: ['Kim Yoo-jung', 'Song Kang', 'Lee Sang-yi', 'Kim Hae-sook'], d: 'A chaebol heiress loses her luck and gains a contract-hungry demon as an unlikely ally.' },
    'Hierarchy': { y: '2024', r: 'TV-14', s: '1 Season', g: ['Drama', 'Teen'], c: ['Roh Jeong-eui', 'Lee Chae-min', 'Kim Jae-won', 'Ji Hye-won', 'Lee Won-jung'], d: 'Students at an elite private school unravel the truth behind a classmate\'s death.' },
    'The Uncanny Counter': { y: '2020–2023', r: 'TV-14', s: '2 Seasons', g: ['Fantasy', 'Action'], c: ['Jo Byeong-kyu', 'Yoo Jun-sang', 'Kim Se-jeong', 'Yeom Hye-ran'], d: 'Four demon-hunting spirit mediums team up with a high schooler to hunt evil spirits.' },
    'When Life Gives You Tangerines': { y: '2025', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Lee Ji-eun (IU)', 'Park Bo-gum', 'Moon So-ri', 'Park Hae-joon'], d: 'A woman who time-travels to her youth gets a second chance at life and love in Jeju.' },
    'Dear X': { y: '2025', r: 'TV-14', s: '1 Season', g: ['Melodrama', 'Thriller'], c: ['Kim Yoo-jung', 'Kim Young-dae', 'Kim Do-hoon', 'Lee Yul-eum'], d: 'A top actress\'s carefully built life unravels as her past catches up with her.' },
    'Hometown Cha-Cha-Cha': { y: '2021', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Shin Min-a', 'Kim Seon-ho', 'Lee Sang-yi'], d: 'A big-city dentist opens a clinic in a seaside village and falls for its jack-of-all-trades.' },
    'Business Proposal': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Ahn Hyo-seop', 'Kim Se-jeong', 'Kim Min-kyu', 'Seol In-ah'], d: 'A woman\'s blind-date setup backfires when she meets her CEO under a fake identity.' },
    'Vincenzo': { y: '2021', r: 'TV-MA', s: '1 Season', g: ['Crime', 'Drama', 'Thriller'], c: ['Song Joong-ki', 'Jeon Yeo-been'], d: 'A Korean-Italian mafia consigliere returns to Seoul and wages war on a corrupt conglomerate.' },
    'All of Us Are Dead': { y: '2022–2023', r: 'TV-MA', s: '2 Seasons', g: ['Horror', 'Thriller'], c: ['Yoon Chan-young', 'Park Ji-hu', 'Cho Yi-hyun', 'Lomon', 'Yoo In-soo'], d: 'Students trapped in their school during a zombie outbreak fight to survive the day.' },
    'D.P.': { y: '2021–2023', r: 'TV-MA', s: '2 Seasons', g: ['Military', 'Drama'], c: ['Jung Hae-in', 'Koo Kyo-hwan', 'Kim Sung-kyun', 'Son Suk-ku'], d: 'Two young soldiers hunting deserters uncover the army\'s dark underbelly.' },
    'My Name': { y: '2021', r: 'TV-MA', s: '1 Season', g: ['Crime', 'Action'], c: ['Han So-hee', 'Park Hee-soon', 'Ahn Bo-hyun'], d: 'A woman joins a crime syndicate to avenge her father, then infiltrates the police.' },
    'Hellbound': { y: '2021–2025', r: 'TV-MA', s: '2 Seasons', g: ['Supernatural', 'Thriller'], c: ['Yoo Ah-in', 'Kim Hyun-joo', 'Park Jeong-min', 'Won Jin-ah'], d: 'Supernatural beings condemn sinners to hell, plunging Seoul into chaos and cults.' },
    'Extracurricular': { y: '2020–2025', r: 'TV-MA', s: '2 Seasons', g: ['Crime', 'Drama'], c: ['Kim Dong-hee', 'Jung Da-bin', 'Park Ju-hyun', 'Nam Yoon-soo'], d: 'A model student\'s crime-syndicate side business spirals out of control.' },
    'Juvenile Justice': { y: '2022', r: 'TV-MA', s: '1 Season', g: ['Legal', 'Drama'], c: ['Kim Hye-soo', 'Kim Moo-yeol', 'Lee Sung-min', 'Lee Jung-eun'], d: 'A judge who distrusts juvenile offenders confronts the system sentencing troubled youth.' },
    'Move to Heaven': { y: '2021', r: 'TV-14', s: '1 Season', g: ['Drama'], c: ['Lee Je-hoon', 'Tang Jun-sang', 'Hong Seung-hee'], d: 'A trauma cleaner and his nephew with autism uncover the stories behind what people leave behind.' },
    'The School Nurse Files': { y: '2020', r: 'TV-14', s: '1 Season', g: ['Comedy', 'Fantasy'], c: ['Jung Yu-mi', 'Nam Joo-hyuk'], d: 'A nurse with a sixth sense for jelly-like anomalies battles mysterious creatures at a high school.' },
    'The Sound of Magic': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Musical', 'Drama'], c: ['Ji Chang-wook', 'Choi Sung-eun', 'Hwang In-youp'], d: 'A mysterious magician helps a struggling student and his classmate rediscover their dreams.' },
    'Glitch': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Sci-Fi', 'Mystery'], c: ['Jeon Yeo-been', 'Nana'], d: 'A woman searches for her missing boyfriend alongside a UFO-watching club.' },
    'Parasyte: The Grey': { y: '2024', r: 'TV-MA', s: '1 Season', g: ['Sci-Fi', 'Horror'], c: ['Jeon So-nee', 'Koo Kyo-hwan', 'Lee Jung-hyun'], d: 'Parasitic creatures hijack human bodies while a young woman fights the infection from within.' },
    'The Silent Sea': { y: '2021', r: 'TV-14', s: '1 Season', g: ['Sci-Fi', 'Thriller'], c: ['Bae Doona', 'Gong Yoo', 'Lee Joon'], d: 'A team descends to an abandoned lunar base to retrieve a mysterious sample.' },
    'Daily Dose of Sunshine': { y: '2023', r: 'TV-14', s: '1 Season', g: ['Medical', 'Drama'], c: ['Park Bo-young', 'Yeon Woo-jin'], d: 'A psychiatric nurse finds purpose and love on a mental health ward.' },
    'The Fabulous': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Drama', 'Fashion'], c: ['Choi Min-ho', 'Chae Soo-bin'], d: 'Two young Seoulites chase their dreams in the cutthroat fashion industry.' },
    'Celebrity': { y: '2023', r: 'TV-14', s: '1 Season', g: ['Drama'], c: ['Park Gyu-young', 'Kang Min-hyuk'], d: 'An influencer\'s rise to fame exposes the dark side of followers and image.' },
    'Forecasting Love and Weather': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Park Min-young', 'Song Kang'], d: 'A weather forecaster works under the ex-boyfriend she never got over.' },
    'The Bequeathed': { y: '2024', r: 'TV-MA', s: '1 Season', g: ['Thriller', 'Mystery'], c: ['Kim Hyun-joo', 'Park Hee-soon', 'Park Byung-eun', 'Ryu Kyung-soo'], d: 'A woman inherits a cemetery and uncovers a dark family cult mystery.' },
    'The Frog': { y: '2024', r: 'TV-MA', s: '1 Season', g: ['Thriller', 'Mystery'], c: ['Kim Yoon-seok', 'Yoon Kye-sang', 'Go Min-si', 'Lee Jung-eun'], d: 'A motel owner\'s quiet past resurfaces when a serial killer returns after twenty years.' },
    'A Killer Paradox': { y: '2024', r: 'TV-MA', s: '1 Season', g: ['Crime', 'Thriller'], c: ['Lee Hee-joon', 'Choi Woo-shik', 'Son Sang-yeon'], d: 'An ordinary man accidentally kills a serial killer and is hunted by a relentless detective.' },
    'Trigger': { y: '2025', r: 'TV-MA', s: '1 Season', g: ['Action', 'Crime'], c: ['Seo Hyun-jin'], d: 'A sharpshooting champion is drawn into dangerous bodyguard work after a personal tragedy.' },
    'Good Boy': { y: '2025', r: 'TV-14', s: '1 Season', g: ['Action', 'Crime', 'Romance'], c: ['Park Bo-gum', 'Kim So-hyun'], d: 'An Olympic boxing medalist joins a police corruption unit and falls for a profiler.' },
    'The Whirlwind': { y: '2024', r: 'TV-MA', s: '1 Season', g: ['Political', 'Thriller'], c: ['Sol Kyung-gu', 'Kim Hee-ae'], d: 'An ambitious deputy prime minister and a determined president clash over power and justice.' },
    'The Deal': { y: '2023', r: 'TV-MA', s: '1 Season', g: ['Crime', 'Thriller'], c: ['Lee Seo-won', 'Yoo Su-bin', 'Kim Dong-hwi'], d: 'Two friends\' kidnapping-for-ransom scheme spirals into a brutal crime saga.' },
    'The Kidnapping Day': { y: '2023', r: 'TV-14', s: '1 Season', g: ['Crime', 'Comedy'], c: ['Yoon Kye-sang', 'Jeon Yu-na'], d: 'A clumsy kidnapper and his abducted charge form an unlikely bond while evading danger.' },
    'Signal': { y: '2016', r: 'TV-14', s: '1 Season', g: ['Crime', 'Thriller'], c: ['Lee Je-hoon', 'Kim Hye-soo', 'Cho Jin-woong'], d: 'A detective in 2015 and a profiler in 1989 communicate by walkie-talkie to crack cold cases.' },
    'Stranger': { y: '2017–2020', r: 'TV-14', s: '2 Seasons', g: ['Crime', 'Legal'], c: ['Cho Seung-woo', 'Bae Doona'], d: 'A prosecutor who cannot feel emotion and a detective expose corruption and murder.' },
    'Voice': { y: '2017–2021', r: 'TV-MA', s: '4 Seasons', g: ['Crime', 'Thriller'], c: ['Lee Ha-na', 'Jang Hyuk'], d: 'A call-center detective with perfect hearing hunts a sadistic serial killer.' },
    'The Fiery Priest': { y: '2019', r: 'TV-14', s: '1 Season', g: ['Crime', 'Comedy'], c: ['Kim Nam-gil', 'Kim Sung-kyun', 'Lee Hanee'], d: 'A hot-tempered priest teams up with quirky allies to solve a murder.' },
    'Weak Hero Class 1': { y: '2022', r: 'TV-MA', s: '1 Season', g: ['Action', 'Drama'], c: ['Park Ji-hoon', 'Choi Hyun-wook', 'Hong Kyung'], d: 'A frail student outsmarts violent bullies to survive a dangerous school.' },
    'Healer': { y: '2014–2015', r: 'TV-14', s: '1 Season', g: ['Action', 'Romance'], c: ['Ji Chang-wook', 'Park Min-young', 'Yoo Ji-tae'], d: 'A mysterious night courier uncovers his past while protecting a fearless reporter.' },
    'City Hunter': { y: '2011', r: 'TV-14', s: '1 Season', g: ['Action', 'Thriller'], c: ['Lee Min-ho', 'Park Min-young'], d: 'A young man infiltrates the halls of power to avenge his father\'s death.' },
    'The K2': { y: '2016', r: 'TV-14', s: '1 Season', g: ['Action', 'Thriller'], c: ['Ji Chang-wook', 'Song Yoon-ah', 'Im Yoon-ah'], d: 'A mercenary bodyguard is caught between a presidential candidate and her hidden daughter.' },
    'Mr. Sunshine': { y: '2018', r: 'TV-14', s: '1 Season', g: ['Historical', 'Romance', 'Action'], c: ['Lee Byung-hun', 'Kim Tae-ri'], d: 'A slave-turned-American officer returns to 1900s Seoul and falls for an aristocrat\'s daughter.' },
    'The Crowned Clown': { y: '2019', r: 'TV-14', s: '1 Season', g: ['Historical', 'Drama'], c: ['Yeo Jin-goo', 'Lee Se-young', 'Kim Sang-kyung'], d: 'A king\'s doppelgänger takes the throne to protect the kingdom from within.' },
    'The King\'s Affection': { y: '2021', r: 'TV-14', s: '1 Season', g: ['Historical', 'Romance'], c: ['Park Eun-bin', 'Rowoon'], d: 'A crown princess disguises herself as her dead twin brother to keep the throne.' },
    'Love in the Moonlight': { y: '2016', r: 'TV-14', s: '1 Season', g: ['Historical', 'Romance', 'Comedy'], c: ['Park Bo-gum', 'Kim Yoo-jung'], d: 'A crown prince falls for a eunuch-in-disguise in the Joseon palace.' },
    'Moon Embracing the Sun': { y: '2012', r: 'TV-14', s: '1 Season', g: ['Historical', 'Romance'], c: ['Han Ga-in', 'Kim Soo-hyun'], d: 'A king never forgets the crown princess he was forced to abandon.' },
    'Dong Yi': { y: '2010', r: 'TV-14', s: '1 Season', g: ['Historical'], c: ['Han Hyo-joo', 'Ji Jin-hee'], d: 'A palace maid rises to royal consort and changes the court\'s fate.' },
    'Queen Seondeok': { y: '2009', r: 'TV-14', s: '1 Season', g: ['Historical'], c: ['Lee Yo-won', 'Go Hyun-jung'], d: 'The first queen of Silla overthrows rivals to build her kingdom\'s golden age.' },
    'Jumong': { y: '2006–2007', r: 'TV-14', s: '1 Season', g: ['Historical', 'Epic'], c: ['Song Il-gook', 'Han Hye-jin'], d: 'The legendary founder of Goguryeo unites rival tribes to build an empire.' },
    'Empress Ki': { y: '2013–2014', r: 'TV-14', s: '1 Season', g: ['Historical'], c: ['Ha Ji-won', 'Joo Jin-mo'], d: 'A Goryeo woman rises to become the powerful empress of the Yuan dynasty.' },
    'Six Flying Dragons': { y: '2015–2016', r: 'TV-14', s: '1 Season', g: ['Historical'], c: ['Yoo Ah-in', 'Shin Se-kyung'], d: 'The founders of Joseon\'s royal line battle to build a new kingdom.' },
    'Hwarang: The Poet Warrior Youth': { y: '2016–2017', r: 'TV-14', s: '1 Season', g: ['Historical', 'Action'], c: ['Park Seo-joon', 'Choi Min-ho', 'Do Kyung-soo'], d: 'Elite young warriors protect the Silla kingdom while hiding a royal secret.' },
    'Under the Queen\'s Umbrella': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Historical', 'Court'], c: ['Kim Hye-soo', 'Kim Hae-sook', 'Choi Won-young'], d: 'A queen battles rival conspiracies to protect her sons and the throne.' },
    'Gyeongseong Creature': { y: '2023–2024', r: 'TV-MA', s: '2 Seasons', g: ['Historical', 'Thriller', 'Horror'], c: ['Park Seo-joon', 'Han So-hee', 'Wi Ha-joon'], d: 'In 1945 Gyeongseong, a rich man and a sleuth hunt monsters born from secret experiments.' },
    'The Tale of Lady Ok': { y: '2024', r: 'TV-14', s: '1 Season', g: ['Historical', 'Fantasy'], c: ['Lim Ji-yeon', 'Choo Young-woo'], d: 'A mysterious widow\'s many identities unravel across Joseon\'s class divide.' },
    'The Red Sleeve': { y: '2021', r: 'TV-14', s: '1 Season', g: ['Historical', 'Romance'], c: ['Lee Jun-ho', 'Lee Se-young'], d: 'A king fights duty and desire for the court lady he loves.' },
    'Knight Flower': { y: '2024', r: 'TV-14', s: '1 Season', g: ['Historical', 'Action'], c: ['Lee Ha-nee', 'Lee Jong-won'], d: 'A widow by day and a masked thief by night hunts her family\'s enemies.' },
    'Poong, the Joseon Psychiatrist': { y: '2022–2023', r: 'TV-14', s: '2 Seasons', g: ['Historical', 'Medical'], c: ['Kim Min-jae', 'Kim Hyang-gi', 'Kim Joo-hun'], d: 'A banished physician heals minds in Joseon with new psychiatric methods.' },
    'Jewel in the Palace': { y: '2003', r: 'TV-PG', s: '1 Season', g: ['Historical', 'Drama'], c: ['Lee Young-ae', 'Ji Jin-hee'], d: 'A kitchen maid becomes the first female royal physician of Joseon.' },
    'Fight for My Way': { y: '2017', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Park Seo-joon', 'Kim Ji-won'], d: 'Two friends chase unlikely dreams while love complicates their lives.' },
    'Because This Is My First Life': { y: '2017', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Lee Min-ki', 'Jung So-min'], d: 'Two thirty-somethings become contract housemates and question their life plans.' },
    'Good Manager': { y: '2017', r: 'TV-14', s: '1 Season', g: ['Comedy', 'Workplace'], c: ['Namkoong Min', 'Lee Jun-ho', 'Jung Hye-in'], d: 'A cunning accountant takes on a corrupt company\'s top management.' },
    'Weightlifting Fairy Kim Bok-joo': { y: '2016–2017', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Lee Sung-kyung', 'Nam Joo-hyuk'], d: 'A college weightlifter juggles love and dreams at a sports university.' },
    'She Was Pretty': { y: '2015', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Hwang Jung-eum', 'Park Seo-joon'], d: 'A plain-looking editor hides her past from the boss she once knew.' },
    'So Not Worth It': { y: '2021', r: 'TV-14', s: '1 Season', g: ['Sitcom', 'Comedy'], c: ['Park Se-wan', 'Shin Hyun-seung'], d: 'Students from across Asia share a chaotic Korean university dorm.' },
    'Chicken Nugget': { y: '2024', r: 'TV-14', s: '1 Season', g: ['Comedy', 'Sci-Fi'], c: ['Ryu Seung-ryong', 'Ahn Jae-hong', 'Kim Yoo-jung'], d: 'A father turns his daughter into a chicken nugget and scrambles to undo it.' },
    'Behind Every Star': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Comedy', 'Workplace'], c: ['Lee Seo-jin', 'Kwak Sun-young', 'Seo Hyun-woo'], d: 'A top celebrity manager and his newbie assistant navigate Hollywood-level stars and chaos.' },
    'The Heavenly Idol': { y: '2023', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Romance'], c: ['Kim Min-kyu', 'Go Bo-gyeol'], d: 'A K-pop idol\'s body is borrowed by a lost otherworldly prince.' },
    'Sweet Home': { y: '2020–2024', r: 'TV-MA', s: '3 Seasons', g: ['Horror', 'Thriller'], c: ['Song Kang', 'Lee Si-young', 'Lee Do-hyun'], d: 'Apartment residents fight monstrous transformations as the world ends.' },
    'Love Alarm': { y: '2019–2021', r: 'TV-14', s: '2 Seasons', g: ['Romance', 'Drama'], c: ['Kim So-hyun', 'Jung Ga-ram', 'Song Kang'], d: 'An app that alerts you when someone nearby likes you complicates two friends\' love.' },
    'True Beauty': { y: '2020–2021', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Moon Ga-young', 'Cha Eun-woo', 'Hwang In-youp'], d: 'A makeup-savvy teen hides her bare face from the school\'s hottest boy.' },
    'Cheese in the Trap': { y: '2016', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Park Hae-jin', 'Kim Go-eun'], d: 'A college student uncovers the dark duality of her senior.' },
    'Itaewon Class': { y: '2020', r: 'TV-14', s: '1 Season', g: ['Drama'], c: ['Park Seo-joon', 'Kim Da-mi', 'Yoo Jae-myung', 'Kwon Nara'], d: 'An ex-convict opens a bar-restaurant in Itaewon and takes on a food giant.' },
    'Hotel Del Luna': { y: '2019', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Romance'], c: ['Lee Ji-eun (IU)', 'Yeo Jin-goo'], d: 'A centuries-old hotel for ghosts gets a new human manager.' },
    'Start-Up': { y: '2020', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Bae Suzy', 'Nam Joo-hyuk'], d: 'Two founders chase a tech dream in Korea\'s Sandbox while old secrets surface.' },
    'Record of Youth': { y: '2020', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Park Bo-gum', 'Kim Da-mi', 'Byeon Woo-seok'], d: 'A model-turned-actor and a makeup artist chase fame in Seoul.' },
    'King the Land': { y: '2023', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Lee Jun-ho', 'Im Yoon-ah'], d: 'A hotel heir falls for his fiercely honest team leader.' },
    'Love Next Door': { y: '2024', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Jung Hae-in', 'Jung So-min'], d: 'An architect\'s next-door neighbor is the ex she never stopped loving.' },
    'The First Night with the Duke': { y: '2025', r: 'TV-14', s: '1 Season', g: ['Historical', 'Romance'], c: ['Lee Ji-eun (IU)', 'Park Bo-gum'], d: 'A court lady and a duke wake up together with no memory of the night before.' },
    'Lovely Runner': { y: '2024', r: 'TV-14', s: '1 Season', g: ['Romance', 'Fantasy'], c: ['Byeon Woo-seok', 'Kim Hye-yoon'], d: 'A star\'s wife travels fifteen years back to save his doomed fate.' },
    'Twenty-Five Twenty-One': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Kim Tae-ri', 'Nam Joo-hyuk'], d: 'A fencer and a bank clerk\'s son chase dreams amid the 1998 IMF crisis.' },
    'Doona!': { y: '2023', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Bae Suzy', 'Yang Se-jong'], d: 'A retired K-pop star and a college student share an unlikely roof.' },
    'The Interest of Love': { y: '2022–2023', r: 'TV-14', s: '1 Season', g: ['Romance', 'Drama'], c: ['Yoo Yeon-seok', 'Moon Ka-young'], d: 'Four bank employees learn what love really costs.' },
    'Once Upon a Small Town': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Park Ji-hu', 'Choo Young-woo'], d: 'A Seoul vet inherits a rural clinic and its outspoken local doctor.' },
    'My Love from the Star': { y: '2013–2014', r: 'TV-14', s: '1 Season', g: ['Romance', 'Fantasy'], c: ['Jun Ji-hyun', 'Kim Soo-hyun'], d: 'An alien who landed in the Joseon era falls for a top actress.' },
    'Boys Over Flowers': { y: '2009', r: 'TV-PG', s: '1 Season', g: ['Romance', 'Drama'], c: ['Ku Hye-sun', 'Lee Min-ho', 'Kim Hyun-joong'], d: 'A poor girl tangles with an elite school\'s four richest boys.' },
    'The Heirs': { y: '2013', r: 'TV-14', s: '1 Season', g: ['Romance', 'Teen'], c: ['Lee Min-ho', 'Park Shin-hye', 'Kim Woo-bin'], d: 'A chaebol heir and a poor classmate hide their love behind privilege.' },
    "What's Wrong with Secretary Kim": { y: '2018', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Park Seo-joon', 'Park Min-young'], d: 'A narcissistic boss is stunned when his perfect secretary quits.' },
    'Coffee Prince': { y: '2007', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Yoon Eun-hye', 'Gong Yoo'], d: 'A tomboy hired at a coffee shop hides her gender from her boss.' },
    'Full House': { y: '2004', r: 'TV-PG', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Song Hye-kyo', 'Rain'], d: 'A writer and an actor wed by scheme and learn to love.' },
    'My Lovely Sam Soon': { y: '2005', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Kim Sun-a', 'Hyun Bin'], d: 'A plus-size baker and a perfectionist restaurateur fake a romance.' },
    'Princess Hours': { y: '2006', r: 'TV-PG', s: '1 Season', g: ['Romance', 'Comedy'], c: ['Yoon Eun-hye', 'Ju Ji-hoon'], d: 'Ordinary schoolmates are betrothed by a royal succession deal.' },
    'Autumn in My Heart': { y: '2000', r: 'TV-PG', s: '1 Season', g: ['Romance', 'Melodrama'], c: ['Song Hye-kyo', 'Won Bin'], d: 'Switched at birth, two rivals fall in love before tragedy strikes.' },
    'Winter Sonata': { y: '2002', r: 'TV-PG', s: '1 Season', g: ['Romance', 'Melodrama'], c: ['Bae Yong-joon', 'Choi Ji-woo'], d: 'A first love lost and reborn ten years later.' },
    'Dream High': { y: '2011', r: 'TV-PG', s: '1 Season', g: ['Musical', 'Teen'], c: ['Bae Suzy', 'Kim Soo-hyun', 'Ok Taec-yeon', 'Jang Woo-young'], d: 'Six students chase K-pop stardom at an arts high school.' },
    'Reply 1988': { y: '2015–2016', r: 'TV-14', s: '1 Season', g: ['Drama', 'Comedy'], c: ['Lee Hye-ri', 'Park Bo-gum'], d: 'Five neighborhood families relive 1988 Seoul in this nostalgia hit.' },
    'Misaeng': { y: '2014', r: 'TV-14', s: '1 Season', g: ['Workplace', 'Drama'], c: ['Im Si-wan', 'Lee Sung-min'], d: 'A Go-player-turned-contract worker survives office life\'s brutal lessons.' },
    'Oh My Ghost': { y: '2015', r: 'TV-14', s: '1 Season', g: ['Romance', 'Comedy', 'Fantasy'], c: ['Park Bo-young', 'Jo Jung-suk', 'Kim Seul-gi'], d: 'A shy chef gets possessed by a virgin ghost chasing one last romance.' },
    'Bread, Love and Dreams': { y: '2010', r: 'TV-PG', s: '1 Season', g: ['Drama'], c: ['Yoon Shi-yoon', 'Lee Young-ah'], d: 'A bakery heir\'s search for his roots rises with the dough.' },
    'Bridal Mask': { y: '2012', r: 'TV-14', s: '1 Season', g: ['Historical', 'Action'], c: ['Joo Won', 'Jin Se-yeon'], d: 'A police officer\'s son becomes the masked freedom fighter Bridal Mask.' },
    'Sungkyunkwan Scandal': { y: '2010', r: 'TV-14', s: '1 Season', g: ['Historical', 'Romance'], c: ['Park Min-young', 'Park Yoo-chun', 'Song Joong-ki', 'Yoo Ah-in'], d: 'A girl disguised as a boy enters the royal academy and finds love.' },
    'Iris': { y: '2009', r: 'TV-14', s: '1 Season', g: ['Spy', 'Action'], c: ['Lee Byung-hun', 'Kim Tae-hee', 'Jung Joon-ho'], d: 'Two agents bond as a shadowy syndicate pits them against each other.' },
    'The Legend of the Blue Sea': { y: '2016–2017', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Romance'], c: ['Jun Ji-hyun', 'Lee Min-ho'], d: 'A mermaid and a con artist meet again across reincarnations.' },
    'The World of the Married': { y: '2020', r: 'TV-MA', s: '1 Season', g: ['Melodrama'], c: ['Kim Hee-ae', 'Park Hae-joon'], d: 'A doctor\'s perfect marriage shatters after a devastating betrayal.' },
    'Doctor Romantic': { y: '2016–2023', r: 'TV-14', s: '3 Seasons', g: ['Medical', 'Drama'], c: ['Han Suk-kyu', 'Lee Sung-kyung', 'Ahn Hyo-seop'], d: 'A genius surgeon runs a small rural hospital that mends lives and careers.' },
    'My Liberation Notes': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Drama'], c: ['Kim Ji-won', 'Son Suk-ku'], d: 'Three siblings and a stranger seek freedom from their quiet rural rut.' },
    'Tomorrow': { y: '2022', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Drama'], c: ['Kim Hee-sun', 'Rowoon', 'Lee Soo-hyuk'], d: 'A suicidal young man joins a team of grim reapers guiding lost souls.' },
    'Tale of the Nine Tailed': { y: '2020–2023', r: 'TV-14', s: '2 Seasons', g: ['Fantasy', 'Romance'], c: ['Lee Dong-wook', 'Jo Bo-ah'], d: 'A nine-tailed fox guardian settles old scores in the city of humans.' },
    'Mystic Pop-up Bar': { y: '2020', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Comedy'], c: ['Hwang Jung-eum', 'Yook Sung-jae', 'Choi Won-young'], d: 'A grudge-haunted bar team helps customers settle their earthly regrets.' },
    'Sisyphus: The Myth': { y: '2021', r: 'TV-14', s: '1 Season', g: ['Sci-Fi', 'Romance'], c: ['Cho Seung-woo', 'Park Shin-hye'], d: 'A genius engineer and a mysterious woman loop through time to save each other.' },
    'Memories of the Alhambra': { y: '2018–2019', r: 'TV-14', s: '1 Season', g: ['Sci-Fi', 'Thriller'], c: ['Hyun Bin', 'Park Shin-hye'], d: 'An investment CEO gets trapped in an AR game where the battles turn real.' },
    'W': { y: '2016', r: 'TV-14', s: '1 Season', g: ['Fantasy', 'Romance'], c: ['Lee Jong-suk', 'Han Hyo-joo'], d: 'A surgeon slips into her father\'s webtoon world and falls for its hero.' },
};

/**
 * Titles Nxsha does not carry (checked on nxsha search), so the CI
 * enrichment drops them. Keep them out of offline builds too, or a
 * local rebuild would resurrect poster-less cards the hosted runner
 * had already removed.
 */
const NXSHA_UNMATCHED = new Set(['Dong Yi', 'Queen Seondeok', 'Reply 1988']);

function buildItem({ title, netflixId }) {
    const meta = META[title] || {};
    const slug = slugify(title);
    const item = {
        id: `${ID_PREFIX}${slug}`,
        imageUrl: `local:${ID_PREFIX}${slug}`,
        title,
        type: 'SERIES',
        mediaType: 'tv',
        catalogCollection: COLLECTION,
        embed_provider: 'nxsha',
    };
    if (meta.n || netflixId) {
        const id = meta.n || netflixId;
        item.netflixId = id;
        item.netflixUrl = `https://www.netflix.com/in/title/${id}`;
    }
    if (meta.y) item.year = meta.y;
    if (meta.r) item.rating = meta.r;
    if (meta.s) item.duration = meta.s;
    if (meta.g) item.genres = meta.g;
    if (meta.c) item.cast = meta.c;
    if (meta.d) item.description = meta.d;
    return item;
}

function slugify(title) {
    return slug(title);
}

function main() {
    const source = parseSource(readFileSync(SOURCE, 'utf8'));
    const seen = new Set();
    const rows = [];
    let missing = 0;
    for (const src of source) {
        const movies = [];
        for (const t of src.titles) {
            if (NXSHA_UNMATCHED.has(t.title)) continue;
            const item = buildItem(t);
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            if (!META[t.title]) missing += 1;
            movies.push(item);
        }
        if (movies.length) rows.push({ rowTitle: `${ROW_PREFIX}${src.rowTitle}`, type: 'normal', movies });
    }

    const unique = new Set();
    for (const row of rows) for (const m of row.movies) unique.add(m.title);
    console.log(`source: ${source.length} rows, ${unique.size} unique K-Drama titles (${missing} without curated metadata)`);

    if (DRY) {
        console.log('dry run: data/movies.json not written');
        return;
    }

    const data = JSON.parse(readFileSync(MOVIES, 'utf8'));
    const kept = data.movies.filter(row => !isKdramaRow(row));
    data.movies = [...kept, ...rows];
    writeFileSync(MOVIES, JSON.stringify(data, null, 4) + '\n');
    console.log(`wrote data/movies.json: ${rows.length} K-Drama rows (${unique.size} titles), ${kept.length} other rows kept`);
}

function isKdramaRow(row) {
    return (
        String(row.rowTitle || '').startsWith(ROW_PREFIX) ||
        row.movies.some(item => item.catalogCollection === COLLECTION)
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
