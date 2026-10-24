import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { MovieboxCroppedFrame } from './MovieboxCroppedFrame';
import { MovieboxDirectPlayer } from './MovieboxDirectPlayer';
import { MovieboxLinkPanel } from './MovieboxLinkPanel';
import {
    buildMovieboxFrameProxyUrl,
    buildMovieboxPageUrl,
    buildMovieboxSearchUrl,
    getMovieboxCrop,
    parseMovieboxInput,
    MOVIEBOX_SERVER_LABEL,
} from '@/lib/moviebox';
import { describeMovieboxLink, getMovieboxLink, saveMovieboxLink } from '@/lib/movieboxLinks';
import { resolveDirectStreams, type DirectStream } from '@/lib/movieboxDirect';
import { buildDubWatchLink, fetchAudioLanguages, type AudioTrack } from '@/lib/movieboxAudio';
import { isPhoneUserAgent } from '@/lib/phonePlayer';
import { resolveMovieboxLive } from '@/lib/movieboxResolve';

/**
 * "Server 2 · M2Box" — poora MovieBox watch page, sirf-player crop me.
 * ====================================================================
 * Player ke upar hamara koi UI nahi: bas upar-left ek chhota gola X (Esc se
 * bhi band), uske bagal me server switch pill, aur link badalne ka chhota
 * button. Frame ke andar M2Box ki poori site chalti hai (episode grid,
 * quality, subtitles sab wahi) — hum sirf dikhne wala hissa kaatte hain.
 *
 * Link kahan se aata hai (is order me):
 *   1. title row ka `embed_url`/`videoUrl`,
 *   2. catalog ke liye baked link (`data/moviebox-links.json`),
 *   3. browser me pehle save hua link,
 *   4. **live resolve** — `/api/moviebox-resolve` MovieBox par khud dhoondhta hai
 *      (`lib/movieboxResolve.ts`), taaki user ko link paste na karna pade.
 * Sab fail ho jaye tabhi paste panel aata hai.
 *
 * `allow-top-navigation` nahi diya jata — M2Box ki ads hamari tab hijack
 * nahi kar sakti. Baaki scripts/forms/popups allowed hain taaki site ke
 * apne controls (episode chunna, quality, subtitles) waise hi chalein.
 */

interface MovieboxPagePlayerProps {
    /** Title ke hisaab se stable key — link isi par yaad rehta hai. */
    linkKey: string;
    /** Title row se mila hua m2box link (agar hai). */
    initialLink?: string | null;
    title?: string;
    /** Live resolve ke liye — MovieBox par sahi subject chunne me madad. */
    year?: number | string;
    mediaType?: 'movie' | 'tv';
    /** Band karo to live resolve nahi hoga (standalone /moviebox page). */
    autoResolve?: boolean;
    /** Series ke liye — page seedha usi episode se khulta hai. */
    season?: number;
    episode?: number;
    /**
     * Series ke liye — is season me total episodes. Isse pata chalta hai ki
     * "Next Episode" dikhana hai ya nahi (aakhri episode par nahi).
     */
    episodeCount?: number;
    /** Chalu episode ka naam ("Everyone Has a Demon in Their Heart"). */
    episodeTitle?: string;
    /**
     * Next Episode dabane par parent ko batao (Continue Watching / row state
     * apne aap sahi rahe). Na de to player khud hi agla episode khol deta hai.
     */
    onEpisodeChange?: (next: { season: number; episode: number }) => void;
    onClose: () => void;
    /** Server 1 par wapas jaane ke liye (cycle me switch). */
    onSwitchServer?: () => void;
    switchLabel?: string;
    /** Naya link save hone par (parent ko batane ke liye). */
    onLinkSaved?: (link: string) => void;
    /**
     * Close X mat dikhao — jab upar hi back wala top bar ho (phone ka
     * Crunchyroll-style player screen).
     */
    hideClose?: boolean;
}

const FRAME_TIMEOUT_MS = 15000;
/**
 * Site ki page khulte hi jo **shell** dikhta hai (M2Box ka header, "Join
 * Telegram" ka dabba, footer) — watch page ka player uske baad mount hota hai,
 * isliye ~2s wahi shell crop ke andar dikhta reh jata hai ("sidhe player par
 * jana chahiye" — owner). Itni der ke liye kaala parda.
 */
const FRAME_COVER_MS = 3200;
/**
 * Site ka apna chrome (controls) ~3s me gayab hota hai. Hamara Next Episode
 * bhi usi waqt gayab hota hai, aur mouse hilte hi wapas.
 */
const CHROME_IDLE_MS = 3200;
/** Player se pointer bahar nikalne ke baad overlays kitni der me gayab. */
const CHROME_HIDE_AFTER_LEAVE_MS = 900;
/**
 * Episode patti video ke dabbe me **neeche** baithti hai — site ke apne
 * controls wali line par (seek bar + "00:13 / 01:08:31" + "English DualSub
 * 720P"), bilkul NetMirror jaisa. 0.90 = dabbe ki 90% unchai — yaani un
 * icons ke thoda neeche, khaali kaali patti me.
 */
const EPISODE_STRIP_BOTTOM = 0.9;
/** Phone par patti thodi badi hai, isliye site ke control bar se thoda upar. */
const EPISODE_STRIP_BOTTOM_PHONE = 0.83;

