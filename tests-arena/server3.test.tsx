// @ts-nocheck — Server 3 (third-party embed): URL builder + cycle + wiring.
/**
 * Owner (24 Oct): *"vidsync hta de aur third server ke liyea aur mast server
 * dhund player bilkul aacha aur fast"*.
 *
 * Yahan wahi cheezein test hoti hain jo sach me toot sakti hain:
 *   1. Provider registry — har provider ka URL shape (movie vs tv, id parsing).
 *   2. Server cycle — Server 3 **kabhi default nahi**, hamesha aakhir me, aur
 *      MovieBox na hone par bhi [Server 1 → Server 3] ban sakta hai.
 *   3. Detail screen — "Server 3" chip dikhta hai aur play karne par iframe ka
 *      src usi provider ka hota hai.
 *   4. VidSync poora gayab — koi `vidsync` string code me nahi bachi.
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
    buildServer3Url,
    loadServer3Provider,
    nextServer3Provider,
    saveServer3Provider,
    server3Label,
    server3TmdbNumber,
    SERVER3_DEFAULT_PROVIDER,
    SERVER3_ORDER,
    SERVER3_PROVIDERS,
} from '../lib/server3';
import { buildServerCycle, hasServerSwitcher, nextServerIn } from '../lib/playbackServers';
import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';

describe('server3TmdbNumber', () => {
    it('catalog id se sirf number nikalta hai', () => {
        expect(server3TmdbNumber('tmdb:1465943')).toBe(1465943);
        expect(server3TmdbNumber(1465943)).toBe(1465943);
        expect(server3TmdbNumber('1465943')).toBe(1465943);
        expect(server3TmdbNumber('tv-66732')).toBe(66732);
    });

    it('IMDb id / bekaar id par null (galat film nahi khulti)', () => {
        expect(server3TmdbNumber('tt0903747')).toBeNull();
        expect(server3TmdbNumber('imdb:tt0903747')).toBeNull();
        expect(server3TmdbNumber(-5)).toBeNull();
        expect(server3TmdbNumber(0)).toBeNull();
        expect(server3TmdbNumber(null)).toBeNull();
        expect(server3TmdbNumber('')).toBeNull();
    });
});

describe('buildServer3Url', () => {
    it('default provider movie route', () => {
        const url = buildServer3Url({ tmdbId: 'tmdb:1441228', mediaType: 'movie' });
        expect(url).toContain('/movie/1441228');
    });

    it('series par chalu season/episode jaata hai', () => {
        const url = buildServer3Url({ tmdbId: 66732, mediaType: 'tv', season: 2, episode: 7 });
        expect(url).toContain('/tv/66732/2/7');
    });

    it('season/episode 0 par 1 (route kabhi tootta nahi)', () => {
        const url = buildServer3Url({ tmdbId: 66732, mediaType: 'tv', season: 0, episode: 0 });
        expect(url).toContain('/tv/66732/1/1');
    });

    it('TMDB id na ho to null — server dikhana hi galat hoga', () => {
        expect(buildServer3Url({ tmdbId: 'imdb-only', mediaType: 'movie' })).toBeNull();
        expect(buildServer3Url({ tmdbId: null, mediaType: 'tv', season: 1, episode: 1 })).toBeNull();
    });

    it('har registry provider apna URL shape deta hai (badalna ek line ka kaam)', () => {
        for (const id of Object.keys(SERVER3_PROVIDERS) as (keyof typeof SERVER3_PROVIDERS)[]) {
            const movie = buildServer3Url({ tmdbId: 1441228, mediaType: 'movie', provider: id });
            const tv = buildServer3Url({ tmdbId: 66732, mediaType: 'tv', season: 1, episode: 2, provider: id });
            expect(movie).toContain('1441228');
            expect(tv).toContain('66732');
            expect(tv).toContain('1/2');
            expect(server3Label(id)).toBe(SERVER3_PROVIDERS[id].label);
        }
    });

    it('default provider registry me maujood hai', () => {
        expect(SERVER3_PROVIDERS[SERVER3_DEFAULT_PROVIDER]).toBeTruthy();
    });
});

describe('source switch (ek pill, agla provider)', () => {
    it('order poora cycle karta hai aur wapas default par aata hai', () => {
        let current = SERVER3_DEFAULT_PROVIDER;
        const seen = [current];
        for (let i = 0; i < SERVER3_ORDER.length - 1; i += 1) {
            current = nextServer3Provider(current);
            seen.push(current);
        }
        expect(seen).toEqual([...SERVER3_ORDER]);
        expect(nextServer3Provider(current)).toBe(SERVER3_DEFAULT_PROVIDER);
    });

    it('chuna hua source yaad rehta hai, bekaar value purani choice nahi bigaadti', () => {
        window.localStorage.clear();
        expect(loadServer3Provider()).toBe(SERVER3_DEFAULT_PROVIDER);
        saveServer3Provider('vidlink');
        expect(loadServer3Provider()).toBe('vidlink');
        saveServer3Provider('nonsense');
        expect(loadServer3Provider()).toBe('vidlink');
    });

    it('har provider ka label unique hai (pill par confusion na ho)', () => {
        const labels = SERVER3_ORDER.map((id) => server3Label(id));
        expect(new Set(labels).size).toBe(labels.length);
    });
});

describe('server cycle me Server 3', () => {
    it('MovieBox ke saath sabse aakhir me aata hai (default nahi)', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: true,
            server3Available: true,
        });
        expect(cycle).toEqual(['nxsha', 'nhd', 'moviebox', 'server3']);
        expect(cycle[0]).toBe('nxsha');
    });

    it('MovieBox na ho to bhi [Server 1 → Server 3] chalta hai', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: false,
            server3Available: true,
        });
        expect(cycle).toEqual(['nxsha', 'server3']);
        expect(hasServerSwitcher(cycle)).toBe(true);
        expect(nextServerIn(cycle, 0)).toBe('server3');
    });

    it('Server 3 available na ho to purana rule (sirf Server 1)', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: false,
            server3Available: false,
        });
        expect(cycle).toEqual(['nxsha']);
        expect(hasServerSwitcher(cycle)).toBe(false);
    });
});

describe('phone detail screen par Server 3 chip', () => {
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
        // Pichle test ka chuna hua source yaad na rahe.
        window.localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('chip dikhta hai aur play par Server 3 ka embed khulta hai', () => {
        act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));

        const chip = document.querySelector('[data-testid="server-3"]') as HTMLElement;
        expect(chip).toBeTruthy();
        expect(chip.textContent).toContain(server3Label());
        // Default Server 3 nahi — Multi (Nxsha) hi selected rehta hai.
        expect(
            (document.querySelector('[data-testid="server-multi"]') as HTMLElement).getAttribute('data-selected'),
        ).toBe('1');

        act(() => chip.click());
        expect(chip.getAttribute('data-selected')).toBe('1');

        act(() => {
            (document.querySelector('[aria-label="Play Irumudi"]') as HTMLElement).click();
        });

        const embed = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
        expect(embed).toBeTruthy();
        expect(embed.getAttribute('data-src')).toContain('1441228');
        expect(embed.getAttribute('data-src')).toBe(
            buildServer3Url({ tmdbId: '1441228', mediaType: 'movie' }),
        );
        expect(embed.getAttribute('data-server')).toContain('Server 3');
    });

    it('tmdb id na ho to Server 3 chip dikhta hi nahi', () => {
        act(() =>
            root.render(<MovieDetailModal movie={{ ...movie, tmdb_id: undefined } as any} onClose={() => {}} />),
        );
        expect(document.querySelector('[data-testid="server-3"]')).toBeNull();
    });
});

describe('VidSync ka safaya', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

    it('lib/vidsync.ts aur uske tests gayab hain', () => {
        expect(fs.existsSync(path.join(process.cwd(), 'lib/vidsync.ts'))).toBe(false);
        expect(fs.existsSync(path.join(process.cwd(), 'tests-arena/vidsync.test.tsx'))).toBe(false);
        expect(fs.existsSync(path.join(process.cwd(), 'tests-arena/vidsync-lines.test.tsx'))).toBe(false);
    });

    it('code me koi vidsync reference nahi bacha', () => {
        for (const file of [
            'app/movie/[id].tsx',
            'components/MovieList/MovieDetailModal.tsx',
            'components/EmbedPlayer.tsx',
            'lib/playbackServers.ts',
        ]) {
            expect(read(file).toLowerCase()).not.toContain('vidsync');
        }
    });

    it('movie page Server 3 ka url banata hai', () => {
        const src = read('app/movie/[id].tsx');
        expect(src).toContain("from '@/lib/server3'");
        expect(src).toContain("if (currentProvider === 'server3')");
        expect(src).toContain('buildServer3Url({');
    });
});
