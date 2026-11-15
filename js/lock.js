// Sperrbildschirm: Ersteinrichtung des Passworts, Entsperren, "Passwort vergessen".
import { $, icon, confirmDialog, toast } from './util.js';
import { createVault, unlock, wipeAll, importBackup } from './store.js';
import { cloudAvailable, preloadGoogle, downloadBackup, restoreFromDrive } from './cloud.js';
import { bioEnabled, passwordFromBio, disableBio, isCancel } from './bio.js';

const MIN_LEN = 6;
const el = () => $('#lock');

function show(html) {
  const l = el();
  l.innerHTML = `<div class="lock-card"><img src="icon.svg?v=2" class="lock-logo" alt=""><h1>Betreuerbuch</h1>${html}</div>`;
  l.hidden = false;
  document.body.classList.add('locked');
}
export function hideLock() {
  el().hidden = true;
  el().innerHTML = '';
  document.body.classList.remove('locked');
}

const pwField = (id, ph, auto) => `<div class="pw"><input type="password" id="${id}" placeholder="${ph}" autocomplete="${auto}">
  <button type="button" class="icon-btn" data-toggle="${id}" aria-label="Passwort anzeigen">${icon('eye')}</button></div>`;
function wireToggles() {
  el().querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => {
    const i = $('#' + b.dataset.toggle);
    i.type = i.type === 'password' ? 'text' : 'password';
  });
}

export function showSetup(onDone) {
  show(`
    <p>Willkommen! Hier liegen später sensible Daten deiner Klienten. Deshalb wird alles <b>verschlüsselt</b> auf diesem Gerät gespeichert.</p>
    <p class="small">Lege ein App-Passwort fest (mindestens ${MIN_LEN} Zeichen). <b>Wichtig:</b> Ohne dieses Passwort kommt niemand an die Daten – auch du nicht. Bitte gut merken oder sicher notieren.</p>
    <div class="stack">
      ${pwField('pw1', 'Neues Passwort', 'new-password')}
      ${pwField('pw2', 'Passwort wiederholen', 'new-password')}
      <button class="btn primary big" id="pw-go">Los geht's</button>
      <button class="link" id="pw-restore">Ich habe eine Sicherung – wiederherstellen</button>
    </div>`);
  wireToggles();
  $('#pw1').focus();
  const go = async () => {
    const a = $('#pw1').value, b = $('#pw2').value;
    if (a.length < MIN_LEN) return toast(`Bitte mindestens ${MIN_LEN} Zeichen`);
    if (a !== b) return toast('Die Passwörter stimmen nicht überein');
    $('#pw-go').disabled = true; $('#pw-go').textContent = 'Richte ein …';
    await createVault(a);
    onDone();
  };
  $('#pw-go').onclick = go;
  $('#pw2').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('#pw-restore').onclick = () => showRestore(onDone, () => showSetup(onDone));
}

