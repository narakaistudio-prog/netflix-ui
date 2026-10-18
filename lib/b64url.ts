/**
 * Base64url helpers shared by the nxsha stream resolver.
 *
 * The nxsha API carries AES output in the URL, so the standard base64 of
 * CryptoJS is converted to the URL-safe alphabet (and back for responses).
 */

export function base64ToB64url(value: string): string {
    return String(value || '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export function b64urlToBase64(value: string): string {
    let text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (text.length % 4) text += '=';
    return text;
}
