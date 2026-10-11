import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createExtractorServer } from '../server/extractor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const EXTRACTOR_PORT = 8787;

// Start backend extractor server on loopback
const extractorServer = createExtractorServer();
extractorServer.listen(EXTRACTOR_PORT, '127.0.0.1', () => {
  console.log(`Backend extractor API running on 127.0.0.1:${EXTRACTOR_PORT}`);
});


const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

function resolveFilePath(urlPath) {
  let clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean === '/') clean = '/index.html';

  // Vercel rewrites emulation
  if (clean.startsWith('/movie/')) {
    clean = '/movie/[id].html';
  } else if (clean.startsWith('/browse/')) {
    clean = '/browse/[rowTitle].html';
  }

  let full = path.join(DIST_DIR, clean);

  // If path exists as file
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    return full;
  }

  // Clean URLs: try adding .html
  if (fs.existsSync(full + '.html') && fs.statSync(full + '.html').isFile()) {
    return full + '.html';
  }

  // Directory index
  const index = path.join(full, 'index.html');
  if (fs.existsSync(index) && fs.statSync(index).isFile()) {
    return index;
  }

  return null;
}

function proxyToExtractor(req, res) {
  const options = {
    hostname: '127.0.0.1',
    port: EXTRACTOR_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${EXTRACTOR_PORT}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'extractor-service-unavailable' }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  // CORS & Preview host headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Forward API calls to backend extractor proxy
  if (req.url.startsWith('/api/') || req.url.startsWith('/healthz')) {
    proxyToExtractor(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const filePath = resolveFilePath(req.url);
  if (!filePath) {
    const notFound = path.join(DIST_DIR, '+not-found.html');
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Vercel Preview Server listening on http://${HOST}:${PORT}`);
});
