// @ts-nocheck — harvester ke pure matcher ko child-process ESM harness se
// chala kar test karta hai (jest .mjs import nahi kar sakta).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MODULE_PATH = join(process.cwd(), 'scripts', 'lib', 'moviebox-match.mjs');
const HARNESS = join(process.cwd(), 'tests-arena', 'helpers', 'moviebox-match-harness.mjs');

function run(scenario) {
    const res = spawnSync('node', [HARNESS], {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, MBM_SCENARIO: JSON.stringify(scenario), MBM_MODULE_PATH: MODULE_PATH },
    });
    const out = String(res.stdout || '');
    const marker = out.lastIndexOf('__RESULT__');
    if (marker === -1) throw new Error(`harness failed: ${res.stderr || out}`);
    return JSON.parse(out.slice(marker + '__RESULT__'.length));
}

describe('moviebox matcher — title normalisation', () => {
    it('strips dub brackets and marks the hint', () => {
        const [first, second] = run({
            op: 'normalize',
            values: ['Mandaadi [Hindi]', 'My Demon (Hindi)'],
        });
        expect(first.normalized).toBe('mandaadi');
        expect(first.dubHint).toBe('hindi');
        expect(second.normalized).toBe('my demon');
        expect(second.dubHint).toBe('hindi');
    });

    it('ignores accents, punctuation, ampersands and case', () => {
        const [row] = run({ op: 'normalize', values: ['Amélie & Co. — Part 2'] });
        expect(row.normalized).toBe('amelie and co part 2');
    });

    it('does not mistake a real bracket word for a dub', () => {
        const [row] = run({ op: 'normalize', values: ['Kaiju No. 8 [Season 2]'] });
        expect(row.dubHint).toBe('');
    });
});

describe('moviebox matcher — title similarity', () => {
    it('scores identical titles highest', () => {
        expect(run({ op: 'titleScore', a: 'Mandaadi', b: 'Mandaadi [Hindi]' })).toBe(1);
    });

    it('tolerates extra dub words', () => {
        const score = run({ op: 'titleScore', a: 'My Demon', b: 'My Demon Hindi Dubbed' });
        expect(score).toBeGreaterThan(0.7);
    });

    it('rejects unrelated titles', () => {
        expect(run({ op: 'titleScore', a: 'Mandaadi', b: 'Squid Game' })).toBeLessThan(0.3);
    });
});

describe('moviebox matcher — candidate scoring', () => {
    const target = { title: 'Mandaadi', year: 2026, mediaType: 'movie' };

    it('accepts the exact movie with the matching year', () => {
        const result = run({
            op: 'score',
            target,
            item: {
                title: 'Mandaadi [Hindi]',
                subjectType: 1,
                year: 2026,
                detailPath: 'mandaadi-hindi-qxUx1r3QHW4',
                hasResource: true,
            },
        });
        expect(result.score).toBeGreaterThan(0.9);
        expect(result.reasons).toContain('type-match');
        expect(result.reasons).toContain('hindi-dub');
    });

    it('penalises a series when the catalog title is a movie', () => {
        const asMovie = run({ op: 'score', target, item: { title: 'Mandaadi', subjectType: 1, year: 2026 } });
        const asSeries = run({ op: 'score', target, item: { title: 'Mandaadi', subjectType: 2, year: 2026 } });
        expect(asSeries.score).toBeLessThan(asMovie.score);
        expect(asSeries.reasons).toContain('type-mismatch');
    });

    it('penalises a far-off release year', () => {
        const close = run({ op: 'score', target, item: { title: 'Mandaadi', subjectType: 1, year: 2026 } });
        const far = run({ op: 'score', target, item: { title: 'Mandaadi', subjectType: 1, year: 1998 } });
        expect(far.score).toBeLessThan(close.score);
        expect(far.reasons).toContain('year-far');
    });

    it('ranks the right candidate first', () => {
        const ranked = run({
            op: 'rank',
            target,
            items: [
                { title: 'Mandaadi 2', subjectType: 1, year: 2027, detailPath: 'mandaadi-2' },
                { title: 'Mandaadi [Hindi]', subjectType: 1, year: 2026, detailPath: 'mandaadi-hindi-x' },
                { title: 'Mandakini', subjectType: 1, year: 2020, detailPath: 'mandakini' },
            ],
        });
        expect(ranked.best.item.detailPath).toBe('mandaadi-hindi-x');
        expect(ranked.best.score).toBeGreaterThanOrEqual(run({ op: 'constants' }).accept);
        expect(ranked.runnersUp.length).toBe(2);
    });
});

describe('moviebox matcher — Hindi dub pick', () => {
    const dubs = [
        { subjectId: '1', detailPath: 'my-demon-korean-AbC', lanName: 'Korean', lanCode: 'ko', type: 0, original: true },
        { subjectId: '2', detailPath: 'my-demon-hindi-Sfaa', lanName: 'Hindi', lanCode: 'hi', type: 0 },
        { subjectId: '3', detailPath: 'my-demon-hindi-sub-XyZ', lanName: 'Hindi', lanCode: 'hi', type: 1 },
    ];

    it('picks the Hindi audio dub (not the subtitle variant)', () => {
        const picked = run({ op: 'pickDub', dubs, prefer: 'hindi' });
        expect(picked.subjectId).toBe('2');
        expect(picked.detailPath).toBe('my-demon-hindi-Sfaa');
    });

    it('falls back to null when there is no Hindi dub', () => {
        const picked = run({
            op: 'pickDub',
            dubs: [dubs[0]],
            prefer: 'hindi',
        });
        expect(picked).toBeNull();
    });
});
