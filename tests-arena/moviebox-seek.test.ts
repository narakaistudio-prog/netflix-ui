// @ts-nocheck — jsdom me asli iframe script chala kar gestures check hote hain.
/**
 * MovieBox player me ±10s (phone ka invisible double-tap)
 * ========================================================
 * Owner: "moviebox ke player mae 10 sec aage ya peeche karne ka koi tarika nhi
 * hai … invisible chiyea koi button nhi mainly ye phone ke liyea karna".
 *
 * MovieBox ka player cross-origin iframe me hai, isliye gesture script **frame
 * ke andar** jaata hai (`api/moviebox-frame.mjs` → `movieboxSeekEnhancer`) —
 * yahan wahi script asli jsdom window me chala kar check hota hai:
 *   - video ke baayein double-tap = −10s, daayein = +10s, beech ka hissa chup
 *   - single tap par kuch nahi hota (site ka play/pause waisa hi rehta hai)
 *   - 0 aur duration ke bahar seek nahi jaata
 *   - koi button nahi banta (sirf ek fade hone wala badge, pointer-events none)
 * Saath me client bridge ke pure helpers (URL, storage, message shape).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

import {
    MOVIEBOX_SEEK_OFF_KEY,
    MOVIEBOX_SEEK_SOURCE,
    MOVIEBOX_SEEK_STEP_SECONDS,
    buildSeekFrameUrl,
    isMovieboxSeekMessage,
    isMovieboxSeekOff,
    markMovieboxSeekOff,
} from '../lib/movieboxSeek';

const MODULE_PATH = join(process.cwd(), 'api', 'moviebox-frame.mjs');
const HARNESS = join(process.cwd(), 'tests-arena', 'helpers', 'moviebox-frame-harness.mjs');
const PAGE =
    'https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail';

/** Asli server module se gesture script nikaalo (jest .mjs import nahi kar sakta). */
function seekScript(): string {
    const res = spawnSync('node', [HARNESS], {
        encoding: 'utf8',
        timeout: 45000,
        env: {
            ...process.env,
            MBF_SCENARIO: JSON.stringify({
                query: { url: PAGE, seek: '1' },
                withSeekScript: true,
                upstream: {
                    contentType: 'text/html',
                    finalUrl: PAGE,
                    body: '<html><head></head><body><div id="player"></div></body></html>',
                },
            }),
            MBF_MODULE_PATH: MODULE_PATH,
        },
    });
    const out = String(res.stdout || '');
    const marker = out.lastIndexOf('__RESULT__');
    if (marker === -1) throw new Error(`harness failed: ${res.stderr || out}`);
    const parsed = JSON.parse(out.slice(marker + '__RESULT__'.length));
    const html = String(parsed.seekScript || '');
    // <script data-m2box-seek="1">…</script> → sirf andar ka JS
    return html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
}

const SCRIPT = seekScript();

interface FakePlayer {
    window: any;
    document: any;
    currentTime: () => number;
    tap: (clientX: number, clientY: number) => void;
    close: () => void;
}

/**
 * Ek saaf jsdom window: 400×225 video (16:9) + 1 ghante ki duration.
 * `PointerEvent` stub zaroori hai — warna script touchstart/mousedown par
 * jaata hai aur test ka MouseEvent bhi wahi raasta leta hai (dono theek hain,
 * par pointer wala rasta hi phone par chalta hai).
 */
