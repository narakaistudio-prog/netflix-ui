/**
 * Resolves a direct MP4 stream URL for a YouTube video id.
 *
 * YouTube's own iframe player crashes with "Error 153" inside sandboxed
 * iframes (no storage/origin available — e.g. hosted preview panels). A plain
 * <video> element playing a progressive MP4 has no such requirement, so we ask
 * public Piped/Invidious front-ends for the trailer's MP4 stream and play that
 * instead. Falls back to null so callers can degrade gracefully.
 */

const PIPED_APIS = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.yt',
];

const INVIDIOUS_APIS = [
    'https://inv.nadeko.net',
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
];

const timeoutFetch = (url: string, ms = 9000) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort(), ms);
    return fetch(url, { signal: ctrl?.signal }).finally(() => clearTimeout(t));
};

/** Progressive MP4 (with audio), preferring <=480p to keep it snappy. */
export async function resolveTrailerMp4(ytId: string): Promise<string | null> {
    for (const base of PIPED_APIS) {
        try {
            const res = await timeoutFetch(`${base}/streams/${ytId}`);
            if (!res.ok) continue;
            const json: any = await res.json();
            const streams: any[] = json?.videoStreams ?? [];
            const withAudio = streams.filter(
                s => (s.mimeType ?? '').includes('mp4a') && s.url,
            );
            const pick =
                withAudio.find(s => (s.height ?? 9999) <= 480) ??
                withAudio[0] ??
                streams.find(s => (s.mimeType ?? '').startsWith('video/mp4') && s.url);
            if (pick?.url) return pick.url as string;
        } catch {
            // try next instance
        }
    }

    for (const base of INVIDIOUS_APIS) {
        try {
            const res = await timeoutFetch(`${base}/api/v1/videos/${ytId}?fields=formatStreams`);
            if (!res.ok) continue;
            const json: any = await res.json();
            const fmt: any = (json?.formatStreams ?? []).find((f: any) =>
                (f.type ?? '').includes('mp4')
            );
            if (fmt?.url) return fmt.url as string;
        } catch {
            // try next instance
        }
    }

    return null;
}
