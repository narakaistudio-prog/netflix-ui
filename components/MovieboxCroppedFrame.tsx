import React, { useEffect, useRef } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
    getMovieboxCrop,
    MOVIEBOX_FRAME_ALLOW,
    MOVIEBOX_FRAME_SANDBOX,
} from '@/lib/moviebox';

/**
 * M2Box ka "sirf player" frame — teen dabbe, ek iframe, ek crop.
 * =================================================================
 * MovieBox official embed nahi deta, isliye uska POORA watch page iframe me
 * khulta hai. Phir teen dabbe se usko kaat kar sirf player + episode list
 * bacha liya jata hai:
 *
 *   host (naapne wali jagah, PAKKI height)
 *     └── box   (dikhne wala dabba, overflow:hidden)
 *           └── stage (fixed 1536px chaudi, scale hoti hai)
 *                 └── iframe (upar −117, baayein −120 dhakela hua)
 *
 * Desktop par iframe hamesha 1536px chaudai par render hota hai, phir stage
 * `transform: scale()` se screen ke hisaab se chhoti/badi hoti hai — isliye
 * kaat har screen par bilkul ek jagah padta hai (chhota laptop ho ya badi
 * monitor). Chhoti screen par stage nahi banta (site episodes ko player ke
 * neeche rakhti hai) — tab iframe asli chaudai par khulta hai aur andar
 * scroll khula rehta hai.
 *
 * Do usool jo pane par rehte hain:
 *   1. Host ki height PAKKI honi chahiye (full-screen layer). Agar host apni
 *      height bachchon se banaye (auto / min-height), crop apni hi height
 *      naap kar "cap" lagane lagta hai — controls kat jate hain.
 *   2. `scrolling="no"` desktop par hamesha (fullscreen me bhi), warna user
 *      scroll karke kata hua header/title wapas dekh leta hai.
 *
 * `allow-top-navigation` sandbox me KABHI nahi — warna site (ya uski ads)
 * hamari poori tab hijack kar sakti hai.
 */

interface MovieboxCroppedFrameProps {
    /** M2Box watch page ka canonical URL. */
    src: string;
    title?: string;
    onLoad?: () => void;
}

const IS_WEB = Platform.OS === 'web';

