// @ts-nocheck — hook: "is title ka MovieBox link hai?" (Server 2 ka gate).
/**
 * MovieBox ka option sirf tab dikhna chahiye jab link sach me mile. Ye test
 * hook ke teen states pin karta hai: known (turant yes), resolve → yes,
 * resolve → no (aur dobara network nahi).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { useMovieboxAvailable } from '../hooks/useMovieboxAvailable';
import { __resetMovieboxResolveCache } from '../lib/movieboxResolve';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

const URL_OK =
    'https://m2box.org/movies/vishwanath-and-sons-AbC123?id=4151920426815471968&type=/movie/detail&detailSe=&detailEp=&lang=en';

const TITLE = { id: 'netflix-genre-1', tmdb_id: '1408162', title: 'Vishwanath & Sons', year: '2026', mediaType: 'movie' };

function Probe({ title = TITLE, known = false, onResolved }: any) {
    const { available, checking } = useMovieboxAvailable(title, { known, onResolved });
    return (
        <div data-testid="probe">{checking ? 'checking' : available ? 'yes' : 'no'}</div>
    );
}

let container: HTMLDivElement;
let root: any;

const state = () => container.querySelector('[data-testid="probe"]')!.textContent;

function mockFetch(payload: any) {
    const fn = jest.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
    (globalThis as any).fetch = fn;
    return fn;
}

beforeEach(() => {
    __resetMovieboxResolveCache();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('useMovieboxAvailable', () => {
    it('trusts a known link without hitting the network', () => {
        const fetchMock = mockFetch({ found: false });
        act(() => root.render(<Probe known />));
        expect(state()).toBe('yes');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('checks live and reports yes when MovieBox has the title', async () => {
        mockFetch({ found: true, url: URL_OK, subjectId: '4151920426815471968', detailPath: 'vishwanath-and-sons-AbC123' });
        const onResolved = jest.fn();
        await act(async () => {
            root.render(<Probe onResolved={onResolved} />);
        });
        expect(state()).toBe('yes');
        expect(onResolved).toHaveBeenCalledTimes(1);
    });

    it('reports no for titles MovieBox does not have', async () => {
        const fetchMock = mockFetch({ found: false, reason: 'no-match' });
        await act(async () => {
            root.render(<Probe />);
        });
        expect(state()).toBe('no');
        // miss 6 ghante cache rehti hai — dobara network nahi
        await act(async () => {
            root.unmount();
        });
        root = createRoot(container);
        await act(async () => {
            root.render(<Probe />);
        });
        expect(state()).toBe('no');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never claims available when the request fails', async () => {
        (globalThis as any).fetch = jest.fn(async () => {
            throw new Error('offline');
        });
        await act(async () => {
            root.render(<Probe title={{ ...TITLE, tmdb_id: '42' }} />);
        });
        expect(state()).toBe('no');
    });
});