function bootPlayer(options: { duration?: number; start?: number } = {}): FakePlayer {
    const dom = new JSDOM('<body><div id="stage"><video></video></div></body>', {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://net-ki15.vercel.app/api/moviebox-frame?seek=1',
    });
    const { window } = dom;
    const document = window.document;
    const video = document.querySelector('video');

    let time = options.start ?? 30;
    const duration = options.duration ?? 3600;
    Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => time,
        set: (value: number) => {
            time = value;
        },
    });
    Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 3 });
    video.getBoundingClientRect = () =>
        ({
            left: 0,
            top: 0,
            width: 400,
            height: 225,
            right: 400,
            bottom: 225,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect;

    window.PointerEvent = function PointerEvent() {};
    window.eval(SCRIPT);

    const tap = (clientX: number, clientY: number) => {
        document.dispatchEvent(
            new window.MouseEvent('pointerdown', { bubbles: true, clientX, clientY }),
        );
    };

    return {
        window,
        document,
        currentTime: () => time,
        tap,
        close: () => dom.window.close(),
    };
}

describe('MovieBox phone seek (invisible double-tap ±10s)', () => {
    it('double-tap left = −10s, right = +10s, middle = kuch nahi', () => {
        const player = bootPlayer({ start: 100 });

        // Baayein kinara (400 ka 34% = 136px) — do tap = peeche 10s.
        player.tap(40, 110);
        expect(player.currentTime()).toBe(100); // ek tap par sirf ginti hoti hai
        player.tap(42, 112);
        expect(player.currentTime()).toBe(90);

        // Daayein kinara — do tap = aage 10s.
        player.tap(360, 110);
        expect(player.currentTime()).toBe(90);
        player.tap(362, 110);
        expect(player.currentTime()).toBe(100);

        // Beech ka hissa (136–264px) site ka hi raha — play/pause wahi.
        player.tap(200, 110);
        player.tap(200, 110);
        expect(player.currentTime()).toBe(100);

        // Alag-alag side ke do tap "double tap" nahi hain.
        player.tap(40, 110);
        player.tap(360, 110);
        expect(player.currentTime()).toBe(100);

        player.close();
    });

    it('0 aur video ke end se bahar seek nahi jaata', () => {
        const start = bootPlayer({ start: 4 });
        start.tap(20, 100);
        start.tap(20, 100);
        expect(start.currentTime()).toBe(0); // 4 − 10 = 0 (negative nahi)
        start.close();

        const end = bootPlayer({ start: 3595, duration: 3600 });
        end.tap(380, 100);
        end.tap(380, 100);
        expect(end.currentTime()).toBe(3599.7); // duration − 0.3s par ruk jata hai
        end.close();
    });

    it('video ke bahar ke tap ignore hote hain', () => {
        const player = bootPlayer({ start: 50 });
        player.tap(20, 400); // video ke neeche
        player.tap(20, 400);
        expect(player.currentTime()).toBe(50);
        player.close();
    });

    it('koi button nahi banta — sirf fade hone wala badge (pointer-events:none)', () => {
        const player = bootPlayer({ start: 60 });
        player.tap(30, 110);
        player.tap(30, 110);

        expect(player.document.querySelectorAll('button').length).toBe(0);
        const badge = player.document.querySelector('[data-m2box-seek-badge]');
        expect(badge).toBeTruthy();
        expect(badge.tagName).toBe('DIV');
        expect(badge.textContent).toContain('-10s');
        expect(badge.textContent).toContain('00:50');
        expect(badge.style.pointerEvents).toBe('none');
        // Clickable nahi — isliye user ko "button" jaisa kuch nahi dikhta.
        expect(badge.getAttribute('role')).toBeNull();

        // Ek hi baar hint (discoverability), wo bhi button nahi.
        const hint = player.document.querySelector('[data-m2box-seek-hint]');
        expect(hint?.textContent).toBe('Double-tap left / right to skip 10s');
        expect(hint.style.pointerEvents).toBe('none');
        player.close();
    });

    it('double-tap ke baad site ka click nigal liya jata hai (warna control toggle hota)', () => {
        const player = bootPlayer({ start: 60 });
        let reached = 0;
        player.document.addEventListener('click', () => {
            reached += 1;
        });

        player.tap(30, 110);
        player.tap(30, 110); // asli seek — iske baad 600ms tak clicks block
        player.document.dispatchEvent(
            new player.window.MouseEvent('click', { bubbles: true, cancelable: true }),
        );
        expect(reached).toBe(0);

        player.close();
    });
});

describe('seek bridge ke helpers (parent side)', () => {
    it('buildSeekFrameUrl proxy URL + seek=1 banata hai (encode ke saath)', () => {
        const url = buildSeekFrameUrl(PAGE);
        expect(url.startsWith('/api/moviebox-frame?url=')).toBe(true);
        expect(url.endsWith('&seek=1')).toBe(true);
        expect(decodeURIComponent(url.split('url=')[1].split('&seek=')[0])).toBe(PAGE);
        expect(MOVIEBOX_SEEK_STEP_SECONDS).toBe(10);
    });

    it('no-media sirf apne source se aane par maana jaata hai', () => {
        expect(isMovieboxSeekMessage({ source: MOVIEBOX_SEEK_SOURCE, type: 'media' })).toBe(true);
        expect(isMovieboxSeekMessage({ source: MOVIEBOX_SEEK_SOURCE, type: 'no-media' })).toBe(
            true,
        );
        expect(isMovieboxSeekMessage({ source: 'ad', type: 'no-media' })).toBe(false);
        expect(isMovieboxSeekMessage('no-media')).toBe(false);
        expect(isMovieboxSeekMessage(null)).toBe(false);
    });

    it('proxy fail hone par sirf is session ke liye yaad rehta hai', () => {
        const store = new Map<string, string>();
        const sessionStorage = {
            getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
            setItem: (key: string, value: string) => store.set(key, value),
        };
        expect(isMovieboxSeekOff(sessionStorage)).toBe(false);
        markMovieboxSeekOff(sessionStorage);
        expect(store.get(MOVIEBOX_SEEK_OFF_KEY)).toBe('1');
        expect(isMovieboxSeekOff(sessionStorage)).toBe(true);
    });
});
