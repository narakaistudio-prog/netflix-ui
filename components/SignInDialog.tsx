import React, { useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@/contexts/UserContext';

/**
 * Netflix ka sign-in dialog.
 *
 * Owner: "netflix mae bhi red ka sign wala exact jo crunchyroll mae system hai wo
 * kardo" — flow wahi hai jo Crunchyroll page me hai (email + password se Supabase
 * sign in; naya account = display name + email + password), bas rang Netflix ka
 * red hai. Session shared hai (lib/account.ts), isliye yahan sign in karne par
 * Crunchyroll comments me bhi account aa jata hai.
 *
 * Guest ke liye app band nahi hota — sirf account chahiye to yahan aata hai.
 */
export function SignInDialog() {
    const { signInOpen, closeSignIn, signIn, signUp } = useUser();
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const reset = () => {
        setError('');
        setBusy(false);
        setPassword('');
    };

    const close = () => {
        reset();
        closeSignIn();
    };

    const submit = async () => {
        if (busy) return;
        setError('');
        // Validation pehle local (network call waste na ho).
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setError('Enter a valid email address.');
            return;
        }
        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }
        setBusy(true);
        try {
            if (mode === 'signup') await signUp(email, password, name);
            else await signIn(email, password);
            setName('');
            setEmail('');
            setPassword('');
        } catch (err: any) {
            const raw = String(err?.message || '');
            // Supabase ke raw English errors ko chhote, seedhe messages me map.
            if (/already registered|already been registered|User already/i.test(raw)) {
                setError('This email is already registered — use Sign In instead.');
            } else if (/Invalid login credentials|invalid_grant/i.test(raw)) {
                setError('Wrong email or password.');
            } else if (/confirm/i.test(raw)) {
                setError('Please confirm your email first — check your inbox.');
            } else {
                setError(raw || 'Something went wrong. Try again.');
            }
            setBusy(false);
        }
    };

    return (
        <Modal transparent visible={signInOpen} animationType="fade" onRequestClose={close}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close sign in" />
                <View style={styles.card}>
                    <View style={styles.headRow}>
                        <Text style={styles.title}>{mode === 'signup' ? 'Create Account' : 'Sign In'}</Text>
                        <Pressable onPress={close} accessibilityLabel="Close sign in" style={styles.closeBtn}>
                            <Ionicons name="close" size={22} color="#fff" />
                        </Pressable>
                    </View>

                    {mode === 'signup' && (
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder="Display name"
                            placeholderTextColor="#8c8c8c"
                            autoCapitalize="words"
                            maxLength={32}
                        />
                    )}
                    <TextInput
                        style={styles.input}
                        value={email}
                        onChangeText={setEmail}
                        placeholder="Email"
                        placeholderTextColor="#8c8c8c"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        inputMode="email"
                    />
                    <TextInput
                        style={styles.input}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Password"
                        placeholderTextColor="#8c8c8c"
                        secureTextEntry
                        onSubmitEditing={submit}
                    />

                    {!!error && <Text style={styles.error}>{error}</Text>}

                    <Pressable
                        style={({ hovered }: any) => [styles.submit, hovered && { backgroundColor: '#f6121d' }, busy && { opacity: 0.7 }]}
                        onPress={submit}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={mode === 'signup' ? 'Create account' : 'Sign in'}
                    >
                        {busy ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text style={styles.submitText}>{mode === 'signup' ? 'Create Account' : 'Sign In'}</Text>
                        )}
                    </Pressable>

                    <Pressable
                        onPress={() => {
                            setMode(mode === 'signup' ? 'signin' : 'signup');
                            setError('');
                        }}
                        style={styles.switchRow}
                    >
                        <Text style={styles.switchText}>
                            {mode === 'signup' ? 'Already have an account? ' : 'New to Netflix? '}
                            <Text style={styles.switchLink}>
                                {mode === 'signup' ? 'Sign in now.' : 'Sign up now.'}
                            </Text>
                        </Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.78)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        ...(Platform.OS === 'web' ? ({ position: 'fixed', inset: 0, zIndex: 1200 } as any) : null),
    },
    card: {
        width: '100%',
        maxWidth: 420,
        backgroundColor: '#131313',
        borderTopWidth: 3,
        borderTopColor: '#E50914',
        borderRadius: 6,
        padding: 24,
        gap: 12,
        boxShadow: '0 30px 80px rgba(0,0,0,0.75)',
    } as any,
    headRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    title: {
        color: '#fff',
        fontSize: 26,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    closeBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    input: {
        height: 50,
        borderRadius: 4,
        backgroundColor: '#1f1f1f',
        borderWidth: 1,
        borderColor: '#3a3a3a',
        color: '#fff',
        paddingHorizontal: 14,
        fontSize: 15,
    },
    error: {
        color: '#ff6b6b',
        fontSize: 13,
        lineHeight: 18,
    },
    submit: {
        height: 48,
        borderRadius: 4,
        backgroundColor: '#E50914',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 4,
    },
    submitText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    switchRow: {
        marginTop: 6,
        alignSelf: 'flex-start',
    },
    switchText: {
        color: '#b3b3b3',
        fontSize: 14,
    },
    switchLink: {
        color: '#fff',
        textDecorationLine: 'underline',
    } as any,
});
