/**
 * Dub (audio language) ke streams — server pehle, browser baad me
 * ==============================================================
 * Owner (24 Oct, chautha round): *"netmirror par bas option aata hai par koi
 * audio milta hi nahi … sab me likhta hai audio nahi mila"*.
 *
 * Provider par har dub ka apna subject hota hai, isliye bhasha badalne ka
 * matlab hai us subject ke naye streams. Pehle wo streams **sirf browser se**
 * maangi jaati thi (`lib/movieboxDirect.ts` → h5-api/player-domain). Us raste
 * par browser CORS/preflight par atak jaata hai — MovieBox par phir bhi audio
 * badalta dikhta tha kyunki desktop par purana iframe (watch page) chalta hai,
 * par NetMirror ke apne `<video>` par har bhasha "nahi mila" ho jaati thi.
 *
 * Ab pehla rasta `/api/moviebox-play` hai (same-origin, server-to-server —
 * wahan CORS ka sawaal hi nahi). Wo fail ho to purana browser rasta try hota
 * hai (jo India ke IP par kabhi kaam karta hai). Dono fail → `ok:false`, aur
 * UI sach bolta hai ("audio nahi mila") — jhootha switch nahi.
 *
 * Video ke bytes kahin proxy nahi hote: sirf JSON (URLs) aata hai.
 */

import { resolveDirectStreams, type DirectResult, type DirectStream } from './movieboxDirect';

export const DUB_PLAY_PATH = '/api/moviebox-play';

export interface DubStreamsResult extends DirectResult {
    /** Streams kahan se aaye — debug/console ke liye. */
    via: 'server' | 'client';
    /** Server route ne kya kaha (fail par). */
    trace?: string[];
}

/**
 * Server route kitni der try kare.
 *
 * MovieBox ka app route (visitor-login + play-info/v2) Vercel ke server IP se
 * hamesha `440` deta hai (24 Oct, sab variants — key30/key31/app-headers
 * sabhi). Us par 20 s kharch karke user ko intezaar karana bekaar hai:
 * thodi der me hi `timeout` maan kar MovieBox player wala rasta khul jata hai.
 */
const DEFAULT_TIMEOUT_MS = 4000;

type FetchLike = typeof fetch;

function kindOf(url: string): DirectStream['kind'] {
    if (/\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url)) return 'hls';
    if (/\.mpd(\?|#|$)/i.test(url) || /\/dash\//i.test(url)) return 'dash';
    return 'mp4';
}

/** `/api/moviebox-play` ka jawab → `DirectStream[]`. Kuch bana kar nahi jodte. */
export function normalizeDubPayload(payload: unknown): { ok: boolean; streams: DirectStream[]; reason?: string } {
    const json = (payload || {}) as Record<string, any>;
    const list = Array.isArray(json.streams) ? json.streams : [];
    const streams: DirectStream[] = [];
    const seen = new Set<string>();
    for (const item of list) {
        const url = String(item?.url || '').trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        streams.push({
            url,
            quality: item?.quality ?? 'auto',
            kind: item?.kind === 'hls' || item?.kind === 'dash' ? item.kind : kindOf(url),
        });
    }
    return {
        ok: Boolean(json.ok) && streams.length > 0,
        streams,
        reason: typeof json.reason === 'string' ? json.reason : undefined,
    };
}

/**
 * Dub ke streams: server route → (fail par) browser resolver.
 * `fetchImpl` injectable — tests bina network chalte hain.
 */
export async function resolveDubStreams(
    params: { subjectId?: string; detailPath?: string; se?: number; ep?: number },
    options: {
        fetchImpl?: FetchLike;
        clientFetch?: FetchLike;
        client?: typeof resolveDirectStreams;
        /** Server route ka budget (ms). Default 4 s. */
        timeoutMs?: number;
        /**
         * Browser wala purana rasta chhodo (NetMirror player isko use karta
         * hai). Wo rasta har attempt par 12 s baith sakta hai aur guest ko
         * khaali hi deta hai — player me 30 s ka intezaar bekaar hai.
         */
        skipClient?: boolean;
    } = {},
): Promise<DubStreamsResult> {
    const subjectId = String(params.subjectId || '').trim();
    if (!/^\d+$/.test(subjectId)) {
        return { ok: false, streams: [], reason: 'no-ref', via: 'server' };
    }

    const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    let trace: string[] | undefined;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (doFetch) {
        const query = new URLSearchParams({ subjectId });
        if (params.detailPath) query.set('detailPath', params.detailPath);
        if (params.se !== undefined) query.set('se', String(params.se));
        if (params.ep !== undefined) query.set('ep', String(params.ep));
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            const request = doFetch(`${DUB_PLAY_PATH}?${query.toString()}`, {
                headers: { Accept: 'application/json' },
            }).then((res) => res.json());
            const budget = new Promise<'timeout'>((done) => {
                timer = setTimeout(() => done('timeout'), timeoutMs);
            });
            const raced = await Promise.race([request, budget]);
            if (raced === 'timeout') {
                trace = [`server: ${timeoutMs} ms me jawab nahi aaya`];
            } else {
                const answer = normalizeDubPayload(raced);
                if (answer.ok) return { ok: true, streams: answer.streams, via: 'server' };
                trace = [`server: ${answer.reason || 'no-streams'}`];
            }
        } catch (error) {
            trace = [`server: ${String((error as any)?.message || error)}`];
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    if (options.skipClient) {
        return { ok: false, streams: [], reason: 'no-streams', via: 'client', trace };
    }

    const client = options.client ?? resolveDirectStreams;
    const clientAnswer = await client(
        { subjectId, detailPath: params.detailPath, se: params.se, ep: params.ep },
        options.clientFetch ? { fetchImpl: options.clientFetch } : {},
    );
    return { ...clientAnswer, via: 'client', trace };
}
