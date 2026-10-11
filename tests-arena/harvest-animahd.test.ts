import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

test('animahd episodes data is valid (solo: 25 eps, S1+S2)', () => {
    const data = JSON.parse(
        readFileSync(join(ROOT, 'data', 'animahd-episodes.json'), 'utf8'),
    );
    expect(data.solo.showId).toBe(1138);
    expect(data.solo.slug).toBe('solo-leveling');
    expect(data.solo.seasons).toEqual({ 1: 12, 2: 13 });
    expect(data.solo.eps).toHaveLength(25);
    expect(new Set(data.solo.eps).size).toBe(25);
    for (const f of data.solo.eps) {
        expect(f).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    }
    expect(data.solo.eps[0]).toBe('144U5FdhfBjG-nTnQ72xiljp8syd_qoMS');
    expect(data.solo.eps[11]).toBe('1udQR-P-EZK65__qcqkJoa4iGGxRj-YvS');
    expect(data.solo.eps[12]).toBe('1YTospn4BG5B4ZIJc0CDlFRzjh9NiO76F');
    expect(data.solo.eps[24]).toBe('1HVCzW7WQaIh35zaniBTvhwqz6pLjY7kp');
});

test('animahd bake stays in sync with the demo page', () => {
    const out = execFileSync(
        process.execPath,
        [join(ROOT, 'scripts', 'bake-animahd-links.mjs'), '--check'],
        { encoding: 'utf8', timeout: 60000 },
    );
    expect(out).toContain('already in sync');
    const html = readFileSync(
        join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'),
        'utf8',
    );
    expect(html).toContain('var EP_DATA={"solo":{"slug":"solo-leveling","showId":1138');
});

test('animahd harvester self-test passes offline', () => {
    const out = execFileSync(
        process.execPath,
        [join(ROOT, 'scripts', 'harvest-animahd.mjs'), '--self-test'],
        { encoding: 'utf8', timeout: 60000 },
    );
    expect(out).toContain('self-tests passed');
    expect(out).not.toContain('FAIL -');
});
