import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MovieboxDirectPlayer } from './MovieboxDirectPlayer';
import {
    fetchNetmirrorStreams,
    NETMIRROR_LABEL,
    netmirrorTmdbNumber,
    toSubtitleTracks,
    type NetmirrorResult,
    type NetmirrorSubtitle,
} from '@/lib/netmirror';
import { resolveDirectStreams, type DirectStream } from '@/lib/movieboxDirect';
import { fetchAudioLanguages, type AudioTrack } from '@/lib/movieboxAudio';

/**
 * "NetMirror" server ka player — apna `<video>`, koi iframe nahi.
 * ==============================================================
 * Owner: *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale"*.
 *
 * NetMirror ka REST route seedhe MP4 links deta hai (1080p tak). Wo links
 * `api/netmirror` (hamara same-origin function) se aate hain, video CDN se
 * seedha browser tak jaata hai — isliye na ad, na popup, na iframe ka jhanjhat.
 *
 * Multi-language dub: provider par har dub apna subject hota hai, isliye list
 * `api/moviebox-audio` se aati hai aur chunne par us dub ke naye streams lagte
 * hain (`resolveDirectStreams`). Original wahi rehta hai jo chal raha tha.
 *
 * Teen halat:
 *   1. `loading` — streams aa rahe hain (chhota spinner).
 *   2. `ready`   — `MovieboxDirectPlayer` (wahi ±10s / seek / progress wala
 *                  player jo MovieBox direct route par chalta hai).
 *   3. `empty`   — NetMirror par title nahi / network fail. Dead button nahi:
 *                  seedha Nxsha par bhejne wala button dikhta hai.
 */

interface NetmirrorPlayerProps {
    /** Catalog id — `tmdb:1465943` / `1465943`. */
    tmdbId?: string | number | null;
    mediaType: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    /** Title bar (Netflix jaisa): "You're Watching / Title (Year)". */
    year?: string | number;
    onClose?: () => void;
    onProgress?: (info: { currentTime: number; duration: number }) => void;
    /** Yahan se parent wapas Server 1 (Nxsha) par le jata hai. */
    onUnavailable?: (reason: string) => void;
    /** Pehle se laaye gaye streams (parent cache) — optional. */
    initialStreams?: DirectStream[];
    /** Agla server (pill ka label) — movie page par cycle ke liye. */
    nextServerName?: string;
    onSwitchServer?: () => void;
}

const IS_WEB = Platform.OS === 'web';

