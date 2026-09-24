import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTvMode, useTvBackHandler } from '@/hooks/useTvNavigation';

interface Props {
    isOpen?: boolean;
    onClose?: () => void;
}

const tv = (attrs: Record<string, string>) => ({ dataSet: attrs } as any);

export function TvRemoteHelper({ isOpen: controlledIsOpen, onClose }: Props) {
    const { isTvMode, isTvDevice, isPointerDriven, inputSource, toggleTvMode } = useTvMode();
    const [internalOpen, setInternalOpen] = useState(false);
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    const isModalOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

    useTvBackHandler(() => {
        if (isModalOpen) {
            if (onClose) onClose();
            else setInternalOpen(false);
            return true;
        }
        return false;
    }, isModalOpen);

    const handleClose = () => {
        if (onClose) onClose();
        else setInternalOpen(false);
    };

    if (Platform.OS !== 'web') return null;

    const inputLabel =
        inputSource === 'keys'
            ? 'Arrow keys (D-pad) ✔'
            : inputSource === 'pointer'
            ? 'Pointer arrow (D-pad is moving the on-screen arrow)'
            : 'Waiting for remote input…';

    return (
        <>
            {isModalOpen && (
                <View style={styles.modalBackdrop} {...tv({ tvScope: 'modal' })}>
                    <ScrollView
                        style={styles.modalScroll}
                        contentContainerStyle={styles.modalScrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.modalCard}>
                            {/* Header */}
                            <View style={styles.modalHeader}>
                                <View style={styles.headerTitleRow}>
                                    <Ionicons name="tv-outline" size={26} color="#E50914" />
                                    <Text style={styles.modalTitle}>TV Mode</Text>
                                </View>
                                <Pressable
                                    onPress={handleClose}
                                    tabIndex={0}
                                    accessibilityRole="button"
                                    accessibilityLabel="Close TV remote guide"
                                    {...tv({ tvFocusable: 'true', tvRow: 'tv-modal', tvIndex: '9', tvId: 'tv-modal-close' })}
                                    style={({ hovered }: any) => [styles.closeBtn, hovered && { backgroundColor: '#333' }]}
                                >
                                    <Ionicons name="close" size={24} color="#fff" />
                                </Pressable>
                            </View>

                            {/* Live status */}
                            <View style={styles.statusBox}>
                                <View style={styles.statusRow}>
                                    <View style={[styles.statusDot, { backgroundColor: isTvMode ? '#46d369' : '#888' }]} />
                                    <Text style={styles.statusText}>
                                        TV Mode: <Text style={styles.bold}>{isTvMode ? 'ON' : 'OFF'}</Text>
                                        {isTvDevice ? '  •  TV detected' : isPointerDriven ? '  •  Big screen (no mouse)' : ''}
                                    </Text>
                                </View>
                                <Text style={styles.statusSub}>
                                    Remote input: <Text style={styles.bold}>{inputLabel}</Text>
                                </Text>
                            </View>

                            {/* The one button that matters */}
                            <Pressable
                                onPress={toggleTvMode}
                                tabIndex={0}
                                accessibilityRole="button"
                                accessibilityLabel={isTvMode ? 'Turn TV mode off' : 'Turn TV mode on'}
                                {...tv({ tvFocusable: 'true', tvRow: 'tv-modal', tvIndex: '0', tvInitial: 'true', tvId: 'tv-mode-toggle' })}
                                style={({ hovered }: any) => [
                                    styles.primaryBtn,
                                    isTvMode && styles.primaryBtnOn,
                                    hovered && { opacity: 0.88 },
                                ]}
                            >
                                <Ionicons name={isTvMode ? 'checkmark-circle' : 'tv-outline'} size={20} color="#fff" />
                                <Text style={styles.primaryBtnText}>
                                    {isTvMode ? 'TV Mode ON — Netflix TV app jaisa' : 'TV Mode ON karein'}
                                </Text>
                            </Pressable>

                            {/* Arrow / pointer help */}
                            <View style={styles.tipBox}>
                                <View style={styles.tipTitleRow}>
                                    <Ionicons name="bulb-outline" size={22} color="#f5c518" />
                                    <Text style={styles.tipHeading}>TV par mouse vale arrow ko kaise hatayein</Text>
                                </View>
                                <Text style={styles.tipText}>
                                    <Text style={styles.bold}>1. </Text>
                                    Remote par arrow / pointer button dabayein (Samsung: browser ke top-right{' '}
                                    <Text style={styles.bold}>'Link Browsing'</Text> icon par OK, LG Magic Remote: pointer band karke D-pad use karein).
                                </Text>
                                <Text style={styles.tipText}>
                                    <Text style={styles.bold}>2. </Text>
                                    Site ke andar TV Mode ON hone par mouse arrow chhup jaata hai aur website native{' '}
                                    <Text style={styles.bold}>Netflix TV app</Text> ki tarah chalti hai — bada white ring highlight, D-pad se up/down/left/right.
                                </Text>
                                <Text style={styles.tipText}>
                                    <Text style={styles.bold}>3. </Text>
                                    Agar TV apna arrow phir bhi dikhata hai (kuch TV usse hataane nahi dete) to koi dikkat nahi:
                                    arrow ko card par le jaayein — <Text style={styles.bold}>white ring usi card ko follow karega</Text>, OK
                                    dabane par wahi title khulega, aur rows apne aap scroll hongi.
                                </Text>
                            </View>

                            {/* Remote buttons legend */}
                            <Text style={styles.sectionHeader}>Remote Controls</Text>
                            <View style={styles.controlsGrid}>
                                <View style={styles.controlItem}>
                                    <View style={styles.keyBadge}>
                                        <Text style={styles.keyText}>⬆️ ⬇️ ⬅️ ➡️</Text>
                                    </View>
                                    <View style={styles.controlTextCol}>
                                        <Text style={styles.controlTitle}>D-Pad</Text>
                                        <Text style={styles.controlDesc}>Rows aur cards ke beech move karein</Text>
                                    </View>
                                </View>

                                <View style={styles.controlItem}>
                                    <View style={styles.keyBadge}>
                                        <Text style={styles.keyText}>OK / ENTER</Text>
                                    </View>
                                    <View style={styles.controlTextCol}>
                                        <Text style={styles.controlTitle}>Select / Play</Text>
                                        <Text style={styles.controlDesc}>Highlighted title kholein ya video play karein</Text>
                                    </View>
                                </View>

                                <View style={styles.controlItem}>
                                    <View style={styles.keyBadge}>
                                        <Text style={styles.keyText}>RETURN / ↩️</Text>
                                    </View>
                                    <View style={styles.controlTextCol}>
                                        <Text style={styles.controlTitle}>Back</Text>
                                        <Text style={styles.controlDesc}>Player / detail band karke wapas jayein</Text>
                                    </View>
                                </View>

                                <View style={styles.controlItem}>
                                    <View style={styles.keyBadge}>
                                        <Text style={styles.keyText}>⏯️ PLAY / PAUSE</Text>
                                    </View>
                                    <View style={styles.controlTextCol}>
                                        <Text style={styles.controlTitle}>Media Keys</Text>
                                        <Text style={styles.controlDesc}>Video pause ya resume karein</Text>
                                    </View>
                                </View>
                            </View>

                            {/* Diagnostics (opt-in) */}
                            <Pressable
                                onPress={() => setShowDiagnostics(v => !v)}
                                tabIndex={0}
                                accessibilityRole="button"
                                accessibilityLabel="Toggle TV input diagnostics"
                                {...tv({ tvFocusable: 'true', tvRow: 'tv-modal', tvIndex: '5' })}
                                style={({ hovered }: any) => [styles.diagToggle, hovered && { opacity: 0.85 }]}
                            >
                                <Ionicons name="pulse-outline" size={16} color="#8ab4f8" />
                                <Text style={styles.diagToggleText}>
                                    {showDiagnostics ? 'Input diagnostics band karein' : 'Mere TV se kya aa raha hai? (diagnostics)'}
                                </Text>
                            </Pressable>

                            {showDiagnostics && (
                                <View style={styles.diagBox}>
                                    <Text style={styles.diagLine}>Detected input: {inputSource}</Text>
                                    <Text style={styles.diagLine}>TV device (user-agent): {String(isTvDevice)}</Text>
                                    <Text style={styles.diagLine}>Big screen without mouse: {String(isPointerDriven)}</Text>
                                    <Text style={styles.diagLine}>TV Mode: {String(isTvMode)}</Text>
                                    <Text style={styles.diagHint}>
                                        Remote par koi bhi arrow dabayein — yahan 'keys' ya 'pointer' turant badlega.
                                    </Text>
                                </View>
                            )}

                            <Pressable
                                onPress={handleClose}
                                tabIndex={0}
                                accessibilityRole="button"
                                accessibilityLabel="Done"
                                {...tv({ tvFocusable: 'true', tvRow: 'tv-modal', tvIndex: '8' })}
                                style={({ hovered }: any) => [styles.darkBtn, hovered && { backgroundColor: '#2a2a2a' }]}
                            >
                                <Text style={styles.darkBtnText}>Ho gaya, browse karein</Text>
                            </Pressable>
                        </View>
                    </ScrollView>
                </View>
            )}
        </>
    );
}

