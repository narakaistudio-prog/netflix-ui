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

        {/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

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
body.tv-remote-mode,
body.tv-remote-mode * {
  cursor: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==') 0 0, none !important;
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
