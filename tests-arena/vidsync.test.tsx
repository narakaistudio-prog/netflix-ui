// @ts-nocheck — VidSync (Server 3): URL builder + server cycle + phone wiring.
/**
 * Owner (24 Oct): "vidsync.pro mae server 3 isse website se soch raha hu lagne
 * ke liyea netflix par ye thik hai".
 *
 * Yahan sirf wahi cheezein test hoti hain jo sach me toot sakti hain:
 *   1. VidSync ka URL — sirf TMDB numeric id, movie vs tv, dub/lang accent.
 *   2. Server cycle — VidSync **kabhi default nahi**, hamesha aakhir me, aur
 *      MovieBox na hone par bhi [Server 1 → VidSync] ban sakta hai.
 *   3. Detail screen — "VidSync" chip dikhta hai aur play karne par iframe ka
 *      src vidsync.pro ka hi hota hai.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import fs from 'fs';
import path from 'path';

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
    useMovieboxAvailable: () => ({ available: false, checking: false }),
}));
jest.mock('@/lib/movieboxLinks', () => {
    const actual = jest.requireActual('@/lib/movieboxLinks');
    return { ...actual, resolveMovieboxLink: () => null };
});
jest.mock('@/components/MovieboxPagePlayer', () => {
    const ReactLocal = require('react');
    return { MovieboxPagePlayer: () => ReactLocal.createElement('div', { 'data-testid': 'moviebox-player' }) };
});
jest.mock('@/components/EmbedPlayer', () => {
    const ReactLocal = require('react');
    return {
        EmbedPlayer: ({ src, serverName }: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'embed-player',
                'data-src': src,
                'data-server': serverName || '',
            }),
    };
});

import {
    buildVidSyncUrl,
    vidsyncTmdbNumber,
    VIDSYNC_BASE_URL,
    VIDSYNC_NETFLIX_ACCENT,
} from '../lib/vidsync';
import { buildServerCycle, hasServerSwitcher, nextServerIn } from '../lib/playbackServers';
import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';

describe('vidsyncTmdbNumber', () => {
    it('catalog id se sirf number nikalta hai', () => {
        expect(vidsyncTmdbNumber('tmdb:1465943')).toBe(1465943);
        expect(vidsyncTmdbNumber(1465943)).toBe(1465943);
        expect(vidsyncTmdbNumber('1465943')).toBe(1465943);
        expect(vidsyncTmdbNumber('tv-66732')).toBe(66732);
    });

    it('id na ho / bekaar ho to null (dead pill nahi)', () => {
        expect(vidsyncTmdbNumber(null)).toBeNull();
        expect(vidsyncTmdbNumber(undefined)).toBeNull();
        expect(vidsyncTmdbNumber('')).toBeNull();
        expect(vidsyncTmdbNumber('tt0903747')).toBeNull();
        expect(vidsyncTmdbNumber(0)).toBeNull();
        expect(vidsyncTmdbNumber(-5)).toBeNull();
    });
});

describe('buildVidSyncUrl', () => {
    it('movie route + Netflix accent + Hindi dub', () => {
        const url = buildVidSyncUrl({ tmdbId: 'tmdb:155', mediaType: 'movie' });
        expect(url).toBe(
            `${VIDSYNC_BASE_URL}/embed/movie/155?primarycolor=${VIDSYNC_NETFLIX_ACCENT}&dubLang=hindi`,
        );
    });

    it('tv route me chalu season/episode jaata hai', () => {
        const url = buildVidSyncUrl({ tmdbId: 66732, mediaType: 'tv', season: 2, episode: 7 });
        expect(url).toContain('/embed/tv/66732/2/7?');
    });

    it('episode 0/galat number par 1 (route kabhi tootta nahi)', () => {
        expect(buildVidSyncUrl({ tmdbId: 66732, mediaType: 'tv', season: 0, episode: 0 })).toContain(
            '/embed/tv/66732/1/1?',
        );
    });

    it('dubLang null = koi dub preference nahi, accent "#" ke bina', () => {
        const url = buildVidSyncUrl({
            tmdbId: 155,
            mediaType: 'movie',
            dubLang: null,
            accent: '#E50914',
        });
        expect(url).toBe(`${VIDSYNC_BASE_URL}/embed/movie/155?primarycolor=E50914`);
    });

    it('TMDB id na ho to null — server dikhana hi galat hoga', () => {
        expect(buildVidSyncUrl({ tmdbId: 'imdb-only', mediaType: 'movie' })).toBeNull();
        expect(buildVidSyncUrl({ tmdbId: null, mediaType: 'tv', season: 1, episode: 1 })).toBeNull();
    });
});

describe('server cycle me Server 3 (VidSync)', () => {
    it('MovieBox ke saath sabse aakhir me aata hai (default nahi banta)', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: true,
            vidsyncAvailable: true,
        });
        expect(cycle).toEqual(['nxsha', 'nhd', 'moviebox', 'vidsync']);
        expect(cycle[0]).toBe('nxsha');
    });

    it('MovieBox na ho to bhi [Server 1 → VidSync] chalta hai', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: false,
            vidsyncAvailable: true,
        });
        expect(cycle).toEqual(['nxsha', 'vidsync']);
        expect(hasServerSwitcher(cycle)).toBe(true);
        expect(nextServerIn(cycle, 0)).toBe('vidsync');
    });

    it('VidSync available na ho to purana rule jaisa hi (sirf Server 1)', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: false,
            vidsyncAvailable: false,
        });
        expect(cycle).toEqual(['nxsha']);
        expect(hasServerSwitcher(cycle)).toBe(false);
    });
});

describe('phone detail screen par VidSync chip', () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let container: HTMLDivElement;
    let root: Root;

    const movie = {
        id: 'netflix-irumudi',
        tmdb_id: '1441228',
        embed_provider: 'nxsha',
        title: 'Irumudi',
        imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
        year: '2026',
        duration: '2h 32m',
        description: 'A father undertakes a spiritual vow.',
        cast: ['Ravi Teja'],
        genres: ['Drama'],
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('chip dikhta hai aur play par VidSync ka embed khulta hai', () => {
        act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));

        const chip = document.querySelector('[data-testid="server-vidsync"]') as HTMLElement;
        expect(chip).toBeTruthy();
        expect(chip.textContent).toContain('VidSync');
        // Default VidSync nahi hai — Multi (Nxsha) hi selected rehta hai.
        expect((document.querySelector('[data-testid="server-multi"]') as HTMLElement).getAttribute('data-selected'))
            .toBe('1');

        act(() => chip.click());
        expect(chip.getAttribute('data-selected')).toBe('1');

        act(() => {
            (document.querySelector('[aria-label="Play Irumudi"]') as HTMLElement).click();
        });

        const embed = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
        expect(embed).toBeTruthy();
        expect(embed.getAttribute('data-src')).toContain('vidsync.pro/embed/movie/1441228');
        expect(embed.getAttribute('data-src')).toContain('dubLang=hindi');
        expect(embed.getAttribute('data-server')).toContain('VidSync');
    });

    it('tmdb id na ho to VidSync chip dikhta hi nahi', () => {
        act(() =>
            root.render(
                <MovieDetailModal movie={{ ...movie, tmdb_id: undefined } as any} onClose={() => {}} />,
            ),
        );
        expect(document.querySelector('[data-testid="server-vidsync"]')).toBeNull();
    });
});

describe('source wiring', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

    it('movie page VidSync url banata hai aur cycle me de raha hai', () => {
        const src = read('app/movie/[id].tsx');
        expect(src).toContain("from '@/lib/vidsync'");
        expect(src).toContain("if (currentProvider === 'vidsync')");
        expect(src).toContain('buildVidSyncUrl({');
        expect(src).toContain('vidsyncAvailable');
    });

    it('detail screen bhi wahi helper use karta hai (do jagah do system nahi)', () => {
        const src = read('components/MovieList/MovieDetailModal.tsx');
        expect(src).toContain('buildVidSyncUrl({');
        expect(src).toContain('VIDSYNC_SERVER_LABEL');
        expect(src).toContain('playerSrc');
    });
});
