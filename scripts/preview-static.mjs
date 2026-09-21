// Local preview of the exported web build — mimics how Vercel serves the
// `dist/` output: real files are served from disk, every other path falls
// back to index.html so expo-router can render the route client-side.
//
// Usage: npm run build:web && npm run preview:web  (then open http://localhost:3000)

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function serve(res, filePath) {
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    // Prevent path traversal: resolve inside dist and re-check prefix.
    const safe = path.join(DIST, urlPath);
    if (!safe.startsWith(DIST)) throw new Error('forbidden');

    // 1) Exact file match (Vercel: filesystem wins over rewrites)
    let filePath = safe;
    if (!path.extname(filePath)) {
      // Try directory index, then clean URL (foo -> foo.html)
      filePath =
        (await fs.stat(safe).then(s => s.isDirectory()).catch(() => false))
          ? path.join(safe, 'index.html')
          : safe + '.html';
    }
    await serve(res, filePath);
  } catch {
    try {
      // 2) SPA fallback — same as the rewrite in vercel.json
      await serve(res, path.join(DIST, 'index.html'));
    } catch {
      res.writeHead(500);
      res.end('dist/ not found — run "npm run build:web" first.');
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Previewing ${DIST} at http://localhost:${PORT} (Vercel-like static + SPA fallback)`);
});
