import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

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
    expect(html.match(/class="server-pill/g)).toHaveLength(3);
    expect(html).toContain('data-server="0"');
    expect(html).toContain('data-server="1"');
    expect(html).toContain('data-server="2"');
    // Server 1 (AnimaHD, default) + Server 2 (Drive) + Server 3 (Nxsha fallback).
    expect(html).toContain('>Server 1</button>');
    expect(html).toContain('>Server 2</button>');
    expect(html).toContain('>Server 3</button>');
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
    expect(html).toContain('id="serverHelp"');
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
    expect(html).toContain("setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')");
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
    expect(def).toContain("host:'nxsha.space'");
    expect(def.indexOf("host:'animahd.com'")).toBeLessThan(def.indexOf("host:'drive.google.com'"));
    // Server 1 resolves the AnimaHD player URL, Server 2 the Drive preview.
    expect(html).toContain("if(i===0)return 'https://animahd.com/player/");
    // Three pills, Server 1 active by default, Server 3 hidden until a title has no other source.
    expect(html.match(/<button class="server-pill/g)).toHaveLength(3);
    expect(html).toContain('server-pill active" data-server="0"');
    expect(html).toContain('data-server="2" title="Server 3 (Nxsha) — nxsha.space" hidden');
    // Extractor client stays out of the player.
    expect(html).not.toContain('xtVideo');
    expect(html).not.toContain('EXTRACTOR_API');
    expect(html).not.toContain('data-extract=');
});

test('server tabs sandbox policy matches the reference play system', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Server 1 (AnimaHD) must be unsandboxed — that is what lets the player's
    // own fullscreen work, and why exiting fullscreen never shows white.
    expect(html).toContain("if(i===1||i===2){serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin')}else{serverFrame.removeAttribute('sandbox')}");
    // Servers 2 (Drive) + 3 (Nxsha) keep the sandbox: no allow-popups, so the
    // embeds cannot open popups.
    expect(html).not.toContain('allow-popups');
    expect(html).toContain("serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')");
    expect(html).not.toContain('allow="autoplay');
    expect(html).not.toContain('sandbox="allow-scripts');
});


test('titles animahd lacks fall back to the nxsha embed (verified ids)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Baked table + markers.
    expect(html).toContain('/*__NXSHA__*/');
    expect(html).toContain('/*__END_NXSHA__*/');
    expect(html).toContain('var NX_DATA=');
    // Server 3 builds the provider URL used by the rest of the app (lib/embeds.ts).
    expect(html).toContain('https://nxsha.space/embed/');
    expect(html).toContain("?server=GbruHindi&lang=hi&sub=hi&color=orange");
    expect(html).toContain('if(i===2){var nx=nxFor(st.key)');
    // Verified ids: AoT, Tokyo Revengers, Ordinal Scale (movie).
    expect(html).toContain('"aot":{"id":"tt2560140","kind":"tv"');
    expect(html).toContain('"tokyo":{"id":"105009","kind":"tv"');
    expect(html).toContain('"saoMovie":{"id":"413594","kind":"movie"');
    // Season/episode numbering comes from the same table the guide renders.
    expect(html).toContain("function serverAvailable(i)");
    expect(html).toContain("function nextServer(from)");
});

