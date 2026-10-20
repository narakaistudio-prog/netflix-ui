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
const NOISE_TOKENS = new Set(['the', 'a', 'an', 'and', 'of', 'part', 'season', 'series', 'full', 'movie']);

/**
 * Dub/language tags title ke andar — compare karte waqt inhe hata do, kyunki
 * harvester queries me "Hindi" jodta hai aur MovieBox bhi `[English]` lagata
 * hai. Dono taraf hataane se "Little Things Hindi" aur "Little Things" barabar
 * rehte hain ("Hindi Medium" jaisi title bhi dono taraf consistent rehti hai).
 */
const LANGUAGE_TOKENS = new Set([...DUB_WORDS, 'dub', 'dubbed', 'sub', 'subs', 'subbed', 'multi', 'audio']);

const SEASON_RE = /^s\d+(-s\d+)?$/;

function meaningful(tokens) {
    const kept = tokens.filter(
        (token) => !NOISE_TOKENS.has(token) && !LANGUAGE_TOKENS.has(token) && !SEASON_RE.test(token),
    );
    return kept.length ? kept : tokens;
}

/**
 * Clip/junk detection — MovieBox par YouTube-style clips (`[SUB] … EP24`,
 * "Dilwale SRK-KAJOL meet Gharwaale") bhi search me aate hain. Inhe kabhi
 * bake nahi karna.
 */
const JUNK_RE = new RegExp(
    [
        '\\[(sub|hardsub|cam|hdcam|fan ?made)\\]',
        '\\bep\\s?\\d+\\b',
        '\\bteaser\\b',
        '\\btrailer\\b',
        '\\bclip\\b',
        '\\bpromo\\b',
        '\\binterview\\b',
        '\\bshorts?\\b',
        '\\bcompilation\\b',
        '\\bbehind the scenes\\b',
        '\\bmeet\\b',
        '\\bwhatsapp\\b',
        '《|》|“|”',
        '[\u3131-\uD79D]',
    ].join('|'),
    'i',
);

/** Junk title/slug? (public — report me bhi dikhta hai.) */
export function isJunkCandidate(value) {
    return JUNK_RE.test(String(value ?? ''));
}

/**
 * Do titles kitne ek jaise hain (0..1).
 * Exact match 1, warna token overlap + prefix match (lambi spelling variants).
 */
