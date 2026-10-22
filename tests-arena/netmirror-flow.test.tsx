// @ts-nocheck — jsdom test: Netflix detail modal ka "Other" server (NetMirror).
/**
 * Owner ka flow
 * =============
 *   Server patti: Hindi (MovieBox) · Multi (Nxsha) · **Other (NetMirror)**.
 *   Other chunne par hamara Play button hat jata hai aur NetMirror ka **asli**
 *   Play button (crop) uski jagah aata hai; dabane par unki site new tab me
 *   khulti hai (net77.cc login + anti-frame — embed nahi hota).
 *   Test scope: sirf Dhurandhar.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    const icon = (props: any) => ReactLocal.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});
jest.mock('expo-linear-gradient', () => {
    const ReactLocal = require('react');
    return { LinearGradient: (props: any) => ReactLocal.createElement('div', null, props.children) };
});
jest.mock('@/hooks/useMovieboxAvailable', () => ({
    useMovieboxAvailable: () => ({ available: true, checking: false }),
}));
jest.mock('@/lib/movieboxLinks', () => {
    const actual = jest.requireActual('@/lib/movieboxLinks');
    return { ...actual, resolveMovieboxLink: () => null };
});
jest.mock('@/components/MovieboxPagePlayer', () => ({
    MovieboxPagePlayer: () => require('react').createElement('div', { 'data-testid': 'moviebox-player' }),
}));
jest.mock('@/components/EmbedPlayer', () => ({
    EmbedPlayer: () => require('react').createElement('div', { 'data-testid': 'embed-player' }),
}));

// jsdom me PNG asset registry nahi hota — button ka crop asset stub kar dete hain
// taaki asli component (aspect + testID) hi test ho, sirf image bytes skip hon.
jest.mock('../assets/netmirror/netmirror-play.png', () => ({
    uri: 'test://netmirror-play.png',
    width: 316,
    height: 106,
}));

import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';

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
    jest.restoreAllMocks();
});

const dhurandhar = {
    id: 'tudum-top10-india-dhurandhar',
    tmdb_id: '1234567',
    embed_provider: 'nxsha',
    title: 'Dhurandhar',
    imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    year: '2025',
    duration: '3h 34m',
    description: 'An undercover operative infiltrates Karachi.',
    cast: ['Ranveer Singh'],
    genres: ['Action'],
};

const otherMovie = { ...dhurandhar, id: 'x', title: 'Irumudi' };

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

test('Dhurandhar par Server patti me Other chip aata hai', () => {
    act(() => root.render(<MovieDetailModal movie={dhurandhar as any} onClose={() => {}} />));

    const other = byTestId('server-other');
    expect(other).toBeTruthy();
    expect(other!.textContent).toContain('Other');
    // Baaki servers bhi wahi hain.
    expect(byTestId('server-hindi')).toBeTruthy();
    expect(byTestId('server-multi')).toBeTruthy();
});

test('Other chunne par NetMirror ka apna Play button apne button ki jagah aata hai', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    act(() => root.render(<MovieDetailModal movie={dhurandhar as any} onClose={() => {}} />));

    // Pehle hamara Play button.
    expect(document.querySelector('[aria-label="Play Dhurandhar"]')).toBeTruthy();
    expect(byTestId('netmirror-play')).toBeNull();

    act(() => {
        byTestId('server-other')!.click();
    });

    // Ab unka button, hamara nahi.
    expect(byTestId('netmirror-play')).toBeTruthy();
    expect(document.querySelector('[aria-label="Play Dhurandhar"]')).toBeNull();

    // Dabane par NetMirror (new tab) — embed nahi.
    act(() => {
        byTestId('netmirror-play')!.click();
    });
    expect(openSpy).toHaveBeenCalled();
    expect(String(openSpy.mock.calls[0][0])).toBe('https://net77.cc/home');
});

test('baaki titles par Other chip nahi aata (owner: test bas Dhurandhar)', () => {
    act(() => root.render(<MovieDetailModal movie={otherMovie as any} onClose={() => {}} />));
    expect(byTestId('server-other')).toBeNull();
    expect(document.querySelector('[aria-label="Play Irumudi"]')).toBeTruthy();
});
