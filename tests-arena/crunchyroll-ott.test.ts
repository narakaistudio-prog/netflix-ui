import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const HTML_PATH = join(ROOT, 'assets', 'crunchyroll', 'crunchyroll.html');

test('crunchyroll OTT demo page ships with the app', () => {
    expect(existsSync(HTML_PATH)).toBe(true);
    // Self-contained page (inline artwork): must be a real, meaty document.
    expect(statSync(HTML_PATH).size).toBeGreaterThan(1_000_000);
});

test('demo player has Server 1 + Server 2 tabs below the video', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Markup: video wrapped with the server bar right below it.
    expect(html).toContain('<div class="stage-col">');
    expect(html).toContain('id="serverBar"');
    expect(html.match(/class="server-pill/g)).toHaveLength(2);
    expect(html).toContain('data-server="0"');
    expect(html).toContain('data-server="1"');
    // The two tabs: Server 1 (AnimaHD, default) + Server 2 (Drive).
    expect(html).toContain('>Server 1</button>');
    expect(html).toContain('>Server 2</button>');
    expect(html).toContain('drive.google.com/file/d/');
    expect(html).toContain('animahd.com/player/?file_id=');
    // Styling + switching logic wired up.
    expect(html).toContain('.server-pill.active');
    expect(html).toContain("querySelectorAll('.server-pill')");
});

test('demo player streams real episodes from servers, no bundled video', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The bundled reference video is gone — episodes come from servers.
    expect(html).not.toContain('application/octet-stream');
    expect(html).not.toContain('referenceVideo');
    // Server iframe player with loader, heading and helper buttons.
    expect(html).toContain('<iframe id="serverFrame"');
    expect(html).toContain('id="frameLoader"');
    expect(html).toContain('id="serverOpen"');
    expect(html).toContain('id="serverFs"');
    expect(html).toContain('id="playerTitle"');
    expect(html).toContain('loadServer');
});

test('demo player resolves direct episode URLs per server', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Real Solo Leveling Google Drive file_ids (Drive tab).
    expect(html).toContain('144U5FdhfBjG-nTnQ72xiljp8syd_qoMS');
    expect(html).toContain('1nxwxO8MqRIyK8DI3v5DSIyaVcdhpFkwR');
    expect(html).toContain('1NyXWP9KBQtkxKJX6ZU--3PFwMeD5iDn-');
    // Episode-aware wiring: state, resolvers, stepper, notice.
    expect(html).toContain('openEpisode');
    expect(html).toContain('serverUrl');
    expect(html).toContain('id="epStepper"');
    expect(html).toContain('id="noticeTitle"');
    expect(html).toContain('SLUG_OVERRIDES');
    // No static homepage embeds anymore — URLs resolve per episode.
    expect(html).not.toContain("url:'https://animahd.com/'");
    expect(html).not.toContain("url:'https://anidisk.org/'");
});

test('player has server failure handling (watchdog + troubleshoot)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('onServerTimeout');
    expect(html).toContain('disarmWatchdog');
    expect(html).toContain('id="serverHelp"');
    expect(html).toContain('id="noticeAlt"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('allow="autoplay; fullscreen"');
    expect(html).not.toContain('allow-popups');
});

