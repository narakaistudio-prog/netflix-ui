/**
 * Subtitles — WebVTT padho, khud dikhao
 * ======================================
 * Owner: *"subtitle kam nahi kar raha"*.
 *
 * Browser ka `<track>` do wajah se bharosemand nahi tha:
 *   1. native rendering ka style app ke control me nahi (Netflix jaisa nahi
 *      dikhta, mobile Chrome/WKWebView par bilkul hi nahi),
 *   2. cross-origin video ke saath `track` chup-chaap fail bhi ho sakta hai.
 *
 * Isliye bridge (`/api/netmirror-subtitle`) se VTT laate hain, yahan parse
 * karte hain, aur apne overlay me `currentTime` ke hisaab se dikhate hain.
 */

export interface SubtitleCue {
    start: number;
    end: number;
    text: string;
}

/** `00:01:02.500` / `01:02.500` / `62.5` → seconds. */
export function parseVttTime(value: string): number | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parts = raw.split(':');
    if (parts.length > 3) return null;
    let seconds = 0;
    for (const part of parts) {
        const num = Number(part.replace(',', '.'));
        if (!Number.isFinite(num) || num < 0) return null;
        seconds = seconds * 60 + num;
    }
    return seconds;
}

/** Cue text se HTML-ish tags (`<c>`, `<i>`, `<v Anna>`) hata do. */
function cleanCueText(lines: string[]): string {
    return lines
        .map((line) => line.replace(/<[^>]*>/g, '').trim())
        .filter((line) => line.length > 0)
        .join('\n');
}

/**
 * WebVTT → cue list.
 *
 *   WEBVTT
 *
 *   00:00:46.916 --> 00:00:50.125
 *   MUGAVAIPATTINAM
 *
 * Header, `NOTE` blocks, cue ids aur cue settings (`align:start`) sab ignore.
 */
export function parseVtt(input: string): SubtitleCue[] {
    const text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const cues: SubtitleCue[] = [];
    for (const block of text.split(/\n{2,}/)) {
        const lines = block.split('\n').filter((line) => line.trim().length > 0);
        if (!lines.length) continue;
        if (/^WEBVTT/.test(lines[0]) || /^NOTE\b/.test(lines[0])) continue;
        const timingIndex = lines.findIndex((line) => line.includes('-->'));
        if (timingIndex < 0) continue;
        const [fromRaw, toRaw] = lines[timingIndex].split('-->');
        const start = parseVttTime((fromRaw || '').trim().split(/\s+/)[0]);
        const end = parseVttTime((toRaw || '').trim().split(/\s+/)[0]);
        if (start === null || end === null || end <= start) continue;
        const body = cleanCueText(lines.slice(timingIndex + 1));
        if (!body) continue;
        cues.push({ start, end, text: body });
    }
    return cues.sort((a, b) => a.start - b.start);
}

/** Us waqt ka cue (ek se zyada ho to sab jod do — Netflix bhi wahi karta hai). */
export function cueAt(cues: SubtitleCue[], time: number): string | null {
    if (!cues.length || !Number.isFinite(time)) return null;
    const active = cues.filter((cue) => time >= cue.start && time < cue.end);
    if (!active.length) return null;
    return active.map((cue) => cue.text).join('\n');
}
