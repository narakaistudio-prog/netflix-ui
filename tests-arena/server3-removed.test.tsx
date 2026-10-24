// @ts-nocheck — Server 3 hata diya gaya (popups + kuch bhi theek se nahi chala).
/**
 * Owner (24 Oct): *"server 3 hta de yaar koi sahi se nhi chalta … jo pop up na
 * deta ho"*.
 *
 * Do cheezein hamesha sach rehni chahiye:
 *   1. Cycle me **server3 jaisa koi server nahi** — sirf wo servers jo chalte
 *      hain (Nxsha / NHD / custom / MovieBox).
 *   2. Har third-party iframe **sandboxed** hai (popups + top-redirect band).
 *      Pichhle patch ne Server 3 ke liye sandbox band kiya tha — wahi popups
 *      ki wajah bani, isliye wo exception dobara nahi aana chahiye.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const ReactLocal = require('react');
    return { Ionicons: (props: any) => ReactLocal.createElement('i', props) };
});

import { EmbedPlayer } from '../components/EmbedPlayer';
import { buildServerCycle, BUILTIN_SERVERS } from '../lib/playbackServers';

const ROOT = path.resolve(__dirname, '..');

describe('Server 3 poora gaya', () => {
    it('lib/server3.ts aur uske docs/scripts maujood nahi', () => {
        ['lib/server3.ts', 'docs/server3.md', 'scripts/probe-server3.mjs', 'scripts/probe-server3-playback.mjs'].forEach(
            (relative) => {
                expect(fs.existsSync(path.join(ROOT, relative))).toBe(false);
            },
        );
    });

    it('app/components/lib me "server3" ka koi reference nahi', () => {
        const offenders: string[] = [];
        const walk = (dir: string) => {
            fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    return;
                }
                if (!/\.(ts|tsx)$/.test(entry.name)) return;
                const text = fs.readFileSync(full, 'utf8');
                if (/server3|server-3|Server 3/.test(text)) offenders.push(path.relative(ROOT, full));
            });
        };
        ['app', 'components', 'lib'].forEach((dir) => walk(path.join(ROOT, dir)));
        expect(offenders).toEqual([]);
    });

    it('cycle me server3 kabhi nahi — MovieBox na ho to sirf Server 1', () => {
        const withoutMoviebox = buildServerCycle({ defaultProvider: 'nxsha', movieboxAvailable: false });
        expect(withoutMoviebox).toEqual(['nxsha']);

        const full = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: true,
            customAvailable: true,
            providers: BUILTIN_SERVERS,
        });
        expect(full.some((id) => String(id).includes('server3'))).toBe(false);
        // M2Box copy (`moviebox2`) ab MovieBox ke turant baad aata hai — wo
        // asli MovieBox backend ka doosra domain hai, dead slot nahi.
        expect(full).toEqual(['nxsha', 'nhd', 'custom', 'moviebox', 'moviebox2']);
    });
});

describe('Sandbox exception dobara na aaye', () => {
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

    it.each([
        'https://nxsha.space/embed/movie/550',
        'https://nhdapi.com/embed/movie/550',
        // Purane Server 3 wale hosts: agar kabhi koi row me aa jaye, tab bhi
        // sandbox lagega hi — popups ka rasta band.
        'https://player.videasy.net/movie/550',
        'https://vidfast.pro/movie/550',
        'https://vidlink.pro/movie/550',
        'https://mycineby.cc/embed/movie/550',
        'https://vaplayer.ru/embed/movie/550',
    ])('%s sandboxed hai (popups band)', (src) => {
        act(() => root.render(<EmbedPlayer src={src} title="Test" />));
        const iframe = container.querySelector('iframe[data-arena-embed="1"]');
        expect(iframe).toBeTruthy();
        const sandbox = iframe.getAttribute('sandbox') || '';
        expect(sandbox).toContain('allow-scripts');
        expect(sandbox).toContain('allow-same-origin');
        expect(sandbox).not.toContain('allow-popups');
        expect(sandbox).not.toContain('allow-top-navigation');
    });
});
