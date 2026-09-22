import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    EmbedSettings,
    DEFAULT_SETTINGS,
    loadSettings,
    resetSettings,
    saveSettings,
} from '@/lib/settings';
import {
    ProviderId,
    PROVIDERS,
    buildEmbedUrl,
    validateCustomTemplate,
} from '@/lib/embeds';
import {
    generateEpisodes,
    fetchTmdbExternalIds,
    GeneratedEpisode,
} from '@/services/tmdbEpisodes';

const IS_WEB = Platform.OS === 'web';

/**
 * Admin screen for embed configuration. Accessible via /admin.
 *
 * Features:
 *  - Global embed templates (nxsha/nhd/custom), default provider, strict Hindi toggle.
 *  - NHD API key field (optional — embeds don't need it).
 *  - Per-title "Test Embed" builder (paste IDs, pick provider, build URL & open in new tab).
 *  - Episode generator: TMDB fetch OR manual "S=N E=1..M" fallback.
 *
 * Settings persist to localStorage (web) / AsyncStorage (native, later).
 * No API keys are hardcoded here; they're only read from env or saved settings.
 */

export default function AdminScreen() {
    const router = useRouter();
    const [settings, setSettings] = useState<EmbedSettings>(() => loadSettings());
    const [dirty, setDirty] = useState(false);

    // Test-embed form state
    const [testType, setTestType] = useState<'movie' | 'tv'>('movie');
    const [testTmdb, setTestTmdb] = useState('');
    const [testImdb, setTestImdb] = useState('');
    const [testProvider, setTestProvider] = useState<ProviderId>('nxsha');
    const [testSeason, setTestSeason] = useState('1');
    const [testEpisode, setTestEpisode] = useState('1');
    const [testStrict, setTestStrict] = useState(false);
    const [resolvedImdb, setResolvedImdb] = useState<string | null>(null);
    const [resolving, setResolving] = useState(false);

    // Episode generator form
    const [genTmdb, setGenTmdb] = useState('');
    const [genManualSeason, setGenManualSeason] = useState('1');
    const [genManualCount, setGenManualCount] = useState('10');
    const [genUseManual, setGenUseManual] = useState(false);
    const [genLoading, setGenLoading] = useState(false);
    const [genResults, setGenResults] = useState<GeneratedEpisode[] | null>(null);
    const [genError, setGenError] = useState<string | null>(null);

    useEffect(() => {
        setTestStrict(settings.strictHindi);
        setTestProvider(settings.defaultProvider);
    }, [settings]);

    const patch = (p: Partial<EmbedSettings>) => {
        setSettings(s => ({ ...s, ...p }));
        setDirty(true);
    };

    const handleSave = () => {
        saveSettings(settings);
        setDirty(false);
        if (IS_WEB) {
            // lightweight in-page toast; native Alert below also runs on web no-op.
        } else {
            Alert.alert('Saved', 'Settings saved.');
        }
    };

    const handleReset = () => {
        const def = resetSettings();
        setSettings(def);
        setDirty(false);
    };

    const testUrl = useMemo(() => {
        try {
            return buildEmbedUrl(
                testProvider,
                testType,
                {
                    tmdbId: testTmdb.trim() || undefined,
                    imdbId: testImdb.trim() || undefined,
                    season: testType === 'tv' ? parseInt(testSeason, 10) : undefined,
                    episode: testType === 'tv' ? parseInt(testEpisode, 10) : undefined,
                    strictHindi: testStrict,
                },
                {
                    movieTemplate:
                        testProvider === 'nxsha'
                            ? settings.nxshaMovieTemplate
                            : testProvider === 'nhd'
                            ? settings.nhdMovieTemplate
                            : settings.customMovieTemplate,
                    tvTemplate:
                        testProvider === 'nxsha'
                            ? settings.nxshaTvTemplate
                            : testProvider === 'nhd'
                            ? settings.nhdTvTemplate
                            : settings.customTvTemplate,
                },
            );
        } catch (e) {
            return '';
        }
    }, [testProvider, testType, testTmdb, testImdb, testSeason, testEpisode, testStrict, settings]);

    const movieValid = validateCustomTemplate(settings.customMovieTemplate, 'movie');
    const tvValid = validateCustomTemplate(settings.customTvTemplate, 'tv');

    const handleResolveImdb = async () => {
        if (!testTmdb.trim()) return;
        setResolving(true);
        setResolvedImdb(null);
        try {
            const r = await fetchTmdbExternalIds(testType, testTmdb.trim());
            if (r.imdb_id) {
                setResolvedImdb(r.imdb_id);
                setTestImdb(r.imdb_id);
            } else {
                setResolvedImdb(null);
            }
        } catch {
            setResolvedImdb(null);
        } finally {
            setResolving(false);
        }
    };

    const handleOpenTest = () => {
        if (!testUrl) return;
        if (IS_WEB) window.open(testUrl, '_blank', 'noopener');
    };

    const handleGenerate = async () => {
        setGenLoading(true);
        setGenError(null);
        setGenResults(null);
        try {
            if (genUseManual) {
                const s = parseInt(genManualSeason, 10);
                const c = parseInt(genManualCount, 10);
                if (!s || !c || s < 1 || c < 1) throw new Error('Season/Count positive integers hone chahiye');
                const r = await generateEpisodes(undefined, { season: s, episodeCount: c });
                setGenResults(r);
            } else {
                if (!genTmdb.trim()) throw new Error('TMDB ID daalo ya Manual mode use karo');
                const r = await generateEpisodes(genTmdb.trim(), null);
                if (!r.length) throw new Error('Koi episodes nahi mile — TMDB ID sahi hai?');
                setGenResults(r);
            }
        } catch (e: any) {
            setGenError(e?.message ?? 'Failed to generate');
        } finally {
            setGenLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top']}>
            <StatusBar style="light" />
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#fff" />
                </Pressable>
                <Text style={styles.title}>Admin • Embed Settings</Text>
                <View style={{ flex: 1 }} />
                <Pressable
                    onPress={handleReset}
                    style={[styles.pillBtn, { borderColor: '#555' }]}
                >
                    <Text style={styles.pillBtnText}>Reset</Text>
                </Pressable>
                <Pressable
                    onPress={handleSave}
                    style={[
                        styles.pillBtn,
                        { backgroundColor: dirty ? '#E50914' : '#333', borderColor: dirty ? '#E50914' : '#333' },
                    ]}
                >
                    <Text style={[styles.pillBtnText, { color: '#fff' }]}>
                        {dirty ? 'Save*' : 'Saved'}
                    </Text>
                </Pressable>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 16, gap: 20 }}>
                {/* -------- Global provider defaults -------- */}
                <Section title="Default provider">
                    <View style={styles.row}>
                        {PROVIDERS.map(p => (
                            <Pill
                                key={p.id}
                                active={settings.defaultProvider === p.id}
                                label={p.name}
                                onPress={() => patch({ defaultProvider: p.id })}
                            />
                        ))}
                        <Pill
                            active={settings.defaultProvider === 'custom'}
                            label="Custom"
                            onPress={() => patch({ defaultProvider: 'custom' })}
                        />
                    </View>
                    <View style={[styles.row, { marginTop: 10 }]}>
                        <Pressable
                            style={[styles.checkbox, settings.strictHindi && styles.checkboxOn]}
                            onPress={() => patch({ strictHindi: !settings.strictHindi })}
                        >
                            {settings.strictHindi ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </Pressable>
                        <Text style={styles.label}>
                            Hindi-first mode (strict Hindi / one_server=true) — Nxsha ke liye
                        </Text>
                    </View>
                </Section>

                {/* -------- Templates -------- */}
                <Section title="Nxsha movie template">
                    <TemplateInput
                        value={settings.nxshaMovieTemplate}
                        onChange={v => patch({ nxshaMovieTemplate: v })}
                        placeholder="https://nxsha.space/embed/movie/{id}?..."
                    />
                </Section>
                <Section title="Nxsha TV template">
                    <TemplateInput
                        value={settings.nxshaTvTemplate}
                        onChange={v => patch({ nxshaTvTemplate: v })}
                        placeholder="https://nxsha.space/embed/tv/{id}/{s}/{e}?..."
                    />
                </Section>
                <Section title="NHD movie template">
                    <TemplateInput
                        value={settings.nhdMovieTemplate}
                        onChange={v => patch({ nhdMovieTemplate: v })}
                        placeholder="https://nhdapi.com/movie/{id}"
                    />
                </Section>
                <Section title="NHD TV template">
                    <TemplateInput
                        value={settings.nhdTvTemplate}
                        onChange={v => patch({ nhdTvTemplate: v })}
                        placeholder="https://nhdapi.com/tv/{id}/{s}/{e}"
                    />
                </Section>

                <Section title="Custom movie template">
                    <TemplateInput
                        value={settings.customMovieTemplate}
                        onChange={v => patch({ customMovieTemplate: v })}
                        placeholder="https://your-player.example/embed/{id}"
                        error={!movieValid.ok ? movieValid.error : undefined}
                    />
                    <Hint>Must contain {`{id}`} placeholder.</Hint>
                </Section>
                <Section title="Custom TV template">
                    <TemplateInput
                        value={settings.customTvTemplate}
                        onChange={v => patch({ customTvTemplate: v })}
                        placeholder="https://your-player.example/embed/{id}/{s}/{e}"
                        error={!tvValid.ok ? tvValid.error : undefined}
                    />
                    <Hint>Must contain {`{id}`}, {`{s}`}, {`{e}`} placeholders.</Hint>
                </Section>

                <Section title="NHD API key (optional)">
                    <TextInput
                        style={styles.input}
                        value={settings.nhdApiKey}
                        onChangeText={v => patch({ nhdApiKey: v })}
                        placeholder="Sirf paid/JSON endpoints ke liye (embed ke liye zaruri nahi)"
                        placeholderTextColor="#666"
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                    />
                </Section>

                {/* -------- Test embed -------- */}
                <Section title="Test embed">
                    <View style={styles.row}>
                        <Pill active={testType === 'movie'} label="Movie" onPress={() => setTestType('movie')} />
                        <Pill active={testType === 'tv'} label="TV" onPress={() => setTestType('tv')} />
                    </View>
                    <View style={[styles.row, { marginTop: 10 }]}>
                        {PROVIDERS.map(p => (
                            <Pill
                                key={p.id}
                                active={testProvider === p.id}
                                label={p.name}
                                onPress={() => setTestProvider(p.id)}
                            />
                        ))}
                        <Pill
                            active={testProvider === 'custom'}
                            label="Custom"
                            onPress={() => setTestProvider('custom')}
                        />
                    </View>

                    <Field label="TMDB ID">
                        <TextInput
                            style={styles.input}
                            value={testTmdb}
                            onChangeText={setTestTmdb}
                            placeholder="e.g. 1375666"
                            placeholderTextColor="#666"
                            keyboardType={IS_WEB ? ('number-pad' as any) : 'number-pad'}
                        />
                        <Pressable style={styles.smallBtn} onPress={handleResolveImdb}>
                            {resolving ? (
                                <ActivityIndicator size="small" color="#000" />
                            ) : (
                                <Text style={styles.smallBtnText}>Lookup IMDb</Text>
                            )}
                        </Pressable>
                    </Field>

                    <Field label="IMDb ID">
                        <TextInput
                            style={styles.input}
                            value={testImdb}
                            onChangeText={setTestImdb}
                            placeholder="tt1375666"
                            placeholderTextColor="#666"
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        {resolvedImdb ? (
                            <Text style={{ color: '#4caf50', fontSize: 11, marginTop: 4 }}>
                                Resolved: {resolvedImdb}
                            </Text>
                        ) : null}
                    </Field>

                    {testType === 'tv' ? (
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <Field label="Season" style={{ flex: 1 }}>
                                <TextInput
                                    style={styles.input}
                                    value={testSeason}
                                    onChangeText={setTestSeason}
                                    placeholder="1"
                                    placeholderTextColor="#666"
                                    keyboardType="number-pad"
                                />
                            </Field>
                            <Field label="Episode" style={{ flex: 1 }}>
                                <TextInput
                                    style={styles.input}
                                    value={testEpisode}
                                    onChangeText={setTestEpisode}
                                    placeholder="1"
                                    placeholderTextColor="#666"
                                    keyboardType="number-pad"
                                />
                            </Field>
                        </View>
                    ) : null}

                    <View style={[styles.row, { marginTop: 8 }]}>
                        <Pressable
                            style={[styles.checkbox, testStrict && styles.checkboxOn]}
                            onPress={() => setTestStrict(v => !v)}
                        >
                            {testStrict ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </Pressable>
                        <Text style={styles.label}>Hindi-first mode (one_server=true)</Text>
                    </View>

                    <TemplateInput value={testUrl} editable={false} monospace />

                    <Pressable
                        style={[styles.primaryBtn, !testUrl && { backgroundColor: '#333' }]}
                        disabled={!testUrl}
                        onPress={handleOpenTest}
                    >
                        <Ionicons name="open-outline" size={16} color="#fff" />
                        <Text style={styles.primaryBtnText}>Open in new tab</Text>
                    </Pressable>
                </Section>

                {/* -------- Episode generator -------- */}
                <Section title="Episode generator">
                    <View style={styles.row}>
                        <Pill
                            active={!genUseManual}
                            label="Fetch from TMDB"
                            onPress={() => setGenUseManual(false)}
                        />
                        <Pill
                            active={genUseManual}
                            label="Manual (S=N, E=1..M)"
                            onPress={() => setGenUseManual(true)}
                        />
                    </View>
                    {!genUseManual ? (
                        <Field label="TMDB ID">
                            <TextInput
                                style={styles.input}
                                value={genTmdb}
                                onChangeText={setGenTmdb}
                                placeholder="e.g. 1399 (Game of Thrones)"
                                placeholderTextColor="#666"
                                keyboardType="number-pad"
                            />
                        </Field>
                    ) : (
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <Field label="Season" style={{ flex: 1 }}>
                                <TextInput
                                    style={styles.input}
                                    value={genManualSeason}
                                    onChangeText={setGenManualSeason}
                                    placeholder="1"
                                    placeholderTextColor="#666"
                                    keyboardType="number-pad"
                                />
                            </Field>
                            <Field label="Episodes" style={{ flex: 1 }}>
                                <TextInput
                                    style={styles.input}
                                    value={genManualCount}
                                    onChangeText={setGenManualCount}
                                    placeholder="10"
                                    placeholderTextColor="#666"
                                    keyboardType="number-pad"
                                />
                            </Field>
                        </View>
                    )}

                    <Pressable style={styles.primaryBtn} onPress={handleGenerate}>
                        {genLoading ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="list" size={16} color="#fff" />
                                <Text style={styles.primaryBtnText}>Generate episodes</Text>
                            </>
                        )}
                    </Pressable>

                    {genError ? (
                        <Text style={{ color: '#ff6b6b', fontSize: 12, marginTop: 8 }}>
                            {genError}
                        </Text>
                    ) : null}

                    {genResults ? (
                        <View style={styles.resultsBox}>
                            <Text style={styles.resultsCount}>
                                {genResults.length} episode{genResults.length === 1 ? '' : 's'} generated
                            </Text>
                            <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                                {genResults.map(e => (
                                    <View key={`${e.season}-${e.episode}`} style={styles.resultRow}>
                                        <Text style={styles.resultBadge}>
                                            S{e.season} E{e.episode}
                                        </Text>
                                        <Text style={styles.resultText} numberOfLines={1}>
                                            {e.name}
                                        </Text>
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    ) : null}
                </Section>

                <Text style={styles.footer}>
                    This product uses the TMDB API but is not endorsed or certified by TMDB.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}

/* ------------------------------ UI helpers ------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {children}
        </View>
    );
}

function Pill({
    label,
    active,
    onPress,
}: {
    label: string;
    active?: boolean;
    onPress?: () => void;
}) {
    return (
        <Pressable
            style={[styles.pill, active && styles.pillActive]}
            onPress={onPress}
        >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
        </Pressable>
    );
}

function Field({
    label,
    children,
    style,
}: {
    label: string;
    children: React.ReactNode;
    style?: any;
}) {
    return (
        <View style={[{ marginTop: 8, gap: 4 }, style]}>
            <Text style={styles.fieldLabel}>{label}</Text>
            {children}
        </View>
    );
}

function Hint({ children }: { children: React.ReactNode }) {
    return <Text style={styles.hint}>{children}</Text>;
}

function TemplateInput({
    value,
    onChange,
    placeholder,
    editable = true,
    error,
    monospace = false,
}: {
    value: string;
    onChange?: (v: string) => void;
    placeholder?: string;
    editable?: boolean;
    error?: string;
    monospace?: boolean;
}) {
    return (
        <View>
            <TextInput
                style={[
                    styles.textarea,
                    !editable && { color: '#888', backgroundColor: '#111' },
                    monospace && { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }) },
                ]}
                value={value}
                onChangeText={onChange}
                placeholder={placeholder}
                placeholderTextColor="#555"
                multiline
                editable={editable}
                autoCapitalize="none"
                autoCorrect={false}
                numberOfLines={2}
            />
            {error ? <Text style={{ color: '#ff6b6b', fontSize: 11, marginTop: 4 }}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0a0a0a' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#1f1f1f',
        backgroundColor: '#0a0a0a',
    },
    backBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: { color: '#fff', fontSize: 16, fontWeight: '700' },
    pillBtn: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#444',
        marginLeft: 6,
    },
    pillBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    scroll: { flex: 1, backgroundColor: '#0a0a0a' },
    sectionTitle: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    pill: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: '#1c1c1c',
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    pillActive: { backgroundColor: '#E50914', borderColor: '#E50914' },
    pillText: { color: '#ccc', fontSize: 12, fontWeight: '700' },
    pillTextActive: { color: '#fff' },
    label: { color: '#ccc', fontSize: 12, marginLeft: 8 },
    fieldLabel: { color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: {
        backgroundColor: '#111',
        color: '#fff',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
    },
    textarea: {
        backgroundColor: '#111',
        color: '#fff',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 12,
        minHeight: 56,
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#666',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
    },
    checkboxOn: { backgroundColor: '#E50914', borderColor: '#E50914' },
    hint: { color: '#666', fontSize: 11, marginTop: 4 },
    smallBtn: {
        position: 'absolute',
        right: 6,
        top: 22,
        backgroundColor: '#fff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 4,
    },
    smallBtnText: { color: '#000', fontSize: 11, fontWeight: '700' },
    primaryBtn: {
        marginTop: 10,
        backgroundColor: '#E50914',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: 6,
    },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    resultsBox: {
        marginTop: 10,
        backgroundColor: '#111',
        borderRadius: 6,
        padding: 10,
        borderWidth: 1,
        borderColor: '#222',
    },
    resultsCount: { color: '#aaa', fontSize: 11, marginBottom: 6 },
    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#222',
    },
    resultBadge: {
        backgroundColor: '#E50914',
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        minWidth: 54,
        textAlign: 'center',
    },
    resultText: { color: '#ddd', fontSize: 13, flex: 1 },
    footer: { color: '#555', fontSize: 11, textAlign: 'center', marginTop: 20, marginBottom: 20 },
});
