import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * This file is web-only and used to configure the root HTML for every web page during static rendering.
 * The contents of this function only run in Node.js environments and do not have access to the DOM or browser APIs.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" content="#000000" />
        <title>Netflix</title>

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Samsung Smart TV: synchronously tag <html> before first paint so the
            TV-browser arrow cursor is hidden even before React hydrates.
            Keep this script ES5 — it runs raw on Chromium 69 (Tizen 5.5). */}
        <script dangerouslySetInnerHTML={{ __html: tvDetectScript }} />

        {/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const tvDetectScript = `(function(){try{
  var ua = navigator.userAgent || '';
  var isTv = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|AppleTV|tvOS|BRAVIA|GoogleTV|Google TV|Android ?TV|AFT[BMRS]|FireTV|Fire TV|MiBOX|MiTV|VIDAA|Hisense|Skyworth|Philips ?TV|Roku|POV_TV|Viera|HbbTV|TV Safari/i.test(ua);
  var bigNoMouse = false;
  try {
    var mq = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
    bigNoMouse = (!mq || !mq.matches) && (((window.screen && window.screen.width) || window.innerWidth || 0) >= 1024);
  } catch (e) {}
  if (isTv || bigNoMouse) { document.documentElement.className += ' tv-device'; }
  var stored = null;
  try { stored = localStorage.getItem('netflix-tv-mode-enabled'); } catch (e) {}
  if (stored !== 'false' && (isTv || bigNoMouse)) { document.documentElement.className += ' tv-remote-mode'; }
}catch(e){}})();`;

const globalStyles = `
html,
body {
  background-color: #000;
}
body {
  margin: 0;
  overscroll-behavior: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
#root {
  min-height: 100vh;
}
/* Netflix-like dark, slim scrollbars */
* {
  -webkit-tap-highlight-color: transparent;
  scrollbar-width: none;
}
*::-webkit-scrollbar {
  width: 0;
  height: 0;
  background: transparent;
}
/* Pointer affordances on desktop */
[role="button"],
button,
a,
[data-hoverable="true"] {
  cursor: pointer;
}
/* Smooth hover zoom for poster cards on web */
[data-hoverable="true"] {
  transition: transform 180ms ease;
}

/* Samsung Smart TV Remote Control - Hide mouse cursor in TV mode.
   1x1 transparent PNG cursor: Samsung Internet for TV ignores plain
   cursor:none in pointer-fallback states, this data URI guarantees the arrow never shows. */
html.tv-device,
html.tv-device *,
html.tv-device body,
html.tv-remote-mode,
html.tv-remote-mode *,
html.tv-remote-mode body,
body.tv-remote-mode,
body.tv-remote-mode *,
body.tv-pointer-mode,
body.tv-pointer-mode * {
  cursor: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==') 0 0, none !important;
}

/* TV mode: no text selection, no blue highlight, no native focus outlines and
   no tap flash — the white Netflix ring is the only highlight on screen. */
html.tv-remote-mode,
html.tv-remote-mode body {
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-tap-highlight-color: transparent !important;
  overflow: hidden;
}
html.tv-remote-mode ::selection {
  background: transparent;
}
html.tv-remote-mode *:focus:not([data-tv-focused='true']) {
  outline: none !important;
}

/* The remote is driving an on-screen arrow (Samsung Internet for TV / LG webOS
   pointer mode): keep the ring snappy so it tracks the arrow closely. */
body.tv-pointer-mode [data-tv-focused='true'] {
  transition: transform 80ms linear !important;
}

/* Samsung Smart TV Remote Control - Authentic Netflix TV Focus State.
   60fps on low-end TV SoCs: no heavy 45px-blur box-shadow, no box-shadow /
   outline transitions (CPU repaints). GPU-composited transform only. */
[data-tv-focused="true"],
.tv-focused,
:focus-visible[data-tv-focusable="true"] {
  outline: 4px solid #ffffff !important;
  outline-offset: 3px !important;
  transform: translate3d(0, 0, 0) scale(1.06) !important;
  will-change: transform !important;
  z-index: 100 !important;
  transition: transform 120ms linear !important;
}

/* Instant programmatic scrolling for spatial navigation (TV 60fps).
   Direct scrollTop/scrollLeft positioning — never smooth-animated. */
html {
  scroll-behavior: auto;
}
`;
