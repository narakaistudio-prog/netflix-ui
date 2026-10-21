// @ts-nocheck — /api/play-frame: ToonStream "Play" (ravok) embed hamare
// server ke raaste aata hai taaki TV browser ravok ko dikhe hi nahi aur
// uska QR robot-check trigger hi na ho. Player wahi Play hai.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MODULE_PATH = join(process.cwd(), 'api', 'play-frame.mjs');
const HARNESS = join(process.cwd(), 'tests-arena', 'helpers', 'play-frame-harness.mjs');

function runScenario(scenario: Record<string, unknown>) {
    const res = spawnSync('node', [HARNESS], {
        encoding: 'utf8',
        timeout: 45000,
        env: { ...process.env, PF_SCENARIO: JSON.stringify(scenario), PF_MODULE_PATH: MODULE_PATH },
    });
    const out = String(res.stdout || '');
    const marker = out.lastIndexOf('__RESULT__');
    if (marker === -1) throw new Error(`harness failed: ${res.stderr || out}`);
    return JSON.parse(out.slice(marker + '__RESULT__'.length));
}

const PLAY = 'https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f';
const UPSTREAM_HTML = `<!doctype html>
<html><head>
  <meta http-equiv="X-Frame-Options" content="DENY">
  <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
  <title>Play</title>
  <script src="/static/player.js"></script>
</head><body><div id="player"></div></body></html>`;

describe('/api/play-frame (Play bot-free proxy)', () => {
    it('serves the Play page from our origin, frame guards removed, base = ravok', () => {
        const result = runScenario({
            query: { url: PLAY },
            upstream: { status: 200, contentType: 'text/html; charset=utf-8', finalUrl: PLAY, body: UPSTREAM_HTML },
        });
        expect(result.status).toBe(200);
        expect(result.body).toContain('<div id="player"></div>');
        expect(result.body.toLowerCase()).not.toContain('x-frame-options');
        expect(result.body.toLowerCase()).not.toContain("frame-ancestors 'none'");
        expect(result.body).toContain('<base href="https://ravok.buzz/">');
        expect(result.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    });

    it('accepts as-cdn mirrors of Play', () => {
        const result = runScenario({
            query: { url: 'https://as-cdn26.top/e/abc123' },
            upstream: { status: 200, contentType: 'text/html', finalUrl: 'https://as-cdn26.top/e/abc123', body: UPSTREAM_HTML },
        });
        expect(result.status).toBe(200);
        expect(result.body).toContain('<base href="https://as-cdn26.top/">');
    });

    it('refuses non-Play hosts (koi dusra server proxy nahi hota)', () => {
        for (const url of [
            'https://abyssplayer.com/LR0L1Adhn',
            'https://blakiteapi.xyz/embed/127532/1-1',
            'https://evil.example/ravok.buzz',
            'not-a-url',
        ]) {
            const result = runScenario({ query: { url }, upstream: { body: UPSTREAM_HTML } });
            expect(result.status).toBe(400);
        }
    });

    it('reports a non-HTML upstream honestly', () => {
        const result = runScenario({
            query: { url: PLAY },
            upstream: { status: 200, contentType: 'application/json', finalUrl: PLAY, body: '{}' },
        });
        expect(result.status).toBe(502);
    });
});
