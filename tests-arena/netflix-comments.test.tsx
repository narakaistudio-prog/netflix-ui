// @ts-nocheck — jsdom test: Netflix phone screen ka like/dislike + comments
// (Crunchyroll page wala hi Supabase system — lib/titleSocial.ts).
/**
 * Owner: "crunchyroll mae jaise comment like ye sab ka system hai netflix ke
 * phone ke liyea bhi ye kardo".
 *
 * Yahan do cheezein check hoti hain:
 *   1. RPC calls **bilkul wahi** jaate hain jo Crunchyroll page bhejta hai
 *      (naam, params, apikey/authorization header) — warna dono jagah ka data
 *      alag ho jata.
 *   2. Phone screen me section asli me laga hua hai, aur dead ±10s buttons
 *      hata diye gaye hain (owner: "agar button chalta hi nhi hai ... hta de").
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('@expo/vector-icons', () => {
    const R = require('react');
    const icon = (props: any) => R.createElement('i', props);
    return { Ionicons: icon, MaterialCommunityIcons: icon };
});

jest.mock('@/contexts/UserContext', () => {
    // TitleComments provider ke bahar bhi render hota hai (tests) — wahi guest
    // context dono hooks se milta hai.
    const guest = () => ({
        signedIn: mockSignedIn,
        account: null,
        signInOpen: false,
        openSignIn: jest.fn(),
        closeSignIn: jest.fn(),
        signIn: jest.fn(),
        signUp: jest.fn(),
        signOut: jest.fn(),
        selectedProfile: null,
    });
    return { useUser: guest, useOptionalUser: guest };
});

let mockSignedIn = false;

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('lib/titleSocial — scope aur mapping', () => {
    const {
        scopeFor,
        mapCommentRow,
        mapReactionRow,
        timeAgo,
        initialsOf,
        socialErrorMessage,
    } = require('@/lib/titleSocial');

    it('movie = S1E1, series = chalu episode (Crunchyroll page ka hi scope)', () => {
        expect(scopeFor({ id: 'tmdb:1465943', mediaType: 'movie' }, 4, 7)).toEqual({
            showKey: 'tmdb:1465943',
            season: 1,
            episode: 1,
        });
        expect(scopeFor({ id: 'tmdb:1', mediaType: 'tv' }, 2, 6)).toEqual({
            showKey: 'tmdb:1',
            season: 2,
            episode: 6,
        });
        // Khaali/zero values 1 par clamp (server bhi greatest(...,1) karta hai).
        expect(scopeFor({ id: 'x', mediaType: 'tv' }, 0, 0)).toEqual({ showKey: 'x', season: 1, episode: 1 });
    });

    it('server ke snake_case row screen shape me aate hain', () => {
        expect(
            mapCommentRow({
                id: 'a1',
                parent_id: null,
                author_name: 'Ravi',
                body: 'Mast tha',
                created_at: '2026-10-24T08:00:00Z',
                like_count: 3,
                dislike_count: 1,
                my_vote: 1,
                mine: true,
            }),
        ).toEqual({
            id: 'a1',
            parentId: null,
            authorName: 'Ravi',
            body: 'Mast tha',
            createdAt: '2026-10-24T08:00:00Z',
            likeCount: 3,
            dislikeCount: 1,
            myVote: 1,
            mine: true,
        });
        expect(mapReactionRow([{ like_count: 5, dislike_count: 2, my_vote: -1 }])).toEqual({
            likeCount: 5,
            dislikeCount: 2,
            myVote: -1,
        });
        expect(mapReactionRow(null)).toEqual({ likeCount: 0, dislikeCount: 0, myVote: 0 });
    });

    it('time/initials/error — chhote helpers sach bolte hain', () => {
        const now = Date.parse('2026-10-24T10:00:00Z');
        expect(timeAgo('2026-10-24T09:59:30Z', now)).toBe('30s ago');
        expect(timeAgo('2026-10-24T08:00:00Z', now)).toBe('2h ago');
        expect(timeAgo('2026-10-21T10:00:00Z', now)).toBe('3d ago');
        expect(timeAgo('', now)).toBe('just now');
        expect(initialsOf('Anime Fan')).toBe('AF');
        expect(initialsOf('')).toBe('?');
        expect(socialErrorMessage(new Error('SIGN_IN_REQUIRED'))).toBe('SIGN_IN_REQUIRED');
        expect(socialErrorMessage(new Error('COMMENT_TOO_SHORT'))).toBe('Comment is too short.');
        expect(socialErrorMessage(new Error('permission denied'))).toBe('permission denied');
    });
});

describe('lib/titleSocial — RPC calls (Crunchyroll ke hi functions)', () => {
    const { listComments, addComment, toggleReaction, reactionCounts, voteComment } = require('@/lib/titleSocial');
    const { SUPABASE_ANON_KEY, SUPABASE_URL } = require('@/lib/account');

    function mockFetch(payload: any) {
        const calls: Array<{ url: string; init: any }> = [];
        const impl = async (url: string, init: any) => {
            calls.push({ url: String(url), init });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(payload),
            } as any;
        };
        return { impl: impl as unknown as typeof fetch, calls };
    }

    const scope = { showKey: 'tmdb:1465943', season: 1, episode: 1 };

    it('comments list — cr_list_comments + apikey/authorization', async () => {
        const { impl, calls } = mockFetch([
            { id: 'c1', author_name: 'Ravi', body: 'hi', like_count: 2, my_vote: 1, mine: false },
        ]);
        const rows = await listComments(scope, 'top', { fetchImpl: impl });
        expect(rows[0]).toMatchObject({ id: 'c1', authorName: 'Ravi', likeCount: 2, myVote: 1 });
        expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/rpc/cr_list_comments`);
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.headers.apikey).toBe(SUPABASE_ANON_KEY);
        expect(String(calls[0].init.headers.Authorization)).toMatch(/^Bearer /);
        expect(JSON.parse(calls[0].init.body)).toEqual({
            p_show_key: 'tmdb:1465943',
            p_season: 1,
            p_episode: 1,
            p_sort: 'top',
        });
    });

    it('comment post — cr_add_comment me parent bhi jaata hai (reply)', async () => {
        const { impl, calls } = mockFetch({ id: 'new' });
        await addComment(scope, 'Mast episode tha', 'parent-1', { fetchImpl: impl });
        expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/rpc/cr_add_comment`);
        expect(JSON.parse(calls[0].init.body)).toEqual({
            p_show_key: 'tmdb:1465943',
            p_season: 1,
            p_episode: 1,
            p_body: 'Mast episode tha',
            p_parent: 'parent-1',
        });
    });

    it('like/dislike — cr_reaction_counts aur cr_toggle_reaction', async () => {
        const { impl, calls } = mockFetch([{ like_count: 7, dislike_count: 1, my_vote: 1 }]);
        const counts = await reactionCounts(scope, { fetchImpl: impl });
        expect(counts).toEqual({ likeCount: 7, dislikeCount: 1, myVote: 1 });
        expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/rpc/cr_reaction_counts`);

        const toggled = await toggleReaction(scope, -1, { fetchImpl: impl });
        expect(toggled).toEqual({ likeCount: 7, dislikeCount: 1, myVote: 1 });
        expect(calls[1].url).toBe(`${SUPABASE_URL}/rest/v1/rpc/cr_toggle_reaction`);
        expect(JSON.parse(calls[1].init.body)).toEqual({
            p_show_key: 'tmdb:1465943',
            p_season: 1,
            p_episode: 1,
            p_value: -1,
        });
    });

    it('comment vote — cr_vote_comment (0 nahi bhejte: server khud toggle karta hai)', async () => {
        const { impl, calls } = mockFetch([{ like_count: 1, dislike_count: 0, my_vote: 1 }]);
        const row = await voteComment('c1', 1, { fetchImpl: impl });
        expect(row).toEqual({ likeCount: 1, dislikeCount: 0, myVote: 1 });
        expect(JSON.parse(calls[0].init.body)).toEqual({ p_comment_id: 'c1', p_value: 1 });
    });
});

describe('TitleComments component (phone)', () => {
    const { TitleComments } = require('@/components/TitleComments');
    let container: HTMLDivElement;
    let root: any;

    beforeEach(() => {
        mockSignedIn = false;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        (global as any).fetch = async () =>
            ({ ok: true, status: 200, text: async () => '0' }) as any;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.body.innerHTML = '';
    });

    it('like/dislike/comment pills dikhte hain, guest ko sign-in par bhejta hai', async () => {
        const requireSignIn = jest.fn();
        await act(async () => {
            root.render(
                <TitleComments
                    scope={{ showKey: 'tmdb:1465943', season: 1, episode: 1 }}
                    onRequireSignIn={requireSignIn}
                    onNotice={() => {}}
                />,
            );
        });
        const like = document.querySelector('[data-testid="netflix-like"]') as HTMLElement;
        const comment = document.querySelector('[data-testid="netflix-comments-open"]') as HTMLElement;
        expect(like).toBeTruthy();
        expect(comment).toBeTruthy();
        expect(document.querySelector('[data-testid="netflix-dislike"]')).toBeTruthy();

        await act(async () => {
            like.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(requireSignIn).toHaveBeenCalled();
    });

    it('comment sheet khulta hai aur guest ko composer nahi, sign-in CTA milta hai', async () => {
        await act(async () => {
            root.render(
                <TitleComments
                    scope={{ showKey: 'tmdb:1465943', season: 1, episode: 1 }}
                    onRequireSignIn={() => {}}
                    onNotice={() => {}}
                />,
            );
        });
        await act(async () => {
            (document.querySelector('[data-testid="netflix-comments-open"]') as HTMLElement).dispatchEvent(
                new MouseEvent('click', { bubbles: true }),
            );
        });
        expect(document.querySelector('[data-testid="netflix-comments-close"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="netflix-comment-signin"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="netflix-comment-input"]')).toBeNull();
    });
});

describe('phone screen me wiring (source)', () => {
    it('detail screen par like/comment section laga hua hai', () => {
        const modal = read('components/MovieList/MovieDetailModal.tsx');
        expect(modal).toContain("import { TitleComments } from '@/components/TitleComments'");
        expect(modal).toContain('<TitleComments');
        expect(modal).toContain('scopeFor(');
        // Sign-in modal wahi chalega jo app me hai — comments se scope shared.
        expect(modal).toContain('openSignIn');
    });

    it('dead ±10s buttons hata diye gaye hain (owner: "hta de usse")', () => {
        const modal = read('components/MovieList/MovieDetailModal.tsx');
        expect(modal).not.toContain('phone-skip-back');
        expect(modal).not.toContain('phone-skip-forward');
        expect(modal).not.toContain('phoneSkip');
        expect(modal).not.toContain('seekMovieboxBy');
        // Invisible double-tap player ke andar hai — wahan asli seek hota hai.
        const player = read('components/MovieboxDirectPlayer.tsx');
        expect(player).toContain('registerMovieboxSeek');
    });
});
