// @ts-nocheck — real EmbedPlayer: VidSync ki upstream line pills (1/2/3).
/**
 * Owner (laptop par VidSync): "bahut ruk ruk kar chalta hai".
 *
 * Uska ilaaj: player ke top bar me **Line 1 / 2 / 3** — ek upstream slow ho to
 * doosra ek tap me (provider ke gear menu me jaane ki zarurat nahi). Ye test
 * asli EmbedPlayer render karta hai (koi mock nahi) taaki pata chale ki pills
 * sach me dikhte hain aur tap se callback chalta hai.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});

import { EmbedPlayer } from '../components/EmbedPlayer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const SRC = 'https://vidsync.pro/embed/movie/1441228?primarycolor=E50914&dubLang=hindi&server=1';

test('line pills dikhte hain aur tap par naya line milta hai', () => {
    const picked: number[] = [];
    act(() =>
        root.render(
            <EmbedPlayer
                src={SRC}
                title="Irumudi"
                lineOptions={[1, 2, 3]}
                lineValue={1}
                onPickLine={(line) => picked.push(line)}
            />,
        ),
    );

    expect(document.querySelector('[data-testid="embed-line-pills"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="embed-line-1"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="embed-line-3"]')).toBeTruthy();

    act(() => {
        (document.querySelector('[data-testid="embed-line-3"]') as HTMLElement).click();
    });
    expect(picked).toEqual([3]);
});

test('line options na do to koi extra pill nahi (baaki servers par shaant)', () => {
    act(() => root.render(<EmbedPlayer src="https://nxsha.space/embed/movie/1441228" title="Irumudi" />));
    expect(document.querySelector('[data-testid="embed-line-pills"]')).toBeNull();
});
