// @ts-nocheck — verify browser image priority without making network requests.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { SafeImage } from '../components/SafeImage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('loads posters lazily and allows the above-the-fold hero to load eagerly', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
        <SafeImage source={{ uri: 'https://example.com/poster.jpg' }} style={{ width: 175, height: 255 }} />,
    ));
    let image = container.querySelector('img')!;
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');

    act(() => root.render(
        <SafeImage source={{ uri: 'https://example.com/poster.jpg' }} style={{ width: 175, height: 255 }} loading="eager" />,
    ));
    image = container.querySelector('img')!;
    expect(image.getAttribute('loading')).toBe('eager');
    act(() => root.unmount());
    container.remove();
});