export function MovieboxPagePlayer({
    linkKey,
    initialLink,
    title,
    year,
    mediaType,
    autoResolve = true,
    season,
    episode,
    episodeCount,
    episodeTitle,
    onEpisodeChange,
    onClose,
    onSwitchServer,
    switchLabel,
    onLinkSaved,
    hideClose = false,
}: MovieboxPagePlayerProps) {
    const [link, setLink] = useState<string | null>(null);
    const [proxy, setProxy] = useState(false);
    const [loading, setLoading] = useState(false);
    /** Page khulte waqt ka kaala parda (site ka shell na dikhe). */
    const [covered, setCovered] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    /** Live resolve chal raha hai (baked/saved link nahi mila). */
    const [resolving, setResolving] = useState(false);
    /**
     * Live resolve chala par title ka watch page MovieBox par hai hi nahi.
     * Tab paste maangne ke bajaye MovieBox ke apne search results frame me
     * khulte hain — wahan se user seedha play kar sakta hai.
     */
    const [searchFallback, setSearchFallback] = useState(false);
    /** User ne search ke bajaye khud link paste karna chuna. */
    const [manualEntry, setManualEntry] = useState(false);
    /**
     * "Next Episode" se aage badha hua episode. Parent ka `episode` prop na
     * badle to bhi frame naye episode par chala jaye — isliye apna override.
     * Parent episode/link badle to override saaf.
     */
    const [episodeOverride, setEpisodeOverride] = useState<number | null>(null);
    /**
     * Phone par seedha (bina proxy) player: MovieBox ki API se stream URL
     * `lib/movieboxDirect.ts` laata hai aur video hamare apne `<video>` me
     * chalta hai — tab ±10s possible hai.
     *
     * Kuch bhi na mile / video na chale to `null` reh jata hai aur neeche wala
     * purana cropped iframe hi chalta hai (koi regression nahi).
     */
    const [directStreams, setDirectStreams] = useState<DirectStream[] | null>(null);
    /**
     * Audio (dub) — provider par har bhasha ka **apna subject** hota hai.
     * Owner (24 Oct): *"kisi par bhi audio dusra nahi aa raha"* — MovieBox
     * wale raste par ye list pehle bilkul nahi thi (sirf NetMirror par).
     */
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
    const [audioMenu, setAudioMenu] = useState(false);
    const [audioBusy, setAudioBusy] = useState<string | null>(null);
    const [audioNotice, setAudioNotice] = useState<string | null>(null);
    /** Audio badalne ke baad isi second se chale. */
    const [audioStartAt, setAudioStartAt] = useState(0);
    const playheadRef = useRef(0);
    /**
     * Player ke upar **koi** text nahi — na `fallback: …`, na `?m2boxdebug=1`
     * wali line. Owner (24 Oct): "ye jo fallback no stream likhta ye sab bhi
     * hta do". Jo bhi ho, kyun hua ye sirf console me (`[m2box-direct] …`)
     * jaata hai, user ko dikhane ki cheez nahi.
     */
    /** Touch device — UA galat ho to bhi gestures ka rasta chale. */
    const isTouch =
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        (Number((navigator as Navigator).maxTouchPoints || 0) > 0);
    /** Player ka apna naap — overlays ko video ke dabbe par align karne ke liye. */
    const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
    /** Site ke controls jaisa: idle par gayab. */
    const [chromeVisible, setChromeVisible] = useState(true);
    /** Poora player dabba (overlays ke saath) fullscreen hai. */
    const [ownFullscreen, setOwnFullscreen] = useState(false);
    const rootRef = useRef<View | null>(null);
    /**
     * Phone? (owner: "ye sare changes phone ke liye hain"). Mobile browser ka
     * user agent — desktop par player bilkul purana hi rehta hai.
     */
    const isPhone =
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        isPhoneUserAgent(navigator.userAgent);

    /** Idle-effect se nikala hua "abhi dikhao" — fullscreen change par bhi use hota hai. */
    const revealRef = useRef<(() => void) | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setEpisodeOverride(null);
    }, [linkKey, episode]);

    /* ---------------------------- Link ---------------------------- */

    useEffect(() => {
        const saved = getMovieboxLink(linkKey);
        const next = (initialLink && initialLink.trim()) || saved?.url || null;
        setLink(next);
        setProxy(saved?.proxy ?? false);
        setLoading(Boolean(next));
        setTimedOut(false);
        setSearchFallback(false);
        setManualEntry(false);
    }, [linkKey, initialLink]);

    /**
     * Koi link nahi mila (na row, na baked catalog, na saved) — to poochhne ke
     * bajaye khud dhoondho. Resolve hote hi frame khul jata hai.
     */
    useEffect(() => {
        if (!autoResolve || link || initialLink || !title) return;
        let cancelled = false;
        setResolving(true);
        setSearchFallback(false);
        resolveMovieboxLive(
            { title, year, mediaType },
            { key: linkKey, storeKey: linkKey },
        )
            .then((result) => {
                if (cancelled) return;
                if (result?.entry?.url) {
                    setLink(result.entry.url);
                    setProxy(false);
                    setLoading(true);
                    onLinkSaved?.(result.entry.url);
                } else {
                    setSearchFallback(true);
                    setLoading(true);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSearchFallback(true);
                    setLoading(true);
                }
            })
            .finally(() => {
                if (!cancelled) setResolving(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoResolve, link, initialLink, linkKey, title, year, mediaType]);

    /** Jo episode abhi frame me khula hai (override jeetta hai). */
    const activeEpisode = episodeOverride ?? episode;

    const pageUrl = useMemo(
        () => (link ? buildMovieboxPageUrl(link, { se: season, ep: activeEpisode }) : null),
        [link, season, activeEpisode],
    );

    /**
     * "Next Episode" — sirf series par, aur sirf tab jab agla episode ho.
     * Resources panel ab crop se bahar hai, isliye episode badalne ka yehi
     * sabse seedha raasta hai.
     */
    const isSeries = mediaType === 'tv' || typeof episode === 'number';
    const nextEpisode = useMemo(() => {
        if (!isSeries || typeof activeEpisode !== 'number') return null;
        if (typeof episodeCount === 'number' && episodeCount > 0 && activeEpisode >= episodeCount) {
            return null;
        }
        return { season: typeof season === 'number' ? season : 1, episode: activeEpisode + 1 };
    }, [activeEpisode, episodeCount, isSeries, season]);

    const goNextEpisode = useCallback(() => {
        if (!nextEpisode) return;
        setEpisodeOverride(nextEpisode.episode);
        setLoading(true);
        setTimedOut(false);
        onEpisodeChange?.(nextEpisode);
    }, [nextEpisode, onEpisodeChange]);

    /** Search fallback ka page (sirf jab watch page hi na mile). */
    const searchUrl = useMemo(
        () => (searchFallback && !link ? buildMovieboxSearchUrl(title) : null),
        [searchFallback, link, title],
    );

    const frameSrc = useMemo(() => {
        if (searchUrl) return searchUrl;
        if (!pageUrl) return null;
        return proxy ? buildMovieboxFrameProxyUrl(pageUrl) : pageUrl;
    }, [pageUrl, proxy, searchUrl]);

    /** Frame me search results khule hain (watch page nahi). */
    const isSearchFrame = Boolean(searchUrl);

    /**
     * Phone par pehla rasta: seedha stream (bina proxy).
     *
     * Sirf phone par — desktop ka player bila-shak purana hi rehta hai. Page URL
     * se hi subjectId/detailPath/season/episode nikalte hain, isliye link paste
     * karne wale raste par bhi chalta hai. Fail hone par chup-chaap iframe.
     */
    useEffect(() => {
        if (!(isPhone || isTouch) || !pageUrl || isSearchFrame) {
            setDirectStreams(null);
            return;
        }
        let cancelled = false;
        setDirectStreams(null);
        const trace: string[] = [];
        resolveDirectStreams(
            {
                link: pageUrl,
                se: season,
                ep: activeEpisode ?? undefined,
            },
            { trace },
        )
            .then((result) => {
                if (cancelled) return;
                if (result.ok && result.streams.length) {
                    setDirectStreams(result.streams);
                    console.info('[m2box-direct] ok:', result.streams.length, result.playerHost, trace);
                } else {
                    // Rasta fail hua — sirf console (UI me kuch nahi).
                    console.info('[m2box-direct] fallback:', result.reason, trace);
                }
            })
            .catch((error) => {
                if (cancelled) return;
                console.info('[m2box-direct] fallback: error', error);
            });
        return () => {
            cancelled = true;
        };
    }, [activeEpisode, isPhone, isTouch, isSearchFrame, pageUrl, season]);

    /**
     * Video ka asli dabba screen par kahan hai.
     *
     * `MovieboxCroppedFrame` poore player me dabbe ko **center** karta hai
     * (`alignItems/justifyContent: center`), aur uski chaudai/unchai wahi crop
     * math deti hai. Isliye overlay (Next Episode) ko root ke kinare par nahi,
     * dabbe ke andar - uske bottom-right - rakha ja sakta hai.
     */
    /* ------------------------- Audio (dub) list ------------------------- */

    /** Chalu watch page ka subject — dubs isi par milte hain. */
    const currentRef = useMemo(() => (pageUrl ? parseMovieboxInput(pageUrl) : null), [pageUrl]);
    const activeAudio = useMemo(() => {
        const subjectId = String(currentRef?.subjectId || '');
        if (!subjectId) return null;
        return audioTracks.find((track) => track.subjectId === subjectId)?.subjectId ?? null;
    }, [audioTracks, currentRef]);

    useEffect(() => {
        const subjectId = String(currentRef?.subjectId || '');
        if (!subjectId || isSearchFrame) {
            setAudioTracks([]);
            return;
        }
        let cancelled = false;
        fetchAudioLanguages({ subjectId, detailPath: currentRef?.detailPath })
            .then((answer) => {
                if (cancelled) return;
                setAudioTracks(answer.languages);
            })
            .catch(() => {
                if (!cancelled) setAudioTracks([]);
            });
        return () => {
            cancelled = true;
        };
    }, [currentRef, isSearchFrame]);

    useEffect(() => {
        if (!audioNotice) return;
        const timer = setTimeout(() => setAudioNotice(null), 2200);
        return () => clearTimeout(timer);
    }, [audioNotice]);

    /**
     * Doosri bhasha chuno.
     *
     *  - Phone/touch par jab hamara `<video>` chal raha hai → us dub ke subject
     *    se naye streams (seedha browser se, koi proxy nahi), wahi second.
     *  - Warna (desktop/iframe) → us dub ka watch page hi khol do; MovieBox
     *    khud usi bhasha me chalata hai. Dono surat me **asli** switch hota
     *    hai — jhootha toast nahi.
     */
    const chooseAudio = useCallback(
        async (track: AudioTrack): Promise<boolean> => {
            if (audioBusy) return false;
            setAudioBusy(track.subjectId);
            setAudioNotice(null);
            try {
                if (directStreams && directStreams.length) {
                    const answer = await resolveDirectStreams({
                        subjectId: track.subjectId,
                        detailPath: track.detailPath,
                        se: season ?? 1,
                        ep: activeEpisode ?? 1,
                    });
                    if (answer.ok && answer.streams.length) {
                        setAudioStartAt(playheadRef.current);
                        setDirectStreams(answer.streams);
                        setAudioMenu(false);
                        return true;
                    }
                }
                const dubLink = buildDubWatchLink(track);
                if (!dubLink) {
                    setAudioNotice(`${track.name} audio nahi mila`);
                    return false;
                }
                // iframe wala rasta: us dub ka page kholo (page hi audio badal deta hai).
                setLink(dubLink);
                setDirectStreams(null);
                setAudioStartAt(playheadRef.current);
                setAudioMenu(false);
                setAudioNotice(`Audio: ${track.name}`);
                return true;
            } catch {
                setAudioNotice(`${track.name} audio nahi mila`);
                return false;
            } finally {
                setAudioBusy(null);
            }
        },
        [activeEpisode, audioBusy, directStreams, season],
    );

    const overlayBox = useMemo(() => {
        if (!rootSize.width || !rootSize.height) return null;
        const crop = getMovieboxCrop(rootSize.width, rootSize.height, { resources: isSearchFrame });
        const pad = Math.max(12, Math.round(crop.frameWidth * 0.025));
        return {
            left: Math.round((rootSize.width - crop.frameWidth) / 2),
            top: Math.round((rootSize.height - crop.height) / 2),
            width: crop.frameWidth,
            height: crop.height,
            padRight: pad,
            padLeft: pad,
            /**
             * Site ke apne fullscreen icon ki jagah — video ke bottom-right.
             *
             * Wo icon **cross-origin iframe ke andar** hai, use DOM se hata
             * nahi sakte. Isliye uske upar hamara icon ek **kaale plate** par
             * baithta hai: plate unka icon dhak leti hai, aur hamare safed
             * brackets usi plate me unke icon se thoda bade hain.
             *
             * Naap — owner ke screenshot se (crop 4.14x zoom, site ka icon
             * 28px, uska centre dabbe ke daayein kinare se 56.5px aur neeche
             * se 40.5px par): ink 3.4% unchai (unse ~11% bada), plate ink ka
             * 1.4x, plate ka daaya kinara 2.14% chaudai aur neeche se 2.06%
             * unchai par.
             */
            fsInk: Math.max(26, Math.round(crop.height * 0.034)),
            fsPlate: Math.max(34, Math.round(crop.height * 0.034 * 1.4)),
            fsRight: Math.round(crop.frameWidth * 0.0214),
            fsBottom: Math.round(crop.height * 0.0206),
            // site ka seek bar + controls neeche ~10-12% jagah lete hain
            padBottom: Math.max(20, Math.round(crop.height * 0.13)),
        };
    }, [rootSize, isSearchFrame]);

    /* --------------------------- Frame ---------------------------- */

    /**
     * Player mount hone tak site ka shell (header / Join Telegram / footer)
     * crop ke andar dikhta hai. Utni der kaala parda — warna server lagate hi
     * 2 second ke liye M2Box ka apna page jhalak jata hai.
     */
    useEffect(() => {
        if (!frameSrc || isSearchFrame) {
            setCovered(false);
            return;
        }
        setCovered(true);
        const coverTimer = setTimeout(() => setCovered(false), FRAME_COVER_MS);
        return () => clearTimeout(coverTimer);
    }, [frameSrc, isSearchFrame]);

    useEffect(() => {
        setTimedOut(false);
        if (!frameSrc) {
            setLoading(false);
            if (timerRef.current) clearTimeout(timerRef.current);
            return;
        }
        setLoading(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            setLoading(false);
            setTimedOut(true);
        }, FRAME_TIMEOUT_MS);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [frameSrc]);

    /** Hamara player dabba fullscreen karo (web par). */
    const enterOwnFullscreen = useCallback(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return;
        const el = rootRef.current as unknown as HTMLElement | null;
        if (!el || document.fullscreenElement === el) return;
        const request =
            (el as any).requestFullscreen ||
            (el as any).webkitRequestFullscreen;
        try {
            request?.call(el)?.catch?.(() => {});
        } catch {}
    }, []);

    /** Apna fullscreen chal raha hai? (Button ka icon badalne ke liye.) */
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return;
        const onFs = () => {
            const el = rootRef.current as unknown as HTMLElement | null;
            setOwnFullscreen(!!el && document.fullscreenElement === el);
            // Fullscreen me bhi chrome turant dikhe, phir idle par gayab —
            // pehle fullscreen ke baad button wapas aata hi nahi tha.
            revealRef.current?.();
        };
        document.addEventListener('fullscreenchange', onFs);
        document.addEventListener('webkitfullscreenchange', onFs as EventListener);
        return () => {
            document.removeEventListener('fullscreenchange', onFs);
            document.removeEventListener('webkitfullscreenchange', onFs as EventListener);
        };
    }, []);

    /**
     * Player chrome (Next Episode + episode patti) — site ke apne controls
     * jaisa: hilla nahi to gayab.
     *
     * Iframe cross-origin hai: video ke andar ka mousemove humein **nahi**
     * milta (browser share nahi karta), aur site ke controls andar chalti
     * hain. Isliye sync ka tareeka ye hai:
     *
     *   - Yahan milne wali **har activity** par overlays dikhte hain aur
     *     timer dobara chalu ho jata hai: pointer player par aana/ghoomna,
     *     click, scroll, key, aur pointer ka frame ke andar jaana
     *     (`mouseout` relatedTarget = null) ya frame ko focus (click).
     *   - **`CHROME_IDLE_MS` (3.2s) tak kuch na ho** to gayab — bilkul site
     *     ke controls ki tarah, chahe pointer khamoshi se video par hi khada
     *     ho. (Pehle pointer "andar" hone par hum kabhi nahi chhupate the,
     *     isliye controls gayab hone ke baad bhi hamara button dikhta rehta
     *     tha — user ki latest shikayat.)
     *
     * Video ke andar lagatar mouse ghumane par site ke controls dikhte hain
     * par humein events nahi milte — us halat me ye overlays 3.2s baad chhup
     * jate hain. Pointer ek baar bahar-nikle-andar-aaye (ya click ho) to
     * turant wapas dikh jate hain.
     */
    useEffect(() => {
        if (!frameSrc || isSearchFrame) {
            setChromeVisible(true);
            return;
        }
        /**
         * Phone par koi overlay nahi — sirf pura MovieBox player (owner:
         * "jitna title aur next button hai sab hata do, sab pura moviebox ka
         * hi player rahe phone me sirf"). Isliye idle-hide ka sawal hi nahi;
         * chrome hamesha on (pointer events ke liye).
         */
        if (isPhone) {
            setChromeVisible(true);
            return;
        }
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;

        const doc = window.document;
        const el = rootRef.current as unknown as HTMLElement | null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const hideLater = (ms: number) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => setChromeVisible(false), ms);
        };

        const reveal = () => {
            setChromeVisible(true);
            hideLater(CHROME_IDLE_MS);
        };
        revealRef.current = reveal;

        reveal();

        const onLeave = () => hideLater(CHROME_HIDE_AFTER_LEAVE_MS);
        /** Pointer iframe ke andar gaya — parent ko sirf ye milta hai. */
        const onOut = (event: MouseEvent) => {
            if (!event.relatedTarget) reveal();
        };
        /** Frame par click (focus) — activity maano. */
        const onFrameFocus = () => reveal();

        el?.addEventListener('mouseenter', reveal);
        el?.addEventListener('mouseleave', onLeave);
        el?.addEventListener('mousemove', reveal, { passive: true });
        el?.addEventListener('mousedown', reveal, { passive: true });
        el?.addEventListener('touchstart', reveal, { passive: true });
        window.addEventListener('keydown', reveal);
        window.addEventListener('wheel', reveal, { passive: true });
        doc.addEventListener('mouseout', onOut);
        doc.addEventListener('focusin', onFrameFocus);

        return () => {
            revealRef.current = null;
            if (timer) clearTimeout(timer);
            el?.removeEventListener('mouseenter', reveal);
            el?.removeEventListener('mouseleave', onLeave);
            el?.removeEventListener('mousemove', reveal);
            el?.removeEventListener('mousedown', reveal);
            el?.removeEventListener('touchstart', reveal);
            window.removeEventListener('keydown', reveal);
            window.removeEventListener('wheel', reveal);
            doc.removeEventListener('mouseout', onOut);
            doc.removeEventListener('focusin', onFrameFocus);
        };
    }, [frameSrc, isSearchFrame, isPhone]);

    /* ---------------------------- Keys ---------------------------- */

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    /* --------------------------- Actions -------------------------- */

    const handlePlay = useCallback(
        (raw: string, opts: { proxy: boolean }) => {
            const page = buildMovieboxPageUrl(raw, { se: season, ep: episode });
            if (!page) return;
            saveMovieboxLink(linkKey, raw, { proxy: opts.proxy });
            setLink(raw.trim());
            setProxy(opts.proxy);
            setLoading(true);
            setTimedOut(false);
            onLinkSaved?.(raw.trim());
        },
        [episode, linkKey, onLinkSaved, season],
    );

    /**
     * Edit (link badalna): frame ko chup-chaap band karke panel dikhao.
     * about:blank pehle — warna purana page background me chalta reh sakta
     * hai (audio ke saath).
     */
    const editLink = useCallback(() => {
        setLink(null);
        setSearchFallback(false);
        setManualEntry(true);
        setLoading(false);
        setTimedOut(false);
    }, []);

    /** Search frame se wapas watch page par (live resolve dobara chalega). */
    const retryResolve = useCallback(() => {
        setSearchFallback(false);
        setManualEntry(false);
        setLoading(false);
        setTimedOut(false);
    }, []);

    /* --------------------------- Render --------------------------- */

    return (
        <View
            ref={rootRef}
            style={[styles.root, ownFullscreen && styles.rootFullscreen]}
            onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setRootSize((prev) =>
                    Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
                        ? prev
                        : { width, height },
                );
            }}
            {...({ dataSet: { tvScope: 'player' } } as any)}
        >
            {directStreams && directStreams.length > 0 && !isSearchFrame ? (
                <MovieboxDirectPlayer
                    streams={directStreams}
                    title={title}
                    year={year}
                    audioTracks={audioTracks}
                    activeAudio={activeAudio}
                    onAudioSelect={chooseAudio}
                    startAt={audioStartAt}
                    onProgress={(info) => {
                        playheadRef.current = info.currentTime;
                    }}
                    onUnavailable={(reason) => {
                        // Stream nahi chala (format/CDN/region) — turant purana
                        // cropped iframe, warna phone par kaala dabba reh jata.
                        console.info('[m2box-direct] fallback:', reason);
                        setDirectStreams(null);
                        setLoading(true);
                        setTimedOut(false);
                    }}
                />
            ) : frameSrc ? (
                <MovieboxCroppedFrame
                    key={frameSrc}
                    src={frameSrc}
                    title={title}
                    allowScroll={isSearchFrame}
                    mode={isSearchFrame ? 'page' : 'player'}
                    interactive={isPhone || chromeVisible}
                    allowFullscreen={isPhone}
                    phoneLayout={isPhone && !isSearchFrame}
                    onLoad={() => {
                        if (timerRef.current) clearTimeout(timerRef.current);
                        setLoading(false);
                        setTimedOut(false);
                    }}
                />
            ) : resolving ? (
                <View style={styles.resolving} {...({ dataSet: { movieboxResolving: '1' } } as any)}>
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.resolvingTitle}>Preparing server 2</Text>
                    <Text style={styles.resolvingText}>
                        MovieBox par “{title}” dhoondha ja raha hai — link khud lag jayega.
                    </Text>
                </View>
            ) : searchFallback && !manualEntry ? null : (
                <MovieboxLinkPanel
                    title={title}
                    notice={
                        'No MovieBox watch page found for this title. Copy the link from MovieBox and paste it here, or try again in a little while.'
                    }
                    initialLink={link}
                    initialProxy={proxy}
                    onPlay={handlePlay}
                    onBack={onSwitchServer}
                    backLabel={switchLabel || 'Server 1'}
                />
            )}

            {/* Player par koi debug/fallback text nahi (owner ka 24 Oct wala
                message) — sirf console. */}

            {/* Kaala parda: page load hone tak + site ka shell (header/footer)
                player ban jaye tab tak. Isse server lagate hi seedha player
                dikhta hai, M2Box ka apna page nahi. */}
            {!directStreams && frameSrc && (loading || covered) ? (
                <View style={styles.frameCover} pointerEvents="none" testID="moviebox-cover">
                    <ActivityIndicator size="large" color="#E50914" />
                    <Text style={styles.loadingText}>Loading…</Text>
                </View>
            ) : null}

            {/* Series: episode ki patti — "S1 • E2  My Demon – <episode name>"
                video ke andar bottom-left, bilkul NetMirror jaisa. Chrome ke
                saath gayab. */}
            {frameSrc && isSeries && !isSearchFrame && !isPhone && typeof activeEpisode === 'number' ? (
                <View
                    style={[
                        styles.stripWrap,
                        overlayBox
                            ? {
                                  left: overlayBox.left,
                                  top:
                                      overlayBox.top +
                                      Math.round(
                                          overlayBox.height *
                                              (isPhone ? EPISODE_STRIP_BOTTOM_PHONE : EPISODE_STRIP_BOTTOM),
                                      ),
                                  width: overlayBox.width,
                                  paddingHorizontal: overlayBox.padRight + (isPhone ? 64 : 150),
                              }
                            : styles.stripFallback,
                        { opacity: chromeVisible ? 1 : 0 },
                    ]}
                    pointerEvents="none"
                    testID="moviebox-episode-strip"
                >
                    <View style={[styles.epBadge, isPhone && styles.epBadgePhone]}>
                        <Text style={[styles.epBadgeText, isPhone && styles.epBadgeTextPhone]}>
                            {`S${typeof season === 'number' ? season : 1} • E${activeEpisode}`}
                        </Text>
                    </View>
                    {title ? (
                        <Text style={[styles.stripTitle, isPhone && styles.stripTitlePhone]} numberOfLines={1}>
                            {title}
                            {episodeTitle ? (
                                <>
                                    <Text style={styles.stripDash}>{' – '}</Text>
                                    <Text style={styles.stripEpName}>{episodeTitle}</Text>
                                </>
                            ) : null}
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {/* Fullscreen — theek site ke fullscreen icon ke UPAR, video ke
                bottom-right me. Site ka icon hata nahi sakte (cross-origin),
                isliye hamara icon unse thoda bada hai aur unke brackets ko
                dhak leta hai; koi plate/background nahi (warna video ke
                neeche kaala dabba dikhta hai). (overlayBox milne se pehle
                fallback: root ke corner par.) */}
            {frameSrc && !isSearchFrame && !isPhone ? (
                <Pressable
                    style={[
                        styles.fsButton,
                        overlayBox
                            ? {
                                  left:
                                      overlayBox.left +
                                      overlayBox.width -
                                      overlayBox.fsRight -
                                      overlayBox.fsPlate,
                                  top:
                                      overlayBox.top +
                                      overlayBox.height -
                                      overlayBox.fsBottom -
                                      overlayBox.fsPlate,
                                  width: overlayBox.fsPlate,
                                  height: overlayBox.fsPlate,
                              }
                            : styles.fsFallback,
                        /**
                         * Chrome ke saath poora button (kaala plate + icon)
                         * gayab — warna mouse rukne ke baad video ke corner me
                         * sirf kaala dabba chipka reh jata hai.
                         */
                        { opacity: chromeVisible ? 1 : 0 },
                    ]}
                    onPress={() => {
                        if (Platform.OS !== 'web' || typeof document === 'undefined') return;
                        if (document.fullscreenElement) {
                            document.exitFullscreen?.().catch(() => {});
                        } else {
                            enterOwnFullscreen();
                        }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={ownFullscreen ? 'Exit fullscreen' : 'Fullscreen player'}
                    testID="moviebox-fullscreen"
                >
                    <MaterialCommunityIcons
                        name={ownFullscreen ? 'fullscreen-exit' : 'fullscreen'}
                        size={overlayBox ? Math.round(overlayBox.fsInk / 0.6) : 46}
                        color="#fff"
                    />
                </Pressable>
            ) : null}

            {/* Series: agla episode — video ke andar, bottom-right (site ke
                apne Next Episode ki jagah), aur chrome ke saath gayab. */}
            {frameSrc && nextEpisode && !isSearchFrame && !isPhone ? (
                <View
                    style={[
                        styles.nextWrap,
                        overlayBox
                            ? {
                                  left: overlayBox.left,
                                  top: overlayBox.top,
                                  width: overlayBox.width,
                                  height: overlayBox.height,
                                  paddingRight: overlayBox.padRight,
                                  paddingBottom: overlayBox.padBottom,
                              }
                            : styles.nextFallback,
                        { opacity: chromeVisible ? 1 : 0 },
                    ]}
                    pointerEvents={chromeVisible ? 'box-none' : 'none'}
                >
                    <Pressable
                        style={[styles.nextButton, isPhone && styles.nextButtonPhone]}
                        onPress={goNextEpisode}
                        accessibilityRole="button"
                        accessibilityLabel={`Next episode ${nextEpisode.episode}`}
                        testID="moviebox-next-episode"
                    >
                        <Ionicons name="play" size={isPhone ? 17 : 15} color="#000" />
                        <Text style={[styles.nextButtonText, isPhone && styles.nextButtonTextPhone]}>
                            Next Episode
                        </Text>
                    </Pressable>
                </View>
            ) : null}

            {/* Audio menu — chhoti list, video ke upar daayein. */}
            {audioMenu && audioTracks.length > 1 ? (
                <View style={styles.audioMenuWrap} testID="moviebox-audio-menu">
                    <View style={styles.audioMenuPanel}>
                        <Text style={styles.audioMenuTitle}>Audio</Text>
                        {audioTracks.map((track) => {
                            const active = track.subjectId === activeAudio;
                            return (
                                <Pressable
                                    key={`audio-${track.subjectId}`}
                                    style={styles.audioMenuRow}
                                    onPress={() => {
                                        if (active) {
                                            setAudioMenu(false);
                                            return;
                                        }
                                        void chooseAudio(track);
                                    }}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    testID={`moviebox-audio-${track.lang}`}
                                >
                                    <Text style={[styles.audioMenuText, active && styles.audioMenuTextActive]}>
                                        {track.name}
                                    </Text>
                                    {audioBusy === track.subjectId ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : active ? (
                                        <MaterialCommunityIcons name="check" size={16} color="#fff" />
                                    ) : (
                                        <Text style={styles.audioMenuHint}>{(track.lang || '').toUpperCase()}</Text>
                                    )}
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            ) : null}

            {/* Badal gaya — video ke beech chhota sa confirm (jhootha nahi:
                sirf tab jab switch asli me hua). */}
            {audioNotice ? (
                <View style={styles.audioNotice} pointerEvents="none" testID="moviebox-audio-notice">
                    <Text style={styles.audioNoticeText}>{audioNotice}</Text>
                </View>
            ) : null}

            {/* Top bar. Fullscreen me kuch bhi nahi — owner: "fullscreen hone
                ke baad upar X ka nishan nahi aana chahiye". Fullscreen se
                nikalne ke liye corner ka fullscreen-exit button ya Esc. */}
            <View style={styles.topBar} pointerEvents="box-none">
                {ownFullscreen || hideClose ? null : (
                    <Pressable
                        style={styles.iconButton}
                        onPress={onClose}
                        accessibilityLabel="Close player"
                        accessibilityRole="button"
                        testID="moviebox-close"
                    >
                        <Ionicons name="close" size={22} color="#fff" />
                    </Pressable>
                )}

                {onSwitchServer ? (
                    <Pressable
                        style={styles.serverPill}
                        onPress={onSwitchServer}
                        accessibilityLabel={`Switch to ${switchLabel || 'Server 1'}`}
                        testID="moviebox-switch-server"
                    >
                        <Ionicons name="swap-horizontal" size={14} color="#fff" />
                        <Text style={styles.serverPillText}>{switchLabel || 'Server 1'}</Text>
                    </Pressable>
                ) : null}

                {/* Audio (dub) — provider par har bhasha alag subject hai. */}
                {audioTracks.length > 1 && !isSearchFrame && !ownFullscreen ? (
                    <Pressable
                        style={[styles.serverPill, styles.audioPill]}
                        onPress={() => setAudioMenu((value) => !value)}
                        accessibilityRole="button"
                        accessibilityLabel="Audio language"
                        testID="moviebox-audio"
                    >
                        <MaterialCommunityIcons name="translate" size={14} color="#fff" />
                        <Text style={styles.serverPillText}>
                            {audioTracks.find((track) => track.subjectId === activeAudio)?.name || 'Audio'}
                        </Text>
                    </Pressable>
                ) : null}

            </View>

            {/* MovieBox par title hi nahi — search results khule hain. */}
            {isSearchFrame ? (
                <View style={styles.searchBar} pointerEvents="box-none">
                    <Text style={styles.searchBarText} numberOfLines={2}>
                        MovieBox par “{title}” ka watch page nahi mila — uske search results khule hain.
                        Neeche se title kholo, ya link paste kar do.
                    </Text>
                    <View style={styles.searchBarActions}>
                        <Pressable
                            style={styles.searchBarButton}
                            onPress={retryResolve}
                            accessibilityLabel="MovieBox par dobara dhoondho"
                            testID="moviebox-retry-resolve"
                        >
                            <Ionicons name="refresh" size={13} color="#000" />
                            <Text style={styles.searchBarButtonText}>Dobara dhoondho</Text>
                        </Pressable>
                        <Pressable
                            style={styles.searchBarButton}
                            onPress={editLink}
                            accessibilityLabel="Paste link"
                            testID="moviebox-manual-link"
                        >
                            <Ionicons name="link-outline" size={13} color="#000" />
                            <Text style={styles.searchBarButtonText}>Paste link</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}

            {/* Seedha frame khali aaya (frame-blocking) — proxy ka rasta do. */}
            {frameSrc && timedOut && !proxy ? (
                <View style={styles.hintBar} pointerEvents="box-none">
                    <Text style={styles.hintText}>
                        Frame khali laga? M2Box framing rok raha ho to proxy se kholo.
                    </Text>
                    <Pressable
                        style={styles.hintButton}
                        onPress={() => {
                            setTimedOut(false);
                            setProxy(true);
                        }}
                        accessibilityLabel="Reload through proxy"
                    >
                        <Ionicons name="git-network-outline" size={14} color="#000" />
                        <Text style={styles.hintButtonText}>Proxy se kholo</Text>
                    </Pressable>
                </View>
            ) : null}

            {frameSrc && proxy && !isPhone ? (
                <View style={styles.proxyBadge} pointerEvents="none">
                    <Text style={styles.proxyBadgeText}>PROXY</Text>
                </View>
            ) : null}

        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', position: 'relative' },
    /** Fullscreen me UA ke bharose na raho — poora screen pakka. */
    rootFullscreen: { width: '100%', height: '100%', flex: 0 },
    /**
     * Video ke dabbe ke andar, bottom-right. `overlayBox` milne tak (pehla
     * layout) fallback: root ke daayein kinare par.
     */
    /** Site ke fullscreen icon ki jagah — thoda gehra gola, icon saaf dikhe. */
    /**
     * Site ke apne fullscreen icon ki tarah — koi gola/background nahi, bas
     * safed icon (chaaron kone wale brackets).
     */
    /**
     * Site ke icon ke bilkul upar — **kaala plate** (unka icon iske neeche
     * chhup jata hai), uske beech me hamare safed brackets. Plate ki wajah
     * se do fullscreen kabhi saath nahi dikhte.
     */
    fsButton: {
        position: 'absolute',
        zIndex: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        borderRadius: 3,
    },
    /** `overlayBox` se pehle (pehla layout) — root ke bottom-right. */
    fsFallback: {
        right: 16,
        bottom: 14,
        width: 44,
        height: 44,
        backgroundColor: '#000',
        borderRadius: 3,
    },
    nextWrap: {
        position: 'absolute',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
    },
    /** `overlayBox` se pehle (pehla layout) — root ke daayein kinare par. */
    nextFallback: { right: 24, bottom: '13%' },
    /** Episode ki patti: video ke andar neeche, controls ki line par, center. */
    stripWrap: {
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    stripFallback: { left: 0, right: 0, bottom: '8%' },
    epBadge: {
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    epBadgeText: { color: '#000', fontSize: 13, fontWeight: '700' },
    /** Phone (ghuma hua landscape) — thoda bada, taaki door se padha ja sake. */
    epBadgePhone: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
    epBadgeTextPhone: { fontSize: 18 },
    stripTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
        flexShrink: 1,
        textShadowColor: 'rgba(0,0,0,0.75)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    stripTitlePhone: { fontSize: 20 },
    stripDash: { color: '#cfcfcf', fontWeight: '600' },
    stripEpName: { color: '#7CD44A', fontWeight: '600' },
    nextButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(255,255,255,0.92)',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 6,
    },
    nextButtonText: { color: '#000', fontSize: 14, fontWeight: '700' },
    nextButtonPhone: { paddingHorizontal: 24, paddingVertical: 14, gap: 10 },
    nextButtonTextPhone: { fontSize: 19 },
    resolving: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 12,
    },
    resolvingTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
    resolvingText: { color: '#9a9a9a', fontSize: 13, textAlign: 'center', maxWidth: 420, lineHeight: 20 },
    /** Pura kaala — site ka shell iske peeche chalta rehta hai, dikhta nahi. */
    frameCover: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        gap: 14,
        zIndex: 2,
    },
    loadingText: { color: '#ccc', fontSize: 13 },
    topBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 12,
        paddingTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 3,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    serverPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.25)',
        opacity: 0.75,
    },
    serverPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    audioPill: { opacity: 0.9 },
    audioMenuWrap: {
        position: 'absolute',
        top: 58,
        right: 14,
        zIndex: 40,
    },
    audioMenuPanel: {
        minWidth: 190,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(20,20,20,0.96)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    audioMenuTitle: {
        color: '#9a9a9a',
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 14,
        paddingBottom: 4,
        letterSpacing: 0.6,
    },
    audioMenuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    audioMenuText: { flex: 1, color: '#e6e6e6', fontSize: 14 },
    audioMenuTextActive: { color: '#fff', fontWeight: '700' },
    audioMenuHint: { color: '#8f8f8f', fontSize: 11 },
    audioNotice: {
        position: 'absolute',
        top: '48%',
        alignSelf: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(0,0,0,0.7)',
    },
    audioNoticeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    searchBar: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        backgroundColor: 'rgba(12,12,12,0.92)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
    },
    searchBarText: { color: '#d8d8d8', fontSize: 12.5, lineHeight: 18 },
    searchBarActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    searchBarButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#e6e6e6',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    searchBarButtonText: { color: '#000', fontSize: 12, fontWeight: '600' },
    hintBar: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: 'rgba(15,15,15,0.92)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.18)',
        zIndex: 4,
    },
    hintText: { color: '#cfcfcf', fontSize: 12, flex: 1, lineHeight: 17 },
    hintButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#fff',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 6,
    },
    hintButtonText: { color: '#000', fontSize: 12, fontWeight: '700' },
    proxyBadge: {
        position: 'absolute',
        right: 14,
        bottom: 14,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.14)',
        zIndex: 2,
    },
    proxyBadgeText: { color: '#d0d0d0', fontSize: 9, letterSpacing: 0.8, fontWeight: '700' },
});

export default MovieboxPagePlayer;
