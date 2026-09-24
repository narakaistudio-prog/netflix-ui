import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTvMode, useTvBackHandler } from '@/hooks/useTvNavigation';
import { spatialNav } from '@/lib/spatialNavigation';

interface Props {
    isOpen?: boolean;
    onClose?: () => void;
}

const tv = (attrs: Record<string, string>) => ({ dataSet: attrs } as any);

export function TvRemoteHelper({ isOpen: controlledIsOpen, onClose }: Props) {
    const {
        isTvMode,
        isTvDevice,
        isPointerDriven,
        inputSource,
        pointerPreference,
        setPointerPreference,
        toggleTvMode,
    } = useTvMode();
    const [internalOpen, setInternalOpen] = useState(false);
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [cursorTest, setCursorTest] = useState<'idle' | 'trying' | 'locked' | 'released' | 'unavailable'>(
        () => spatialNav.isTvPointerLocked() ? 'locked' : 'idle'
    );

    useEffect(() => {
        if (Platform.OS !== 'web') return;
        return spatialNav.subscribeTvPointerLock(locked => {
            setCursorTest(previous => locked ? 'locked' : previous === 'locked' ? 'released' : previous);
        });
    }, []);

    const tryHideBrowserArrow = () => {
        setCursorTest('trying');
        // Call immediately from the OK/click handler: Pointer Lock needs the
        // browser's transient user activation, and may be unsupported on TV.
        void spatialNav.tryLockTvPointer().then(locked => {
            setCursorTest(locked || spatialNav.isTvPointerLocked() ? 'locked' : 'unavailable');
        });
    };

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
                                    {isTvMode ? 'TV Mode ON — remote navigation active' : 'TV Mode ON karein'}
                                </Text>
                            </Pressable>

                            {/* Arrow / pointer help */}
                            <View style={styles.tipBox}>
                                <View style={styles.tipTitleRow}>
                                    <Ionicons name="bulb-outline" size={22} color="#f5c518" />
                                    <Text style={styles.tipHeading}>TV ka mouse arrow? Koi setting badalne ki zaroorat nahi</Text>
                                </View>
                                <Text style={styles.tipText}>
                                    <Text style={styles.bold}>Kaam kaise karta hai: </Text>
                                    <Text style={styles.bold}>Down</Text> NETFLIX logo se Play par, phir pehli shelf par
                                    jaata hai aur page scroll hota hai. Agar TV sirf pointer bhejta hai, arrow ko
                                    logo, Play ya poster ke andar neeche hilane par bhi ring aage jaati hai.
                                    <Text style={styles.bold}> OK</Text> ring waala title select karta hai.
                                </Text>
                                <Text style={styles.tipText}>
                                    <Text style={styles.bold}>Screen ke kinare: </Text>
                                    Down ko Play par dabayein. Pointer-only browser me cursor ko neeche hilayein; kinare
                                    par jaane par bhi page scroll karta hai. Arrow keys mode browser support kare to woh
                                    zyada TV-app jaisa lagta hai.
                                </Text>
                                <Text style={styles.tipText}>
                                    <Text style={styles.bold}>TV ka arrow dikhta rehta hai: </Text>
                                    TV Mode website ka cursor chhupata hai, lekin TV browser ka system arrow website band
                                    nahi kar sakti. Browser me Link Browsing / arrow-key mode mile to use try karein.
                                    Agar upar status me "Waiting for remote input" hi rahe, browser site ko na keys bhej raha hai
                                    na pointer movement. Apna TV model aur browser batayein — bina DOM input ke website remote
                                    button ko detect nahi kar sakti.
                                </Text>
                            </View>

                            {/* Manual remote-style override */}
                            <Text style={styles.sectionHeader}>Mera remote kaise chalta hai?</Text>
                            <View style={styles.modeRow}>
                                <Pressable
                                    onPress={() => setPointerPreference('auto')}
                                    tabIndex={0}
                                    accessibilityRole="button"
                                    accessibilityLabel="Remote style auto detect"
                                    {...tv({ tvFocusable: 'true', tvRow: 'tv-modal-modes', tvIndex: '0' })}
                                    style={({ hovered }: any) => [
                                        styles.modeCard,
                                        pointerPreference === 'auto' && styles.modeCardActive,
                                        hovered && { opacity: 0.88 },
                                    ]}
                                >
                                    <Text style={styles.modeTitle}>Auto detect (recommended)</Text>
                                    <Text style={styles.modeDesc}>Site khud pehchaan leti hai</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => setPointerPreference('on')}
                                    tabIndex={0}
                                    accessibilityRole="button"
                                    accessibilityLabel="Remote style pointer arrow"
                                    {...tv({ tvFocusable: 'true', tvRow: 'tv-modal-modes', tvIndex: '1' })}
                                    style={({ hovered }: any) => [
                                        styles.modeCard,
                                        pointerPreference === 'on' && styles.modeCardActive,
                                        hovered && { opacity: 0.88 },
                                    ]}
                                >
                                    <Text style={styles.modeTitle}>Pointer arrow</Text>
                                    <Text style={styles.modeDesc}>Remote ek mouse arrow chalata hai</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => setPointerPreference('off')}
                                    tabIndex={0}
                                    accessibilityRole="button"
                                    accessibilityLabel="Remote style arrow keys"
                                    {...tv({ tvFocusable: 'true', tvRow: 'tv-modal-modes', tvIndex: '2' })}
                                    style={({ hovered }: any) => [
                                        styles.modeCard,
                                        pointerPreference === 'off' && styles.modeCardActive,
                                        hovered && { opacity: 0.88 },
                                    ]}
                                >
                                    <Text style={styles.modeTitle}>Arrow keys</Text>
                                    <Text style={styles.modeDesc}>Remote seedhe arrow keys bhejta hai</Text>
                                </Pressable>
                            </View>
                            <Text style={styles.modeHint}>
                                Agar up/down kaam na kare to <Text style={styles.bold}>Pointer arrow</Text> chun lein — TV ka arrow
                                chalu hote hi highlight usko follow karega. Filhaal: {pointerPreference}
                            </Text>

                            {/* Optional browser-only experiment; never enable automatically. */}
                            <View style={styles.cursorTestBox}>
                                <Text style={styles.cursorTestTitle}>Browser arrow hide karein (optional)</Text>
                                <Text style={styles.cursorTestDescription}>
                                    Website ka cursor TV Mode mein hidden hai. Agar alag TV arrow dikhta hai,
                                    Pointer Lock try kar sakte hain. Yeh browser par depend karta hai — TV ka
                                    apna arrow phir bhi dikh sakta hai. Upar Pointer arrow / Arrow keys settings
                                    sirf remote input ke liye hain, arrow hide karne ke liye nahi.
                                </Text>
                                {isTvMode && (
                                    <Pressable
                                        onPress={cursorTest === 'locked' ? () => spatialNav.releaseTvPointerLock() : tryHideBrowserArrow}
                                        disabled={cursorTest === 'trying'}
                                        tabIndex={0}
                                        accessibilityRole="button"
                                        accessibilityLabel={cursorTest === 'locked' ? 'Release browser pointer lock' : 'Try hiding browser arrow'}
                                        {...tv({ tvFocusable: 'true', tvRow: 'tv-modal', tvIndex: '4', tvId: 'tv-cursor-test' })}
                                        style={({ hovered }: any) => [styles.cursorTestButton, hovered && { opacity: 0.85 }]}
                                    >
                                        <Text style={styles.cursorTestButtonText}>
                                            {cursorTest === 'locked' ? 'Pointer Lock band karein' :
                                                cursorTest === 'trying' ? 'Browser se pooch rahe hain…' :
                                                'Browser arrow hide try karein'}
                                        </Text>
                                    </Pressable>
                                )}
                                <Text style={styles.cursorTestStatus}>
                                    {!isTvMode ? 'Pehle TV Mode ON karein.' :
                                        cursorTest === 'locked' ? 'Browser ne Pointer Lock allow kiya. Ring se navigate karein.' :
                                        cursorTest === 'unavailable' ? 'Browser ne Pointer Lock allow nahi kiya. Normal TV navigation chalu hai.' :
                                        cursorTest === 'released' ? 'Pointer Lock release ho gaya. Normal TV navigation chalu hai.' :
                                        cursorTest === 'trying' ? 'Agar TV ijazat maange to allow karein.' :
                                        'Sirf aapke OK par try hoga; automatic nahi.'}
                                </Text>
                                <Text style={styles.cursorTestDescription}>
                                    Agar remote ruk jaye, RETURN / Escape dabakar unlock karein.
                                    TV Mode OFF karne se bhi unlock hoga. Browser refuse kare to focus ring pehle ki tarah chalegi.
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
                                    <Text style={styles.diagLine}>Remote style setting: {pointerPreference}</Text>
                                    <Text style={styles.diagHint}>
                                        Remote par koi bhi arrow dabayein — yahan 'keys' ya 'pointer' turant badlega.
                                        Kuch na badle to upar 'Pointer arrow' chun lein.
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
        marginTop: 4,
    },
    modeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 10,
    },
    modeCard: {
        flexGrow: 1,
        flexBasis: 190,
        backgroundColor: '#1c1c1c',
        borderWidth: 2,
        borderColor: '#333',
        borderRadius: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    modeCardActive: {
        borderColor: '#46d369',
        backgroundColor: 'rgba(70, 211, 105, 0.10)',
    },
    modeTitle: {
        color: '#e8e8e8',
        fontSize: 14.5,
        fontWeight: '800',
        marginBottom: 4,
    },
    modeDesc: {
        color: '#aaa',
        fontSize: 12.5,
        lineHeight: 18,
    },
    modeHint: {
        color: '#cfcfcf',
        fontSize: 12.5,
        lineHeight: 19,
        marginBottom: 18,
    },
    cursorTestBox: {
        backgroundColor: '#121920',
        borderWidth: 1,
        borderColor: '#385267',
        borderRadius: 8,
        padding: 16,
        marginBottom: 20,
    },
    cursorTestTitle: {
        color: '#e8f5ff',
        fontSize: 16,
        fontWeight: '800',
        marginBottom: 8,
    },
    cursorTestDescription: {
        color: '#d0d9e0',
        fontSize: 12.5,
        lineHeight: 19,
        marginBottom: 8,
    },
    cursorTestButton: {
        backgroundColor: '#286998',
        borderRadius: 7,
        paddingVertical: 13,
        paddingHorizontal: 15,
        alignItems: 'center',
        marginVertical: 8,
    },
    cursorTestButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '800',
    },
    cursorTestStatus: {
        color: '#a9dbfa',
        fontSize: 12.5,
        lineHeight: 19,
        marginBottom: 8,
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
