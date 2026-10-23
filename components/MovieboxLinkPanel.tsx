import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isMovieboxUrl, MOVIEBOX_SITE, parseMovieboxInput } from '@/lib/moviebox';
import {
    describeMovieboxLink,
    listMovieboxLinks,
    type MovieboxSavedLink,
} from '@/lib/movieboxLinks';

/**
 * M2Box link paste karne wala panel.
 *
 * MovieBox ka koi `?id=` embed nahi hota, isliye ek baar uska watch-page link
 * chahiye. Panel wahi maangta hai (aur bata deta hai ki link kahan se milega),
 * phir wahi link is browser me title ke saath yaad rakh liya jata hai —
 * dobara paste nahi karna padta.
 */

interface MovieboxLinkPanelProps {
    title?: string;
    /** Pehle se chuna hua link (edit karte waqt input me dikhta hai). */
    initialLink?: string | null;
    /** Pehle se proxy mode on tha? */
    initialProxy?: boolean;
    /** Chhoti list dikhani hai (standalone /moviebox page). */
    showSaved?: boolean;
    /** Upar dikhne wala note (auto-resolve fail hone par). */
    notice?: string;
    onPlay: (link: string, opts: { proxy: boolean }) => void;
    /** Server 1 par wapas jane ka rasta (player ke andar dikhta hai). */
    onBack?: () => void;
    backLabel?: string;
    /** Standalone page: saved list se link chunne par seedha play. */
    onPickSaved?: (key: string, entry: MovieboxSavedLink) => void;
}

