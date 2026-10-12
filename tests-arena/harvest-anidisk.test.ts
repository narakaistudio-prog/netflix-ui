import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

test('anidisk confirmed-links data is valid', () => {
    const data = JSON.parse(
        readFileSync(join(ROOT, 'data', 'anidisk-confirmed.json'), 'utf8'),
    );
    expect(typeof data).toBe('object');
    // Seed: solo is confirmed from manual research.
    expect(data.solo.slug).toBe('solo-leveling');
    expect(data.solo.hindi).toBe(true);
    for (const entry of Object.values<any>(data)) {
        if (entry.slug !== undefined) {
            expect(entry.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        }
        for (const [epKey, url] of Object.entries<string>(entry.eps || {})) {
            expect(epKey).toMatch(/^\d+:\d+$/);
            expect(url).toMatch(/^https:\/\/anidisk\.org\/watch\//);
        }
    }
});

test('demo HTML has confirmed links baked + preferring resolver', () => {
    const html = readFileSync(
        join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'),
        'utf8',
    );
    expect(html).toContain('/*__ANIDISK_CONFIRMED__*/');
    expect(html).toContain('var ANIDISK_CONFIRMED=');
    expect(html).toContain('"solo":{"slug":"solo-leveling"');
    expect(html).toContain('ANIDISK_CONFIRMED[k]');
    expect(html).toContain('anidiskHindi');
});

test('harvest pipeline scripts + workflow exist', () => {
    expect(existsSync(join(ROOT, 'scripts', 'harvest-deadtoons.mjs'))).toBe(true);
    expect(existsSync(join(ROOT, 'scripts', 'bake-anidisk-links.mjs'))).toBe(true);
    expect(
        existsSync(join(ROOT, '.github', 'workflows', 'harvest-anidisk.yml')),
    ).toBe(true);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['harvest:anidisk']).toContain('harvest-deadtoons');
});

test('harvester self-test passes (offline parser fixtures)', () => {
    const out = execFileSync(
        process.execPath,
        [join(ROOT, 'scripts', 'harvest-deadtoons.mjs'), '--self-test'],
        { encoding: 'utf8' },
    );
    expect(out).toContain('All harvester self-tests passed');
}, 60000);
