/**
 * Audio languages (dub) — client side
 * ====================================
 * Owner: *"mujhe multilanguage dub chahiye tha"*.
 *
 * Provider par har dub apna subject hota hai, isliye:
 *   1. `/api/moviebox-audio` (same origin) se **bhashaon ki list** aati hai,
 *   2. bhasha chunne par us dub ke subject se naye stream — `resolveDirectStreams`.
 *
 * Jo title provider par nahi / jiske dubs nahi, wahan list khaali rehti hai —
 * menu me jhoothe options nahi banti.
 */

export const MOVIEBOX_AUDIO_PATH = '/api/moviebox-audio';

export interface AudioTrack {
    /** ISO kod (`hi`, `ta`, `en` …) — original ka bhi apna code hota hai. */
    lang: string;
    /** Dikhne wala naam (`Hindi`, `Original`). */
    name: string;
    subjectId: string;
    detailPath: string;
    /** Provider ka original audio. */
    original: boolean;
}

export interface AudioResult {
    ok: boolean;
    languages: AudioTrack[];
    reason?: 'not-found' | 'network';
    error?: string;
}

/** Provider ka jawab → app ka shape (duplicate/khali entries hata kar). */
export function normalizeAudioPayload(payload: unknown): AudioResult {
    if (!payload || typeof payload !== 'object') {
        return { ok: false, languages: [], reason: 'network', error: 'empty payload' };
    }
    const json = payload as Record<string, any>;
    const list = Array.isArray(json.languages) ? json.languages : [];
    const seen = new Set<string>();
    const languages: AudioTrack[] = [];
    for (const item of list) {
        const subjectId = String(item?.subjectId || '').trim();
        if (!subjectId || seen.has(subjectId)) continue;
        seen.add(subjectId);
        languages.push({
            lang: String(item?.lang || '').trim().toLowerCase() || subjectId,
            name: String(item?.name || '').trim() || String(item?.lang || '').toUpperCase(),
            subjectId,
            detailPath: String(item?.detailPath || '').trim(),
            original: item?.original === true,
        });
    }
    return {
        ok: Boolean(json.ok) && languages.length > 0,
        languages,
        reason: json.reason === 'not-found' ? 'not-found' : json.ok ? undefined : 'network',
        error: typeof json.error === 'string' ? json.error : undefined,
    };
}

/**
 * Audio languages lo. `fetchImpl` injectable hai — tests bina network chalte
 * hain. Fail par khaali list (player sirf subtitles dikha dega).
 */
export async function fetchAudioLanguages(
    params: { subjectId?: string; detailPath?: string },
    options: { fetchImpl?: typeof fetch } = {},
): Promise<AudioResult> {
    const subjectId = String(params.subjectId || '').trim();
    if (!/^\d+$/.test(subjectId)) {
        return { ok: false, languages: [], reason: 'not-found', error: 'subjectId nahi mila' };
    }
    const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) {
        return { ok: false, languages: [], reason: 'network', error: 'fetch nahi hai' };
    }
    const query = new URLSearchParams({ subjectId });
    if (params.detailPath) query.set('detailPath', params.detailPath);
    try {
        const res = await doFetch(`${MOVIEBOX_AUDIO_PATH}?${query.toString()}`, {
            headers: { Accept: 'application/json' },
        });
        return normalizeAudioPayload(await res.json());
    } catch (error) {
        return {
            ok: false,
            languages: [],
            reason: 'network',
            error: String((error as any)?.message || error),
        };
    }
}

/**
 * Dub ke liye MovieBox watch page ka link.
 *
 * Provider par har bhasha ka **apna subject** hota hai, isliye doosri bhasha
 * chunna = us subject ka page kholna. Yahan wahi URL banate hain (jaisa site
 * khud use karti hai) — iframe wale raste par bas page badalne se audio badal
 * jaata hai, koi naya backend nahi.
 */
export function buildDubWatchLink(track: AudioTrack | null | undefined): string | null {
    const subjectId = String(track?.subjectId || '').trim();
    if (!/^\d+$/.test(subjectId)) return null;
    const detailPath = String(track?.detailPath || '').trim();
    if (!detailPath) return `https://m2box.org/movies/?id=${subjectId}`;
    return (
        `https://m2box.org/movies/${encodeURIComponent(detailPath)}` +
        `?id=${encodeURIComponent(subjectId)}&type=/movie/detail&detailSe=&detailEp=&lang=en`
    );
}
