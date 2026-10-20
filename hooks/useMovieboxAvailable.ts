/**
 * "Is title ka MovieBox link hai ya nahi?" — ek hi jagah tay hota hai.
 * ===================================================================
 * Server switcher me M2Box sirf tab dikhna chahiye jab us par kuch chalta ho.
 * Isliye title khulte hi:
 *   1. row / baked catalog / browser-saved link → turant `available: true`,
 *   2. warna background me live resolve (`/api/moviebox-resolve`),
 *   3. mila → `available: true` (link save ho jata hai), nahi mila → `false`.
 *
 * Jab tak jawab nahi aata `checking: true` rehta hai — UI us waqt MovieBox ka
 * option dikhata hi nahi (default Nxsha chalta rehta hai).
 */

import { useEffect, useRef, useState } from 'react';
import { resolveMovieboxLive } from '@/lib/movieboxResolve';

interface TitleLike {
    id?: string | number;
    tmdb_id?: string | number;
    title?: string;
    year?: string | number;
    mediaType?: string;
    embed_url?: string;
    videoUrl?: string;
}

export interface MovieboxAvailability {
    /** MovieBox par is title ka watch page hai. */
    available: boolean;
    /** Jawab ka intezaar chal raha hai. */
    checking: boolean;
}

export function useMovieboxAvailable(
    title: TitleLike | null | undefined,
    options: {
        /** Pehle se link pata hai (resolveMovieboxLink se) — network ki zaroorat nahi. */
        known?: boolean;
        /** Player ka linkKey — cache/save isi par. */
        linkKey?: string;
        /** Live resolve ne link dhoondh liya — parent ko revision bump karne do. */
        onResolved?: () => void;
    } = {},
): MovieboxAvailability {
    const { known = false, linkKey, onResolved } = options;
    const [available, setAvailable] = useState(known);
    const [checking, setChecking] = useState(!known);
    const resolvedRef = useRef(false);

    // Title badla → dobara check.
    const titleKey = `${title?.id ?? ''}|${title?.tmdb_id ?? ''}|${title?.mediaType ?? ''}|${title?.title ?? ''}`;

    useEffect(() => {
        if (known) {
            setAvailable(true);
            setChecking(false);
            return;
        }
        if (!title?.title) {
            setAvailable(false);
            setChecking(false);
            return;
        }
        let cancelled = false;
        setChecking(true);
        resolveMovieboxLive(
            {
                id: title.id,
                tmdb_id: title.tmdb_id,
                title: title.title,
                year: title.year,
                mediaType: title.mediaType,
            },
            {
                ...(linkKey ? { key: linkKey, storeKey: linkKey } : {}),
            },
        )
            .then((result) => {
                if (cancelled) return;
                const found = Boolean(result?.entry?.url);
                setAvailable(found);
                setChecking(false);
                if (found && !resolvedRef.current) {
                    resolvedRef.current = true;
                    onResolved?.();
                }
            })
            .catch(() => {
                if (cancelled) return;
                setAvailable(false);
                setChecking(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [titleKey, known, linkKey]);

    return { available: known || available, checking: known ? false : checking };
}

export default useMovieboxAvailable;
