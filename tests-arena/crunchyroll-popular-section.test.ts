import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const catalog = readFileSync(join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'), 'utf8');
const nxshaTitles = JSON.parse(readFileSync(join(ROOT, 'data', 'nxsha-titles.json'), 'utf8')) as Record<string, { id: string; kind: string }>;

const expectedPopularRanks = [
    'frieren', 'goldenkamuy', 'fireforce', 'fatestrange', 'cheatskill', 'onepiece', 'mfg', 'trigun',
    'jjk', 'mha', 'aot', 'toyour', 'slime', 'solo', 'classroom', 'apothecary', 'blackclover',
    'drstone', 'bluemiburo', 'haikyuu', 'demon', 'dbz', 'gachiakuta', 'hellsparadise',
    'beginningend', 'mushoku', 'naruto', 'tsukimichi', 'shieldhero', 'bluelock', 'rezero',
    'fairytail', 'yourlie', 'jojo', 'shangri', 'iruma',
];

test('Most Popular on Crunchyroll rail mirrors all 36 ranked results and every card has an Nxsha route', () => {
    const row = catalog.match(/\{title:'Most Popular on Crunchyroll',ranked:true,keys:\[([^\]]+)\]\}/);
    expect(row).not.toBeNull();
    const keys = [...(row?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);

    expect(keys).toEqual(expectedPopularRanks);
    expect(new Set(keys).size).toBe(36);
    const cardKeys = new Set([...catalog.matchAll(/^[ \t]{8}([A-Za-z_$][A-Za-z0-9_$]*):\{title:'/gm)].map((match) => match[1]));
    keys.forEach((key) => {
        expect(cardKeys.has(key)).toBe(true);
        expect(nxshaTitles[key]?.id).toBeTruthy();
    });
});

test('all 23 newly added Popular titles are registered as Nxsha TV routes', () => {
    const newKeys = [
        'goldenkamuy', 'fireforce', 'fatestrange', 'cheatskill', 'mfg', 'trigun', 'toyour', 'slime',
        'classroom', 'apothecary', 'bluemiburo', 'dbz', 'gachiakuta', 'hellsparadise', 'beginningend',
        'mushoku', 'tsukimichi', 'shieldhero', 'fairytail', 'yourlie', 'jojo', 'shangri', 'iruma',
    ];

    expect(newKeys).toHaveLength(23);
    newKeys.forEach((key) => {
        expect(nxshaTitles[key]?.kind).toBe('tv');
        expect(catalog).toContain(`${key}:{title:`);
    });
});
