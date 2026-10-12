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

test('Crunchyroll player exposes Nxsha as its only playback source', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('<div class="stage-col">');
    expect(html).toContain('id="serverBar"');
    expect(html.match(/class="server-pill/g) || []).toHaveLength(1);
    expect(html).toContain('server-pill active" data-server="0"');
    expect(html).toContain('title="Reload Nxsha player — nxsha.space"');
    expect(html).toContain("var SERVERS=[{name:'Nxsha',host:'nxsha.space'}];");
    expect(html).toContain('var PLAYER_DEFAULT_SERVER=0;');
    expect(html).toContain('Nxsha · nxsha.space');
    expect(html).not.toContain('Server 1');
    expect(html).not.toContain('Server 2');
    expect(html).not.toContain('Server 3');
    expect(html).not.toContain('animahd.com');
    expect(html).not.toContain('drive.google.com');
    expect(html).not.toContain('drivePopCover');
});

test('player embeds episode links from Nxsha only (no bundled files or legacy ids)', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).not.toContain('application/octet-stream');
    expect(html).not.toContain('referenceVideo');
    expect(html).not.toContain('144U5FdhfBjG-nTnQ72xiljp8syd_qoMS');
    expect(html).not.toContain('1nxwxO8MqRIyK8DI3v5DSIyaVcdhpFkwR');
    expect(html).not.toContain('1NyXWP9KBQtkxKJX6ZU--3PFwMeD5iDn-');
    expect(html).toContain('<iframe id="serverFrame"');
    expect(html).toContain('id="frameLoader"');
    expect(html).toContain('id="serverOpen"');
    expect(html).toContain('id="serverHelp"');
    expect(html).toContain('id="playerTitle"');
    expect(html).toContain('https://nxsha.space/embed/');
    expect(html).toContain("?server=GbruHindi&lang=hi&sub=hi&color=orange");
    expect(html).toContain('function serverUrl(i)');
    expect(html).toContain('id="epStepper"');
});

test('episode metadata is kept separate from playback links', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('var EP_DATA=');
    expect(html).toContain('"solo":{"slug":"solo-leveling","seasons":{"1":12,"2":13}');
    expect(html).not.toContain('"showId":1138');
    expect(html).not.toContain('"eps":["144U5FdhfBjG');
    expect(html).toContain('/*__NXSHA__*/');
    expect(html).toContain('/*__END_NXSHA__*/');
    expect(html).toContain('var NX_DATA=');
});

test('episode guide bakes Nxsha-only images and details separately from playback mappings', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const dataStart = html.indexOf('var NX_EPISODE_DATA=');
    const dataEnd = html.indexOf(';/*__END_NXSHA_GUIDE__*/', dataStart);
    expect(dataStart).toBeGreaterThan(-1);
    expect(dataEnd).toBeGreaterThan(dataStart);
    const guide = JSON.parse(html.slice(dataStart + 'var NX_EPISODE_DATA='.length, dataEnd));
    expect(guide.onepiece).toBeUndefined();
    if (existsSync(join(ROOT, 'data', 'nxsha-episodes.json'))) {
        const snapshot = JSON.parse(readFileSync(join(ROOT, 'data', 'nxsha-episodes.json'), 'utf8'));
        const firstEpisode = snapshot.shows.vinland.episodes.find(
            (episode: { season: number; episode: number }) => episode.season === 1 && episode.episode === 1,
        );
        expect(firstEpisode).toBeTruthy();
        expect(guide.vinland['1']['1']).toMatchObject({
            title: firstEpisode.title,
            image: firstEpisode.image,
            overview: firstEpisode.overview,
        });
        expect(firstEpisode.image).toMatch(/^https:\/\/image\.tmdb\.org\//);
        expect(firstEpisode.overview).toBeTruthy();
    } else {
        // Never relabel cached catalog/legacy artwork as confirmed Nxsha data.
        expect(guide).toEqual({});
    }
    expect(html).toContain('meta.overview');
    expect(html).toContain('meta.airDate');
    expect(html).toContain('episodePlaceholderImage(title,season,i)');
    expect(html).toContain("meta.image||(key==='onepiece'?show.img:episodePlaceholderImage(title,season,i))");
    expect(html).toContain("(ep.desc?'<span class=\"episode-desc\">'");
    expect(html).toContain("(ep.runtime?'<span class=\"episode-runtime\">'");
    expect(html).toContain('.episode-copy .episode-air-date');
    expect(html).toContain("detailPageScroller.addEventListener('scroll',queueLazy,false)");
});

