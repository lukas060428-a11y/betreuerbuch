// Datenhaltung: ein verschlüsselter Tresor in IndexedDB.
//   meta        → { salt, iter }            (unverschlüsselt, enthält kein Geheimnis)
//   state       → verschlüsselter JSON-Stand aller Daten
//   doc:<id>    → verschlüsselte Datei (Foto/PDF)
import { idbGet, idbSet, idbDel, idbKeys, idbBatch } from './db.js';
import { deriveKey, randomBytes, encryptBytes, decryptBytes, encryptText, decryptText, ITERATIONS, toB64, fromB64, boxToB64, boxFromB64 } from './crypto.js';
import { toast } from './util.js';
import { DEFAULT_TEMPLATES } from './templates.js';

export const DEFAULT_PURPOSES = ['Hausbesuch', 'Bankangelegenheit', 'Amtsgericht', 'Behördengang', 'Arzttermin begleiten', 'Heimbesuch', 'Post / Unterlagen'];

const fresh = () => ({
  version: 2,
  settings: {
    ownerName: '', title: 'Berufsbetreuerin', office: '', phone: '', email: '',
    vehicle: '', home: null, rate: 0.30, autoLockMin: 5,
  },
  clients: [],
  places: [],
  trips: [],
  logs: [],
  deadlines: [],
  billing: [],
  docs: [],
  templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })),
  purposes: [...DEFAULT_PURPOSES],
  lastBackup: null,
  cloud: { connected: false },
});

function normalize(s) {
  const d = fresh();
  const out = { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
  for (const k of ['clients', 'places', 'trips', 'logs', 'deadlines', 'billing', 'docs', 'templates', 'purposes']) {
    if (!Array.isArray(out[k])) out[k] = d[k];
  }
  return out;
}

/** Live-Binding: andere Module lesen `state` direkt. */
export let state = null;
let key = null;
let writeChain = Promise.resolve();

export const isUnlocked = () => !!key;
export async function hasVault() { return !!(await idbGet('meta')); }

async function encryptState(k, s) { return encryptText(k, JSON.stringify(s)); }

export async function createVault(password) {
  const salt = randomBytes(16);
  const k = await deriveKey(password, salt);
  const s = migrateLegacy() || fresh();
  await idbBatch({ set: [['meta', { salt, iter: ITERATIONS }], ['state', await encryptState(k, s)]] });
  localStorage.removeItem(LEGACY_KEY); // unverschlüsselte Altdaten entfernen
  key = k; state = s;
}

export async function unlock(password) {
  const meta = await idbGet('meta');
  const k = await deriveKey(password, meta.salt, meta.iter);
  try {
    const s = JSON.parse(await decryptText(k, await idbGet('state')));
    key = k; state = normalize(s);
    return true;
  } catch { return false; }
}

export function lock() { key = null; state = null; }

let afterSave = () => {};
/** Wird nach jedem erfolgreichen Speichern aufgerufen (z. B. für die automatische Cloud-Sicherung). */
export const setAfterSave = (fn) => { afterSave = fn; };

/** Speichert den aktuellen Stand (Schreibvorgänge laufen nacheinander). */
export function save() {
  if (!key) return writeChain;
  const k = key, json = JSON.stringify(state);
  writeChain = writeChain
    .then(async () => { await idbSet('state', await encryptText(k, json)); afterSave(); })
    .catch((e) => { console.error(e); toast('Speichern fehlgeschlagen: ' + e.message); });
  return writeChain;
}

export async function changePassword(oldPw, newPw) {
  const meta = await idbGet('meta');
  const oldKey = await deriveKey(oldPw, meta.salt, meta.iter);
  try { await decryptBytes(oldKey, await idbGet('state')); } catch { return false; }
  const salt = randomBytes(16);
  const newKey = await deriveKey(newPw, salt);
  // Erst alles im Speicher neu verschlüsseln, dann in einer Transaktion schreiben.
  const set = [['meta', { salt, iter: ITERATIONS }], ['state', await encryptState(newKey, state)]];
  for (const k of (await idbKeys()).filter((x) => String(x).startsWith('doc:'))) {
    const bytes = await decryptBytes(oldKey, await idbGet(k));
    set.push([k, await encryptBytes(newKey, bytes)]);
  }
  await writeChain;
  await idbBatch({ set });
  key = newKey;
  return true;
}

/** Alles löschen (z. B. Passwort vergessen). */
export async function wipeAll() {
  await idbBatch({ clear: true });
  localStorage.removeItem(LEGACY_KEY);
  lock();
}

// ---------- Dokumente ----------
export async function putDoc(id, bytes) { await idbSet('doc:' + id, await encryptBytes(key, bytes)); }
export async function getDoc(id) {
  const box = await idbGet('doc:' + id);
  return box ? decryptBytes(key, box) : null;
}
export const delDoc = (id) => idbDel('doc:' + id);

// ---------- Sicherung ----------
// Die Sicherungsdatei bleibt verschlüsselt (mit dem Passwort zum Zeitpunkt der Sicherung).
export async function exportBackup() {
  await save();
  const meta = await idbGet('meta');
  const docs = {};
  for (const k of (await idbKeys()).filter((x) => String(x).startsWith('doc:'))) docs[k] = boxToB64(await idbGet(k));
  return {
    app: 'betreuerbuch', format: 2, created: new Date().toISOString(),
    salt: toB64(meta.salt), iter: meta.iter,
    state: boxToB64(await idbGet('state')),
    docs,
  };
}

/** Prüft das Passwort einer Sicherung und ersetzt bei Erfolg alle Daten auf dem Gerät. */
export async function importBackup(file, password) {
  if (file.app !== 'betreuerbuch' || !file.state || !file.salt) throw new Error('Keine gültige Sicherungsdatei');
  const salt = fromB64(file.salt);
  const k = await deriveKey(password, salt, file.iter);
  const stateBox = boxFromB64(file.state);
  let s;
  try { s = JSON.parse(await decryptText(k, stateBox)); } catch { return false; }
  const set = [['meta', { salt, iter: file.iter }], ['state', stateBox]];
  for (const [kk, b] of Object.entries(file.docs || {})) set.push([kk, boxFromB64(b)]);
  await writeChain;
  await idbBatch({ clear: true, set });
  key = k; state = normalize(s);
  return true;
}

// ---------- Übernahme aus der ersten Version (unverschlüsselt in localStorage) ----------
const LEGACY_KEY = 'fahrtenbuch.v1';
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    const s = fresh();
    Object.assign(s.settings, { ownerName: old.settings?.ownerName || '', vehicle: old.settings?.vehicle || '', home: old.settings?.home || null, rate: old.settings?.rate ?? 0.30 });
    s.places = (old.places || []).map(({ id, name, category, address, lat, lon, kmTo, kmBack, note }) => ({ id, name, category, address, lat, lon, kmTo, kmBack, note }));
    s.trips = (old.trips || []).map((t) => ({ ...t, stops: t.stops.map(({ placeId, ...rest }) => ({ ref: placeId, ...rest })) }));
    if (old.purposes) s.purposes = old.purposes;
    return s;
  } catch { return null; }
}
