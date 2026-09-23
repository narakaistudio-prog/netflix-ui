import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { MovieRow } from '@/types/movie';
import { MovieList } from './MovieList';

const IS_WEB = Platform.OS === 'web';

type Props = MovieRow & { eager?: boolean; hideExploreAll?: boolean };

function scrollParent(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement;
    while (parent) {
        // The shelves live in a nested ScrollView rather than window scroll.
        // Observe that scrollport so we can render *before* the row appears.
        if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
        parent = parent.parentElement;
    }
    return null;
}

/** Defer below-the-fold shelves, without removing them from the scroll layout. */
export function DeferredMovieList({ eager = false, ...row }: Props) {
    const [ready, setReady] = useState(eager || !IS_WEB);
    const ref = useRef<View>(null);

    useEffect(() => {
        if (ready || !IS_WEB) return;
        const element = ref.current as unknown as HTMLElement | null;
        if (!element) return;
        if (typeof IntersectionObserver === 'undefined') {
            setReady(true);
            return;
        }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                observer.disconnect();
                setReady(true);
            }
        }, { root: scrollParent(element), rootMargin: '700px 0px' });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ready]);

    if (!IS_WEB) return <MovieList {...row} />;

    return (
        <View ref={ref} style={styles.wrapper}>
            {ready ? <MovieList {...row} /> : (
                <View style={styles.placeholder} testID={`deferred-row-${row.rowTitle}`}>
                    <Text style={styles.title}>{row.rowTitle}</Text>
                    <View style={styles.cards}>
                        {[0, 1, 2, 3].map(index => <View key={index} style={styles.card} />)}
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: { width: '100%', flexShrink: 0 },
    placeholder: { height: 370, paddingHorizontal: 48, paddingTop: 2 },
    title: { fontSize: 22, fontWeight: '800', color: '#e5e5e5', marginBottom: 18 },
    cards: { flexDirection: 'row', gap: 12 },
    card: { width: 175, height: 255, backgroundColor: '#1c1c1c', borderRadius: 4 },
});
