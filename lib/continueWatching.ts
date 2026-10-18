/**
 * "Continue Watching" logic shared by the Netflix home row.
 *
 * This is the same feature that already runs inside the Crunchyroll page
 * (assets/crunchyroll/crunchyroll.html) — ported over so both apps behave
 * identically:
 *
 *   - the same playback-position sniffing (player time events),
 *   - the same wall-clock estimator as a fallback,
 *   - the same card copy ("6:12 in · 18 min left · just now"),
 *   - the same progress bar and dismiss button,
 *   - the same resume behaviour: the SAME episode, resumed at the SAME
 *     second, with the same seek nudges sprayed into the player frame.
 *
 * Nothing here touches the network: every value comes from the player frame
 * (postMessage) or from the wall clock.
 */

/** Longest plausible media position we accept from a player event (24h). */
const MAX_SECONDS = 86400;

/** Position (in seconds) from which the card starts showing the playhead. */
export const POSITION_LABEL_MIN_SECONDS = 30;

/** Remaining time (in seconds) that still counts as "Almost done". */
export const ALMOST_DONE_SECONDS = 90;

/**
 * Delays (ms) at which a resume is sprayed into the player frame.
 *
 * The provider player boots at its own pace, so the seek command is repeated
 * a few times — the same schedule the Crunchyroll page uses.
 */
export const SEEK_NUDGE_DELAYS = [400, 1500, 3500, 7000, 12000];

export interface TimeEvent {
    /** Playback position in seconds. */
    t: number;
    /** Media duration in seconds, when the player reports one. */
    dur: number | null;
}

/**
 * Read a number that can stand for a media position.
 * Returns null for anything that is not a sane number of seconds.
 */
export function guessSeconds(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > MAX_SECONDS) return null;
    return n;
}

/**
 * Pull a playback position out of a player message.
 *
 * Providers spell the same information in many ways, so every known field
 * name is tried: currentTime / time / seconds / position / progress, with
 * duration / total / length for the length of the media.
 */
export function sniffTimeEvent(data: unknown): TimeEvent | null {
    if (data === null || data === undefined) return null;
    let d: any = data;
    if (typeof d === 'string') {
        try {
            d = JSON.parse(d);
        } catch {
            return null;
        }
    }
    if (typeof d !== 'object') return null;

    let body: any =
        d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d;

    for (let i = 0; i < 2; i++) {
        const t =
            guessSeconds(body.currentTime) ??
            guessSeconds(body.time) ??
            guessSeconds(body.seconds) ??
            guessSeconds(body.position) ??
            guessSeconds(body.progress);
        if (t !== null) {
            const dur =
                guessSeconds(body.duration) ??
                guessSeconds(body.total) ??
                guessSeconds(body.length);
            const evName = String(d.event || d.type || d.name || body.event || '').toLowerCase();
            if (
                /progress|timeupdate|seek|play|pause|time|tick/.test(evName) ||
                d.type === 'MEDIA_DATA' ||
                d.type === 'PLAYER_EVENT' ||
                d.event === 'timeupdate'
            ) {
                return { t, dur };
            }
        }
        if (body !== d) body = d;
        else break;
    }
    return null;
}

/** "6:12" (or "1:02:03" for long media). */
export function formatClock(seconds: number): string {
    const sec = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "just now" / "5m ago" / "2h ago" / "yesterday" / "3d ago". */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
    const minutes = Math.round((now - timestamp) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
}

export interface ResumeInfo {
    /** "6:12 in" */
    position: string;
    /** "18 min left" | "Almost done" | null (no duration known) */
    remaining: string | null;
    /** 0..100 — how much of the media was watched. */
    percent: number;
}

/**
 * Describe where the viewer stopped.
 * Returns null while the playhead is too early to be worth showing.
 */
export function resumeInfo(positionSec = 0, durationSec = 0): ResumeInfo | null {
    const t = Math.max(0, Math.floor(positionSec || 0));
    const dur = Math.max(0, Math.floor(durationSec || 0));
    if (t < POSITION_LABEL_MIN_SECONDS) return null;
    const left = dur > t ? dur - t : null;
    return {
        position: `${formatClock(t)} in`,
        remaining:
            left === null
                ? null
                : left <= ALMOST_DONE_SECONDS
                    ? 'Almost done'
                    : `${Math.ceil(left / 60)} min left`,
        percent: dur > 0 ? Math.max(2, Math.min(100, Math.round((t / dur) * 100))) : 0,
    };
}

export interface ContinueMeta {
    /** "Episode 3 · The Fall" | "Movie" */
    label: string;
    /** "S1 · EP3 · 6:12 in · 18 min left · just now" */
    meta: string;
    /** 0..100 — how much of the media was watched (0 when unknown). */
    percent: number;
}

/**
 * Build the two text lines of a Continue Watching card.
 *
 * `label` names the episode ("Episode 3 · The Fall"), `meta` names the
 * position ("S1 · EP3 · 6:12 in · 18 min left · just now").
 */
export function buildContinueMeta(params: {
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    episodeName?: string;
    positionSec?: number;
    durationSec?: number;
    at: number;
    now?: number;
}): ContinueMeta {
    const { type, season, episode, episodeName, positionSec, durationSec, at } = params;
    const isMovie = type !== 'tv';
    const ep = Math.max(1, Math.floor(episode || 1));
    const sn = Math.max(1, Math.floor(season || 1));

    const label = isMovie
        ? 'Movie'
        : `Episode ${ep}` +
          (episodeName && episodeName !== `Episode ${ep}` ? ` · ${episodeName}` : '');

    const resume = resumeInfo(positionSec || 0, durationSec || 0);
    const where = isMovie ? 'Movie' : `S${sn} · EP${ep}`;
    const position = resume ? ` · ${resume.position}` : '';
    const left = resume?.remaining ? ` · ${resume.remaining}` : '';
    const meta = `${where}${position}${left} · ${relativeTime(at, params.now)}`;

    return { label, meta, percent: resume?.percent ?? 0 };
}

/**
 * The seek commands sprayed into the player frame when a title is resumed.
 *
 * The provider player listens for different shapes, so every known spelling
 * is sent — the frame ignores what it does not understand.
 */
export function buildSeekMessages(seconds: number): unknown[] {
    const s = Math.max(0, Math.floor(seconds || 0));
    return [
        { type: 'seek', seconds: s },
        { type: 'seek', time: s },
        { event: 'seek', time: s },
        { command: 'seek', time: s },
        { action: 'seek', time: s },
        { type: 'PLAYER_COMMAND', data: { command: 'seek', time: s } },
        { type: 'media-seek', currentTime: s },
        JSON.stringify({ event: 'seek', time: s }),
    ];
}
