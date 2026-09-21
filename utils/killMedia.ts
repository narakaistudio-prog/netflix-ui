/**
 * Nuclear option for stopping media on web.
 *
 * React unmount already tears down our players, but third-party embed
 * providers (and browsers caching detached frames) have shown that audio
 * can occasionally survive a "closed" player. This utility force-kills
 * any leftover playing media in the DOM — call it whenever the user
 * closes a player or navigates away.
 */

const EMBED_SRC_PATTERN =
    /nxsha|nhdapi|youtube|youtu\.be|piped|invidious|embed/i;

export function killStrayMedia(): void {
    if (typeof document === 'undefined') return;

    // 1. Kill stray iframes (embed players / trailer fallbacks).
    try {
        const frames = Array.from(document.querySelectorAll('iframe'));
        for (const frame of frames) {
            const el = frame as HTMLIFrameElement;
            const src = el.src || el.getAttribute('src') || '';
            const ours = el.getAttribute('data-arena-embed') === '1';
            if (ours || EMBED_SRC_PATTERN.test(src)) {
                try {
                    el.src = 'about:blank';
                } catch {}
                try {
                    el.remove();
                } catch {}
            }
        }
    } catch {}

    // 2. Pause + unload any stray <video>/<audio> elements.
    try {
        const media = Array.from(
            document.querySelectorAll('video, audio'),
        ) as HTMLMediaElement[];
        for (const el of media) {
            try {
                el.pause();
                el.muted = true;
                el.removeAttribute('src');
                el.load();
            } catch {}
        }
    } catch {}
}
