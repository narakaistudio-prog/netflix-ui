import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@/contexts/UserContext';
import {
    addComment,
    commentCount,
    deleteComment,
    initialsOf,
    listComments,
    reactionCounts,
    socialErrorMessage,
    timeAgo,
    tintOf,
    toggleReaction,
    voteComment,
    type SocialScope,
    type TitleComment,
} from '@/lib/titleSocial';

/**
 * Netflix phone screen ka **Like / Dislike + Comments** — Crunchyroll jaisa hi.
 * ======================================================================
 * Owner: "crunchyroll mae jaise comment like ye sab ka system hai netflix ke
 * phone ke liyea bhi ye kardo".
 *
 * Crunchyroll page par ye do cheezein hain:
 *   1. player ke neeche like/dislike (counts sabko dikhte hain, vote save hota
 *      hai) — wahi `cr_episode_reactions`.
 *   2. "Comment" pill → right side drawer, list + composer + reply + apne
 *      comment ka delete — wahi `cr_comments`.
 *
 * Yahan dono ek hi jagah, phone ke hisaab se: counts wali patli row title ke
 * neeche, aur comment **bottom sheet** me (desktop drawer ki tarah side me khali
 * jagah nahi hoti). Dono **wahi tables/RPC** use karte hain, isliye Netflix par
 * ki hui like/comment Crunchyroll page par bhi dikhti hai (aur ulta bhi) —
 * do jagah do system rakhna hi galat hota.
 *
 * Niym (owner ke): guest padh sakta hai par likhne par sign-in — isliye guest
 * ko composer ki jagah "Sign in to comment" CTA dikhta hai. Rang Netflix ka
 * (laal `#E50914`, kaala panel), Crunchyroll ka orange yahan nahi.
 */

const RED = '#E50914';
const PANEL = '#141414';
const CARD = '#1c1c1c';
const MUTED = '#a3a3a3';
const MAX_BODY = 1200;

interface TitleCommentsProps {
    scope: SocialScope;
    /** Signed-out user ne like/comment dabaya — app ka sign-in dialog kholo. */
    onRequireSignIn: () => void;
    /** Chhota toast (modal ke andar hi, app ke apne announce se alag). */
    onNotice: (message: string | null) => void;
}

