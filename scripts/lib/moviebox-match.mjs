/**
 * MovieBox matching — pure helpers (koi network nahi).
 * ====================================================
 * Harvester (`scripts/harvest-moviebox-links.mjs`) Netflix catalog ke title ko
 * MovieBox ke search result se milata hai. Matching ka poora dimaag yahan hai
 * taaki tests fixtures par chala sakein:
 *
 *   - title: accents/case/punctuation ignore, `&` = "and", Hindi-style suffix
 *     `[Hindi]` / `(Hindi)` alag se pehchan kar halka bonus.
 *   - type: movie (subjectType 1) vs tv (subjectType 2) — mismatch par bada
 *     penalty, kyunki "same naam wali movie" aur "series" alag subjects hote hain.
 *   - year: same ±0, ek saal ka farq halka, zyada par penalty (MovieBox par
 *     release year kabhi kabhi premiere ka hota hai).
 *
 * Score 0..1. `MATCH_ACCEPT` se upar wala hi bake hota hai; beech wale
 * `MATCH_REVIEW` band me "review" list me jate hain (owner baad me dekh sake).
 */

export const MATCH_ACCEPT = 0.72;
export const MATCH_REVIEW = 0.6;

const DUB_WORDS = [
    'hindi',
    'tamil',
    'telugu',
    'malayalam',
    'kannada',
    'bengali',
    'marathi',
    'punjabi',
    'gujarati',
    'urdu',
    'english',
    'japanese',
    'korean',
    'spanish',
    'french',
    'german',
    'portuguese',
    'italian',
    'dubbed',
];

export function decodeEntities(value) {
    return String(value ?? '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

/** `Mandaadi [Hindi]` → title `mandaadi`, dubHint `hindi`. */
export function splitDubHint(value) {
    const text = decodeEntities(value).trim();
    const match = text.match(/[[(]\s*([a-z ]{3,20})\s*[\])]/i);
    const hint = match ? match[1].trim().toLowerCase() : '';
    const clean = match ? text.replace(match[0], ' ').trim() : text;
    return {
        title: clean || text,
        dubHint: DUB_WORDS.includes(hint) ? hint : '',
    };
}

/** Lowercase, accents hatao, `&`→and, sirf alnum + single spaces. */
export function normalizeTitle(value) {
    return splitDubHint(value)
        .title.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function titleTokens(value) {
    const normalized = normalizeTitle(value);
    return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/** Roman numerals / part markers jo sirf shor hote hain. */
const NOISE_TOKENS = new Set(['the', 'a', 'an', 'and', 'of', 'part', 'season', 'series']);

function meaningful(tokens) {
    const kept = tokens.filter((token) => !NOISE_TOKENS.has(token));
    return kept.length ? kept : tokens;
}

/**
 * Do titles kitne ek jaise hain (0..1).
 * Exact match 1, warna token overlap + prefix match (lambi spelling variants).
 */
export function titleScore(queryTitle, candidateTitle) {
    const a = normalizeTitle(queryTitle);
    const b = normalizeTitle(candidateTitle);
    if (!a || !b) return 0;
    if (a === b) return 1;

    const at = meaningful(a.split(' '));
    const bt = meaningful(b.split(' '));
    if (!at.length || !bt.length) return 0;

    let hits = 0;
    for (const token of at) {
        const found = bt.some(
            (candidate) =>
                candidate === token ||
                (token.length >= 5 && candidate.length >= 5 &&
                    (candidate.startsWith(token.slice(0, 5)) || token.startsWith(candidate.slice(0, 5)))),
        );
        if (found) hits += 1;
    }
    const recall = hits / at.length;
    const precision = hits / bt.length;
    // Query ke saare token mile (recall 1) par candidate me extra shabd hon
    // ("Mandaadi Hindi Dubbed") to bhi achha match hai — isliye recall bhaari.
    return Math.min(1, recall * 0.8 + precision * 0.2);
}

/** 1 = same year, 0.5 = ek saal ka farq, 0 = aur zyada / pata nahi. */
export function yearScore(queryYear, candidateYear) {
    const a = Number(queryYear);
    const b = Number(candidateYear);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return 0.5;
    const diff = Math.abs(a - b);
    if (diff === 0) return 1;
    if (diff <= 1) return 0.5;
    return 0;
}

/** subjectType 1 = movie, 2 = TV. `null` = pata nahi (catalog me mediaType nahi). */
export function typeOfSubject(subjectType) {
    const n = Number(subjectType);
    if (n === 1) return 'movie';
    if (n === 2) return 'tv';
    return null;
}

/**
 * Ek candidate ko score karo.
 *
 * target  : { title, year?, mediaType? }   (catalog ka title)
 * item    : { title, year?, subjectType, detailPath?, hasResource? }  (MovieBox search)
 */
export function scoreCandidate(target, item) {
    const title = titleScore(target.title, item.title ?? '');
    if (title <= 0) return { score: 0, title, reasons: ['title-mismatch'] };

    const reasons = [];
    let score = title * 0.7;
    let penalty = 0;

    if (title >= 0.99) {
        score = 0.75;
        reasons.push('title-exact');
    }

    const want = target.mediaType === 'movie' || target.mediaType === 'tv' ? target.mediaType : null;
    const got = typeOfSubject(item.subjectType);
    if (want && got) {
        if (want === got) {
            score += 0.15;
            reasons.push('type-match');
        } else {
            penalty += 0.5;
            reasons.push('type-mismatch');
        }
    }

    const ys = yearScore(target.year, item.year);
    if (ys === 1) {
        score += 0.1;
        reasons.push('year-exact');
    } else if (ys === 0.5) {
        score += 0.02;
    } else {
        penalty += 0.3;
        reasons.push('year-far');
    }

    // Hindi dub wale subject pehle chahiye (owner ka player Hindi-first hai).
    const hint = splitDubHint(item.title ?? '').dubHint || '';
    const slug = String(item.detailPath ?? '').toLowerCase();
    if (hint === 'hindi' || /\bhindi\b/.test(slug)) {
        score += 0.05;
        reasons.push('hindi-dub');
    }
    if (item.hasResource === false) {
        penalty += 0.15;
        reasons.push('no-resource');
    }

    return {
        score: Math.max(0, Math.min(1, score - penalty)),
        title,
        reasons,
    };
}

/** Best candidate + top runners-up (debug/report ke liye). */
export function rankCandidates(target, items) {
    const scored = (Array.isArray(items) ? items : [])
        .map((item) => ({ item, ...scoreCandidate(target, item) }))
        .sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title)));
    return {
        best: scored[0] || null,
        runnersUp: scored.slice(1, 4),
        scored,
    };
}

/**
 * `/detail` response ke `dubs` me se Hindi (ya jo `prefer` bhasha) chuno —
 * MovieBox par har dub apna alag subject hota hai (alag subjectId + detailPath).
 * `type` 0 = audio dub, 1 = subtitle variant (usko play target nahi banana).
 */
export function pickDub(dubs, prefer = 'hindi') {
    const list = Array.isArray(dubs) ? dubs : [];
    const audio = list.filter((d) => Number(d.type ?? 0) === 0);
    const pool = audio.length ? audio : list;
    const wanted = String(prefer || 'hindi').toLowerCase();
    return (
        pool.find((d) => String(d.lanCode ?? '').toLowerCase() === 'hi' && wanted === 'hindi') ||
        pool.find((d) => String(d.lanName ?? '').toLowerCase().includes(wanted)) ||
        pool.find((d) => /hindi/i.test(String(d.detailPath ?? ''))) ||
        null
    );
}
