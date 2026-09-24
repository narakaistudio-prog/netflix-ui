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

/* Samsung Smart TV Remote Control - Hide mouse cursor in TV mode */
body.tv-remote-mode,
body.tv-remote-mode * {
  cursor: none !important;
}

/* Samsung Smart TV Remote Control - Authentic Netflix TV Focus State */
[data-tv-focused="true"],
.tv-focused,
:focus-visible[data-tv-focusable="true"] {
  outline: 4px solid #ffffff !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 24px rgba(255, 255, 255, 0.95), 0 0 45px rgba(229, 9, 20, 0.7) !important;
  transform: scale(1.07) !important;
  z-index: 100 !important;
  transition: transform 180ms cubic-bezier(0.2, 0, 0.2, 1), box-shadow 180ms ease, outline 180ms ease !important;
}

/* Smooth scrolling for spatial navigation */
html {
  scroll-behavior: smooth;
}
`;
