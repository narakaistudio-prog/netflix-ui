// @ts-nocheck — live resolver: API route ka matching + client-side cache.
/**
 * Do cheezein pin hoti hain:
 *   1. `/api/moviebox-resolve` wahi search ladder chalata hai jo harvester —
 *      poore title par fail hone par distinctive shabd se sahi subject milta hai.
 *   2. Client resolve ko browser me yaad rakhta hai (dobara network call nahi),
 *      aur galat/na-mila jawab ko cache me miss ki tarah rakhta hai.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MODULE_PATH = join(process.cwd(), 'api', 'moviebox-resolve.mjs');
const API_PATH = join(process.cwd(), 'scripts', 'lib', 'moviebox-api.mjs');
const MATCH_PATH = join(process.cwd(), 'scripts', 'lib', 'moviebox-match.mjs');
const HARNESS = join(process.cwd(), 'tests-arena', 'helpers', 'moviebox-resolve-harness.mjs');

function run(scenario) {
    const res = spawnSync('node', [HARNESS], {
        encoding: 'utf8',
        timeout: 30000,
        env: {
            ...process.env,
            MBR_SCENARIO: JSON.stringify(scenario),
            MBR_MODULE_PATH: MODULE_PATH,
            MBR_API_PATH: API_PATH,
            MBR_MATCH_PATH: MATCH_PATH,
        },
    });
    const out = String(res.stdout || '');
    const marker = out.lastIndexOf('__RESULT__');
    if (marker === -1) throw new Error(`harness failed: ${res.stderr || out}`);
    return JSON.parse(out.slice(marker + '__RESULT__'.length));
}

describe('search ladder (buildSearchQueries)', () => {
    it('adds a distinctive-word anchor for titles MovieBox fumbles', () => {
        const queries = run({ op: 'queries', title: 'Vishwanath & Sons', year: 2026 }).map((q) => q.text);
        expect(queries).toContain('Vishwanath & Sons');
        expect(queries).toContain('Vishwanath & Sons 2026');
        expect(queries).toContain('Vishwanath');
        expect(queries).toContain('Vishwanath and Sons');
    });

    it('tries the part before a subtitle', () => {
        const queries = run({
            op: 'queries',
            title: 'Demon Slayer: Kimetsu no Yaiba Infinity Castle',
            year: 2025,
        }).map((q) => q.text);
        expect(queries).toContain('Demon Slayer');
    });

    it('never repeats a query', () => {
        const queries = run({ op: 'queries', title: 'Squid Game', year: 2021 });
        const texts = queries.map((q) => q.text.toLowerCase());
        expect(new Set(texts).size).toBe(texts.length);
    });
});

describe('/api/moviebox-resolve', () => {
    it('finds the title through the anchor query when the full title fails', () => {
        const result = run({
            op: 'resolve',
            title: 'Vishwanath & Sons',
            year: 2026,
            mediaType: 'movie',
            search: {
                'Vishwanath & Sons': [{ title: 'SONS OF ROYALTY', year: 2026, subjectType: 1, detailPath: 'sons-of-royalty' }],
                'Vishwanath & Sons 2026': [
                    { title: 'SONS OF ROYALTY', year: 2026, subjectType: 1, detailPath: 'sons-of-royalty' },
                ],
                'Vishwanath & Sons Hindi': [],
                'Vishwanath and Sons': [],
                Vishwanath: [
                    {
                        title: 'Vishwanath & Sons [Hindi]',
                        year: 2026,
                        subjectType: 1,
                        subjectId: '777',
                        detailPath: 'vishwanath-and-sons-hindi-AbC123',
                    },
                ],
            },
            detail: {
                subjectId: '777',
                detailPath: 'vishwanath-and-sons-hindi-AbC123',
                title: 'Vishwanath & Sons [Hindi]',
                subjectType: 1,
                year: 2026,
                dubs: [],
            },
        });

        expect(result.found).toBe(true);
        expect(result.detailPath).toBe('vishwanath-and-sons-hindi-AbC123');
        expect(result.url).toBe(
            'https://m2box.org/movies/vishwanath-and-sons-hindi-AbC123?id=777&type=/movie/detail&detailSe=&detailEp=&lang=en',
        );
        expect(result.dub).toBe('hindi');
        // anchor query tak pahuncha
        expect(result.calls.filter((c) => c.type === 'search').map((c) => c.keyword)).toContain('Vishwanath');
    });

    it('reports a miss instead of baking a wrong page', () => {
        const result = run({
            op: 'resolve',
            title: 'Ohh My Dog',
            year: 2026,
            mediaType: 'movie',
            search: {
                'Ohh My Dog': [{ title: 'Dog', year: 2024, subjectType: 1, detailPath: 'dog' }],
            },
        });
        expect(result.found).toBe(false);
        expect(result.reason).toBe('no-match');
        expect(result.best.title).toBe('Dog');
    });

    it('ignores anything that is not a real watch page', () => {
        expect(run({ op: 'url', detailPath: '', subjectId: '1' })).toBe('');
        expect(run({ op: 'parse', url: 'https://m2box.org/movies/x' })).toBeNull();
    });
});