export function MovieboxCroppedFrame({ src, title, onLoad }: MovieboxCroppedFrameProps) {
    const hostRef = useRef<View | HTMLDivElement | null>(null);
    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;

    useEffect(() => {
        if (!IS_WEB) return;
        const host = hostRef.current as unknown as HTMLElement | null;
        if (!host || typeof document === 'undefined') return;

        const doc = host.ownerDocument;
        host.innerHTML = '';

        /* ----------------------------- DOM ----------------------------- */

        const outer = doc.createElement('div');
        outer.setAttribute('data-m2box', 'outer');
        Object.assign(outer.style, {
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
        } as Partial<CSSStyleDeclaration>);

        const box = doc.createElement('div');
        box.setAttribute('data-m2box', 'box');
        Object.assign(box.style, {
            position: 'relative',
            overflow: 'hidden',
            background: '#000',
            flex: '0 0 auto',
        } as Partial<CSSStyleDeclaration>);

        const stage = doc.createElement('div');
        stage.setAttribute('data-m2box', 'stage');
        Object.assign(stage.style, {
            position: 'relative',
            transformOrigin: 'top left',
        } as Partial<CSSStyleDeclaration>);

        const frame = doc.createElement('iframe');
        frame.setAttribute('data-m2box', 'frame');
        frame.title = title ? `${title} — M2Box` : 'M2Box player';
        frame.setAttribute('allow', MOVIEBOX_FRAME_ALLOW);
        frame.setAttribute('allowfullscreen', 'true');
        frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        frame.setAttribute('sandbox', MOVIEBOX_FRAME_SANDBOX);
        frame.setAttribute('frameborder', '0');
        frame.style.position = 'absolute';
        frame.style.border = '0';
        frame.style.backgroundColor = '#000';
        frame.src = src;
        frame.onload = () => onLoadRef.current?.();

        stage.appendChild(frame);
        box.appendChild(stage);
        outer.appendChild(box);
        host.appendChild(outer);

        /* ---------------------------- Crop ----------------------------- */

        const apply = () => {
            const rect = host.getBoundingClientRect();
            const fs = doc.fullscreenElement as Element | null;
            // Sirf tab crop hatao jab VIDEO khud fullscreen hua ho — us waqt
            // top-level document ka fullscreen element yahi iframe hota hai.
            // Hamari app khud `documentElement` ko fullscreen karti hai; us
            // halat me crop chalta rahega (bas naye size se dobara naapa
            // jayega), warna fullscreen me poora m2box page dikhne lagta.
            const frameIsFullscreen =
                !!fs && fs !== doc.documentElement && (fs === frame || frame.contains(fs));

            if (frameIsFullscreen) {
                box.style.width = '100%';
                box.style.height = '100%';
                stage.style.width = '100%';
                stage.style.height = '100%';
                stage.style.transform = '';
                frame.style.top = '0px';
                frame.style.left = '0px';
                frame.style.width = '100%';
                frame.style.height = '100%';
                frame.setAttribute('scrolling', 'no');
                return;
            }

            const crop = getMovieboxCrop(rect.width, rect.height);
            box.style.width = `${crop.frameWidth}px`;
            box.style.height = `${crop.height}px`;
            stage.style.width = `${crop.stageVisibleWidth}px`;
            stage.style.height = `${crop.stageVisibleHeight}px`;
            stage.style.transform = crop.scale !== 1 ? `scale(${crop.scale})` : '';
            frame.style.top = `${-crop.cropTop}px`;
            frame.style.left = `${-crop.cropLeft}px`;
            frame.style.width = `${crop.stageWidth}px`;
            frame.style.height = `${crop.stageVisibleHeight + crop.cropTop}px`;
            // Mobile par episode list neeche hoti hai — scroll khula chahiye.
            if (crop.stacked) frame.removeAttribute('scrolling');
            else frame.setAttribute('scrolling', 'no');
        };

        apply();

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(apply);
            observer.observe(outer);
        }
        window.addEventListener('resize', apply);

        // Fullscreen se lautne par purana size chipak jata hai — turant,
        // phir rAF + 80ms + 250ms par dobara naapo.
        const timers: Array<ReturnType<typeof setTimeout>> = [];
        const onFullscreenChange = () => {
            apply();
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
            timers.push(setTimeout(apply, 80));
            timers.push(setTimeout(apply, 250));
        };
        doc.addEventListener('fullscreenchange', onFullscreenChange);
        doc.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);

        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', apply);
            doc.removeEventListener('fullscreenchange', onFullscreenChange);
            doc.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
            timers.forEach(clearTimeout);
            try {
                frame.onload = null;
                // Audio turant band ho: document tod do, phir node hatao.
                frame.src = 'about:blank';
            } catch {}
            try {
                frame.remove();
            } catch {}
            host.innerHTML = '';
        };
    }, [src, title]);

    if (!IS_WEB) {
        return (
            <View style={styles.nativeFallback}>
                <Ionicons name="play-circle-outline" size={56} color="#E50914" />
                <Text style={styles.nativeTitle}>{title ? `${title} — M2Box` : 'M2Box player'}</Text>
                <Text style={styles.nativeHint}>
                    M2Box server web preview me chalta hai. Neeche se browser me khol lo.
                </Text>
                <Pressable style={styles.nativeButton} onPress={() => Linking.openURL(src).catch(() => {})}>
                    <Ionicons name="open-outline" size={18} color="#000" />
                    <Text style={styles.nativeButtonText}>Open in browser</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View
            ref={hostRef as any}
            style={styles.host}
            testID="moviebox-frame"
            collapsable={false}
        />
    );
}

const styles = StyleSheet.create({
    host: {
        flex: 1,
        backgroundColor: '#000',
    },
    nativeFallback: {
        flex: 1,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 14,
    },
    nativeTitle: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
    nativeHint: { color: '#9a9a9a', fontSize: 13, textAlign: 'center', lineHeight: 18 },
    nativeButton: {
        marginTop: 10,
        backgroundColor: '#fff',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 22,
        paddingVertical: 12,
        borderRadius: 6,
    },
    nativeButtonText: { color: '#000', fontWeight: '700', fontSize: 14 },
});

export default MovieboxCroppedFrame;
