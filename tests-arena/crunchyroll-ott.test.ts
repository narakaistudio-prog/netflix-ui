import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

test('crunchyroll OTT demo page ships with the app', () => {
    expect(existsSync(HTML_PATH)).toBe(true);
    // Self-contained page (inline artwork): must be a real, meaty document.
    expect(statSync(HTML_PATH).size).toBeGreaterThan(1_000_000);
});

test('demo player has a 3-server switcher below the video', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Markup: video wrapped with the server bar right below it.
    expect(html).toContain('<div class="stage-col">');
    expect(html).toContain('id="serverBar"');
    expect(html.match(/class="server-pill/g)).toHaveLength(3);
    expect(html).toContain('data-server="2"');
    // The three servers.
    expect(html).toContain('https://animahd.com/');
    expect(html).toContain('https://www.hindianime.world/home');
    expect(html).toContain('https://anidisk.org/');
    // Styling + switching logic wired up.
    expect(html).toContain('.server-pill.active');
    expect(html).toContain("querySelectorAll('.server-pill')");
});

test('demo page toast stays fully hidden until triggered', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The empty toast must not peek above the viewport bottom (fixed sliver).
    expect(html).toContain('translate(-50%,250%);opacity:0;visibility:hidden');
    expect(html).toContain(
        '.toast.show{transform:translate(-50%,0);opacity:1;visibility:visible}',
    );
    // Toast feature itself stays wired up.
    expect(html).toContain('showToast');
});

test('demo page is Crunchyroll-branded and self-contained', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('<title>Crunchyroll');
    expect(html).toContain('brand-word">crunchy<');
    expect(html).not.toContain('AniRoll');
    // Inline artwork keeps the OTT page working offline / in export.
    expect(html).toContain('data:image');
});

test('web export ships the demo page at its iframe URL', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'prepare-web-dist.mjs'), 'utf8');
    expect(script).toContain("'crunchyroll'");
    expect(script).toContain('crunchyroll.html');
});

test('crunchyroll route, tab and navbar entries exist', () => {
    expect(existsSync(join(ROOT, 'app', '(tabs)', 'crunchyroll.tsx'))).toBe(true);
    expect(existsSync(join(ROOT, 'components', 'Crunchyroll', 'CrunchyrollView.web.tsx'))).toBe(true);
    expect(existsSync(join(ROOT, 'components', 'Crunchyroll', 'CrunchyrollView.tsx'))).toBe(true);

    const tabs = readFileSync(join(ROOT, 'app', '(tabs)', '_layout.tsx'), 'utf8');
    expect(tabs).toContain("name: 'crunchyroll'");

    // Navbar: Crunchyroll sits right beside My List with its logo, and the
    // bar hides itself on /crunchyroll for full immersion.
    const nav = readFileSync(join(ROOT, 'components', 'WebNavBar.tsx'), 'utf8');
    expect(nav).toContain('/crunchyroll');
    expect(nav.indexOf("label: 'Crunchyroll'")).toBeGreaterThan(
        nav.indexOf("label: 'My List'"),
    );
    expect(nav).toContain('CrunchyrollIcon');
    // The early return must hide the whole navbar on the OTT route — match
    // the exact line so a lookalike elsewhere can't fake this.
    expect(nav).toContain(
        "|| pathname.startsWith('/crunchyroll')) return null;",
    );
});

test('crunchyroll logo ships in the app and the demo page', () => {
    expect(existsSync(join(ROOT, 'icons', 'Crunchyroll.tsx'))).toBe(true);
    const icon = readFileSync(join(ROOT, 'icons', 'Crunchyroll.tsx'), 'utf8');
    expect(icon).toContain('M2.909 13.436');

    const tabs = readFileSync(join(ROOT, 'app', '(tabs)', '_layout.tsx'), 'utf8');
    expect(tabs).toContain('CrunchyrollIcon');

    // Demo page header/footer brand marks + favicon use the real logo.
    const html = readFileSync(
        join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html'),
        'utf8',
    );
    expect(html.match(/<svg class="brand-mark" viewBox="0 0 24 24"/g)).toHaveLength(2);
    expect(html).toContain('M2.909 13.436');
    expect(html).not.toContain('M6 32C16 14 48 14 58 32');
});
