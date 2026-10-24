/** PROBE (temporary) — `api/moviebox-audio` asli provider par, dono ids ke liye. */
import handler from '../api/moviebox-audio.mjs';

function call(query) {
  return new Promise((resolve) => {
    const req = { query, headers: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, payload });
      },
    };
    handler(req, res).catch((error) => resolve({ status: 500, payload: String(error) }));
  });
}

const cases = [
  ['baked Hindi dub (MovieBox page)', '4151920426815471968', 'mandaadi-hindi-qxUx1r3QHW4'],
  ['NetMirror ka subject (original Tamil)', '2237794012843369344', 'mandaadi-gWLfEvs7jF2'],
  ['TV: Breaking Bad S1E1 (MovieBox)', '6207982430134357800', ''],
];

for (const [label, subjectId, detailPath] of cases) {
  const { status, payload } = await call({ subjectId, detailPath });
  console.log(
    `\n### ${label}\n` +
      JSON.stringify({
        status,
        ok: payload.ok,
        reason: payload.reason,
        error: payload.error,
        languages: (payload.languages || []).map((item) => `${item.name}/${item.lang}/${item.subjectId}`),
      }),
  );
}