export function NetmirrorPlayer({
    tmdbId,
    mediaType,
    season,
    episode,
    title,
    year,
    onClose,
    onProgress,
    onUnavailable,
    initialStreams,
    nextServerName,
    onSwitchServer,
}: NetmirrorPlayerProps) {
    const hasId = Boolean(netmirrorTmdbNumber(tmdbId));
    const [state, setState] = useState<'loading' | 'ready' | 'empty'>(
        initialStreams && initialStreams.length ? 'ready' : 'loading',
    );
    const [streams, setStreams] = useState<DirectStream[]>(initialStreams ?? []);
    /** Multi-language subtitles (NetMirror ke `captions[]` se). */
    const [subtitles, setSubtitles] = useState<NetmirrorSubtitle[]>([]);
    /** Multi-language audio (dub) — provider jo deta hai, utni hi. */
    const [audio, setAudio] = useState<AudioTrack[]>([]);
    const [activeAudio, setActiveAudio] = useState<string | null>(null);
    /** Audio badalne ke baad isi jagah se chale. */
    const [startAt, setStartAt] = useState(0);
    const currentTimeRef = useRef(0);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        if (!hasId) {
            setError('TMDB id nahi mila');
            setState('empty');
            return;
        }
        let cancelled = false;
        // Parent ne streams de diye ho to wahi turant dikhao, par metadata
        // (subtitles + audio list) phir bhi laao — warna CC/dub gayab rehte hain.
        if (!(initialStreams && initialStreams.length)) {
            setState('loading');
        }
        setError('');
        fetchNetmirrorStreams({ tmdbId, mediaType, season, episode }).then(async (first: NetmirrorResult) => {
            if (cancelled) return;
            let result = first;
            /**
             * `subjectId` hi **audio (dub) list** ki kunji hai. Purane client
             * cache me wo nahi tha (player pasand aa gaya to data purana reh
             * jata hai) — isliye ek baar fresh maang lete hain, warna NetMirror
             * par audio chup-chaap gayab reh jata hai.
             */
            if (!result.subjectId) {
                const retry = await fetchNetmirrorStreams(
                    { tmdbId, mediaType, season, episode },
                    { fresh: true },
                );
                if (cancelled) return;
                if (retry.ok && retry.streams.length) result = retry;
            }
            setSubtitles(toSubtitleTracks(result.captions));
            if (result.ok && result.streams.length) {
                setStreams(result.streams);
                setState('ready');
                // Dub list (agar provider deta hai) — background me, fail ho to
                // sirf subtitles rehte hain (koi jhootha option nahi).
                if (result.subjectId) {
                    // Ek baar network hichkichaye to dobara — warna audio list
                    // chup-chaap khaali reh jati hai (owner ka complaint).
                    const load = (attempt = 0): Promise<Awaited<ReturnType<typeof fetchAudioLanguages>>> =>
                        fetchAudioLanguages({
                            subjectId: result.subjectId as string,
                            detailPath: result.detailPath,
                        }).then((answer) =>
                            !answer.languages.length && attempt < 1
                                ? new Promise((done) => setTimeout(done, 700)).then(() => load(attempt + 1))
                                : answer,
                        );
                    load().then((answer) => {
                        if (cancelled) return;
                        setAudio(answer.languages);
                        const current =
                            answer.languages.find((item) => item.subjectId === result.subjectId) ??
                            answer.languages.find((item) => item.original) ??
                            answer.languages[0];
                        setActiveAudio(current ? current.subjectId : null);
                    });
                }
                return;
            }
            setError(
                result.reason === 'not-added'
                    ? 'This title is not on NetMirror yet'
                    : result.reason === 'bad-id'
                      ? 'NetMirror needs a TMDB id'
                      : 'NetMirror did not answer',
            );
            setState('empty');
        });
        return () => {
            cancelled = true;
        };
    }, [hasId, tmdbId, mediaType, season, episode, initialStreams]);

    /** Audio (dub) chuno — us language ke subject se naye streams. */
    const selectAudio = useCallback(
        async (track: AudioTrack) => {
            const answer = await resolveDirectStreams({
                subjectId: track.subjectId,
                detailPath: track.detailPath,
                se: mediaType === 'tv' ? (season ?? 1) : 1,
                ep: mediaType === 'tv' ? (episode ?? 1) : 1,
            });
            if (!answer.ok || !answer.streams.length) return false;
            setStartAt(currentTimeRef.current);
            setStreams(answer.streams);
            setActiveAudio(track.subjectId);
            return true;
        },
        [mediaType, season, episode],
    );

    const fallback = useCallback(() => {
        onUnavailable?.(error || 'not-added');
    }, [onUnavailable, error]);

    return (
        <View style={styles.root} testID="netmirror-player">
            {state === 'ready' ? (
                <MovieboxDirectPlayer
                    streams={streams}
                    title={title}
                    year={year}
                    onBack={onClose}
                    captions={subtitles}
                    audioTracks={audio}
                    activeAudio={activeAudio}
                    onAudioSelect={selectAudio}
                    startAt={startAt}
                    nextServerName={nextServerName}
                    onSwitchServer={onSwitchServer}
                    onProgress={(info) => {
                        currentTimeRef.current = info.currentTime;
                        onProgress?.(info);
                    }}
                    onUnavailable={() => {
                        setError('Stream did not play');
                        setState('empty');
                    }}
                />
            ) : null}

            {state === 'loading' ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#E50914" />
                    <Text style={styles.hint}>{NETMIRROR_LABEL} · connecting…</Text>
                </View>
            ) : null}

            {state === 'empty' ? (
                <View style={styles.center}>
                    <Ionicons name="cloud-offline-outline" size={30} color="#9a9a9a" />
                    <Text style={styles.hint}>{error}</Text>
                    {onUnavailable ? (
                        <Pressable
                            onPress={fallback}
                            style={styles.switchButton}
                            accessibilityRole="button"
                            accessibilityLabel="Play on Nxsha instead"
                            testID="netmirror-fallback"
                        >
                            <Text style={styles.switchText}>Play on Nxsha</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}

        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', position: 'relative' },
    center: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
    },
    hint: { color: '#c7c7c7', fontSize: 14, textAlign: 'center' },
    switchButton: {
        marginTop: 6,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 22,
        backgroundColor: '#E50914',
    },
    switchText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
