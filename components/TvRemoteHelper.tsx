import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTvMode, useTvBackHandler } from '@/hooks/useTvNavigation';

interface Props {
    isOpen?: boolean;
    onClose?: () => void;
}

export function TvRemoteHelper({ isOpen: controlledIsOpen, onClose }: Props) {
    const { isTvMode, isTvDevice, toggleTvMode } = useTvMode();
    const [internalOpen, setInternalOpen] = useState(false);
    const [dismissedBanner, setDismissedBanner] = useState(false);

    const isModalOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

    // Auto-show tip banner once on Smart TV
    useEffect(() => {
        if (Platform.OS !== 'web') return;
        if (isTvDevice && !dismissedBanner) {
            // Keep banner visible or let user open full guide
        }
    }, [isTvDevice, dismissedBanner]);

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

    return (
        <>
            {/* TV Mode Guide Modal */}
            {isModalOpen && (
                <View
                    style={styles.modalBackdrop}
                    {...({ dataSet: { tvScope: 'tv-guide-modal' } } as any)}
                >
                    <View style={styles.modalCard}>
                        {/* Header */}
                        <View style={styles.modalHeader}>
                            <View style={styles.headerTitleRow}>
                                <Ionicons name="tv-outline" size={26} color="#E50914" />
                                <Text style={styles.modalTitle}>Samsung Smart TV Remote Control</Text>
                            </View>
                            <Pressable
                                onPress={handleClose}
                                tabIndex={0}
                                accessibilityRole="button"
                                accessibilityLabel="Close TV remote guide"
                                {...({ dataSet: { tvFocusable: 'true', tvRow: 'tv-modal-close' } } as any)}
                                style={({ hovered }: any) => [styles.closeBtn, hovered && { backgroundColor: '#333' }]}
                            >
                                <Ionicons name="close" size={24} color="#fff" />
                            </Pressable>
                        </View>

                        {/* Samsung Browser Arrow Pointer Solution */}
                        <View style={styles.tipBox}>
                            <View style={styles.tipTitleRow}>
                                <Ionicons name="bulb-outline" size={22} color="#f5c518" />
                                <Text style={styles.tipHeading}>
                                    Samsung TV Browser me Arrow Pointer ko kaise hatayein:
                                </Text>
                            </View>
                            <Text style={styles.tipText}>
                                1. Samsung TV browser ke top-right corner par <Text style={styles.bold}>'Link Browsing'</Text> (pointer switch) icon par OK dabayein.
                            </Text>
                            <Text style={styles.tipText}>
                                2. Mouse ka arrow pointer band ho jayega aur website bilkul <Text style={styles.bold}>Netflix TV App</Text> ki tarah chalegi!
                            </Text>
                        </View>

                        {/* Remote Buttons Legend */}
                        <Text style={styles.sectionHeader}>Remote Controls Guide</Text>
                        <View style={styles.controlsGrid}>
                            <View style={styles.controlItem}>
                                <View style={styles.keyBadge}>
                                    <Text style={styles.keyText}>⬆️ ⬇️ ⬅️ ➡️</Text>
                                </View>
                                <View style={styles.controlTextCol}>
                                    <Text style={styles.controlTitle}>D-Pad Arrows</Text>
                                    <Text style={styles.controlDesc}>Movies, rows aur menus ke beech move karein</Text>
                                </View>
                            </View>

                            <View style={styles.controlItem}>
                                <View style={styles.keyBadge}>
                                    <Text style={styles.keyText}>OK / ENTER</Text>
                                </View>
                                <View style={styles.controlTextCol}>
                                    <Text style={styles.controlTitle}>Select / Play</Text>
                                    <Text style={styles.controlDesc}>Selected movie open karein ya video play karein</Text>
                                </View>
                            </View>

                            <View style={styles.controlItem}>
                                <View style={styles.keyBadge}>
                                    <Text style={styles.keyText}>RETURN / ↩️</Text>
                                </View>
                                <View style={styles.controlTextCol}>
                                    <Text style={styles.controlTitle}>Back Button</Text>
                                    <Text style={styles.controlDesc}>Player ya detail modal band karke wapas jayein</Text>
                                </View>
                            </View>

                            <View style={styles.controlItem}>
                                <View style={styles.keyBadge}>
                                    <Text style={styles.keyText}>⏯️ PLAY/PAUSE</Text>
                                </View>
                                <View style={styles.controlTextCol}>
                                    <Text style={styles.controlTitle}>Media Keys</Text>
                                    <Text style={styles.controlDesc}>Video pause ya resume karein</Text>
                                </View>
                            </View>
                        </View>

                        {/* Status & Toggle */}
                        <View style={styles.footerRow}>
                            <View style={styles.statusIndicator}>
                                <View style={[styles.statusDot, { backgroundColor: isTvMode ? '#46d369' : '#888' }]} />
                                <Text style={styles.statusText}>
                                    Spatial Remote Mode: <Text style={styles.bold}>{isTvMode ? 'Active (ON)' : 'Standard'}</Text>
                                </Text>
                            </View>

                            <Pressable
                                onPress={toggleTvMode}
                                tabIndex={0}
                                accessibilityRole="button"
                                {...({ dataSet: { tvFocusable: 'true', tvRow: 'tv-modal-toggle' } } as any)}
                                style={({ hovered }: any) => [styles.toggleBtn, hovered && { opacity: 0.85 }]}
                            >
                                <Text style={styles.toggleBtnText}>
                                    {isTvMode ? 'Disable TV Mode' : 'Enable TV Mode'}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
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
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 99999,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalCard: {
        width: '92%',
        maxWidth: 680,
        backgroundColor: '#181818',
        borderRadius: 12,
        padding: 28,
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
        marginBottom: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#282828',
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    modalTitle: {
        fontSize: 22,
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
    tipBox: {
        backgroundColor: 'rgba(245, 197, 24, 0.1)',
        borderLeftWidth: 4,
        borderLeftColor: '#f5c518',
        borderRadius: 8,
        padding: 16,
        marginBottom: 22,
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
    },
    tipText: {
        fontSize: 14,
        color: '#e5e5e5',
        lineHeight: 22,
        marginBottom: 4,
    },
    bold: {
        fontWeight: '700',
        color: '#fff',
    },
    sectionHeader: {
        fontSize: 16,
        fontWeight: '700',
        color: '#aaa',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 14,
    },
    controlsGrid: {
        gap: 12,
        marginBottom: 24,
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
        minWidth: 110,
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
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#282828',
    },
    statusIndicator: {
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
        color: '#ccc',
    },
    toggleBtn: {
        backgroundColor: '#E50914',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 6,
    },
    toggleBtnText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
});
