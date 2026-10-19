// Child-process harness: imports the REAL api/toonstream.mjs as ESM (the same
// way Vercel does), runs one scenario against a mocked fetch, prints the
// response JSON. Jest cannot transform .mjs itself, hence this file.
const scenario = JSON.parse(process.env.TS_SCENARIO || '{}');

if (scenario.crashFetch) {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
} else {
    // Longest matching needle wins, so '/episode/x-1x2' beats '/episode/x-1x2/'.
    globalThis.fetch = async (url) => {
        const entries = scenario.mocks || [];
        const hit = entries
            .filter((m) => String(url).includes(m.needle))
            .sort((a, b) => b.needle.length - a.needle.length)[0];
        const headers = new Map([['content-security-policy', '']]);
        if (hit) return { status: hit.status, text: async () => hit.body, headers };
        return { status: 404, text: async () => 'not found', headers };
    };
}

const mod = await import(process.env.TS_MODULE_PATH);

if (scenario.mode === 'unit') {
    const out = scenario.calls.map(([fn, args]) => mod._internal[fn](...args));
    process.stdout.write(`__RESULT__${JSON.stringify({ results: out })}`);
} else {
    const res = {
        code: 0,
        body: null,
        setHeader: () => {},
        status(c) { this.code = c; return this; },
        json(b) { this.body = b; return this; },
    };
    await mod.default({
        method: 'GET',
        headers: { origin: 'https://app.example' },
        socket: { remoteAddress: '1.2.3.4' },
        query: scenario.query || {},
    }, res);
    process.stdout.write(`__RESULT__${JSON.stringify({ code: res.code, body: res.body })}`);
}
