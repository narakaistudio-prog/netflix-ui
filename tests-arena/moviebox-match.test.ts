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

    it('penalises YouTube-style clips hard', () => {
        const clip = run({
            op: 'score',
            target: { title: 'Suspicious Partner', year: 2017, mediaType: 'tv' },
            item: {
                title: '[SUB] 남지현 기습키스 《Suspicious Partner》 EP24',
                subjectType: 2,
                year: 2017,
                detailPath: 'sub-suspicious-partner-ep24-AbC',
            },
        });
        expect(clip.score).toBeLessThan(0.6);
        expect(clip.reasons).toContain('junk-clip');
    });

    it('rejects a longer title when the catalog title is one word', () => {
        const exact = run({ op: 'score', target: { title: 'Sultan' }, item: { title: 'Sultan', subjectType: 1 } });
        const delhi = run({
            op: 'score',
            target: { title: 'Sultan' },
            item: { title: 'Sultan of Delhi', subjectType: 1, year: 2022 },
        });
        expect(exact.score).toBeGreaterThan(0.72);
        expect(delhi.score).toBeLessThan(0.6);
    });

    it('keeps a TV season pack even when the year is a few years off', () => {
        const result = run({
            op: 'score',
            target: { title: 'Squid Game', year: 2021, mediaType: 'tv' },
            item: { title: 'Squid Game [English] S1-S3', subjectType: 2, year: 2025 },
        });
        expect(result.score).toBeGreaterThan(0.72);
        expect(result.reasons).toContain('year-tv-window');
    });

    it('still rejects a far-off year for a movie', () => {
        const result = run({
            op: 'score',
            target: { title: 'Mandaadi', year: 2026, mediaType: 'movie' },
            item: { title: 'Mandaadi', subjectType: 1, year: 1998 },
        });
        expect(result.score).toBeLessThan(0.72);
        expect(result.reasons).toContain('year-far');
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

describe('moviebox matcher — play target + dub label', () => {
    it('uses a Hindi dub only when it has its own subject', () => {
        const withOwnSubject = run({
            op: 'playRef',
            detail: {
                detailPath: 'my-demon-AbC',
                subjectId: '111',
                title: 'My Demon',
                dubs: [{ subjectId: '222', detailPath: 'my-demon-hindi-XyZ', lanCode: 'hi', lanName: 'Hindi', type: 0 }],
            },
        });
        expect(withOwnSubject.ref.detailPath).toBe('my-demon-hindi-XyZ');
        expect(withOwnSubject.dub).toBe('hindi');
        expect(withOwnSubject.hindiDub).toBeTruthy();
    });

    it('labels the page by its slug when the Hindi track shares the subject', () => {
        const sharedSubject = run({
            op: 'playRef',
            detail: {
                detailPath: 'reporting-live-08MIG',
                subjectId: '333',
                title: 'Reporting Live',
                dubs: [{ subjectId: '333', detailPath: 'reporting-live-08MIG', lanCode: 'hi', lanName: 'Hindi', type: 0 }],
            },
        });
        expect(sharedSubject.ref.detailPath).toBe('reporting-live-08MIG');
        expect(sharedSubject.dub).toBe('original');
        expect(sharedSubject.hindiAudio).toBe(true);
        expect(sharedSubject.hindiDub).toBeNull();
    });

    it('falls back to the picked search item when /detail is empty', () => {
        const fallback = run({
            op: 'playRef',
            detail: null,
            fallback: { detailPath: 'mandaadi-hindi-qxUx', subjectId: '444', title: 'Mandaadi [Hindi]' },
        });
        expect(fallback.ref.detailPath).toBe('mandaadi-hindi-qxUx');
        expect(fallback.dub).toBe('hindi');
    });

    it('does not leak a language word from "Hindi Medium"-style names into the slug', () => {
        expect(run({ op: 'language', ref: { detailPath: 'hindi-medium-AbC', title: 'Hindi Medium' } })).toBe('hindi');
        expect(run({ op: 'language', ref: { detailPath: 'the-office-AbC', title: 'The Office' } })).toBe('original');
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
