import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MovieboxLinkPanel } from '@/components/MovieboxLinkPanel';
import { MovieboxPagePlayer } from '@/components/MovieboxPagePlayer';
import { isMovieboxUrl } from '@/lib/moviebox';
import { MOVIEBOX_PAGE_KEY, saveMovieboxLink } from '@/lib/movieboxLinks';

/**
 * `/moviebox` — M2Box (Server 2) ka apna page.
 * ============================================
 * Kisi bhi movie/series par jaane ki zaroorat nahi: yahan m2box watch-page
 * ka link paste karo aur sirf-player crop me turant chalu ho jayega.
 * `?url=<link>` se seedha player khulta hai (link ko aur yaad rakhta hai).
 *
 * Title-specific playback title ke apne player se hota hai — wahan bhi
 * "Server 2 · M2Box" milta hai; link wahi ek baar maanga jata hai.
 */
export default function MovieboxScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ url?: string | string[] }>();
    const incoming = Array.isArray(params.url) ? params.url[0] : params.url;
    const startLink = typeof incoming === 'string' && isMovieboxUrl(incoming) ? incoming : null;

    const [link, setLink] = useState<string | null>(startLink);

    if (link) {
        return (
            <View style={styles.root}>
                <StatusBar style="light" />
                <MovieboxPagePlayer
                    linkKey={MOVIEBOX_PAGE_KEY}
                    initialLink={link}
                    title="M2Box"
                    autoResolve={false}
                    onClose={() => setLink(null)}
                />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.safe} edges={['top']}>
            <StatusBar style="light" />
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
                    <Ionicons name="arrow-back" size={22} color="#fff" />
                </Pressable>
                <Text style={styles.headerTitle}>M2Box • Server 2</Text>
                <View style={{ flex: 1 }} />
                <View style={styles.hdPill}>
                    <Text style={styles.hdPillText}>CROPPED FRAME</Text>
                </View>
            </View>

            <MovieboxLinkPanel
                showSaved
                onPlay={(raw, opts) => {
                    saveMovieboxLink(MOVIEBOX_PAGE_KEY, raw, opts);
                    setLink(raw.trim());
                }}
                onPickSaved={(_key, entry) => setLink(entry.url)}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    safe: { flex: 1, backgroundColor: '#000' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: Platform.OS === 'web' ? 18 : 14,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#1f1f1f',
    },
    backBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
    hdPill: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: 'rgba(229,9,20,0.5)',
    },
    hdPillText: { color: '#ff6b6b', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
});
