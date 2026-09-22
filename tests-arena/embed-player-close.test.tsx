// @ts-nocheck — jest-only verification harness (jsdom), not part of the app build.
/**
 * Arena verification test: does closing/unmounting the embed player
 * actually destroy the playing iframe (i.e. stop the audio)?
 *
 * Runs on the WEB preset (react-native -> react-native-web) with a real
 * jsdom document, so the imperative iframe behaviour is observable.
 */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return {
        Ionicons: (props: any) => ReactLocal.createElement('i', props),
    };
});

import { EmbedPlayer } from '../components/EmbedPlayer';

// expo-av / expo-image and friends are not needed by EmbedPlayer, but
// transitive icon imports must resolve; jest-expo/web handles expo modules.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

const liveIframes = (needle: string) =>
    Array.from(document.querySelectorAll('iframe')).filter((f) =>
        (f as HTMLIFrameElement).src.includes(needle),
    );

describe('EmbedPlayer close behaviour', () => {
    it('kills the iframe when the X (close) button is pressed', () => {
        const onClose = jest.fn();
        act(() => {
            root.render(
                <EmbedPlayer
                    src="https://example.com/embed/movie/123"
                    title="Test Movie"
                    onClose={onClose}
                />,
            );
        });

        expect(liveIframes('example.com').length).toBe(1);

        const closeBtn = container.querySelector('[aria-label="Close player"]') as HTMLElement;
        expect(closeBtn).toBeTruthy();
        act(() => {
            closeBtn.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true }),
            );
        });

        expect(onClose).toHaveBeenCalled();
        // Immediately after the press, the playing iframe must be gone
        // (or at least navigated away) — no audio can survive this.
        expect(liveIframes('example.com').length).toBe(0);
    });

    it('kills the iframe on plain unmount (navigation away)', () => {
        act(() => {
            root.render(
                <EmbedPlayer src="https://example.com/embed/tv/9/1/2" title="Test Show" />,
            );
        });
        expect(liveIframes('example.com').length).toBe(1);

        act(() => {
            root.unmount();
        });
        expect(liveIframes('example.com').length).toBe(0);
    });
});
