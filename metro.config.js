const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle the Crunchyroll OTT demo page (.html) as an opaque local asset so
// native WebViews can load it straight from disk. Web instead uses the
// /assets/crunchyroll/crunchyroll.html static URL (see prepare-web-dist.mjs).
if (!config.resolver.assetExts.includes('html')) {
    config.resolver.assetExts.push('html');
}

module.exports = config;
