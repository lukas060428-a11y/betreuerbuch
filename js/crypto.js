// Verschlüsselung mit der Web Crypto API.
// Aus dem App-Passwort wird per PBKDF2 (600.000 Runden, SHA-256) ein AES-256-GCM-Schlüssel abgeleitet.
// Der Schlüssel existiert nur im Arbeitsspeicher, solange die App entsperrt ist.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const ITERATIONS = 600000;

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Verschlüsselt Bytes → { iv: Uint8Array, data: ArrayBuffer } */
export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv, data };
}
/** Wirft einen Fehler, wenn Schlüssel falsch oder Daten verändert wurden. */
export async function decryptBytes(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, key, box.data));
}
export const encryptText = (key, text) => encryptBytes(key, enc.encode(text));
export const decryptText = async (key, box) => dec.decode(await decryptBytes(key, box));

// ---------- Base64 (für Sicherungsdateien) ----------
export function toB64(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const boxToB64 = (box) => ({ iv: toB64(box.iv), data: toB64(box.data) });
export const boxFromB64 = (b) => ({ iv: fromB64(b.iv), data: fromB64(b.data) });