const styles = StyleSheet.create({
    modalBackdrop: {
        position: 'fixed' as any,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.88)',
        zIndex: 99999,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    modalScroll: {
        maxHeight: '94%' as any,
        width: '100%',
    },
    modalScrollContent: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    modalCard: {
        width: '96%',
        maxWidth: 720,
        backgroundColor: '#181818',
        borderRadius: 12,
        padding: 26,
        borderWidth: 1,
        borderColor: '#333',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.6,
        shadowRadius: 24,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#282828',
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#fff',
    },
    closeBtn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#222',
    },
    statusBox: {
        backgroundColor: '#101010',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#262626',
        padding: 14,
        marginBottom: 14,
        gap: 6,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    statusText: {
        fontSize: 14,
        color: '#ddd',
    },
    statusSub: {
        fontSize: 13,
        color: '#aaa',
    },
    bold: {
        fontWeight: '700',
        color: '#fff',
    },
    primaryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#E50914',
        paddingVertical: 14,
        borderRadius: 8,
        marginBottom: 18,
    },
    primaryBtnOn: {
        backgroundColor: '#1f7a37',
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '800',
    },
    tipBox: {
        backgroundColor: 'rgba(245, 197, 24, 0.08)',
        borderLeftWidth: 4,
        borderLeftColor: '#f5c518',
        borderRadius: 8,
        padding: 16,
        marginBottom: 20,
    },
    tipTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    tipHeading: {
        fontSize: 16,
        fontWeight: '700',
        color: '#f5c518',
        flexShrink: 1,
    },
    tipText: {
        fontSize: 14,
        color: '#e5e5e5',
        lineHeight: 22,
        marginBottom: 6,
    },
    sectionHeader: {
        fontSize: 15,
        fontWeight: '700',
        color: '#aaa',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 12,
    },
    controlsGrid: {
        gap: 10,
        marginBottom: 18,
    },
    controlItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        backgroundColor: '#222',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
    },
    keyBadge: {
        minWidth: 130,
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: '#333',
        borderRadius: 6,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#444',
    },
    keyText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    controlTextCol: {
        flex: 1,
    },
    controlTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#fff',
    },
    controlDesc: {
        fontSize: 13,
        color: '#aaa',
        marginTop: 2,
    },
    diagToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        marginBottom: 8,
    },
    diagToggleText: {
        color: '#8ab4f8',
        fontSize: 13,
        fontWeight: '600',
    },
    diagBox: {
        backgroundColor: '#0d1117',
        borderWidth: 1,
        borderColor: '#26303d',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        gap: 4,
    },
    diagLine: {
        color: '#c9d1d9',
        fontSize: 13,
        fontFamily: Platform.OS === 'web' ? ('monospace' as any) : undefined,
    },
    diagHint: {
        color: '#8b949e',
        fontSize: 12,
        marginTop: 6,
    },
    darkBtn: {
        alignSelf: 'center',
        backgroundColor: '#222',
        borderWidth: 1,
        borderColor: '#3a3a3a',
        paddingVertical: 10,
        paddingHorizontal: 22,
        borderRadius: 6,
    },
    darkBtnText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
});
