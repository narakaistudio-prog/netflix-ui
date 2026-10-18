// @ts-nocheck — the sealed nxsha payload crypto must interop with CryptoJS,
// because that is what the nxsha player and every open-source extractor use.
import CryptoJS from 'crypto-js';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { seal, open, evpBytesToKey } = require('../api/nxsha-crypto.cjs');

const PASS = 'S8x!Jk4ZP1uG8$my';

describe('sealed payload crypto (CryptoJS interop)', () => {
    test('open() decrypts what CryptoJS sealed', () => {
        const payload = { provider: 'gbru', tmdbId: '550', type: 'movie', method: 'stream', _req_ts: 1 };
        const sealed = CryptoJS.AES.encrypt(JSON.stringify(payload), PASS).toString();
        expect(open(sealed)).toEqual(payload);
    });

    test('seal() output decrypts with CryptoJS (after the url-safe undo, as the wire format works)', () => {
        const payload = { servers: [{ id: 'gbru', name: 'GbruHindi' }] };
        const sealed = seal(payload);
        // URL-safe alphabet — it travels inside a URL query.
        expect(sealed).not.toMatch(/[+/=]/);
        // The nxsha server does exactly this conversion (the extractors
        // mirror it): base64url back to base64 before CryptoJS decrypt.
        let text64 = sealed.replace(/-/g, '+').replace(/_/g, '/');
        while (text64.length % 4) text64 += '=';
        const text = CryptoJS.AES.decrypt(text64, PASS).toString(CryptoJS.enc.Utf8);
        expect(JSON.parse(text)).toEqual(payload);
    });

    test('salted containers: two seals of the same payload differ, both open', () => {
        const payload = { a: 1 };
        const first = seal(payload);
        const second = seal(payload);
        expect(first).not.toBe(second); // random salt
        expect(open(first)).toEqual(payload);
        expect(open(second)).toEqual(payload);
    });

    test('garbage opens to null', () => {
        expect(open('')).toBeNull();
        expect(open('not-sealed-at-all')).toBeNull();
        // base64 of plain text without the Salted__ marker
        expect(open(Buffer.from('hello world hello world').toString('base64'))).toBeNull();
    });

    test('evpBytesToKey derives 32-byte key + 16-byte iv', () => {
        const { key, iv } = evpBytesToKey(PASS, Buffer.alloc(8, 7));
        expect(key.length).toBe(32);
        expect(iv.length).toBe(16);
        // Deterministic for the same salt.
        const again = evpBytesToKey(PASS, Buffer.alloc(8, 7));
        expect(again.key.equals(key)).toBe(true);
        expect(again.iv.equals(iv)).toBe(true);
    });
});
