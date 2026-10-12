import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

test('Nxsha guide harvester parses a title route and episode metadata offline', () => {
    const out = execFileSync(
        process.execPath,
        [join(ROOT, 'scripts', 'harvest-nxsha-guide.mjs'), '--self-test'],
        { encoding: 'utf8', timeout: 30000 },
    );
    expect(out).toContain('harvest-nxsha-guide self-tests passed');
});

test('Nxsha harvest workflow is manual, artifacts its guide, and does not touch One Piece', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'harvest-nxsha-guide.yml'), 'utf8');
    const script = readFileSync(join(ROOT, 'scripts', 'harvest-nxsha-guide.mjs'), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('name: nxsha-episode-guide');
    expect(workflow).toContain('data/nxsha-episodes.json');
    expect(workflow).toContain('node scripts/probe-nxsha.mjs');
    expect(workflow).toContain('data/nxsha-verify.json');
    expect(script).toContain("const SKIP_KEYS = new Set(['onepiece'])");
    expect(script).toContain("source: 'https://nxsha.space/api/tv/{tmdbId}/season/{season}'");
});
