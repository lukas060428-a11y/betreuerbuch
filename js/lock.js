// Sperrbildschirm: Ersteinrichtung des Passworts, Entsperren, "Passwort vergessen".
import { $, icon, confirmDialog, toast } from './util.js';
import { createVault, unlock, wipeAll, importBackup } from './store.js';

const MIN_LEN = 6;
const el = () => $('#lock');

function show(html) {
  const l = el();
  l.innerHTML = `<div class="lock-card"><img src="icon.svg" class="lock-logo" alt=""><h1>Betreuerbuch</h1>${html}</div>`;
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

export function showUnlock(onDone) {
  show(`
    <p>Bitte App-Passwort eingeben.</p>
    <div class="stack">
      ${pwField('pw', 'Passwort', 'current-password')}
      <button class="btn primary big" id="pw-go">Entsperren</button>
      <button class="link" id="pw-forgot">Passwort vergessen?</button>
    </div>`);
  wireToggles();
  setTimeout(() => $('#pw')?.focus(), 50);
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
  show(`
    <p>Wähle die Sicherungsdatei (.json) und gib das Passwort ein, das beim Erstellen der Sicherung galt.</p>
    <div class="stack">
      <input type="file" id="r-file" accept=".json,application/json">
      ${pwField('r-pw', 'Passwort der Sicherung', 'current-password')}
      <button class="btn primary big" id="r-go">Wiederherstellen</button>
      <button class="link" id="r-back">Zurück</button>
    </div>`);
  wireToggles();
  $('#r-back').onclick = onBack;
  $('#r-go').onclick = async () => {
    const f = $('#r-file').files[0];
    if (!f) return toast('Bitte eine Datei auswählen');
    const btn = $('#r-go');
    btn.disabled = true; btn.textContent = 'Prüfe …';
    try {
      const ok = await importBackup(JSON.parse(await f.text()), $('#r-pw').value);
      if (ok) { toast('Sicherung wiederhergestellt'); return onDone(); }
      toast('Falsches Passwort für diese Sicherung');
    } catch (e) { toast(e.message || 'Datei konnte nicht gelesen werden'); }
    btn.disabled = false; btn.textContent = 'Wiederherstellen';
  };
}
