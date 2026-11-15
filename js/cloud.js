// Sicherung in Google Drive.
// Die Datei liegt im versteckten App-Bereich ("appDataFolder") des Google-Kontos und ist mit dem
// App-Passwort verschlüsselt – Google kann den Inhalt nicht lesen. Die App darf nur auf diesen
// eigenen Bereich zugreifen, nicht auf andere Dateien im Drive.
import { state, save, exportBackup, importBackup, isUnlocked } from './store.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import { $, esc, fmtDate, toast, openDialog, closeDialog } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'betreuerbuch-sicherung.json';
const AUTO_INTERVAL_H = 12;   // beim Entsperren sichern, wenn letzte Sicherung älter ist
const LIVE_DELAY_MS = 60000;  // solange angemeldet: 1 Minute nach der letzten Änderung sichern

export const cloudAvailable = () => !!GOOGLE_CLIENT_ID;
export const cloudConnected = () => cloudAvailable() && !!state?.cloud?.connected;

let token = null;
let tokenExp = 0;
let gisPromise = null;
const hasToken = () => token && Date.now() < tokenExp - 60000;

function deviceId() {
  try {
    let id = localStorage.getItem('betreuerbuch.device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('betreuerbuch.device', id); }
    return id;
  } catch { return 'unbekannt'; }
}

export function preloadGoogle() {
  if (!cloudAvailable()) return Promise.resolve();
  return gisPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => { gisPromise = null; reject(new Error('Google ist nicht erreichbar')); };
    document.head.appendChild(s);
  });
}

/** Holt ein Zugriffstoken. Öffnet ggf. kurz ein Google-Fenster – muss aus einem Tipp heraus aufgerufen werden. */
async function getToken() {
  if (hasToken()) return token;
  await preloadGoogle();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      login_hint: state?.cloud?.email || undefined,
      callback: (r) => {
        if (r.error) return reject(new Error('Google hat den Zugriff nicht erlaubt'));
        token = r.access_token;
        tokenExp = Date.now() + r.expires_in * 1000;
        resolve(token);
      },
      error_callback: (e) => reject(new Error(
        e.type === 'popup_closed' ? 'Google-Anmeldung abgebrochen'
          : e.type === 'popup_failed_to_open' ? 'Google-Fenster wurde blockiert'
            : 'Google-Anmeldung fehlgeschlagen')),
    });
    client.requestAccessToken({ prompt: state?.cloud?.connected ? '' : 'consent' });
  });
}

