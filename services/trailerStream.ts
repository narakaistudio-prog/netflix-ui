/**
 * Resolves a direct MP4 stream URL for a YouTube video id.
 *
 * YouTube's own iframe player crashes with "Error 153" inside sandboxed
 * iframes (no storage/origin available — e.g. hosted preview panels). A plain
 * <video> element playing a progressive MP4 has no such requirement, so we ask
 * public Piped/Invidious front-ends for the trailer's MP4 stream and play that
 * instead. All instances are raced in parallel so the fastest one wins.
 */

const PIPED_APIS = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.yt',
    'https://pipedapi.reallyaweso.me',
];

const INVIDIOUS_APIS = [
    'https://inv.nadeko.net',
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://iv.melmac.space',
];

const cache = new Map<string, string>();

const timeoutFetch = (url: string, ms = 8000) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort(), ms);
    return fetch(url, { signal: ctrl?.signal }).finally(() => clearTimeout(t));
};

async function fromPiped(base: string, ytId: string): Promise<string> {
    const res = await timeoutFetch(`${base}/streams/${ytId}`);
    if (!res.ok) throw new Error(`piped ${res.status}`);
    const json: any = await res.json();
    const streams: any[] = json?.videoStreams ?? [];
    const withAudio = streams.filter(s => (s.mimeType ?? '').includes('mp4a') && s.url);
    const pick =
        withAudio.find(s => (s.height ?? 9999) <= 480) ??
        withAudio[0] ??
        streams.find(s => (s.mimeType ?? '').startsWith('video/mp4') && s.url);
    if (!pick?.url) throw new Error('no stream');
    return pick.url as string;
}

async function fromInvidious(base: string, ytId: string): Promise<string> {
    const res = await timeoutFetch(`${base}/api/v1/videos/${ytId}?fields=formatStreams`);
    if (!res.ok) throw new Error(`invidious ${res.status}`);
    const json: any = await res.json();
    const fmt: any = (json?.formatStreams ?? []).find((f: any) => (f.type ?? '').includes('mp4'));
    if (!fmt?.url) throw new Error('no stream');
    return fmt.url as string;
}

/** Progressive MP4 (with audio), preferring <=480p to keep it snappy. */
export async function resolveTrailerMp4(ytId: string): Promise<string | null> {
    const hit = cache.get(ytId);
    if (hit) return hit;

    const attempts = [
        ...PIPED_APIS.map(b => fromPiped(b, ytId)),
        ...INVIDIOUS_APIS.map(b => fromInvidious(b, ytId)),
    ];
    try {
        const url = await Promise.any(attempts);
        if (url) cache.set(ytId, url);
        return url || null;
    } catch {
        return null;
    }
}
