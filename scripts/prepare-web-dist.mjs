import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(projectRoot, process.argv[2] || 'dist');
const postersDir = join(projectRoot, 'assets', 'posters');

if (!existsSync(join(outputDir, 'index.html'))) {
    throw new Error(`Web export not found at ${outputDir}; run expo export --platform web first.`);
}

// Expo copies assets referenced by require(), but the web poster manifest uses
// /assets/posters/... URLs to avoid importing 800+ native asset modules. Ship
// those exact files alongside the static export, including refresh-generated art.
let copied = 0;
function copyPosterDirectory(source, destination) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) {
        const from = join(source, name);
        const to = join(destination, name);
        if (statSync(from).isDirectory()) {
            copyPosterDirectory(from, to);
        } else if (/\.(?:jpe?g|png|webp)$/i.test(name)) {
            cpSync(from, to);
            copied += 1;
        }
    }
}
copyPosterDirectory(postersDir, join(outputDir, 'assets', 'posters'));

const manifest = readFileSync(join(postersDir, 'index.web.ts'), 'utf8');
const urls = new Set([...manifest.matchAll(/"(\/assets\/posters\/[^\"]+)"/g)].map(match => match[1]));
const missing = [...urls].filter(url => !existsSync(join(outputDir, url.slice(1))));
if (missing.length) {
    throw new Error(`Missing exported posters: ${missing.slice(0, 5).join(', ')}`);
}
console.log(`Copied ${copied} local posters; verified ${urls.size} manifest URLs in ${outputDir}`);
