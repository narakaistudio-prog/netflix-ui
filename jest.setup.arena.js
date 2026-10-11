/**
 * Arena test setup: jest-environment-jsdom does not expose TextEncoder /
 * TextDecoder, which jsdom (used to boot the self-contained Crunchyroll page)
 * needs. Polyfill them from node:util.
 */
const { TextDecoder, TextEncoder } = require('node:util');

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
