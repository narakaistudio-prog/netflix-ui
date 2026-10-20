/**
 * Local preview server for the exported web build.
 *
 *   npm run build:web   # ya: npx expo export --platform web
 *   node scripts/preview-server.mjs   # http://localhost:3000
 *
 * Do kaam karta hai:
 *   1. `dist/` ko serve karta hai, expo-router ke clean URLs ke saath
 *      (`/moviebox` → `dist/moviebox.html`, `/movie/<id>` → `dist/movie/[id].html`).
 *   2. `api/*.mjs` (Vercel functions) ko usi port par chala deta hai, taaki
 *      `/api/moviebox-frame` (M2Box ka proxy fallback) aur `/api/toonstream`
 *      bina `vercel dev` ke bhi test ho sakein.
 *
 * Ye sirf local/preview ke liye hai — production me Vercel khud `api/` aur
 * `dist/` dono sambhalta hai.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd(), 'dist');
const API_DIR = resolve(process.cwd(), 'api');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

if (!existsSync(ROOT)) {
    console.error('dist/ nahi mila — pehle `npx expo export --platform web` chalao.');
    process.exit(1);
}

/** /api/<name> ko api/<name>.mjs ke Vercel-style handler par bhejo. */
async function handleApi(req, res, pathname, searchParams) {
    const name = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
    if (!/^[a-z0-9-]+$/i.test(name)) return false;
    const modulePath = join(API_DIR, `${name}.mjs`);
    if (!existsSync(modulePath)) return false;

    const query = {};
    for (const key of new Set(searchParams.keys())) {
        const values = searchParams.getAll(key);
        query[key] = values.length > 1 ? values : values[0];
    }

    // Vercel's req/res shakal par chhota adapter.
    req.query = query;
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
        return res;
    };
    res.send = (body) => {
        if (body === undefined || body === null) {
            res.end();
            return res;
        }
        res.end(Buffer.isBuffer(body) ? body : String(body));
        return res;
    };

    try {
        const mod = await import(pathToFileURL(modulePath).href);
        await mod.default(req, res);
    } catch (error) {
        res.statusCode = 500;
        res.end(`function error: ${String((error && error.message) || error)}`);
    }
    return true;
}

function resolveFile(pathname) {
    const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const candidates = [];
    const base = join(ROOT, clean);
    candidates.push(base);
    if (!extname(clean)) {
        candidates.push(`${base}.html`);
        candidates.push(join(base, 'index.html'));
    }
    for (const candidate of candidates) {
        try {
            if (candidate.startsWith(ROOT) && statSync(candidate).isFile()) return candidate;
        } catch {
            // agla candidate dekho
        }
    }

    // Dynamic routes: expo-router `dist/movie/[id].html` export karta hai.
    // `/movie/jw-…` ke liye usi folder ka pehla `[param].html` de do — bilkul
    // jaise vercel.json ka rewrite karta hai.
    try {
        const dir = dirname(base);
        const dynamic = readdirSync(dir).find((name) => /^\[[^\]]+\]\.html$/.test(name));
        if (dynamic && dir.startsWith(ROOT)) return join(dir, dynamic);
    } catch {
        // koi dynamic route nahi
    }
    return null;
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, url.pathname, url.searchParams);
        if (handled) return;
    }

    const file = resolveFile(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!file) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('404');
        return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
    // Preview frames ke andar chalta hai — koi frame-block header mat bhejo.
    createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
    console.log(`preview: http://${HOST}:${PORT}  (dist + api/*.mjs)`);
});
