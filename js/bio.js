// Entsperren per Fingerabdruck / Gesichtserkennung (WebAuthn-Passkey mit PRF-Erweiterung).
//
// Beim Einrichten legt das Handy einen Passkey an (Android: Google-Passwortmanager). Bei jeder
// Bestätigung per Fingerabdruck liefert der Passkey über "PRF" immer denselben geheimen Wert.
// Daraus wird ein AES-Schlüssel, mit dem das App-Passwort verschlüsselt auf dem Gerät liegt.
// Ohne Fingerabdruck kommt man an diesen Wert nicht heran – das Passwort bleibt geschützt.
import { idbGet, idbSet, idbDel } from './db.js';
import { randomBytes, encryptText, decryptText } from './crypto.js';

const UNSUPPORTED = 'Dieses Gerät unterstützt das Entsperren per Fingerabdruck in Apps leider nicht';

export async function bioSupported() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}
export const bioEnabled = async () => !!(await idbGet('bio'));
export const disableBio = () => idbDel('bio');

const aesFrom = (bytes) => crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

async function keyFromPasskey(credId, salt) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = cred.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error(UNSUPPORTED);
  return aesFrom(out);
}

/** Richtet den Fingerabdruck ein. Das Passwort muss vorher geprüft sein. */
export async function enableBio(password) {
  const salt = randomBytes(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Betreuerbuch', id: location.hostname },
      user: { id: randomBytes(16), name: 'Betreuerbuch', displayName: 'Betreuerbuch' },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const prf = cred.getClientExtensionResults().prf;
  if (!prf || prf.enabled === false) throw new Error(UNSUPPORTED);
  const credId = new Uint8Array(cred.rawId);
  // Manche Geräte liefern den Wert schon beim Anlegen, sonst ein zweites Mal bestätigen
  const key = prf.results?.first ? await aesFrom(prf.results.first) : await keyFromPasskey(credId, salt);
  await idbSet('bio', { credId, salt, box: await encryptText(key, password) });
}

/** Fragt den Fingerabdruck ab und liefert das App-Passwort. */
export async function passwordFromBio() {
  const bio = await idbGet('bio');
  if (!bio) throw new Error('Fingerabdruck ist nicht eingerichtet');
  const key = await keyFromPasskey(bio.credId, bio.salt);
  return decryptText(key, bio.box);
}

/** true, wenn der Nutzer den Dialog nur abgebrochen hat (kein echter Fehler). */
export const isCancel = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError';
