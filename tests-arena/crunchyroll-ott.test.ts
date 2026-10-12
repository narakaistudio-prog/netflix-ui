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

test('demo player has a single Nxsha tab below the video', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Markup: video wrapped with the server bar right below it.
    expect(html).toContain('<div class="stage-col">');
    expect(html).toContain('id="serverBar"');
    // Exactly one pill — Nxsha is the only player; Server 1/Server 2 are gone.
    expect(html.match(/class="server-pill/g)).toHaveLength(1);
    expect(html).toContain('data-server="0"');
    expect(html).toContain('>Nxsha</button>');
    expect(html).toContain('nxsha.space/embed/');
    // The removed servers leave no trace in the player.
    expect(html).not.toContain('>Server 1</button>');
    expect(html).not.toContain('>Server 2</button>');
    expect(html).not.toContain('drive.google.com/file/d/');
    expect(html).not.toContain('animahd.com/player/?file_id=');
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

test('demo player resolves nxsha embed URLs per title and episode', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The whole catalog hangs off the baked NX_DATA id table.
    expect(html).toContain('var NX_DATA=');
    expect(html).toContain('"solo":{"id":"tt21209876","kind":"tv"');
    expect(html).toContain('"aot":{"id":"tt2560140","kind":"tv"');
    // Episode-aware wiring: state, resolvers, stepper, notice.
    expect(html).toContain('openEpisode');
    expect(html).toContain('serverUrl');
    expect(html).toContain('id="epStepper"');
    expect(html).toContain('id="noticeTitle"');
    // No dead-server URL builders or tables anymore.
    expect(html).not.toContain('SLUG_OVERRIDES');
    expect(html).not.toContain('var EP_DATA=');
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

test('the only player server is Nxsha (default)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const m = html.match(/var SERVERS=\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const def = (m as RegExpMatchArray)[1];
    // One entry: Nxsha. The old AnimaHD / Drive tabs are gone for good.
    expect(def).toBe("{name:'Nxsha',host:'nxsha.space'}");
    expect(def).not.toContain("name:'Server 1'");
    expect(def).not.toContain("name:'Server 2'");
    expect(def).not.toContain('animahd.com');
    expect(def).not.toContain('drive.google.com');
    // serverUrl() only ever builds the provider embed URL.
    expect(html).toContain("var nbase='https://nxsha.space/embed/'");
    expect(html).not.toContain("if(i===0)return 'https://animahd.com/player/");
    // One pill, Nxsha active by default.
    expect(html.match(/<button class="server-pill/g)).toHaveLength(1);
    expect(html).toContain('server-pill active" data-server="0"');
    // Extractor client stays out of the player.
    expect(html).not.toContain('xtVideo');
    expect(html).not.toContain('EXTRACTOR_API');
    expect(html).not.toContain('data-extract=');
});

test('nxsha embed policy is locked: sandboxed, no popups, permissions listed', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The one player (Nxsha) always runs with the popup shield: sandbox without
    // allow-popups, scrolling locked to the frame, and the media permissions
    // list its own fullscreen/autoplay needs.
    expect(html).toContain("serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin');serverFrame.setAttribute('scrolling','no');serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')");
    // No branch ever strips the sandbox again.
    expect(html).not.toContain("removeAttribute('sandbox')");
    expect(html).not.toContain('allow-popups');
    expect(html).not.toContain('allow="autoplay');
    expect(html).not.toContain('sandbox="allow-scripts');
});


test('every title embeds from the nxsha table (verified ids)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // Baked table + markers.
    expect(html).toContain('/*__NXSHA__*/');
    expect(html).toContain('/*__END_NXSHA__*/');
    expect(html).toContain('var NX_DATA=');
    // serverUrl builds the provider URL used by the rest of the app (lib/embeds.ts).
    expect(html).toContain('https://nxsha.space/embed/');
    expect(html).toContain("?server=GbruHindi&lang=hi&sub=hi&color=orange");
    expect(html).toContain('var nx=nxFor(st.key)');
    // Verified ids: AoT, Tokyo Revengers, Ordinal Scale (movie)…
    expect(html).toContain('"aot":{"id":"tt2560140","kind":"tv"');
    expect(html).toContain('"tokyo":{"id":"105009","kind":"tv"');
    expect(html).toContain('"saoMovie":{"id":"413594","kind":"movie"');
    // …plus the titles the old file-based servers used to carry (Solo Leveling).
    expect(html).toContain('"solo":{"id":"tt21209876","kind":"tv"');
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

test('no white frame after fullscreen: plain-flow nav + repaint nudge', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // While the player shell is open the sticky nav drops back to plain flow,
    // so nothing composited sits over the player frames (reference behaviour —
    // that combination is what leaves a white video on exit).
    expect(html).toContain('body.playing .topbar{position:relative}');
    expect(html).toContain("addClass(document.body,'playing')");
    expect(html).toContain("removeClass(document.body,'playing')");
    // Leaving fullscreen forces the frame to re-raster, then twice more.
    expect(html).toContain('function repaintStage()');
    expect(html).toContain('repaintStage();setTimeout(repaintStage,160);setTimeout(repaintStage,420)');
    // The repaint is a blink + 1px re-layout — never a reload (playback keeps
    // its position).
    expect(html).toContain("f.style.width='calc(100% - 1px)'");
    expect(html).toContain("f.style.visibility='hidden'");
    // The 1-tap recovery toast stays as the last resort.
    expect(html).toContain('Stuck on white? Tap here to reload');
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

test('player-driven fullscreen: nxsha tab carries the fullscreen grant, no separate control', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The embed is given exactly the attributes its own fullscreen control
    // needs (legacy webkit/moz aliases are on the frame markup for old
    // Safari/Firefox). Because the player page fullscreens its own document,
    // our layout never changes — which is why coming back never leaves a white
    // frame.
    expect(html).toContain(
        "serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin');serverFrame.setAttribute('scrolling','no');serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')",
    );
    expect(html).toContain('<iframe id="serverFrame" title="Anime server player" allowfullscreen webkitallowfullscreen mozallowfullscreen>');
    expect(html).toContain("serverFrame.setAttribute('allowfullscreen','')");
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
    // ...and repaints its own iframe when fullscreen ends (white-frame guard).
    expect(view).toContain("document.addEventListener('fullscreenchange', onChange)");
    expect(view).toContain("frame.style.width = 'calc(100% - 1px)'");
    expect(view).toContain('window.setTimeout(nudge, 160)');
});


test('plain stage: no cover strip, nothing cropped or blurred over the player', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    // The stage shows the whole Nxsha player page: nothing cropped, covered or
    // blurred on top of it, and no forced aspect class (the default stage).
    expect(html).not.toContain('s1cover');
    expect(html).not.toContain('s1fit');
    expect(html).not.toContain('s16x9');
    expect(html).not.toContain('max-width:1000px');
    // No blur anywhere.
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