export function MovieboxLinkPanel({
    title,
    initialLink,
    initialProxy = false,
    showSaved = false,
    notice,
    onPlay,
    onBack,
    backLabel,
    onPickSaved,
}: MovieboxLinkPanelProps) {
    const [value, setValue] = useState(initialLink ?? '');
    const [proxy, setProxy] = useState(initialProxy);
    const [error, setError] = useState<string | null>(null);

    const saved = useMemo(() => (showSaved ? listMovieboxLinks() : []), [showSaved]);

    const openSite = () => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            try {
                window.open(MOVIEBOX_SITE, '_blank', 'noopener,noreferrer');
            } catch {}
        }
    };

    const submit = () => {
        const raw = value.trim();
        if (!raw) {
            setError('Paste an m2box link first.');
            return;
        }
        if (!isMovieboxUrl(raw)) {
            setError('This does not look like an m2box/moviebox watch-page link. Open the title on m2box.org and copy the full link from the address bar.');
            return;
        }
        setError(null);
        onPlay(raw, { proxy });
    };

    const parsed = parseMovieboxInput(value.trim());

    return (
        <View style={styles.root}>
            {onBack ? (
                <Pressable style={styles.backPill} onPress={onBack} accessibilityLabel={backLabel || 'Back'}>
                    <Ionicons name="swap-horizontal" size={16} color="#fff" />
                    <Text style={styles.backPillText}>{backLabel || 'Server 1'}</Text>
                </Pressable>
            ) : null}

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollInner}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.badgeRow}>
                    <View style={styles.badge}>
                        <Ionicons name="layers-outline" size={13} color="#E50914" />
                        <Text style={styles.badgeText}>SERVER 2</Text>
                    </View>
                    <Text style={styles.badgeSub}>M2Box / MovieBox</Text>
                </View>

                <Text style={styles.heading}>
                    {title ? `M2Box link needed for ${title}` : 'Paste an M2Box link'}
                </Text>
                {notice ? (
                    <Text style={styles.notice} testID="moviebox-link-notice">
                        {notice}
                    </Text>
                ) : null}
                <Text style={styles.body}>
                    MovieBox embed nahi deta — isliye uska poora watch page khol kar sirf player wala
                    hissa dikhaya jata hai. Aam taur par link apne aap lag jata hai (catalog ke liye
                    pehle se baked, warna live search). Yahan sirf tab paste karo jab MovieBox par is
                    title ka page na mile; link is browser me yaad rah jayega.
                </Text>

                <Pressable style={styles.linkRow} onPress={openSite} accessibilityLabel="Open m2box.org">
                    <Ionicons name="open-outline" size={14} color="#9ab4ff" />
                    <Text style={styles.linkRowText}>Open the title on {MOVIEBOX_SITE} → copy the link</Text>
                </Pressable>

                <TextInput
                    value={value}
                    onChangeText={(text) => {
                        setValue(text);
                        if (error) setError(null);
                    }}
                    onSubmitEditing={submit}
                    placeholder="https://m2box.org/movies/…?id=…&type=/movie/detail"
                    placeholderTextColor="#5a5a5a"
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    accessibilityLabel="M2Box link"
                    testID="moviebox-link-input"
                />

                {parsed?.detailPath ? (
                    <Text style={styles.detected}>
                        <Ionicons name="checkmark-circle" size={12} color="#46d369" />{' '}
                        {describeMovieboxLink(value.trim())}
                        {parsed.se != null ? ` · S${parsed.se}` : ''}
                        {parsed.ep != null ? ` E${parsed.ep}` : ''}
                    </Text>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                    style={styles.proxyRow}
                    onPress={() => setProxy((p) => !p)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: proxy }}
                    accessibilityLabel="Proxy mode"
                >
                    <View style={[styles.checkbox, proxy && styles.checkboxOn]}>
                        {proxy ? <Ionicons name="checkmark" size={12} color="#000" /> : null}
                    </View>
                    <Text style={styles.proxyText}>
                        Proxy se kholo — sirf tab jab seedha frame khali aaye (m2box frame-blocking)
                    </Text>
                </Pressable>

                <Pressable
                    style={[styles.playButton, !value.trim() && styles.playButtonIdle]}
                    onPress={submit}
                    accessibilityLabel="Play in M2Box"
                >
                    <Ionicons name="play" size={16} color="#000" />
                    <Text style={styles.playButtonText}>Play (Server 2)</Text>
                </Pressable>

                {showSaved && saved.length > 0 ? (
                    <View style={styles.savedBlock}>
                        <Text style={styles.savedTitle}>Pehle use kiye links</Text>
                        {saved.map(({ key, link }) => (
                            <Pressable
                                key={key}
                                style={styles.savedRow}
                                onPress={() => {
                                    if (onPickSaved) onPickSaved(key, link);
                                    else {
                                        setValue(link.url);
                                        setProxy(link.proxy);
                                    }
                                }}
                                accessibilityLabel={`Use saved M2Box link ${describeMovieboxLink(link.url)}`}
                            >
                                <Ionicons name="time-outline" size={14} color="#8a8a8a" />
                                <Text style={styles.savedRowText} numberOfLines={1}>
                                    {describeMovieboxLink(link.url)}
                                </Text>
                                <Text style={styles.savedRowKey} numberOfLines={1}>
                                    {key === '@page' ? 'page' : key.replace(/^tmdb:/, 'tmdb ')}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#000',
    },
    scroll: { flex: 1 },
    scrollInner: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 22,
        paddingVertical: 40,
    },
    backPill: {
        position: 'absolute',
        top: 14,
        right: 14,
        zIndex: 5,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    backPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: 'rgba(229,9,20,0.16)',
        borderWidth: 1,
        borderColor: 'rgba(229,9,20,0.5)',
    },
    badgeText: { color: '#ff6b6b', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
    badgeSub: { color: '#8a8a8a', fontSize: 11 },
    heading: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 10,
        maxWidth: 560,
    },
    body: {
        color: '#a5a5a5',
        fontSize: 13,
        lineHeight: 19,
        textAlign: 'center',
        maxWidth: 560,
        marginBottom: 16,
    },
    notice: {
        color: '#f5c542',
        fontSize: 12.5,
        lineHeight: 19,
        textAlign: 'center',
        maxWidth: 460,
        marginBottom: 4,
    },
    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 14,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: 'rgba(120,150,255,0.10)',
    },
    linkRowText: { color: '#9ab4ff', fontSize: 12 },
    input: {
        width: '100%',
        maxWidth: 560,
        backgroundColor: '#141414',
        borderWidth: 1,
        borderColor: '#2c2c2c',
        borderRadius: 8,
        color: '#fff',
        fontSize: 13,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'web' ? 12 : 10,
    },
    detected: { color: '#7bd88f', fontSize: 11, marginTop: 8, maxWidth: 560 },
    error: { color: '#ff8080', fontSize: 12, marginTop: 8, maxWidth: 560, textAlign: 'center' },
    proxyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
        maxWidth: 560,
    },
    checkbox: {
        width: 16,
        height: 16,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: '#4a4a4a',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: '#e5e5e5', borderColor: '#e5e5e5' },
    proxyText: { color: '#8a8a8a', fontSize: 11, flex: 1, lineHeight: 15 },
    playButton: {
        marginTop: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fff',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 6,
    },
    playButtonIdle: { opacity: 0.75 },
    playButtonText: { color: '#000', fontSize: 14, fontWeight: '800' },
    savedBlock: { width: '100%', maxWidth: 560, marginTop: 26 },
    savedTitle: { color: '#7d7d7d', fontSize: 11, letterSpacing: 0.5, marginBottom: 8 },
    savedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 9,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#232323',
    },
    savedRowText: { color: '#e5e5e5', fontSize: 12, flex: 1 },
    savedRowKey: { color: '#5f5f5f', fontSize: 10, maxWidth: 160 },
});

export default MovieboxLinkPanel;
