import React, { useEffect, useRef } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
    getMovieboxCrop,
    MOVIEBOX_FRAME_ALLOW,
    MOVIEBOX_FRAME_ALLOW_PHONE,
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
 * Player mode me crop ka daaya kinara MovieBox ke **Resources panel** se pehle
 * hi band ho jata hai, isliye screen par sirf player dikhta hai (episode grid,
 * "Source: …", sab bahar). Site ki layout badal jaye to
 * `MOVIEBOX_STAGE_PLAYER_WIDTH` (lib/moviebox.ts) dobara naap lena.
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
    /**
     * Desktop par bhi andar scroll khula rakho. Sirf tab — jab frame me watch
     * page nahi, search results khule hon (warna kata hua header wapas dikhta).
     */
    allowScroll?: boolean;
    /**
     * `player` (default) = screen par **sirf player** (MovieBox ka Resources
     * panel bahar) — NetMirror jaisa full-bleed 16:9.
     * `page` = poora page crop (search results ke liye).
     */
    mode?: 'player' | 'page';
    /**
     * Frame pointer events le raha hai? Chrome (hamare overlays) chhupne par
     * `false` — tab pointer ka pura movement hamare dabbe tak aata hai, isliye
     * mouse hilte hi chrome wapas aa jata hai (warna cross-origin iframe
     * andar ka mousemove deta hi nahi).
     */
    interactive?: boolean;
    /**
     * Site ke apne fullscreen button ko chalu rakho (`allow="…; fullscreen"`).
     * Sirf phone par — desktop par site ka fullscreen crop tod deta hai.
     */
    allowFullscreen?: boolean;
    /**
     * Phone: site ka mobile layout, native scale — site ke apne controls
     * (play/seek/quality/fullscreen) bade, touch ke laayak.
     */
    phoneLayout?: boolean;
}

const IS_WEB = Platform.OS === 'web';

export function MovieboxCroppedFrame({
    src,
    title,
    onLoad,
    allowScroll = false,
    mode = 'player',
    interactive = true,
    allowFullscreen = false,
    phoneLayout = false,
}: MovieboxCroppedFrameProps) {
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
        frame.setAttribute(
            'allow',
            allowFullscreen ? MOVIEBOX_FRAME_ALLOW_PHONE : MOVIEBOX_FRAME_ALLOW,
        );
        // Phone: site ka apna fullscreen button chalta rahe.
        if (allowFullscreen) frame.setAttribute('allowfullscreen', 'true');
        // `allowfullscreen` jaan-boojh kar nahi — wo allow="fullscreen" ka
        // purana alias hai aur site ke fullscreen button ko chalu kar deta
        // hai (crop toot kar poora page dikhne lagta hai). Fullscreen hum
        // apne player dabbe ka dete hain.
        frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        frame.setAttribute('sandbox', MOVIEBOX_FRAME_SANDBOX);
        frame.setAttribute('frameborder', '0');
        frame.style.position = 'absolute';
        frame.style.border = '0';
        frame.style.backgroundColor = '#000';
        // Chrome chhupa ho to video pointer events na le — tab mouse ka har
        // movement hum tak aata hai aur overlays turant wapas dikh jate hain
        // (cross-origin iframe andar ki harkat nahi batata).
        frame.style.pointerEvents = interactive ? 'auto' : 'none';
        frame.src = src;
        frame.onload = () => onLoadRef.current?.();

        stage.appendChild(frame);
        box.appendChild(stage);
        outer.appendChild(box);
        host.appendChild(outer);

        /* ---------------------------- Crop ----------------------------- */

        const apply = () => {
            const rect = host.getBoundingClientRect();
            /**
             * Phone par ye dabba CSS se 90° ghuma hota hai (landscape player).
             * `getBoundingClientRect` tab **ghuma hua** naap deta hai (chaudai
             * aur unchai ulte), isliye layout ka asli naap `offsetWidth/height`
             * se lete hain — transform ka koi asar nahi hota. Rotation na ho
             * to dono ek hi cheez hain.
             */
            const measureWidth = host.offsetWidth || rect.width;
            const measureHeight = host.offsetHeight || rect.height;
            // Crop HAR haalat me — chhoti window, bada fullscreen, sab me.
            // Host (hamara player dabba) fullscreen hone par uski rect hi
            // screen ka naap hoti hai, isliye crop apne aap naye size par
            // lag jata hai aur screen par sirf player dikhta hai.
            const crop = getMovieboxCrop(measureWidth, measureHeight, {
                resources: mode === 'page',
                phone: phoneLayout,
            });
            box.style.width = `${crop.frameWidth}px`;
            box.style.height = `${crop.height}px`;
            stage.style.width = `${crop.stageVisibleWidth}px`;
            stage.style.height = `${crop.stageVisibleHeight}px`;
            stage.style.transform = crop.scale !== 1 ? `scale(${crop.scale})` : '';
            frame.style.top = `${-crop.cropTop}px`;
            frame.style.left = `${-crop.cropLeft}px`;
            frame.style.width = `${crop.stageWidth}px`;
            frame.style.height = `${crop.stageVisibleHeight + crop.cropTop}px`;
            // Scroll sirf desktop player crop par band — warna user crop ke
            // bahar wala header/grid wapas la sakta hai. Mobile par grid
            // neeche hoti hai, isliye wahan scroll khula rehta hai.
            if (crop.stacked || allowScroll) frame.removeAttribute('scrolling');
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
            // Hamara player dabba fullscreen hua / bahar aaya — naaya size
            // aa gaya, dobara naapo (crop wahin ka wahin rehna chahiye).
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, title, mode, allowScroll, allowFullscreen]);

    /**
     * Chrome chhupne/dikhne par sirf pointer-events badalta hai — iframe
     * dobara mount NAHI hota (warna video reload ho jata). Isliye `interactive`
     * upar wale effect ki dependency me nahi hai.
     */
    useEffect(() => {
        if (!IS_WEB || typeof document === 'undefined') return;
        const host = hostRef.current as unknown as HTMLElement | null;
        const frame = host?.querySelector('iframe[data-m2box="frame"]') as HTMLIFrameElement | null;
        if (frame) frame.style.pointerEvents = interactive ? 'auto' : 'none';
    }, [interactive, src]);

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
