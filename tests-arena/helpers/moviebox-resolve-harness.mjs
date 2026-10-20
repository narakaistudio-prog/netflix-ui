/**
 * Harness for `api/moviebox-resolve.mjs` — jest .mjs import nahi kar sakta, aur
 * hum route ko asli network par nahi bhejna chahte. Fake client inject hota hai,
 * isliye test deterministic hai.
 *
 * env: MBR_SCENARIO = { op, … }
 */
const scenario = JSON.parse(process.env.MBR_SCENARIO || '{}');
const route = await import(process.env.MBR_MODULE_PATH);
const apiLib = await import(process.env.MBR_API_PATH);
const matchLib = await import(process.env.MBR_MATCH_PATH);

let result;

if (scenario.op === 'queries') {
    result = apiLib.buildSearchQueries(scenario.title, scenario.year);
} else if (scenario.op === 'resolve') {
    const calls = [];
    const fakeClient = {
        async search(keyword) {
            calls.push({ type: 'search', keyword });
            const items = (scenario.search || {})[keyword] || [];
            return {
                status: 200,
                items: items.map((item) => ({
                    title: item.title,
                    subjectId: item.subjectId || '111',
                    detailPath: item.detailPath || 'x',
                    subjectType: item.subjectType ?? 1,
                    year: item.year,
                    hasResource: item.hasResource !== false,
                })),
                total: items.length,
            };
        },
        async detail(ref) {
            calls.push({ type: 'detail', ref });
            return scenario.detail ?? null;
        },
    };
    result = await route.resolveMovieboxLink(
        { title: scenario.title, year: scenario.year, mediaType: scenario.mediaType },
        { client: fakeClient, accept: scenario.accept ?? matchLib.MATCH_ACCEPT },
    );
    result.calls = calls;
} else if (scenario.op === 'url') {
    result = apiLib.movieboxWatchUrl({ detailPath: scenario.detailPath, subjectId: scenario.subjectId });
} else if (scenario.op === 'parse') {
    result = apiLib.parseMovieboxWatchUrl(scenario.url);
} else {
    result = { error: `unknown op ${scenario.op}` };
}

process.stdout.write(`__RESULT__${JSON.stringify(result)}`);
