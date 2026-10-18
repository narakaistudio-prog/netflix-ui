'use strict';

/**
 * Sealed-payload crypto for the nxsha internal API (server-side).
 *
 * The API carries AES-encrypted JSON in the `q` query param and answers with
 * an encrypted `_hash` field. The format is the OpenSSL "Salted__" container
 * that CryptoJS produces by default: AES-256-CBC, key+IV derived from the
 * passphrase with EVP_BytesToKey (MD5, 1 iteration), PKCS#7 padding.
 * Implemented here with node:crypto only — no extra dependency on the edge.
 *
 * The passphrase ships inside the open-source nxsha extractors.
 */

const crypto = require('node:crypto');

const PASSPHRASE = 'S8x!Jk4ZP1uG8$my';

/** OpenSSL EVP_BytesToKey (MD5, count=1): key 32 bytes, IV 16 bytes. */
function evpBytesToKey(passphrase, salt, keyLen, ivLen) {
    keyLen = keyLen || 32;
    ivLen = ivLen || 16;
    const blocks = [];
    let prev = Buffer.alloc(0);
    let total = 0;
    while (total < keyLen + ivLen) {
        prev = crypto
            .createHash('md5')
            .update(Buffer.concat([prev, Buffer.from(passphrase, 'utf8'), salt]))
            .digest();
        blocks.push(prev);
        total += prev.length;
    }
    const all = Buffer.concat(blocks);
    return { key: all.subarray(0, keyLen), iv: all.subarray(keyLen, keyLen + ivLen) };
}

/** JSON payload -> base64url sealed string (the `q` value). */
function seal(payload) {
    const salt = crypto.randomBytes(8);
    const { key, iv } = evpBytesToKey(PASSPHRASE, salt);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const body = Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
        cipher.final(),
    ]);
    const sealed = Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, body]);
    return sealed
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/** base64url sealed string -> JSON payload, or null when undecryptable. */
function open(b64url) {
    if (typeof b64url !== 'string' || !b64url) return null;
    let text = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (text.length % 4) text += '=';
    let raw;
    try {
        raw = Buffer.from(text, 'base64');
    } catch {
        return null;
    }
    if (raw.length < 24 || raw.subarray(0, 8).toString('utf8') !== 'Salted__') return null;
    const { key, iv } = evpBytesToKey(PASSPHRASE, raw.subarray(8, 16));
    let plain;
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
    } catch {
        return null;
    }
    try {
        return JSON.parse(plain.toString('utf8'));
    } catch {
        return null;
    }
}

module.exports = { seal, open, evpBytesToKey, PASSPHRASE };
