// @ts-nocheck — MovieBox (Server 2) par **audio (dub)** switch.
/**
 * Owner: *"kisi par bhi audio dusra nahi aa raha"*
 * ==============================================
 * Sach: MovieBox wale raste par audio list hi nahi thi (sirf NetMirror par).
 * Ab provider ke `dubs[]` se pill + menu aata hai:
 *
 *   - desktop (iframe) → us dub ka watch page khulta hai (page hi audio
 *     badal deta hai),
 *   - phone (hamara `<video>`) → us dub ke subject se naye streams, wahi second.
 *
 * Test dono raste dekhta hai, aur ye bhi ki jhoothe options nahi bante.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});

jest.mock('../lib/movieboxAudio', () => {
    const actual = jest.requireActual('../lib/movieboxAudio');
    return {
        ...actual,
        fetchAudioLanguages: jest.fn(),
    };
});

jest.mock('../lib/movieboxDirect', () => {
    const actual = jest.requireActual('../lib/movieboxDirect');
    return {
        ...actual,
        resolveDirectStreams: jest.fn(),
    };
});

import { MovieboxPagePlayer } from '../components/MovieboxPagePlayer';
import { fetchAudioLanguages, buildDubWatchLink } from '../lib/movieboxAudio';
import { resolveDirectStreams } from '../lib/movieboxDirect';

const PAGE =
    'https://m2box.org/movies/mandaadi-hindi-qxUx1r3QHW4?id=4151920426815471968&type=/movie/detail&detailSe=&detailEp=&lang=en';

const AUDIO = {
    ok: true,
    languages: [
        { lang: 'ta', name: 'Original', subjectId: '2237794012843369344', detailPath: 'mandaadi-gWLfEvs7jF2', original: true },
        { lang: 'hi', name: 'Hindi', subjectId: '4151920426815471968', detailPath: 'mandaadi-hindi-qxUx1r3QHW4', original: false },
        { lang: 'te', name: 'Telugu', subjectId: '5228019281622882336', detailPath: 'mandaadi-hindi-mNLYleNnce6', original: false },
    ],
};

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    (fetchAudioLanguages as jest.Mock).mockResolvedValue(AUDIO);
    (resolveDirectStreams as jest.Mock).mockResolvedValue({
        ok: true,
        streams: [{ url: 'https://cdn.example/hindi.mp4', quality: 720, kind: 'mp4' }],
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
});

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function render() {
    await act(async () => {
        root.render(
            <MovieboxPagePlayer
                linkKey="audio:1"
                initialLink={PAGE}
                title="Mandaadi"
                mediaType="movie"
                autoResolve={false}
                onClose={() => {}}
            />,
        );
    });
}

test('audio list provider se aati hai (NetMirror ke baahar bhi)', async () => {
    await render();
    expect(fetchAudioLanguages).toHaveBeenCalled();
    const call = (fetchAudioLanguages as jest.Mock).mock.calls[0][0];
    expect(call.subjectId).toBe('4151920426815471968');
    expect(call.detailPath).toBe('mandaadi-hindi-qxUx1r3QHW4');
    expect(q('moviebox-audio')).toBeTruthy();
    expect(container.textContent).toContain('Hindi');
});

test('audio menu me saari bhashayein hain (jhoothe options nahi)', async () => {
    await render();
    await act(async () => {
        (q('moviebox-audio') as HTMLElement).click();
    });
    expect(q('moviebox-audio-menu')).toBeTruthy();
    expect(q('moviebox-audio-ta')).toBeTruthy();
    expect(q('moviebox-audio-hi')).toBeTruthy();
    expect(q('moviebox-audio-te')).toBeTruthy();
});

test('desktop (iframe) par switch = us dub ka watch page', async () => {
    await render();
    await act(async () => {
        (q('moviebox-audio') as HTMLElement).click();
    });
    await act(async () => {
        (q('moviebox-audio-te') as HTMLElement).click();
    });
    expect(buildDubWatchLink(AUDIO.languages[2])).toContain('mandaadi-hindi-mNLYleNnce6');
    // Frame us dub ke page par chala gaya.
    const frame = document.querySelector('iframe') as HTMLIFrameElement | null;
    expect(frame?.getAttribute('src') || '').toContain('mandaadi-hindi-mNLYleNnce6');
    expect(q('moviebox-audio-notice')?.textContent).toContain('Audio: Telugu');
});

test('list hi na mile to pill bhi nahi (jhoothi list nahi)', async () => {
    (fetchAudioLanguages as jest.Mock).mockResolvedValue({ ok: false, languages: [], reason: 'not-found' });
    await render();
    expect(q('moviebox-audio')).toBeNull();
});

test('jo bhasha chalu hai use dobara chunne par kuch nahi badalta', async () => {
    await render();
    await act(async () => {
        (q('moviebox-audio') as HTMLElement).click();
    });
    await act(async () => {
        (q('moviebox-audio-hi') as HTMLElement).click();
    });
    // Hindi pehle se chalu hai (page ka subject) — menu band, frame wahi.
    expect(q('moviebox-audio-menu')).toBeNull();
    expect(resolveDirectStreams).not.toHaveBeenCalled();
    const frame = document.querySelector('iframe') as HTMLIFrameElement | null;
    expect(frame?.getAttribute('src') || '').toContain('mandaadi-hindi-qxUx1r3QHW4');
});