test('player shows notice panel when a title has no source', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('id="frameBlocked"');
    expect(html).toContain('id="blockedOpen"');
    // Generic no-source notice covers every title without a file_id for that ep.
    expect(html).toContain('has no source available yet.<br>Pick another episode or title.');
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

test('the Netflix wordmark lives in the page nav and the nav is sticky', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Wordmark sits inside the page's own nav, right after Request.
    expect(html).toContain('>Request</button>\n      <button class="nav-exit" id="navExit" title="Back to Netflix" aria-label="Back to Netflix">NETFLIX</button>');
    // Sticky bar: the wordmark can never drift down with the content.
    expect(html).toContain('.topbar{position:sticky;top:0;z-index:40;');
    // Red wordmark, no arrow, no pill chrome.
    expect(html).toContain('.nav-exit{border:0;border-bottom:3px solid transparent;background:transparent;color:#E50914;');
    expect(html).not.toContain('arrow-back');
    expect(html).not.toContain('nav-exit-dot');
    // Clicking it asks the shell to leave (same-origin postMessage).
    expect(html).toContain("postMessage({type:'crunchyroll:exit'},'*')");

    const view = readFileSync(
        join(ROOT, 'components', 'Crunchyroll', 'CrunchyrollView.web.tsx'),
        'utf8',
    );
    expect(view).toContain("data.type === 'crunchyroll:exit'");
    expect(view).toContain('router.back()');
    // No app-level overlay anymore — the page owns the control.
    expect(view).not.toContain('exitChipPosition');
    expect(view).not.toContain('Ionicons');
});

test('the wordmark posts the exit message to the shell', async () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    const posted: Array<{ message: unknown; target: string }> = [];
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://app.local/crunchyroll',
        virtualConsole,
    });
    const win = dom.window as unknown as Window & { parent: unknown };
    await new Promise((resolve) => setTimeout(resolve, 250));
    // jsdom gives a top-level window itself as `parent`; fake a host frame.
    const fakeParent = {
        postMessage: (message: unknown, target: string) => posted.push({ message, target }),
    };
    Object.defineProperty(win, 'parent', { value: fakeParent, configurable: true });

    const click = (id: string) => {
        const el = dom.window.document.getElementById(id);
        expect(el).toBeTruthy();
        el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    };
    click('navExit');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posted.map((p) => p.message)).toEqual([{ type: 'crunchyroll:exit' }]);
    dom.window.close();
}, 30000);

test('player-driven fullscreen: AnimaHD tab unsandboxed, no separate control', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The reference behaviour: Server 1 runs unsandboxed with the full allow
    // list, so the player's own fullscreen control works — the page layout
    // never changes, so leaving fullscreen can't leave a white frame.
    expect(html).toContain("if(i===1||i===2){serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin')}else{serverFrame.removeAttribute('sandbox')}");
    expect(html).toContain("serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')");
    // No separate fullscreen entry point anywhere.
    expect(html).not.toContain('serverFs');
    expect(html).not.toContain('enterFs');
    expect(html).not.toContain('requestFullscreen');
    // The play gesture just injects the episode (reference behaviour).
    expect(html).toContain("if(stageInjected)return;stageInjected=true;injectServer(activeServer)");
    // Safety net kept from the reference build.
    expect(html).toContain('Stuck on white? Tap here to reload');
    expect(html).toContain('fsExitWatch');
    expect(html).toContain('fsExitArmed');
});

test('fullscreen support is unchanged for the driver shell', () => {
    const view = readFileSync(
        join(ROOT, 'components', 'Crunchyroll', 'CrunchyrollView.web.tsx'),
        'utf8',
    );
    // The iframe still advertises fullscreen + autoplay to any embedded player.
    expect(view).toContain("allow: 'fullscreen; autoplay; encrypted-media; picture-in-picture'");
    expect(view).toContain('allowFullScreen: true');
    // The shell only answers the exit request now.
    expect(view).toContain("data.type === 'crunchyroll:exit'");
    expect(view).not.toContain('crunchyroll:fullscreen');
});


test('junk cover strip is back but plain black (no blur)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The reference build covered the player page's lower junk with this strip.
    expect(html).toContain('id="s1cover"');
    expect(html).toContain('#s1cover{position:absolute;left:0;right:0;bottom:0;height:4%;background:#000;pointer-events:none}');
    expect(html).toContain("setHidden(s1cover,i!==0)");
    // ...but the blur the user disliked stays gone.
    expect(html).not.toContain('backdrop-filter:blur');
    expect(html).not.toContain('blur(7px)');
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
