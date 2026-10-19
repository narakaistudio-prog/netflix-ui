/**
 * Small text helpers shared by the anime harvesters. They used to live in the
 * DeadToons schedule harvester; the daily rail no longer uses that source, so
 * the ToonStream jobs own them now.
 */
const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–',
};

const fromCodePoint = (code) => {
    try {
        return String.fromCodePoint(code);
    } catch {
        return '';
    }
};

/** `JoJo&#x27;s` / `&amp;` -> the title the catalog and Nxsha actually use. */
export function decodeEntities(text) {
    return String(text || '')
        .replace(/&#x([0-9a-f]{1,6});?/gi, (m, hex) => fromCodePoint(Number.parseInt(hex, 16)) || m)
        .replace(/&#(\d{2,6});?/g, (m, dec) => fromCodePoint(Number.parseInt(dec, 10)) || m)
        .replace(/&([a-z][a-z0-9]{1,9});?/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Case/punctuation-insensitive key: "Ranma ½" and "ranma1-2" both become ranma12. */
export function titleKey(title) {
    return decodeEntities(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/** The plain title first, then the same title without a dub/language suffix. */
export function titleVariants(title) {
    const raw = decodeEntities(String(title || '')).trim();
    const out = raw ? [raw] : [];
    const cleaned = raw
        .replace(/\s*[\(\[][^)\]]*(dub|sub|hindi|multi|audio)[^)\]]*[\)\]]\s*$/i, '')
        .replace(/\s*[-–—:|]\s*(hindi\s*)?(dub|sub)(bed)?\s*$/i, '')
        .trim();
    if (cleaned && cleaned !== raw) out.push(cleaned);
    return out;
}
