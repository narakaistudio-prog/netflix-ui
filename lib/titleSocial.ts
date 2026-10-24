/**
 * Netflix app me **comments + like/dislike** — wahi system jo Crunchyroll page
 * par chalta hai.
 * ======================================================================
 * Owner: "crunchyroll mae jaise comment like ye sab ka system hai netflix ke
 * phone ke liyea bhi ye kardo".
 *
 * Do alag tables hain (Crunchyroll page ke saath **shared**, isliye Netflix par
 * ki hui like/comment Crunchyroll par bhi dikhti hai aur ulta bhi):
 *
 *   cr_episode_reactions  → title/episode ka like-dislike  (`cr_reaction_counts`,
 *                           `cr_toggle_reaction`)
 *   cr_comments           → comments + replies + votes      (`cr_list_comments`,
 *                           `cr_comment_count`, `cr_add_comment`,
 *                           `cr_vote_comment`)
 *
 * Sab kuch **RPC** se hota hai, table par direct insert allowed nahi — table
 * par sirf `select` policy hai aur likhna `SECURITY DEFINER` functions se hota
 * hai jo `auth.uid()` khud padhte hain. Isliye browser se `user_id`/
 * `author_name` forge karke comment daalna possible nahi
 * (`supabase/migrations/` me poora schema + RLS hai).
 *
 * Guest bhi sab padh sakta hai (counts/comment list), par likhne ke liye sign-in
 * chahiye — wahi niyam jo owner ne Crunchyroll ke liye bola tha ("sirf sign in
 * karne wala hi comment kar sakta hai").
 *
 * `fetch` manually hai (supabase-js nahi) — `lib/account.ts` bhi wahi karta hai,
 * aur ek hi session (`cr_comment_session_v1`) dono jagah chalta hai.
 */

import {
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
    ensureFreshSession,
} from './account';
import type { Movie } from '@/types/movie';

/** Ek title/episode ka scope — dono tables isi triple se keyed hain. */
export interface SocialScope {
    /** Stable title key (`movie.id`) — Crunchyroll `show_key` bhi yahi shape rakhta hai. */
    showKey: string;
    season: number;
    episode: number;
}

export interface TitleComment {
    id: string;
    parentId: string | null;
    authorName: string;
    body: string;
    createdAt: string;
    likeCount: number;
    dislikeCount: number;
    /** 1 = like, -1 = dislike, 0 = kuch nahi (current user ka). */
    myVote: number;
    mine: boolean;
}

export interface ReactionCounts {
    likeCount: number;
    dislikeCount: number;
    myVote: number;
}

/**
 * Kaunsa scope? Movies = season 1 / episode 1, series = chalu episode.
 * (Crunchyroll page bhi movie ko S1E1 par daalta hai, isliye dono taraf ek hi
 * thread banta hai — warna same title ke do comment boxes ho jate.)
 */
export function scopeFor(
    movie: Pick<Movie, 'id' | 'mediaType'>,
    season?: number,
    episode?: number,
): SocialScope {
    const isTv = movie.mediaType === 'tv';
    return {
        showKey: String(movie.id || ''),
        season: isTv ? Math.max(1, Number(season) || 1) : 1,
        episode: isTv ? Math.max(1, Number(episode) || 1) : 1,
    };
}

/**
 * Raw row → screen ka shape. Server snake_case bhejta hai, aur `my_vote`/
 * `mine` sirf signed-in user ke liye aate hain (guest ke liye undefined).
 */
export function mapCommentRow(row: Record<string, any>): TitleComment {
    return {
        id: String(row?.id ?? ''),
        parentId: row?.parent_id ? String(row.parent_id) : null,
        authorName: String(row?.author_name || 'Netflix fan'),
        body: String(row?.body || ''),
        createdAt: String(row?.created_at || ''),
        likeCount: Number(row?.like_count) || 0,
        dislikeCount: Number(row?.dislike_count) || 0,
        myVote: Number(row?.my_vote) || 0,
        mine: row?.mine === true,
    };
}

/**
 * Counts wale RPC `returns table(...)` hain, isliye PostgREST kabhi ek row
 * bhejta hai kabhi `[row]` — dono shape ek hi jagah handle karte hain, warna
 * har caller ko `Array.isArray` likhna padta.
 */
export function mapReactionRow(
    row: Record<string, any> | Record<string, any>[] | null | undefined,
): ReactionCounts {
    const value = Array.isArray(row) ? row[0] : row;
    return {
        likeCount: Number(value?.like_count) || 0,
        dislikeCount: Number(value?.dislike_count) || 0,
        myVote: Number(value?.my_vote) || 0,
    };
}

/** Supabase ke error codes ko chhote, samajh me aane wale messages me. */
export function socialErrorMessage(error: unknown): string {
    const raw = String((error as Error)?.message || error || '');
    if (/SIGN_IN_REQUIRED|JWT expired|invalid claim|invalid JWT/i.test(raw)) return 'SIGN_IN_REQUIRED';
    if (/COMMENT_TOO_SHORT/i.test(raw)) return 'Comment is too short.';
    if (/COMMENT_TOO_LONG/i.test(raw)) return 'Comment is longer than 1200 characters.';
    if (/PARENT_NOT_FOUND/i.test(raw)) return 'The comment you were replying to was deleted.';
    if (/COMMENT_NOT_FOUND/i.test(raw)) return 'That comment is already gone.';
    if (/Failed to fetch|NetworkError|network/i.test(raw)) return 'Check your connection and try again.';
    return raw || 'Something went wrong.';
}

type FetchLike = typeof fetch;

