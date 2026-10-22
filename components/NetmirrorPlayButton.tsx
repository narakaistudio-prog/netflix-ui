import React from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
import { NETMIRROR_PLAY_ASPECT } from '@/lib/netmirror';

/**
 * NetMirror ka **asli** Play button — owner ke screenshot se crop kiya hua.
 *
 * Owner: "netmirror wala jo play ke button hai usse as crop karke laga dena
 * apne play ke button se replace kar dena... jab mai Other server select karu
 * tab ye hona chahiye."
 *
 * Asset `assets/netmirror/netmirror-play.png` (316×106) unke button (158×53)
 * ka 2x crop hai, rounded corners transparent — to kisi bhi hero image par
 * apne button jaisa hi baithta hai. Press karne par NetMirror khulta hai
 * (embed/login ki wajah se new tab me — `openNetmirror` in the modal).
 */
export function NetmirrorPlayButton({
    onPress,
    height = 44,
}: {
    onPress: () => void;
    /** Button ki height — width aspect se khud nikal aati hai. */
    height?: number;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={[styles.button, { height, width: Math.round(height * NETMIRROR_PLAY_ASPECT) }]}
            accessibilityRole="button"
            accessibilityLabel="Play on NetMirror (Other server)"
            testID="netmirror-play"
        >
            <Image
                source={require('../assets/netmirror/netmirror-play.png')}
                style={styles.image}
                resizeMode="contain"
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    /** Hero me apne Play button ki jagah — same left alignment. */
    button: {
        alignSelf: 'flex-start',
        justifyContent: 'center',
        borderRadius: 4,
        overflow: 'hidden',
    },
    image: { width: '100%', height: '100%' },
});
