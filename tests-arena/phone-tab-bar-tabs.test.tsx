// @ts-nocheck — jsdom test: the phone bottom tab bar carries every
// section (K-Dramas included) and follows the user into Crunchyroll,
// so Android phones always have a way back to Netflix.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

let mockPath = '/';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => mockPath,
    Stack: { Screen: () => null },
}));
jest.mock('@/contexts/UserContext', () => ({
    useUser: () => ({ selectedProfile: { id: 'p1', name: 'Phone' } }),
}));
jest.mock('@/icons/Crunchyroll', () => {
    const ReactLocal = require('react');
    return {
        CrunchyrollIcon: () => ReactLocal.createElement('span', null, 'CR'),
    };
});
jest.mock('@/lib/layout', () => {
    const actual = jest.requireActual('@/lib/layout');
    return { ...actual, isPhoneWidth: () => true };
});

import { PhoneTabBar } from '@/components/PhoneTabBar';

const renderBar = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
        createRoot(host).render(React.createElement(PhoneTabBar));
    });
    return host;
};

const tabLabels = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[role="button"]')).map(
        (tab) => tab.getAttribute('aria-label'),
    );

test('the phone bottom bar lists every section, K-Dramas included', () => {
    mockPath = '/';
    const host = renderBar();
    expect(tabLabels(host)).toEqual([
        'Home',
        'TV Shows',
        'Movies',
        'Anime',
        'K-Dramas',
        'My List',
        'Crunchyroll',
    ]);
});

test('the bottom bar stays on the Crunchyroll page too', () => {
    mockPath = '/crunchyroll';
    const host = renderBar();
    expect(tabLabels(host)).toContain('Home');
    expect(tabLabels(host)).toContain('K-Dramas');
    expect(tabLabels(host)).toContain('Crunchyroll');
});

test('the bottom bar stays off full-screen detail routes', () => {
    mockPath = '/movie/netflix-genre-1';
    const host = renderBar();
    expect(tabLabels(host)).toEqual([]);
});
