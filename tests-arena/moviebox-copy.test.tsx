// @ts-nocheck — "MovieBox ka copy" = usi backend ka doosra domain (m2box.co).
/**
 * Owner (24 Oct): *"koi aacha server moviebox ka copy dhundo"*.
 *
 * Copy ka matlab naya brand nahi — **wahi MovieBox site/backend, doosra
 * domain**. Probe (GitHub runner, 24 Oct) se ye domains zinda mile:
 * m2box.org · m2box.co · movieboxonline.net · netnaija.film ·
 * officialmoviebox.com · moviebox.ke — sab par BFF `x-user` token aata hai.
 *
 * Yahan jo test hota hai:
 *   1. Page URL kisi bhi domain par bane (`site` override).
 *   2. Cycle me M2Box copy sirf tab jab MovieBox link mile.
 *   3. Phone detail screen par "Hindi 2" chip → player ko copy ka site milta hai.
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
jest.mock('@/components/MovieboxPagePlayer', () => {
    const ReactLocal = require('react');
    return {
        MovieboxPagePlayer: ({ site }: any) =>
            ReactLocal.createElement('div', {
                'data-testid': 'moviebox-player',
                'data-site': site || '',
            }),
    };
});
jest.mock('@/components/EmbedPlayer', () => {
    const ReactLocal = require('react');
    return {
        EmbedPlayer: ({ src }: any) =>
            ReactLocal.createElement('div', { 'data-testid': 'embed-player', 'data-src': src }),
    };
});

import { MovieDetailModal } from '../components/MovieList/MovieDetailModal';
import { buildMovieboxPageUrl, MOVIEBOX_COPY_SITE, MOVIEBOX_SITE } from '../lib/moviebox';
import { buildServerCycle } from '../lib/playbackServers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LINK = 'https://m2box.org/movies/mandaadi-hindi-qxUx1r3QHW4?id=4151920426815471968&type=/movie/detail';

const movie = {
    id: 'moviebox-copy-mandaadi',
    tmdb_id: '1465943',
    embed_provider: 'nxsha',
    title: 'Mandaadi',
    imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    year: '2026',
    duration: '2h 12m',
    description: 'Test title.',
    cast: [],
    genres: ['Drama'],
};

describe('buildMovieboxPageUrl — site override', () => {
    it('default m2box.org, copy par wahi page m2box.co par', () => {
        const canonical = buildMovieboxPageUrl(LINK);
        expect(canonical).toContain(`${MOVIEBOX_SITE}/movies/`);
        expect(canonical).toContain('id=4151920426815471968');

        const copy = buildMovieboxPageUrl(LINK, { site: MOVIEBOX_COPY_SITE });
        expect(copy).toContain(`${MOVIEBOX_COPY_SITE}/movies/`);
        // Wahi detailPath + subjectId — sirf domain badla.
        expect(copy.split('?')[0]).toBe(
            canonical.split('?')[0].replace(MOVIEBOX_SITE, MOVIEBOX_COPY_SITE),
        );
    });

    it('episode override copy par bhi lagta hai', () => {
        const copy = buildMovieboxPageUrl(LINK, { site: MOVIEBOX_COPY_SITE, se: 2, ep: 5 });
        expect(copy).toContain('detailSe=2');
        expect(copy).toContain('detailEp=5');
    });
});

describe('Server cycle — M2Box copy', () => {
    it('MovieBox link mile to copy MovieBox ke turant baad aata hai', () => {
        const cycle = buildServerCycle({ defaultProvider: 'nxsha', movieboxAvailable: true });
        expect(cycle).toContain('moviebox');
        expect(cycle).toContain('moviebox2');
        expect(cycle.indexOf('moviebox2')).toBe(cycle.indexOf('moviebox') + 1);
    });

    it('link na ho to copy ka koi dead slot nahi', () => {
        const cycle = buildServerCycle({ defaultProvider: 'nxsha', movieboxAvailable: false });
        expect(cycle).toEqual(['nxsha']);
        expect(cycle).not.toContain('moviebox2');
    });
});

describe('Phone detail screen — "Hindi 2" chip', () => {
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

    const playButton = () => document.querySelector('[aria-label="Play Mandaadi"]') as HTMLElement;

    it('chip dikhta hai aur usse copy player (m2box.co) khulta hai', () => {
        act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));

        const chip = document.querySelector('[data-testid="server-hindi-2"]') as HTMLElement;
        expect(chip).toBeTruthy();
        expect(chip.textContent).toContain('Hindi 2');

        act(() => chip.click());
        act(() => playButton().click());

        const player = document.querySelector('[data-testid="moviebox-player"]') as HTMLElement;
        expect(player).toBeTruthy();
        expect(player.getAttribute('data-site')).toBe(MOVIEBOX_COPY_SITE);
        expect(document.querySelector('[data-testid="embed-player"]')).toBeNull();
    });

    it('default "Hindi" (asli MovieBox) par site override nahi hota', () => {
        act(() => root.render(<MovieDetailModal movie={movie as any} onClose={() => {}} />));
        act(() => playButton().click());

        const player = document.querySelector('[data-testid="moviebox-player"]') as HTMLElement;
        expect(player.getAttribute('data-site')).toBe('');
    });
});
