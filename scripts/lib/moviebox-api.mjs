/**
 * MovieBox H5 API client — harvester aur live resolver dono ka common hissa.
 * ==========================================================================
 * MovieBox ki site apni `h5-api.aoneroom.com/wefeed-h5api-bff` API se chalti
 * hai. Har call me guest JWT chahiye (`/home` ke `x-user` header se, ya
 * `search-suggest` se mint karke). Yahan wahi flow hai — jo chiz do jagah
 * chalti hai:
 *
 *   1. `scripts/harvest-moviebox-links.mjs` — poora catalog pehle se bake karta
 *      hai (GitHub Actions, roz).
 *   2. `api/moviebox-resolve.mjs` — jo title bake nahi hua (naya release, ya
 *      search me na mila) uske liye **play time par** live resolve, taaki user
 *      ko link paste na karna pade.
 *
 * Koi shared mutable state nahi — har client apna token cache rakhta hai.
 * `fetchImpl` inject kar sakte hain, isliye tests bilkul network ke bina chalte
 * hain.
 */

import { createHash } from 'node:crypto';

export const H5_API = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
export const MOVIEBOX_SITE = 'https://m2box.org';
export const DEFAULT_FRONT_HOST = 'moviebox.ph';

export const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 2;
const TOKEN_TTL_MS = 45 * 60 * 1000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** `X-Client-Token`: `<unix-sec>,<md5(reverse(sec))>` — MovieBox ka apna formula. */
export function clientToken(nowMs = Date.now()) {
    const sec = String(Math.floor(nowMs / 1000));
    const md5 = createHash('md5').update(sec.split('').reverse().join('')).digest('hex');
    return `${sec},${md5}`;
}

/** `x-user` header (ya `set-cookie`) me se token nikalo. */
export function tokenFrom(xUserHeader, cookies) {
    if (xUserHeader) {
        try {
            const token = JSON.parse(xUserHeader)?.token;
            if (token) return String(token);
        } catch {
            // header JSON nahi tha
        }
    }
    const match = String(cookies || '').match(/token=([^;]+)/);
    return match ? match[1] : '';
}

/** Search result ko app/harvester ke common shape me. */
export function normalizeSearchItems(data) {
    const items = data?.data?.items;
    const list = Array.isArray(items) ? items : [];
    return {
        items: list.map((item) => ({
            title: String(item?.title ?? ''),
            subjectId: String(item?.subjectId ?? item?.id ?? ''),
            detailPath: String(item?.detailPath ?? ''),
            subjectType: Number(item?.subjectType) || 0,
            year: Number(String(item?.releaseDate ?? '').slice(0, 4)) || undefined,
            hasResource: item?.hasResource !== false,
        })),
        total: Number(data?.data?.pager?.totalCount) || list.length,
    };
}

/** `/detail` ka `subject` → humara shape (dubs ke saath). */
export function normalizeDetail(subject) {
    if (!subject) return null;
    const releaseDate = String(subject.releaseDate ?? '');
    return {
        subjectId: String(subject.subjectId ?? ''),
        detailPath: String(subject.detailPath ?? ''),
        title: String(subject.title ?? ''),
        subjectType: Number(subject.subjectType) || 0,
        year: Number(releaseDate.slice(0, 4)) || undefined,
        hasResource: subject.hasResource !== false,
        dubs: Array.isArray(subject.dubs)
            ? subject.dubs.map((dub) => ({
                  subjectId: String(dub?.subjectId ?? ''),
                  detailPath: String(dub?.detailPath ?? ''),
                  lanName: String(dub?.lanName ?? ''),
                  lanCode: String(dub?.lanCode ?? ''),
                  type: Number(dub?.type ?? 0),
                  original: dub?.original === true,
              }))
            : [],
    };
}

/**
 * Search queries ki tarteeb — pehla result-sets jo sabse zyada dhundhte hain.
 *
 * MovieBox ka search poore title par kamzor padta hai (e.g. "Vishwanath & Sons"
 * par "SONS OF ROYALTY" laut kar aata hai), lekin **ek distinctive shabd**
 * ("Vishwanath") par sahi subject mil jata hai. Isliye ladder me anchor query
 * bhi hai, aur subtitles (`: …`) hata kar chhoti query bhi.
 */
export function buildSearchQueries(title, year) {
    const raw = String(title ?? '').trim();
    if (!raw) return [];
    const out = [];
    const push = (text, tag) => {
        const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
        if (clean.length < 2) return;
        const key = clean.toLowerCase();
        if (out.some((entry) => entry.text.toLowerCase() === key)) return;
        out.push({ text: clean, tag });
    };

    push(raw, 'primary');
    if (!/\bhindi\b/i.test(raw)) push(`${raw} Hindi`, 'hindi');
    if (year) push(`${raw} ${year}`, 'year');

    // Brackets/parenthetical hata kar.
    const clean = raw.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean && clean !== raw) push(clean, 'clean');

    // `&` ↔ and
    if (/&/.test(raw)) push(raw.replace(/&/g, ' and '), 'ampersand');
    if (/\band\b/i.test(raw)) push(raw.replace(/\band\b/gi, '&'), 'ampersand');

    // Subtitle ke baad wala hissa hata do ("Demon Slayer: Kimetsu…" → "Demon Slayer").
    const head = raw.split(/[:–—|]/)[0].trim();
    if (head && head !== raw && head.length >= 3) push(head, 'head');

    // Sabse distinctive shabd — sabse lamba non-stopword (numbers nahi).
    const stop = new Set([
        'the', 'a', 'an', 'and', 'of', 'in', 'on', 'for', 'to', 'with', 'part', 'season', 'series',
        'movie', 'full', 'hindi', 'english', 'tamil', 'telugu', 'korean', 'japanese',
    ]);
    const words = raw
        .replace(/[^\p{L}\p{N} ]+/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 4 && !stop.has(word.toLowerCase()) && !/^\d+$/.test(word));
    if (words.length > 1) {
        const anchor = [...words].sort((a, b) => b.length - a.length)[0];
        if (anchor) push(anchor, 'anchor');
        // Pehle do shabd bhi ek achi middle-ground query hai.
        const plain = raw.replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean);
        if (plain.length > 2) push(plain.slice(0, 2).join(' '), 'short');
    }
    return out;
}

