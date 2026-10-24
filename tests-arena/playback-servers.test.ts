// @ts-nocheck — pure server-cycle rules (owner ka Server 2 rule).
/**
 * Rule: jis title ka MovieBox link nahi, us par sirf Server 1 (Nxsha) —
 * na M2Box entry, na switch ka option (cycle length 1 = pill nahi).
 */
import {
    buildServerCycle,
    hasServerSwitcher,
    nextServerIn,
    BUILTIN_SERVERS,
} from '../lib/playbackServers';

describe('buildServerCycle — MovieBox available', () => {
    it('offers every server, M2Box last (Server 1 default)', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: true,
            customAvailable: true,
            providers: BUILTIN_SERVERS,
        });
        // `moviebox2` = usi MovieBox backend ka doosra domain (owner: "moviebox
        // ka copy dhundo") — MovieBox ke turant baad.
        expect(cycle).toEqual(['nxsha', 'nhd', 'custom', 'moviebox', 'moviebox2']);
        expect(hasServerSwitcher(cycle)).toBe(true);
        expect(nextServerIn(cycle, 0)).toBe('nhd');
    });

    it('puts M2Box first when the row itself is a m2box link', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: true,
            rowIsMoviebox: true,
        });
        expect(cycle[0]).toBe('moviebox');
        expect(cycle).toContain('nxsha');
    });

    it('respects a NHD default', () => {
        const cycle = buildServerCycle({ defaultProvider: 'nhd', movieboxAvailable: true });
        expect(cycle[0]).toBe('nhd');
        expect(cycle).toContain('moviebox');
    });
});

describe('buildServerCycle — MovieBox missing', () => {
    it('keeps only Server 1 and hides every switch option', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: false,
            customAvailable: true,
            providers: BUILTIN_SERVERS,
        });
        expect(cycle).toEqual(['nxsha']);
        expect(hasServerSwitcher(cycle)).toBe(false);
        expect(nextServerIn(cycle, 0)).toBeNull();
        expect(cycle).not.toContain('moviebox');
        expect(cycle).not.toContain('nhd');
        expect(cycle).not.toContain('custom');
    });

    it('falls back to Nxsha if the saved default was MovieBox', () => {
        const cycle = buildServerCycle({ defaultProvider: 'moviebox', movieboxAvailable: false });
        expect(cycle).toEqual(['nxsha']);
    });

    it('keeps Nxsha even for a row that used to point at M2Box', () => {
        const cycle = buildServerCycle({
            defaultProvider: 'nxsha',
            movieboxAvailable: false,
            rowIsMoviebox: true,
        });
        expect(cycle).toEqual(['nxsha']);
    });
});