test('player has Nxsha failure handling with retry and no fallback tab', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('onServerTimeout');
    expect(html).toContain('disarmWatchdog');
    expect(html).toContain('id="serverHelp"');
    expect(html).not.toContain('id="noticeAlt"');
    expect(html).toContain('Retry the player or open it in a new tab.');
    expect(html).toContain("setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')");
    expect(html).not.toContain('allow-popups');
    expect(html).toContain("function serverAvailable(i){return i===0&&!!nxFor(playState.key)}");
    expect(html).not.toContain('function nextServer(');
});

test('all 41 Crunchyroll titles resolve through the Nxsha table', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const match = html.match(/\/\*__NXSHA__\*\/var NX_DATA=(\{.*?\});\/\*__END_NXSHA__\*\//);
    expect(match).not.toBeNull();
    const data = JSON.parse((match as RegExpMatchArray)[1]);
    expect(Object.keys(data)).toHaveLength(41);
    for (const entry of Object.values<any>(data)) {
        expect(entry.id).toMatch(/^(tt\d{6,10}|\d{1,9})$/);
        expect(['tv', 'movie']).toContain(entry.kind);
        expect(Object.keys(entry.seasons).length).toBeGreaterThan(0);
    }
    expect(data.aot.id).toBe('tt2560140');
    expect(data.saoMovie.id).toBe('413594');
    expect(data.solo.id).toBe('127532');
    expect(data.onepiece.id).toBe('37854');
});

test('Nxsha iframe sandbox and fullscreen permissions are consistent', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain("serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin')");
    expect(html).toContain("serverFrame.setAttribute('scrolling','no')");
    expect(html).toContain("serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')");
    expect(html).toContain("setClass(videoStage,'s16x9',true)");
    expect(html).toContain('<iframe id="serverFrame" title="Anime server player" allowfullscreen webkitallowfullscreen mozallowfullscreen>');
    expect(html).not.toContain('allow-popups');
    expect(html).not.toContain('sandbox="allow-scripts');
});

test('player shows a notice when a title has no Nxsha mapping', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('id="frameBlocked"');
    expect(html).toContain('id="blockedOpen"');
    expect(html).toContain('has no Nxsha source available yet.<br>Pick another episode or title.');
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
    expect(html).toContain('Player frozen? Tap here to reload');
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

test('Nxsha remains sandboxed, fullscreen-enabled, and has no alternate server controls', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain("serverFrame.setAttribute('sandbox','allow-scripts allow-same-origin')");
    expect(html).toContain("serverFrame.setAttribute('scrolling','no')");
    expect(html).toContain("serverFrame.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture')");
    expect(html).toContain('<iframe id="serverFrame" title="Anime server player" allowfullscreen webkitallowfullscreen mozallowfullscreen>');
    expect(html).toContain("serverFrame.setAttribute('allowfullscreen','')");
    expect(html).not.toContain('serverFs');
    expect(html).not.toContain('enterFs');
    expect(html).not.toContain('requestFullscreen');
    expect(html).toContain('if(stageInjected)return;stageInjected=true;injectServer(PLAYER_DEFAULT_SERVER)');
    expect(html).toContain('Player frozen? Tap here to reload');
    expect(html).toContain('fsExitWatch');
    expect(html).toContain('fsExitArmed');
    expect(html).not.toContain('Server 1');
    expect(html).not.toContain('Server 2');
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


test('Nxsha embed uses a full 16:9 stage with no legacy cover strip', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('.video-stage.s16x9{padding-bottom:56.25%}');
    expect(html).toContain("setClass(videoStage,'s16x9',true)");
    expect(html).not.toContain('s1cover');
    expect(html).not.toContain('s1fit');
    expect(html).not.toContain('max-width:1000px');
    expect(html).not.toContain('drivePopCover');
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