interface CallOptions {
    /** Tests ke liye — default `globalThis.fetch`. */
    fetchImpl?: FetchLike;
}

/** Signed-in token (expired ho to refresh). Guest ko anon key hi milti hai. */
async function token(): Promise<string> {
    const session = await ensureFreshSession();
    return session?.access_token || SUPABASE_ANON_KEY;
}

async function call(path: string, init: { method?: string; body?: unknown }, options: CallOptions = {}) {
    const doFetch = options.fetchImpl || (globalThis.fetch as FetchLike);
    const res = await doFetch(SUPABASE_URL + path, {
        method: init.method || 'GET',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (await token()),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let text = '';
    try {
        text = await res.text();
    } catch {
        text = '';
    }
    let data: any = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    if (!res.ok) {
        const message = String(
            data?.message || data?.msg || data?.error_description || data?.error || `HTTP ${res.status}`,
        );
        if (res.status === 401 || res.status === 403) throw new Error('SIGN_IN_REQUIRED');
        throw new Error(message);
    }
    return data;
}

function rpc(name: string, args: Record<string, unknown>, options?: CallOptions) {
    return call(`/rest/v1/rpc/${name}`, { method: 'POST', body: args }, options);
}

/** Episode ke comments (root + replies ek hi flat list me, jaise server deta hai). */
export async function listComments(
    scope: SocialScope,
    sort: 'top' | 'new' = 'top',
    options?: CallOptions,
): Promise<TitleComment[]> {
    const rows = await rpc(
        'cr_list_comments',
        {
            p_show_key: scope.showKey,
            p_season: scope.season,
            p_episode: scope.episode,
            p_sort: sort,
        },
        options,
    );
    return Array.isArray(rows) ? rows.map(mapCommentRow) : [];
}

/** Badge ke liye chhota count (`cr_comment_count` scalar lautta hai). */
export async function commentCount(scope: SocialScope, options?: CallOptions): Promise<number> {
    const value = await rpc(
        'cr_comment_count',
        { p_show_key: scope.showKey, p_season: scope.season, p_episode: scope.episode },
        options,
    );
    return Number(value) || 0;
}

export async function addComment(
    scope: SocialScope,
    body: string,
    parentId: string | null = null,
    options?: CallOptions,
): Promise<void> {
    await rpc(
        'cr_add_comment',
        {
            p_show_key: scope.showKey,
            p_season: scope.season,
            p_episode: scope.episode,
            p_body: body,
            p_parent: parentId,
        },
        options,
    );
}

/**
 * Apna comment delete. Ye seedha REST delete hai (Crunchyroll page bhi yahi
 * karta hai) — RLS policy `user_id = auth.uid()` khud rok deti hai, isliye kisi
 * aur ka comment id bhejne par 0 rows delete hoti hain.
 */
export async function deleteComment(id: string, options?: CallOptions): Promise<void> {
    await call(
        `/rest/v1/cr_comments?id=eq.${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        options,
    );
}

export async function voteComment(
    id: string,
    value: 1 | -1 | 0,
    options?: CallOptions,
): Promise<{ likeCount: number; dislikeCount: number; myVote: number }> {
    const rows = await rpc('cr_vote_comment', { p_comment_id: id, p_value: value }, options);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
        likeCount: Number(row?.like_count) || 0,
        dislikeCount: Number(row?.dislike_count) || 0,
        myVote: Number(row?.my_vote) || 0,
    };
}

/** Episode ke like/dislike counts (+ apna vote, agar signed in ho). */
export async function reactionCounts(scope: SocialScope, options?: CallOptions): Promise<ReactionCounts> {
    const rows = await rpc(
        'cr_reaction_counts',
        { p_show_key: scope.showKey, p_season: scope.season, p_episode: scope.episode },
        options,
    );
    return mapReactionRow(rows);
}

/** Same button dobara = reaction hat jata hai (server par toggle). */
export async function toggleReaction(
    scope: SocialScope,
    value: 1 | -1,
    options?: CallOptions,
): Promise<ReactionCounts> {
    const rows = await rpc(
        'cr_toggle_reaction',
        { p_show_key: scope.showKey, p_season: scope.season, p_episode: scope.episode, p_value: value },
        options,
    );
    return mapReactionRow(rows);
}

/** "2h ago" style — Crunchyroll page ka wahi scale. */
export function timeAgo(iso: string, now: number = Date.now()): string {
    const at = Date.parse(iso);
    if (!at) return 'just now';
    const sec = Math.max(1, Math.floor((now - at) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    const wk = Math.floor(day / 7);
    if (wk < 5) return `${wk}w ago`;
    try {
        return new Date(at).toLocaleDateString();
    } catch {
        return `${Math.floor(day / 30)}mo ago`;
    }
}

/** Avatar ke initials ("Anime Fan" → "AF"). */
export function initialsOf(name: string): string {
    const parts = String(name || '')
        .replace(/[^A-Za-z0-9 _.-]/g, ' ')
        .trim()
        .split(/[\s_.-]+/);
    let out = '';
    for (const part of parts) {
        if (out.length >= 2) break;
        if (part) out += part.charAt(0);
    }
    return (out || '?').toUpperCase();
}

/** Avatar ka rang — naam se hi tay, isliye har user ka apna fix rang rehta hai. */
export function tintOf(name: string): string {
    const value = String(name || 'netflix fan');
    let hue = 0;
    for (let i = 0; i < value.length; i += 1) hue = (hue * 31 + value.charCodeAt(i)) % 360;
    return `hsl(${hue}, 58%, 42%)`;
}