test('player servers are Server 1 (AnimaHD, default) + Server 2 (Drive)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const m = html.match(/var SERVERS=\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const def = (m as RegExpMatchArray)[1];
    const iS1 = def.indexOf("name:'Server 1'");
    const iS2 = def.indexOf("name:'Server 2'");
    expect(iS1).toBeGreaterThanOrEqual(0);
    expect(iS2).toBeGreaterThan(iS1);
    expect(def).toContain("host:'animahd.com'");
    expect(def).toContain("host:'drive.google.com'");
    expect(def.indexOf("host:'animahd.com'")).toBeLessThan(def.indexOf("host:'drive.google.com'"));
    // Server 1 resolves the AnimaHD player URL, Server 2 the Drive preview.
    expect(html).toContain("if(i===0)return 'https://animahd.com/player/");
    // Two pills, Server 1 active by default.
    expect(html.match(/<button class="server-pill/g)).toHaveLength(2);
    expect(html).toContain('server-pill active" data-server="0"');
    expect(html).not.toContain('data-server="2"');
    // Extractor client stays out of the player.
    expect(html).not.toContain('xtVideo');
    expect(html).not.toContain('EXTRACTOR_API');
    expect(html).not.toContain('data-extract=');
});

test('both server iframes are sandboxed (popups impossible)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain("setAttribute('sandbox','allow-scripts allow-same-origin')");
    expect(html).not.toContain("removeAttribute('sandbox')");
    expect(html).not.toContain('allow-popups');
});

test('drive tab covers the pop-out button', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('id="drivePopCover"');
    expect(html).toContain('#drivePopCover{position:absolute;top:0;right:0;width:60px;height:60px');
    expect(html).toContain('setHidden(drivePopCover,i!==1)');
});

test('server 1 hides below-video junk without fullscreen', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // No page scrolling inside the frame + 16:9 viewport on Server 1.
    expect(html).toContain('scrolling="no"');
    expect(html).toContain("setAttribute('scrolling','no')");
    expect(html).toContain('.video-stage.s16x9{padding-bottom:56.25%}');
    expect(html).toContain("setClass(videoStage,'s16x9',i===0)");
    // No auto-fullscreen on inject (manual fullscreen button still works).
    expect(html).not.toContain("vst=byId('videoStage')");
    expect(html).toContain('ex.call(document)');
    expect(html).toContain('id="s1Crop"');
    expect(html).toContain('#s1Crop{position:absolute;left:0;right:0;bottom:0;height:7%');
    expect(html).toContain("setHidden(s1Crop,i!==0)");
    expect(html).toContain('var lt=loadToken');
});

test('fullscreen button targets the video stage', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('var el=videoStage||playerShell');
    expect(html).toContain("showToast('Fullscreen blocked hai')");
});

test('player lazy-loads behind a poster + play button', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('id="stagePoster"');
    expect(html).toContain('id="stagePlay"');
    expect(html).toContain('id="stagePosterImg"');
    expect(html).toContain('id="stagePosterText"');
    expect(html).toContain('stageInjected');
    expect(html).toContain('showStagePoster');
    expect(html).toContain('injectServer');
});

test('solo leveling ships all 25 episodes from one file_id table', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('/*__ANIMAHDEP__*/');
    expect(html).toContain('/*__END_ANIMAHDEP__*/');
    expect(html).toContain('var EP_DATA=');
    // S1E1, S1E12, S2E1, S2E13 (0-based ep 0/11/12/24).
    expect(html).toContain('144U5FdhfBjG-nTnQ72xiljp8syd_qoMS');
    expect(html).toContain('1udQR-P-EZK65__qcqkJoa4iGGxRj-YvS');
    expect(html).toContain('1YTospn4BG5B4ZIJc0CDlFRzjh9NiO76F');
    expect(html).toContain('1HVCzW7WQaIh35zaniBTvhwqz6pLjY7kp');
    // Both server URLs derive from file_id + show_id + ep.
    expect(html).toContain('drive.google.com/file/d/');
    expect(html).toContain('animahd.com/player/?file_id=');
    expect(html).toContain('show_id=');
    expect(html).toContain('&ep=');
    expect(html).toContain('epFileIndex');
    expect(html).toContain('seasonEpCount');
});

test('season 2 lists 13 episodes for solo leveling', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('On to the Next Target');
    expect(html).toContain('source.slice(0,12)');
});

test('player shows notice panel when a title has no source', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('id="frameBlocked"');
    expect(html).toContain('id="blockedOpen"');
    expect(html).toContain('Solo Leveling S1–S2 uplabdh hai');
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
