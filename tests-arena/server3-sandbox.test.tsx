// @ts-nocheck — web-only jsdom harness for the Server 3 sandbox exception.
/**
 * Owner (24 Oct, follow-up): *"server 3 ke liyea sandbox bas disable karoo"*.
 *
 * Server 3 ke players (Videasy / VidFast / VidLink / MyCineBy / VidAPI) ke
 * iframe par `sandbox` attribute lagta hi nahi. Baaki servers (Nxsha, NHD,
 * MovieBox) ka sandbox pehle jaisa hi rehta hai — wahan ads/top-redirect
 * abhi bhi band hain.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});

import { EmbedPlayer } from '../components/EmbedPlayer';
import { buildServer3Url, isServer3Url } from '../lib/server3';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
});

function mount(props: Record<string, unknown>) {
    act(() => root.render(<EmbedPlayer title="Test title" {...(props as any)} />));
    const iframe = container.querySelector('iframe[data-arena-embed="1"]') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    act(() => iframe.dispatchEvent(new Event('load')));
    return iframe;
}

describe('Server 3 iframe — sandbox off', () => {
    it('har registry provider ka frame bina sandbox ke banta hai', () => {
        const urls = [
            buildServer3Url({ tmdbId: 'tmdb:1465943', mediaType: 'movie', provider: 'videasy' }),
            buildServer3Url({ tmdbId: 'tmdb:1396', mediaType: 'tv', season: 1, episode: 2, provider: 'vidfast' }),
            buildServer3Url({ tmdbId: 550, mediaType: 'movie', provider: 'vidlink' }),
            buildServer3Url({ tmdbId: 550, mediaType: 'movie', provider: 'mycineby' }),
            buildServer3Url({ tmdbId: 550, mediaType: 'movie', provider: 'vaplayer' }),
        ];
        expect(urls.every(Boolean)).toBe(true);

        urls.forEach((src) => {
            expect(isServer3Url(src as string)).toBe(true);
            const iframe = mount({ src });
            expect(iframe.getAttribute('src')).toBe(src);
            // Attribute set hi nahi hota — khaali string bhi nahi.
            expect(iframe.hasAttribute('sandbox')).toBe(false);
            expect(iframe.getAttribute('sandbox')).toBeNull();
            act(() => root.unmount());
            root = createRoot(container);
        });
    });

    it('autoplay/fullscreen ki permission waise hi milti hai', () => {
        const iframe = mount({
            src: 'https://player.videasy.net/movie/550?color=E50914',
        });
        const allow = iframe.getAttribute('allow') || '';
        expect(allow).toContain('autoplay');
        expect(allow).toContain('fullscreen');
        expect(iframe.getAttribute('allowfullscreen')).toBe('true');
    });

    it('explicit sandboxed={true} se Server 3 par bhi sandbox lag jata hai (escape hatch)', () => {
        const iframe = mount({
            src: 'https://player.videasy.net/movie/550?color=E50914',
            sandboxed: true,
        });
        expect(iframe.getAttribute('sandbox') || '').toContain('allow-scripts');
    });
});

describe('Baaki servers — sandbox on', () => {
    it('Nxsha ka frame sandboxed rehta hai, popups/top-navigation band', () => {
        const iframe = mount({ src: 'https://nxsha.space/embed/movie/550?server=GbruHindi' });
        const sandbox = iframe.getAttribute('sandbox') || '';
        expect(sandbox).toContain('allow-scripts');
        expect(sandbox).toContain('allow-same-origin');
        expect(sandbox).not.toContain('allow-popups');
        expect(sandbox).not.toContain('allow-top-navigation');
    });

    it('NHD ka frame bhi sandboxed rehta hai', () => {
        const iframe = mount({ src: 'https://nhdapi.com/embed/movie/550' });
        expect(iframe.getAttribute('sandbox') || '').toContain('allow-scripts');
    });
});

describe('isServer3Url', () => {
    it('registry hosts aur unke subdomains pe true', () => {
        expect(isServer3Url('https://player.videasy.net/movie/1')).toBe(true);
        expect(isServer3Url('https://vidfast.pro/tv/1/1/1')).toBe(true);
        expect(isServer3Url('https://www.vidlink.pro/movie/1')).toBe(true);
        expect(isServer3Url('https://mycineby.cc/embed/movie/1')).toBe(true);
        expect(isServer3Url('https://vaplayer.ru/embed/tv/1/1/1')).toBe(true);
    });

    it('milte-julte host aur khaali input pe false (galat frame ko chhoot nahi)', () => {
        expect(isServer3Url('https://notvideasy.net/movie/1')).toBe(false);
        expect(isServer3Url('https://videasy.net.evil.example/movie/1')).toBe(false);
        expect(isServer3Url('https://nxsha.space/embed/movie/1')).toBe(false);
        expect(isServer3Url('')).toBe(false);
        expect(isServer3Url(null)).toBe(false);
        expect(isServer3Url('not a url')).toBe(false);
    });
});
