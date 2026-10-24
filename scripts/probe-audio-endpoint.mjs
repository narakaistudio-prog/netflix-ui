/** PROBE (temporary) — raw `dubs[]` (type field) Breaking Bad par. */
const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const headers = (extra = {}) => ({
  'User-Agent': UA,
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
  'X-Request-Lang': 'en',
  Referer: 'https://moviebox.ph/',
  Origin: 'https://moviebox.ph',
  ...extra,
});
const home = await fetch(`${H5}/home?host=moviebox.ph`, { headers: headers() });
let token = '';
try {
  token = String(JSON.parse(home.headers.get('x-user') || '{}').token || '');
} catch {
  /* ignore */
}
const auth = token ? { Authorization: `Bearer ${token}` } : {};
for (const [label, subjectId, detailPath] of [
  ['Breaking Bad (tv)', '6207982430134357800', ''],
  ['Mandaadi (movie)', '4151920426815471968', 'mandaadi-hindi-qxUx1r3QHW4'],
]) {
  const url = `${H5}/detail?subjectId=${subjectId}${detailPath ? `&detailPath=${detailPath}` : ''}`;
  const res = await fetch(url, { headers: headers(auth), signal: AbortSignal.timeout(20000) });
  const subject = (await res.json())?.data?.data?.subject || {};
  console.log(`\n### ${label} ${res.status}`);
  console.log(JSON.stringify(subject.dubs || [], null, 0));
}