export function TitleComments({ scope, onRequireSignIn, onNotice }: TitleCommentsProps) {
    const { signedIn } = useUser();
    const [counts, setCounts] = useState({ likeCount: 0, dislikeCount: 0, myVote: 0 });
    const [total, setTotal] = useState(0);
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<TitleComment[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sort, setSort] = useState<'top' | 'new'>('top');
    const [draft, setDraft] = useState('');
    const [reply, setReply] = useState<TitleComment | null>(null);
    const [busy, setBusy] = useState(false);

    const scopeKey = `${scope.showKey}:${scope.season}:${scope.episode}`;

    /** Counts + comment badge — panel band ho to bhi taaza rehte hain. */
    const refreshCounters = useCallback(async () => {
        try {
            const [nextCounts, nextTotal] = await Promise.all([
                reactionCounts(scope),
                commentCount(scope),
            ]);
            setCounts(nextCounts);
            setTotal(nextTotal);
        } catch {
            // Offline: purane numbers hi rehne do, screen block na ho.
        }
    }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setCounts({ likeCount: 0, dislikeCount: 0, myVote: 0 });
        setTotal(0);
        void refreshCounters();
    }, [refreshCounters]);

    const load = useCallback(
        async (nextSort: 'top' | 'new' = sort) => {
            setLoading(true);
            setError('');
            try {
                const rows = await listComments(scope, nextSort);
                setItems(rows);
            } catch (err) {
                setItems([]);
                setError(
                    socialErrorMessage(err) === 'SIGN_IN_REQUIRED'
                        ? 'Sign in again to view comments.'
                        : 'Comments could not load. Check your connection and try again.',
                );
            } finally {
                setLoading(false);
            }
        },
        [scopeKey, sort], // eslint-disable-line react-hooks/exhaustive-deps
    );

    useEffect(() => {
        if (!open) return;
        void load(sort);
    }, [open, load, sort]);

    const roots = useMemo(() => {
        // Server flat list deta hai — replies ko parent ke neeche dikhate hain.
        const ids = new Set(items.map((item) => item.id));
        const out: Array<{ comment: TitleComment; reply: boolean }> = [];
        for (const item of items) {
            if (item.parentId && ids.has(item.parentId)) continue;
            out.push({ comment: item, reply: false });
            for (const child of items) {
                if (child.parentId === item.id) out.push({ comment: child, reply: true });
            }
        }
        return out;
    }, [items]);

    const requireAuth = () => {
        onNotice('Sign in to like or comment');
        onRequireSignIn();
    };

    const vote = async (value: 1 | -1) => {
        if (!signedIn) {
            requireAuth();
            return;
        }
        try {
            const next = await toggleReaction(scope, value);
            setCounts(next);
        } catch (err) {
            if (socialErrorMessage(err) === 'SIGN_IN_REQUIRED') requireAuth();
            else onNotice('Your vote was not saved');
        }
    };

    const voteOnComment = async (comment: TitleComment, value: 1 | -1) => {
        if (!signedIn) {
            requireAuth();
            return;
        }
        try {
            // Server khud toggle karta hai (wahi value dobara = vote hat jata
            // hai), isliye yahan 0 bhejne ki zaroorat nahi — 0 par BAD_VOTE aata.
            const next = await voteComment(comment.id, value);
            setItems((prev) =>
                prev.map((item) =>
                    item.id === comment.id
                        ? { ...item, likeCount: next.likeCount, dislikeCount: next.dislikeCount, myVote: next.myVote }
                        : item,
                ),
            );
        } catch (err) {
            if (socialErrorMessage(err) === 'SIGN_IN_REQUIRED') requireAuth();
            else onNotice('Your vote was not saved');
        }
    };

    const post = async () => {
        const body = draft.trim();
        if (busy) return;
        if (!signedIn) {
            requireAuth();
            return;
        }
        if (body.length < 2) {
            onNotice('Comment is too short');
            return;
        }
        if (body.length > MAX_BODY) {
            onNotice(`Keep it under ${MAX_BODY} characters`);
            return;
        }
        setBusy(true);
        try {
            await addComment(scope, body, reply?.id ?? null);
            setDraft('');
            setReply(null);
            await load();
            void refreshCounters();
            onNotice('Comment posted');
        } catch (err) {
            const message = socialErrorMessage(err);
            if (message === 'SIGN_IN_REQUIRED') requireAuth();
            else onNotice(message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (comment: TitleComment) => {
        if (!signedIn) return;
        const confirmed =
            Platform.OS === 'web' && typeof window !== 'undefined'
                ? window.confirm('Delete your comment?')
                : true;
        if (!confirmed) return;
        try {
            await deleteComment(comment.id);
            setItems((prev) => prev.filter((item) => item.id !== comment.id && item.parentId !== comment.id));
            setTotal((value) => Math.max(0, value - 1));
            onNotice('Comment deleted');
        } catch {
            onNotice('Delete failed');
        }
    };

    const closeSheet = () => {
        setOpen(false);
        setReply(null);
    };

    return (
        <View style={styles.root} {...({ dataSet: { netflixSocial: scopeKey } } as any)}>
            <View style={styles.row}>
                <Pressable
                    style={[styles.pill, counts.myVote === 1 && styles.pillOn]}
                    onPress={() => void vote(1)}
                    accessibilityRole="button"
                    accessibilityLabel="Like this title"
                    accessibilityState={{ selected: counts.myVote === 1 }}
                    testID="netflix-like"
                >
                    <Ionicons
                        name={counts.myVote === 1 ? 'thumbs-up' : 'thumbs-up-outline'}
                        size={18}
                        color={counts.myVote === 1 ? '#fff' : MUTED}
                    />
                    <Text style={[styles.pillText, counts.myVote === 1 && styles.pillTextOn]}>
                        {counts.likeCount}
                    </Text>
                </Pressable>

                <Pressable
                    style={[styles.pill, counts.myVote === -1 && styles.pillOn]}
                    onPress={() => void vote(-1)}
                    accessibilityRole="button"
                    accessibilityLabel="Dislike this title"
                    accessibilityState={{ selected: counts.myVote === -1 }}
                    testID="netflix-dislike"
                >
                    <Ionicons
                        name={counts.myVote === -1 ? 'thumbs-down' : 'thumbs-down-outline'}
                        size={18}
                        color={counts.myVote === -1 ? '#fff' : MUTED}
                    />
                    <Text style={[styles.pillText, counts.myVote === -1 && styles.pillTextOn]}>
                        {counts.dislikeCount}
                    </Text>
                </Pressable>

                <Pressable
                    style={[styles.pill, styles.commentPill]}
                    onPress={() => {
                        setOpen(true);
                        void load(sort);
                        void refreshCounters();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Open comments"
                    testID="netflix-comments-open"
                >
                    <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                    <Text style={[styles.pillText, styles.pillTextOn]}>Comment</Text>
                    {total > 0 ? (
                        <View style={styles.badge}>
                            <Text style={styles.badgeText}>{total > 99 ? '99+' : total}</Text>
                        </View>
                    ) : null}
                </Pressable>
            </View>

            <Modal visible={open} transparent animationType="slide" onRequestClose={closeSheet}>
                <View style={styles.sheetBackdrop}>
                    <Pressable
                        style={StyleSheet.absoluteFillObject}
                        onPress={closeSheet}
                        accessibilityLabel="Close comments"
                    />
                    <View style={styles.sheet}>
                        <View style={styles.sheetHead}>
                            <Ionicons name="chatbubble-ellipses" size={20} color={RED} />
                            <Text style={styles.sheetTitle}>Comments</Text>
                            <Text style={styles.sheetCount}>{total ? `(${total})` : ''}</Text>
                            <Pressable
                                onPress={closeSheet}
                                style={styles.sheetClose}
                                accessibilityLabel="Close comments"
                                testID="netflix-comments-close"
                            >
                                <Ionicons name="close" size={22} color={MUTED} />
                            </Pressable>
                        </View>

                        <View style={styles.tabs}>
                            {(['top', 'new'] as const).map((value) => (
                                <Pressable
                                    key={value}
                                    onPress={() => setSort(value)}
                                    style={[styles.tab, sort === value && styles.tabOn]}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: sort === value }}
                                    testID={`netflix-comments-sort-${value}`}
                                >
                                    <Text style={[styles.tabText, sort === value && styles.tabTextOn]}>
                                        {value === 'top' ? 'Top' : 'Newest'}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>

                        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                            {loading ? (
                                <ActivityIndicator color={RED} style={styles.spinner} />
                            ) : error ? (
                                <Text style={styles.empty}>{error}</Text>
                            ) : !items.length ? (
                                <Text style={styles.empty}>
                                    No comments yet.{'\n'}Be the first to comment.
                                </Text>
                            ) : (
                                roots.map(({ comment, reply }) => (
                                    <View
                                        key={comment.id}
                                        style={[styles.comment, reply && styles.commentReply]}
                                    >
                                        <View style={[styles.avatar, { backgroundColor: tintOf(comment.authorName) }]}>
                                            <Text style={styles.avatarText}>
                                                {initialsOf(comment.authorName)}
                                            </Text>
                                        </View>
                                        <View style={styles.commentMain}>
                                            <View style={styles.commentMeta}>
                                                <Text style={styles.commentAuthor} numberOfLines={1}>
                                                    {comment.authorName}
                                                </Text>
                                                <Text style={styles.commentTime}>
                                                    {comment.mine ? 'You · ' : ''}
                                                    {timeAgo(comment.createdAt)}
                                                </Text>
                                            </View>
                                            <Text style={styles.commentBody}>{comment.body}</Text>
                                            <View style={styles.commentActions}>
                                                <Pressable
                                                    style={styles.smallAction}
                                                    onPress={() => void voteOnComment(comment, 1)}
                                                    accessibilityLabel="Like comment"
                                                >
                                                    <Ionicons
                                                        name={comment.myVote === 1 ? 'thumbs-up' : 'thumbs-up-outline'}
                                                        size={15}
                                                        color={comment.myVote === 1 ? RED : MUTED}
                                                    />
                                                    <Text
                                                        style={[
                                                            styles.smallActionText,
                                                            comment.myVote === 1 && styles.smallActionOn,
                                                        ]}
                                                    >
                                                        {comment.likeCount}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    style={styles.smallAction}
                                                    onPress={() => void voteOnComment(comment, -1)}
                                                    accessibilityLabel="Dislike comment"
                                                >
                                                    <Ionicons
                                                        name={comment.myVote === -1 ? 'thumbs-down' : 'thumbs-down-outline'}
                                                        size={15}
                                                        color={comment.myVote === -1 ? RED : MUTED}
                                                    />
                                                    <Text
                                                        style={[
                                                            styles.smallActionText,
                                                            comment.myVote === -1 && styles.smallActionOn,
                                                        ]}
                                                    >
                                                        {comment.dislikeCount}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    style={styles.smallAction}
                                                    onPress={() => {
                                                        if (!signedIn) {
                                                            requireAuth();
                                                            return;
                                                        }
                                                        setReply(comment);
                                                    }}
                                                    accessibilityLabel="Reply to comment"
                                                >
                                                    <Text style={styles.smallActionText}>Reply</Text>
                                                </Pressable>
                                                {comment.mine ? (
                                                    <Pressable
                                                        style={styles.smallAction}
                                                        onPress={() => void remove(comment)}
                                                        accessibilityLabel="Delete your comment"
                                                        testID="netflix-comment-delete"
                                                    >
                                                        <Ionicons name="trash-outline" size={14} color={MUTED} />
                                                        <Text style={styles.smallActionText}>Delete</Text>
                                                    </Pressable>
                                                ) : null}
                                            </View>
                                        </View>
                                    </View>
                                ))
                            )}
                        </ScrollView>

                        {signedIn ? (
                            <View style={styles.composer}>
                                {reply ? (
                                    <View style={styles.replyChip}>
                                        <Text style={styles.replyText} numberOfLines={1}>
                                            Replying to {reply.authorName}
                                        </Text>
                                        <Pressable onPress={() => setReply(null)} accessibilityLabel="Cancel reply">
                                            <Ionicons name="close" size={16} color={MUTED} />
                                        </Pressable>
                                    </View>
                                ) : null}
                                <View style={styles.composerRow}>
                                    <TextInput
                                        value={draft}
                                        onChangeText={setDraft}
                                        placeholder={reply ? `Reply to ${reply.authorName}…` : 'Add a comment...'}
                                        placeholderTextColor="#7a7a7a"
                                        style={styles.input}
                                        multiline
                                        maxLength={MAX_BODY}
                                        testID="netflix-comment-input"
                                    />
                                    <Pressable
                                        onPress={() => void post()}
                                        disabled={busy || draft.trim().length < 2}
                                        style={[
                                            styles.post,
                                            (busy || draft.trim().length < 2) && styles.postOff,
                                        ]}
                                        accessibilityRole="button"
                                        accessibilityLabel="Post comment"
                                        testID="netflix-comment-post"
                                    >
                                        {busy ? (
                                            <ActivityIndicator color="#fff" size="small" />
                                        ) : (
                                            <Text style={styles.postText}>Post</Text>
                                        )}
                                    </Pressable>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.guest}>
                                <Text style={styles.guestTitle}>Sign in to comment</Text>
                                <Text style={styles.guestText}>
                                    Your name shows next to what you post.
                                </Text>
                                <Pressable
                                    style={styles.guestButton}
                                    onPress={onRequireSignIn}
                                    accessibilityRole="button"
                                    testID="netflix-comment-signin"
                                >
                                    <Text style={styles.guestButtonText}>Sign in</Text>
                                </Pressable>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { marginTop: 22 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: '#1f1f1f',
        borderWidth: 1,
        borderColor: '#2e2e2e',
    },
    pillOn: { backgroundColor: 'rgba(229,9,20,0.16)', borderColor: RED },
    pillText: { color: MUTED, fontSize: 13, fontWeight: '800' },
    pillTextOn: { color: '#fff' },
    commentPill: { backgroundColor: 'rgba(229,9,20,0.14)', borderColor: 'rgba(229,9,20,0.55)' },
    badge: {
        minWidth: 22,
        height: 22,
        paddingHorizontal: 6,
        borderRadius: 999,
        backgroundColor: RED,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: PANEL,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        maxHeight: '86%',
        minHeight: '58%',
        borderTopWidth: 3,
        borderTopColor: RED,
    },
    sheetHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 10,
    },
    sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
    sheetCount: { color: MUTED, fontSize: 13, fontWeight: '700' },
    sheetClose: { marginLeft: 'auto', padding: 6 },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingBottom: 10 },
    tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#1f1f1f' },
    tabOn: { backgroundColor: 'rgba(229,9,20,0.2)' },
    tabText: { color: MUTED, fontSize: 12, fontWeight: '800' },
    tabTextOn: { color: '#fff' },
    list: { flexGrow: 0 },
    listContent: { paddingHorizontal: 16, paddingBottom: 14 },
    spinner: { marginVertical: 26 },
    empty: { color: MUTED, fontSize: 14, lineHeight: 21, paddingVertical: 24, textAlign: 'center' },
    comment: { flexDirection: 'row', gap: 10, paddingVertical: 11 },
    commentReply: { marginLeft: 34 },
    avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#fff', fontSize: 12, fontWeight: '900' },
    commentMain: { flex: 1 },
    commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    commentAuthor: { color: '#fff', fontSize: 13, fontWeight: '800', flexShrink: 1 },
    commentTime: { color: '#7f7f7f', fontSize: 11 },
    commentBody: { color: '#cfcfcf', fontSize: 14, lineHeight: 20, marginTop: 4 },
    commentActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 7 },
    smallAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    smallActionText: { color: MUTED, fontSize: 12, fontWeight: '700' },
    smallActionOn: { color: RED },
    composer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#2c2c2c',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 16,
        backgroundColor: PANEL,
    },
    replyChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
        backgroundColor: CARD,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    replyText: { color: MUTED, fontSize: 12, flexShrink: 1 },
    composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    input: {
        flex: 1,
        minHeight: 44,
        maxHeight: 110,
        borderRadius: 10,
        backgroundColor: CARD,
        color: '#fff',
        fontSize: 14,
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderWidth: 1,
        borderColor: '#303030',
    },
    post: {
        paddingHorizontal: 18,
        height: 44,
        borderRadius: 10,
        backgroundColor: RED,
        alignItems: 'center',
        justifyContent: 'center',
    },
    postOff: { opacity: 0.45 },
    postText: { color: '#fff', fontSize: 14, fontWeight: '900' },
    guest: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#2c2c2c',
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 20,
        alignItems: 'center',
    },
    guestTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
    guestText: { color: MUTED, fontSize: 12.5, marginTop: 4, textAlign: 'center' },
    guestButton: {
        marginTop: 12,
        backgroundColor: RED,
        borderRadius: 8,
        paddingHorizontal: 26,
        paddingVertical: 10,
    },
    guestButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});

export default TitleComments;