export function titleScore(queryTitle, candidateTitle) {
    const a = normalizeTitle(queryTitle);
    const b = normalizeTitle(candidateTitle);
    if (!a || !b) return 0;

    const at = meaningful(a.split(' '));
    const bt = meaningful(b.split(' '));
    if (!at.length || !bt.length) return 0;
    if (at.join(' ') === bt.join(' ')) return 1;

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
    // Recall bhaari (MovieBox "Dubbed"/"S1-S3" jaise shabd jodta hai), par
    // precision ko pehle se zyada weight — warna "Sultan" → "Sultan of Delhi"
    // aur "MIMI" → "30 DAYS EDDIE WATSON MIMI ORJIEKWE" jaisi matches pass ho
    // jati hain.
    // Ek hi shabd wali query ("Jawan", "Sultan", "MIMI") par extra shabd =
    // pakka alag title (Jawani Janeman / Sultan of Delhi). Exact hi chahiye.
    if (at.length === 1) return hits === 0 ? 0 : bt.length === 1 ? 1 : 0.45;

    let score = recall * 0.7 + precision * 0.3;

    // Chhoti query par extra distinctive shabd = alag title (spin-off/sequel).
    const extra = bt.length - hits;
    if (extra > 0 && at.length <= 2) score -= Math.min(0.3, 0.12 * extra);
    else if (extra > 1) score -= Math.min(0.2, 0.06 * (extra - 1));

    return Math.max(0, Math.min(1, score));
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

    // TV par saal dheela — MovieBox season pack ka saal (pehla/last season)
    // catalog ke saal se 2-4 saal alag ho sakta hai. Movie par strict.
    const ys = yearScore(target.year, item.year);
    const tvLenient = want === 'tv';
    if (ys === 1) {
        score += 0.1;
        reasons.push('year-exact');
    } else if (ys === 0.5) {
        score += 0.02;
    } else if (Number(target.year) && Number(item.year)) {
        const diff = Math.abs(Number(target.year) - Number(item.year));
        if (tvLenient && diff <= 5) {
            reasons.push('year-tv-window');
        } else if (diff === 2) {
            penalty += 0.15;
            reasons.push('year-near');
        } else {
            penalty += 0.4;
            reasons.push('year-far');
        }
    } else {
        reasons.push('year-unknown');
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
    if (isJunkCandidate(item.title) || isJunkCandidate(item.detailPath)) {
        penalty += 0.45;
        reasons.push('junk-clip');
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

/** MovieBox slug/title me dikhne wali audio languages. */
export const DUB_LANGUAGES = [
    'hindi',
    'english',
    'korean',
    'japanese',
    'tamil',
    'telugu',
    'malayalam',
    'kannada',
    'bengali',
    'marathi',
    'punjabi',
    'urdu',
    'gujarati',
    'filipino',
    'indonesian',
    'thai',
    'chinese',
    'arabic',
    'spanish',
    'french',
    'german',
    'portuguese',
    'russian',
    'turkish',
    'italian',
];

/**
 * Watch page ki asli audio language — slug se (`…-hindi-…`) ya title ke
 * bracket tag se (`Mandaadi [Hindi]`). Kuch na mile to `original`.
 *
 * `dubs[]` me Hindi audio hona ka matlab ye nahi ki page Hindi dub ka hai —
 * bahut titles par ek hi subject ke andar dub badalta hai, aur uska slug
 * original bhasha ka hota hai. Isliye label page se nikalo, dua se nahi.
 */
export function languageOfRef(ref = {}) {
    const slug = String(ref?.detailPath ?? '').toLowerCase();
    for (const lang of DUB_LANGUAGES) {
        if (new RegExp(`(?:^|[-_])${lang}(?:[-_]|$)`).test(slug)) return lang;
    }
    const title = String(ref?.title ?? '');
    const tag = title.match(/\[([^\]]+)\]/);
    if (tag) {
        const words = tag[1]
            .toLowerCase()
            .split(/[\s/,&]+/)
            .filter(Boolean);
        const hit = words.find((word) => DUB_LANGUAGES.includes(word));
        if (hit) return hit;
    }
    return 'original';
}

/**
 * Kis subject par bhejna hai + uska sach wala dub label.
 *
 * `dubs[]` ka Hindi entry tabhi use hota hai jab uska **apna** `detailPath` +
 * `subjectId` ho (MovieBox par kuch dubs alag subject hote hain). Warna wahi
 * confirmed subject chalta hai — label us slug se aata hai, isliye galat
 * "Hindi" tag nahi lagta.
 */
export function pickPlayRef(detail, fallback = {}) {
    const hindiDub = detail ? pickDub(detail.dubs, 'hindi') : null;
    const ownSubject = Boolean(
        hindiDub &&
            hindiDub.detailPath &&
            hindiDub.subjectId &&
            (!detail?.detailPath || hindiDub.detailPath !== detail.detailPath),
    );

    const ref = ownSubject
        ? { detailPath: String(hindiDub.detailPath), subjectId: String(hindiDub.subjectId) }
        : detail?.detailPath
        ? { detailPath: String(detail.detailPath), subjectId: String(detail.subjectId ?? '') }
        : { detailPath: String(fallback.detailPath ?? ''), subjectId: String(fallback.subjectId ?? '') };

    return {
        ref,
        /** Alag Hindi-dub subject mila aur use hi bheja ja raha hai. */
        hindiDub: ownSubject ? hindiDub : null,
        /** Page ke andar Hindi audio available hai (label `hindi` ho, zaroori nahi). */
        hindiAudio: Boolean(hindiDub),
        title: detail?.title || fallback.title || '',
        dub: languageOfRef({ detailPath: ref.detailPath, title: detail?.title || fallback.title || '' }),
    };
}