async function api(path, opts = {}) {
  const t = await getToken();
  const r = await fetch('https://www.googleapis.com/' + path, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (r.status === 401) { token = null; throw new Error('Google-Anmeldung abgelaufen – bitte nochmal'); }
  if (!r.ok) throw new Error(`Google Drive meldet Fehler ${r.status}`);
  return r;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const r = await api(`drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size,appProperties)&orderBy=modifiedTime desc`);
  return (await r.json()).files[0] || null;
}

async function upload(existingId, body) {
  const meta = existingId
    ? { appProperties: { device: deviceId() } }
    : { name: FILE_NAME, parents: ['appDataFolder'], appProperties: { device: deviceId() } };
  // Fortsetzbarer Upload – funktioniert auch bei vielen Fotos (> 5 MB)
  const init = await api(`upload/drive/v3/files${existingId ? '/' + existingId : ''}?uploadType=resumable&fields=id,modifiedTime`, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  const location = init.headers.get('Location');
  if (!location) throw new Error('Upload zu Google Drive konnte nicht starten');
  const r = await fetch(location, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  if (!r.ok) throw new Error(`Upload fehlgeschlagen (${r.status})`);
  return r.json();
}

// ---------- Öffentliche Funktionen ----------

export async function connect() {
  await getToken();
  const about = await (await api('drive/v3/about?fields=user(emailAddress)')).json();
  state.cloud = { ...(state.cloud || {}), connected: true, email: about.user.emailAddress };
  await save();
  return state.cloud.email;
}

export async function disconnect({ deleteRemote = false } = {}) {
  if (deleteRemote) {
    const f = await findFile();
    if (f) await api(`drive/v3/files/${f.id}`, { method: 'DELETE' });
  }
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  state.cloud = { connected: false };
  await save();
}

/** Lädt die Sicherung hoch. Wirft {conflict} wenn ein anderes Gerät zwischenzeitlich neuer gesichert hat. */
async function uploadBackup({ force = false } = {}) {
  const remote = await findFile();
  const c = state.cloud || {};
  const otherDevice = remote && remote.appProperties?.device !== deviceId();
  if (!force && otherDevice && (!c.lastSync || remote.modifiedTime > c.lastSync)) {
    const e = new Error('Konflikt'); e.conflict = remote; throw e;
  }
  const now = new Date().toISOString();
  state.lastBackup = now;
  state.cloud = { ...c, lastUpload: now };
  const data = await exportBackup();
  const res = await upload(remote?.id, JSON.stringify(data));
  state.cloud.lastSync = res.modifiedTime;
  await save();
}

/** Holt die Sicherung aus Drive (verschlüsselt) – Entschlüsseln passiert in importBackup. */
export async function downloadBackup() {
  const f = await findFile();
  if (!f) return null;
  const data = await (await api(`drive/v3/files/${f.id}?alt=media`)).json();
  return { data, meta: f };
}

/** Ersetzt die Daten auf diesem Gerät durch die Drive-Sicherung. */
export async function restoreFromDrive(download, password) {
  const ok = await importBackup(download.data, password);
  if (!ok) return false;
  state.cloud = { ...(state.cloud || {}), connected: true, lastSync: download.meta.modifiedTime };
  await save();
  return true;
}

// ---------- Mit Oberfläche ----------
let busy = false;
let liveTimer = null;
let onChangeUi = () => {};
export const setCloudUiRefresh = (fn) => { onChangeUi = fn; };

/** Sichern mit Rückmeldung und Konfliktdialog. silent = keine Erfolgsmeldung. */
export async function backupNow({ silent = false, force = false } = {}) {
  if (!cloudConnected() || busy) return;
  busy = true;
  try {
    await uploadBackup({ force });
    if (!silent) toast('In Google Drive gesichert');
  } catch (e) {
    if (e.conflict) askConflict(e.conflict);
    else if (!silent) toast(e.message);
    else console.warn('Automatische Sicherung:', e.message);
  } finally {
    busy = false;
    onChangeUi();
  }
}

/** Beim Entsperren (= Tipp des Nutzers) aufrufen: sichert, wenn es Zeit ist. */
export function autoBackupOnUnlock() {
  if (!cloudConnected() || !navigator.onLine) return;
  const last = state.cloud.lastUpload ? Date.parse(state.cloud.lastUpload) : 0;
  if (Date.now() - last > AUTO_INTERVAL_H * 3600000) backupNow({ silent: true });
}

/** Nach jeder Änderung: solange ein Token da ist, kurz danach automatisch sichern. */
export function scheduleLiveBackup() {
  if (!cloudConnected() || !hasToken()) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { if (isUnlocked() && navigator.onLine) backupNow({ silent: true }); }, LIVE_DELAY_MS);
}

export function askPassword(title, text) {
  return new Promise((resolve) => {
    const dlg = openDialog(`<h3>${esc(title)}</h3><p class="small">${esc(text)}</p>
      <input type="password" id="ap-pw" style="width:100%" autocomplete="current-password">
      <div class="dlg-actions"><button class="btn secondary" data-no>Abbrechen</button><button class="btn primary" data-yes>Weiter</button></div>`);
    $('#ap-pw', dlg).focus();
    const done = (v) => { closeDialog(); resolve(v); };
    $('[data-no]', dlg).onclick = () => done(null);
    $('[data-yes]', dlg).onclick = () => done($('#ap-pw', dlg).value);
    $('#ap-pw', dlg).onkeydown = (e) => { if (e.key === 'Enter') done(e.target.value); };
  });
}

/** Auf diesem Gerät die Drive-Sicherung laden (ersetzt alles hier). */
export async function restoreInteractive() {
  try {
    const dl = await downloadBackup();
    if (!dl) return toast('In Google Drive liegt noch keine Sicherung');
    const pw = await askPassword('Sicherung aus Google Drive laden',
      `Stand: ${fmtDate(dl.meta.modifiedTime.slice(0, 10))}, ${new Date(dl.meta.modifiedTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr. Die Daten auf diesem Gerät werden ersetzt. Bitte das App-Passwort eingeben, das beim Sichern galt.`);
    if (pw == null) return false;
    if (!(await restoreFromDrive(dl, pw))) { toast('Falsches Passwort für diese Sicherung'); return false; }
    toast('Daten aus Google Drive geladen');
    onChangeUi();
    return true;
  } catch (e) { toast(e.message); return false; }
}

function askConflict(remote) {
  const when = new Date(remote.modifiedTime).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const dlg = openDialog(`
    <h3>Neuere Sicherung von einem anderen Gerät</h3>
    <p>Am <b>${esc(when)}</b> wurde von einem anderen Gerät (z. B. PC oder anderes Handy) in Google Drive gesichert – nach der letzten Sicherung von diesem Gerät.</p>
    <p class="small muted">Die App führt die Daten nicht zusammen. Bitte wähle, welcher Stand gelten soll.</p>
    <div class="stack">
      <button class="btn primary block" data-load>Stand aus Google Drive laden (ersetzt dieses Gerät)</button>
      <button class="btn danger block" data-force>Dieses Gerät hochladen (überschreibt Google Drive)</button>
      <button class="btn secondary block" data-cancel>Später entscheiden</button>
    </div>`);
  $('[data-cancel]', dlg).onclick = closeDialog;
  $('[data-force]', dlg).onclick = () => { closeDialog(); backupNow({ force: true }); };
  $('[data-load]', dlg).onclick = () => { closeDialog(); restoreInteractive(); };
}