/** auto = Fingerabdruck sofort abfragen (beim App-Start). */
export async function showUnlock(onDone, { auto = false } = {}) {
  const withBio = await bioEnabled();
  show(`
    ${withBio ? `<button class="btn primary big" id="bio-go">${icon('finger')} Mit Fingerabdruck entsperren</button>
      <p class="small muted" style="text-align:center">oder mit Passwort:</p>` : '<p>Bitte App-Passwort eingeben.</p>'}
    <div class="stack">
      ${pwField('pw', 'Passwort', 'current-password')}
      <button class="btn ${withBio ? 'secondary' : 'primary'} big" id="pw-go">Entsperren</button>
      <button class="link" id="pw-forgot">Passwort vergessen?</button>
    </div>`);
  wireToggles();
  if (!withBio) setTimeout(() => $('#pw')?.focus(), 50);

  const bioGo = async () => {
    const b = $('#bio-go');
    if (!b || b.disabled) return;
    b.disabled = true;
    try {
      const pw = await passwordFromBio();
      if (await unlock(pw)) return onDone();
      // Passwort wurde inzwischen geändert (z. B. Sicherung eingespielt) → neu einrichten
      await disableBio();
      toast('Bitte mit Passwort entsperren und den Fingerabdruck neu einrichten');
      b.remove();
    } catch (e) {
      if (!isCancel(e)) toast(e.message);
      b.disabled = false;
    }
  };
  if (withBio) {
    $('#bio-go').onclick = bioGo;
    if (auto) bioGo();
  }
  const go = async () => {
    const btn = $('#pw-go');
    btn.disabled = true; btn.textContent = 'Prüfe …';
    if (await unlock($('#pw').value)) return onDone();
    btn.disabled = false; btn.textContent = 'Entsperren';
    $('#pw').value = '';
    toast('Falsches Passwort');
    $('#pw').focus();
  };
  $('#pw-go').onclick = go;
  $('#pw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('#pw-forgot').onclick = () => showForgot(onDone);
}

function showForgot(onDone) {
  show(`
    <p>Das Passwort kann nicht zurückgesetzt werden – genau das schützt die Daten deiner Klienten.</p>
    <p class="small">Möglichkeiten:</p>
    <div class="stack">
      <button class="btn secondary block" id="f-back">Nochmal versuchen</button>
      <button class="btn secondary block" id="f-restore">Sicherungsdatei einspielen</button>
      <button class="btn danger block" id="f-wipe">Alle Daten löschen und neu anfangen</button>
    </div>`);
  $('#f-back').onclick = () => showUnlock(onDone);
  $('#f-restore').onclick = () => showRestore(onDone, () => showForgot(onDone));
  $('#f-wipe').onclick = async () => {
    if (!(await confirmDialog('Wirklich ALLE Daten auf diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.', 'Alles löschen'))) return;
    await wipeAll();
    showSetup(onDone);
  };
}

function showRestore(onDone, onBack) {
  let drive = null; // geladene Sicherung aus Google Drive
  show(`
    <p>Woher soll die Sicherung kommen? Danach das Passwort eingeben, das beim Sichern galt.</p>
    <div class="stack">
      ${cloudAvailable() ? `<button class="btn secondary block" id="r-drive">${icon('download')} Aus Google Drive laden</button>
        <div id="r-drive-info" class="small" hidden></div>
        <div class="small muted">oder Sicherungsdatei wählen:</div>` : ''}
      <input type="file" id="r-file" accept=".json,application/json">
      ${pwField('r-pw', 'Passwort der Sicherung', 'current-password')}
      <button class="btn primary big" id="r-go">Wiederherstellen</button>
      <button class="link" id="r-back">Zurück</button>
    </div>`);
  wireToggles();
  $('#r-back').onclick = onBack;
  if (cloudAvailable()) preloadGoogle().catch(() => {});
  $('#r-drive')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Verbinde mit Google …';
    try {
      drive = await downloadBackup();
      const info = $('#r-drive-info');
      info.hidden = false;
      info.innerHTML = drive
        ? `✓ Sicherung gefunden vom <b>${new Date(drive.meta.modifiedTime).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</b>. Jetzt Passwort eingeben.`
        : '<span class="err">In diesem Google-Konto liegt noch keine Sicherung.</span>';
      if (drive) $('#r-pw').focus();
    } catch (err) { toast(err.message); }
    b.disabled = false; b.innerHTML = `${icon('download')} Aus Google Drive laden`;
  });
  $('#r-go').onclick = async () => {
    const f = $('#r-file').files[0];
    if (!drive && !f) return toast('Bitte zuerst eine Sicherung auswählen');
    const btn = $('#r-go');
    btn.disabled = true; btn.textContent = 'Prüfe …';
    try {
      const pw = $('#r-pw').value;
      const ok = drive && !f ? await restoreFromDrive(drive, pw) : await importBackup(JSON.parse(await f.text()), pw);
      if (ok) { toast('Sicherung wiederhergestellt'); return onDone(); }
      toast('Falsches Passwort für diese Sicherung');
    } catch (e) { toast(e.message || 'Datei konnte nicht gelesen werden'); }
    btn.disabled = false; btn.textContent = 'Wiederherstellen';
  };
}
