// @ts-nocheck — jsdom verification for player overlay controls.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});

import { EmbedPlayer } from '../components/EmbedPlayer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const src = 'https://nxsha.space/embed/tv/30984/1/2?server=GbruHindi';

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('EmbedPlayer episode controls', () => {
    it('does not render the previous or next episode overlays for a TV embed', () => {
        act(() => root.render(<EmbedPlayer src={src} title="Test show" />));

        expect(container.querySelector('iframe[data-arena-embed="1"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="episode-navigation"]')).toBeNull();
        expect(container.querySelector('[aria-label="Previous episode"]')).toBeNull();
        expect(container.querySelector('[aria-label="Next episode"]')).toBeNull();
        expect(container.querySelector('[aria-label="Switch player provider"]')).toBeNull();
        expect(container.querySelector('[aria-label="Open in new tab"]')).toBeNull();
    });

    it('keeps the provider player unobstructed after pointer movement', () => {
        act(() => root.render(<EmbedPlayer src={src} title="Test show" />));
        const player = container.querySelector('[data-testid="embed-player"]') as HTMLElement;

        act(() => player.dispatchEvent(new Event('pointermove', { bubbles: true })));

        expect(container.querySelector('[data-testid="episode-navigation"]')).toBeNull();
        expect(container.querySelector('[aria-label="Previous episode"]')).toBeNull();
        expect(container.querySelector('[aria-label="Next episode"]')).toBeNull();
        expect(container.querySelector('[aria-label="Switch player provider"]')).toBeNull();
        expect(container.querySelector('[aria-label="Open in new tab"]')).toBeNull();
    });
});
