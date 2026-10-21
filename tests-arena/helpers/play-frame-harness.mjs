/**
 * Harness for api/moviebox-frame.mjs — jest cannot import .mjs directly, so
 * the module is loaded exactly like Vercel loads it (real ESM import) inside a
 * child process, with `fetch` stubbed to a scenario's upstream response.
 *
 * Input  (env): PF_MODULE_PATH, PF_SCENARIO = { query, upstream, url }
 * Output (stdout): ...__RESULT__{"status":…,"body":…,"headers":{…}}
 */
const modulePath = process.env.PF_MODULE_PATH;
const scenario = JSON.parse(process.env.PF_SCENARIO || '{}');

const mod = await import(modulePath);

globalThis.fetch = async (url) => {
    const upstream = scenario.upstream || {};
    const body = upstream.body ?? '';
    const headers = new Headers(upstream.headers || {});
    if (upstream.contentType) headers.set('content-type', upstream.contentType);
    // `new Response` keeps `.url` empty, and the handler reads it for the
    // <base> origin — a tiny wrapper gives us the final URL.
    const res = new Response(body, { status: upstream.status ?? 200, headers });
    Object.defineProperty(res, 'url', { value: upstream.finalUrl || String(url) });
    return res;
};

function makeRes() {
    const out = { status: 200, headers: {}, body: '' };
    return {
        status(code) {
            out.status = code;
            return this;
        },
        setHeader(key, value) {
            out.headers[String(key).toLowerCase()] = value;
            return this;
        },
        send(body) {
            out.body = String(body ?? '');
            return this;
        },
        _out: out,
    };
}

const req = {
    url: scenario.url || '/api/moviebox-frame',
    query: scenario.query || {},
    headers: scenario.headers || {},
};

const res = makeRes();
try {
    await mod.default(req, res);
    process.stdout.write(`__RESULT__${JSON.stringify(res._out)}`);
} catch (error) {
    process.stdout.write(
        `__RESULT__${JSON.stringify({ status: 0, body: `harness-error: ${error && error.message}`, headers: {} })}`,
    );
}
