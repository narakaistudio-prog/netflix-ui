// @ts-nocheck — drives api/moviebox-frame.mjs through a child-process ESM
// harness (jest cannot import .mjs). This is the fallback used when M2Box
// starts blocking framing: the page's HTML comes from our own origin, so the
// frame keeps working.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MODULE_PATH = join(process.cwd(), 'api', 'moviebox-frame.mjs');
const HARNESS = join(process.cwd(), 'tests-arena', 'helpers', 'moviebox-frame-harness.mjs');

function runScenario(scenario: Record<string, unknown>) {
    const res = spawnSync('node', [HARNESS], {
        encoding: 'utf8',
        timeout: 45000,
        env: {
            ...process.env,
            MBF_SCENARIO: JSON.stringify(scenario),
            MBF_MODULE_PATH: MODULE_PATH,
        },
    });
    const out = String(res.stdout || '');
    const marker = out.lastIndexOf('__RESULT__');
    if (marker === -1) throw new Error(`harness failed: ${res.stderr || out}`);
    return JSON.parse(out.slice(marker + '__RESULT__'.length));
}

const PAGE =
    'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en';

/** Upstream HTML that tries to stop framing three different ways. */
const UPSTREAM_HTML = `<!doctype html>
<html><head>
  <meta http-equiv="X-Frame-Options" content="DENY">
  <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
  <title>My Demon</title>
  <script src="/static/app.js"></script>
</head><body><div id="player"></div></body></html>`;

describe('/api/moviebox-frame (M2Box proxy fallback)', () => {
    it('serves the watch page with the frame guards removed and a base tag', () => {
        const result = runScenario({
            query: { url: PAGE },
            upstream: {
                status: 200,
                contentType: 'text/html; charset=utf-8',
                finalUrl: PAGE,
                body: UPSTREAM_HTML,
            },
        });

        expect(result.status).toBe(200);
        expect(result.body).toContain('<div id="player"></div>');
        // frame-blocking metas are gone...
        expect(result.body.toLowerCase()).not.toContain('x-frame-options');
        expect(result.body.toLowerCase()).not.toContain("frame-ancestors 'none'");
        // ...and relative assets keep pointing at the real site
        expect(result.body).toContain('<base href="https://m2box.org/">');
        expect(result.body).toContain('<script src="/static/app.js"></script>');
        // only our own app may frame it
        expect(result.headers['content-security-policy']).toBe("frame-ancestors 'self'");
        expect(result.headers['content-type']).toContain('text/html');
        expect(result.headers['x-robots-tag']).toBe('noindex');
    });

    it('replaces an existing <base> instead of stacking two', () => {
        const result = runScenario({
            query: { url: PAGE },
            upstream: {
                contentType: 'text/html',
                finalUrl: PAGE,
                body: '<html><head><base href="https://elsewhere.example/"></head><body>ok</body></html>',
            },
        });
        expect(result.status).toBe(200);
        expect(result.body.match(/<base /gi)?.length).toBe(1);
        expect(result.body).toContain('https://m2box.org/');
        expect(result.body).not.toContain('elsewhere.example');
    });

    it('accepts a rotated player domain shaped like a watch page', () => {
        const result = runScenario({
            query: {
                url: 'https://mzfi.me/spa/videoPlayPage/movies/demo-hindi-AbC123?id=1234567890&type=/movie/detail',
            },
            upstream: { contentType: 'text/html', body: '<html><head></head><body>ok</body></html>' },
        });
        expect(result.status).toBe(200);
        expect(result.body).toContain('https://mzfi.me/');
    });

    it('refuses any other site (no open proxy)', () => {
        const result = runScenario({ query: { url: 'https://nxsha.space/embed/movie/tt1375666' } });
        expect(result.status).toBe(400);
        expect(result.body).toContain('MovieBox');
    });

    it('refuses non-http(s) URLs', () => {
        expect(runScenario({ query: { url: 'javascript:alert(1)' } }).status).toBe(400);
        expect(runScenario({ query: {} }).status).toBe(400);
    });

    it('answers 502 when upstream is not HTML', () => {
        const result = runScenario({
            query: { url: PAGE },
            upstream: { status: 200, contentType: 'application/json', body: '{"ok":true}' },
        });
        expect(result.status).toBe(502);
        expect(result.body).toContain('HTML nahi diya');
    });

    it('answers 502 when upstream errors without HTML', () => {
        const result = runScenario({ query: { url: PAGE }, upstream: { status: 500 } });
        expect(result.status).toBe(502);
        expect(result.body).toContain('Seedha frame try karo');
    });
});