/**
 * Client banao. `fetchImpl`/`host` inject ho sakte hain (tests ke liye).
 */
export function createMovieboxClient(options = {}) {
    const host = options.host || process.env.MOVIEBOX_HOST || DEFAULT_FRONT_HOST;
    const doFetch = options.fetchImpl || globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = options.retries ?? DEFAULT_RETRIES;

    if (typeof doFetch !== 'function') throw new Error('fetch available nahi hai');

    const tokenState = { value: options.token || '', at: options.token ? Date.now() : 0 };

    const headers = (extra = {}) => ({
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
        'X-Request-Lang': 'en',
        Referer: `https://${host}/`,
        Origin: `https://${host}`,
        ...extra,
    });

    async function fetchJson(url, init = {}) {
        let lastError = '';
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                const res = await doFetch(url, {
                    method: init.method || 'GET',
                    headers: init.headers,
                    body: init.body,
                    redirect: 'follow',
                    signal: AbortSignal.timeout(timeoutMs),
                });
                const text = await res.text().catch(() => '');
                let data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch {
                    data = null;
                }
                if (res.status === 429 && attempt < retries) {
                    await sleep(1500 * (attempt + 1));
                    lastError = 'rate-limited';
                    continue;
                }
                return { status: res.status, data, headers: res.headers, text };
            } catch (error) {
                lastError = error?.message || String(error);
                if (attempt < retries) await sleep(700 * (attempt + 1));
            }
        }
        return { status: 0, data: null, headers: null, text: '', error: lastError };
    }

    async function getToken(force = false) {
        if (!force && tokenState.value && Date.now() - tokenState.at < TOKEN_TTL_MS) return tokenState.value;
        const home = await fetchJson(`${H5_API}/home?host=${encodeURIComponent(host)}`, { headers: headers() });
        let token = tokenFrom(home.headers?.get('x-user'), home.headers?.get('set-cookie'));
        if (!token) {
            const mint = await fetchJson(`${H5_API}/subject/search-suggest`, {
                method: 'POST',
                headers: headers({
                    'Content-Type': 'application/json',
                    'X-Client-Token': clientToken(),
                }),
                body: JSON.stringify({ keyword: 'a', perPage: 10 }),
            });
            token = tokenFrom(mint.headers?.get('x-user'), mint.headers?.get('set-cookie'));
        }
        if (token) {
            tokenState.value = token;
            tokenState.at = Date.now();
        }
        return token;
    }

    async function search(keyword) {
        let token = await getToken();
        const call = (bearer) =>
            fetchJson(`${H5_API}/subject/search`, {
                method: 'POST',
                headers: headers({
                    'Content-Type': 'application/json',
                    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
                }),
                // Site khud perPage:0 bhejti hai — isi se order/count site jaisa rehta hai.
                body: JSON.stringify({ keyword, page: 1, perPage: 0, subjectType: 0 }),
            });

        let result = await call(token);
        if (result.status === 401 || result.status === 403 || !result.data) {
            token = await getToken(true);
            result = await call(token);
        }
        const normalized = normalizeSearchItems(result?.data);
        return { status: result.status, ...normalized };
    }

    async function detail(ref) {
        const queries = [];
        if (ref.detailPath) queries.push(`detailPath=${encodeURIComponent(ref.detailPath)}`);
        if (ref.subjectId) queries.push(`subjectId=${encodeURIComponent(ref.subjectId)}`);
        const token = await getToken();
        for (const query of queries) {
            const result = await fetchJson(`${H5_API}/detail?${query}`, {
                headers: headers(token ? { Authorization: `Bearer ${token}` } : {}),
            });
            const found = normalizeDetail(result?.data?.data?.subject);
            if (result.status === 200 && found) return found;
        }
        return null;
    }

    return { host, h5: H5_API, getToken, search, detail, fetchJson, headers };
}

/** `{detailPath, subjectId}` → canonical watch page URL. */
export function movieboxWatchUrl({ detailPath, subjectId }) {
    if (!detailPath || !subjectId) return '';
    return (
        `${MOVIEBOX_SITE}/movies/${encodeURIComponent(detailPath)}` +
        `?id=${encodeURIComponent(subjectId)}&type=/movie/detail&detailSe=&detailEp=&lang=en`
    );
}

/** Watch page URL → `{detailPath, subjectId}` (warna null). */
export function parseMovieboxWatchUrl(value) {
    try {
        const url = new URL(String(value ?? ''));
        const match = url.pathname.match(/\/movies\/([^/]+)\/?$/);
        const subjectId = url.searchParams.get('id') || '';
        if (!match || !subjectId) return null;
        return { detailPath: decodeURIComponent(match[1]), subjectId };
    } catch {
        return null;
    }
}
