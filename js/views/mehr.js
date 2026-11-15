// "Mehr": Einstellungen, feste Orte, Textvorlagen, Export, Datensicherung, Sicherheit.
import { state, save, exportBackup, changePassword, verifyPassword } from '../store.js';
import { $, $$, esc, uid, fmtKm, fmtEur, fmtDate, todayISO, parseNum, toast, confirmDialog, openDialog, closeDialog, download, icon } from '../util.js';
import { tripsOfYear, tripYears, usageCounts } from '../model.js';
import { PLACEHOLDERS } from '../templates.js';
import { view, header, navigate, rerender, emptyState } from '../ui.js';
import { addrSearchHTML, wireAddrSearch, computeTargetKm, recomputeAllTargets } from '../geo.js';
import { exportXlsx, exportCsv, printTrips } from '../export.js';
import { bioSupported, bioEnabled, enableBio, disableBio, isCancel } from '../bio.js';
import { cloudAvailable, cloudConnected, connect, disconnect, backupNow, restoreInteractive } from '../cloud.js';

export function viewMore(lockNow) {
  header('Mehr');
  const items = [
    ['einstellungen', 'home', 'Meine Daten & Wohnadresse', state.settings.home?.address || 'Noch keine Wohnadresse'],
    ['orte', 'pin', 'Feste Orte', `${state.places.length} Orte – Bank, Gericht, Ämter …`],
    ['vorlagen', 'mail', 'Textvorlagen', `${state.templates.length} Vorlagen für Schreiben`],
    ['export', 'download', 'Fahrtenbuch exportieren', 'Excel, CSV, Drucken / PDF'],
    ['sicherung', 'shield', 'Datensicherung', (cloudConnected() ? 'Google Drive verbunden · ' : '') + (state.lastBackup ? 'zuletzt ' + fmtDate(state.lastBackup.slice(0, 10)) : 'noch nie gesichert')],
    ['sicherheit', 'key', 'Passwort & Sperre', `Automatisch sperren nach ${state.settings.autoLockMin} Min.`],
  ];
  view().innerHTML = `
    <div class="list">${items.map(([p, ic, t, sub]) => `
      <button class="item" data-nav="${p}">${icon(ic)}<div class="main"><div class="t1">${t}</div><div class="t2">${esc(sub)}</div></div><span class="chev">›</span></button>`).join('')}</div>
    <button class="btn secondary block" id="lock-now" style="margin-top:16px">${icon('lock')} Jetzt sperren</button>
    <p class="small muted" style="text-align:center;margin-top:24px">Alle Daten liegen verschlüsselt nur auf diesem Gerät.<br>Adresssuche & Routen: © OpenStreetMap-Mitwirkende, OSRM</p>`;
  $$('[data-nav]').forEach((b) => b.onclick = () => navigate(b.dataset.nav));
  $('#lock-now').onclick = lockNow;
}

// ---------- Einstellungen ----------
export function viewSettings() {
  header('Meine Daten', { back: 'mehr' });
  const s = state.settings;
  const f = (k, label, type = 'text', ph = '') => `<label class="field">${label}<input type="${type}" data-s="${k}" value="${esc(s[k] ?? '')}" placeholder="${ph}"></label>`;
  view().innerHTML = `
    <h2>Wohnadresse – Start jeder Fahrt</h2>
    <div class="card">
      ${s.home ? `<div class="addr-ok" style="padding-top:0">✓ ${esc(s.home.address)}</div>` : '<p class="small muted" style="margin-top:0">Noch nicht eingetragen.</p>'}
      ${addrSearchHTML('')}
    </div>
    <h2>Für Briefe & Export</h2>
    <div class="card stack">
      ${f('ownerName', 'Name', 'text', 'Vor- und Nachname')}
      ${f('title', 'Bezeichnung', 'text', 'z. B. Berufsbetreuerin')}
      ${f('office', 'Büroanschrift', 'text', 'Straße, PLZ Ort')}
      <div class="grid2">${f('phone', 'Telefon', 'tel')}${f('email', 'E-Mail', 'email')}</div>
    </div>
    <h2>Fahrtenbuch</h2>
    <div class="card stack">
      ${f('vehicle', 'Kennzeichen (optional)', 'text', 'z. B. K-AB 1234')}
      <label class="field">Kilometerpauschale in €<input type="number" inputmode="decimal" step="0.01" min="0" id="s-rate" value="${s.rate}"></label>
    </div>`;
  wireAddrSearch($('.addr', view()), async (r) => {
    s.home = { address: r.label, lat: r.lat, lon: r.lon };
    await save();
    if (state.clients.length || state.places.length) {
      toast('Wohnadresse gespeichert – Kilometer werden neu berechnet …');
      const fail = await recomputeAllTargets();
      toast(fail ? `Gespeichert. ${fail} Ziele konnten nicht berechnet werden.` : 'Wohnadresse gespeichert, km aktualisiert');
    } else toast('Wohnadresse gespeichert');
    viewSettings();
  });
  $$('[data-s]').forEach((i) => i.onchange = () => { s[i.dataset.s] = i.value.trim(); save(); toast('Gespeichert'); });
  $('#s-rate').onchange = (e) => {
    const v = parseNum(e.target.value);
    if (v != null && v >= 0) { s.rate = v; save(); toast('Gespeichert'); }
  };
}

// ---------- Feste Orte ----------
const PLACE_CATEGORIES = ['Bank', 'Behörde / Gericht', 'Arzt / Klinik', 'Heim / Einrichtung', 'Sonstiges'];

export function viewPlaces() {
  header('Feste Orte', { back: 'mehr', actions: [{ icon: 'plus', label: 'Neuer Ort', onClick: () => openPlaceDialog() }] });
  const usage = usageCounts();
  const places = [...state.places].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const missing = state.settings.home && [...state.places, ...state.clients].some((p) => p.lat != null && p.kmTo == null);
  view().innerHTML = `
    <p class="small muted pad" style="margin-top:0">Orte, zu denen du öfter fährst, die aber keine Klienten sind. Klienten mit Adresse erscheinen automatisch bei „Neue Fahrt“.</p>
    ${missing ? `<div class="banner">Bei manchen Zielen fehlen noch die Kilometer.<br><button class="btn secondary" id="recalc">Jetzt berechnen</button></div>` : ''}
    ${places.length ? `<div class="list" style="margin-top:12px">${places.map((p) => `
      <button class="item" data-edit="${p.id}">
        <div class="main"><div class="t1">${esc(p.name)} <span class="badge">${esc(p.category || 'Sonstiges')}</span></div><div class="t2">${esc(p.address)}</div></div>
        <div style="text-align:right"><div class="km">${p.kmTo != null ? fmtKm(p.kmTo) + ' km' : '–'}</div><div class="small muted">${usage[p.id] || 0}× gefahren</div></div>
      </button>`).join('')}</div>`
    : emptyState('pin', 'Noch keine festen Orte.', '<button class="btn primary" id="p-first">Ort anlegen</button>')}`;
  $$('[data-edit]').forEach((b) => b.onclick = () => openPlaceDialog(state.places.find((p) => p.id === b.dataset.edit)));
  $('#p-first')?.addEventListener('click', () => openPlaceDialog());
  $('#recalc')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Berechne …';
    const fail = await recomputeAllTargets();
    toast(fail ? `${fail} Ziele konnten nicht berechnet werden` : 'Kilometer aktualisiert');
    viewPlaces();
  });
}

function openPlaceDialog(place) {
  const editing = !!place;
  let picked = editing ? { label: place.address, lat: place.lat, lon: place.lon } : null;
  const dlg = openDialog(`
    <h3>${editing ? 'Ort bearbeiten' : 'Neuer Ort'}</h3>
    <div class="stack">
      <label class="field">Name<input type="text" id="p-name" value="${esc(place?.name || '')}" placeholder="z. B. Sparkasse Innenstadt"></label>
      <label class="field">Art<select id="p-cat">${PLACE_CATEGORIES.map((c) => `<option ${place?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <div><div class="small muted" style="margin-bottom:4px">Adresse ${editing ? `<span class="addr-ok">· aktuell: ${esc(place.address)}</span>` : ''}</div>${addrSearchHTML(place?.address || '')}</div>
      <label class="field">Notiz (optional)<input type="text" id="p-note" value="${esc(place?.note || '')}"></label>
    </div>
    <div class="dlg-actions">
      ${editing ? `<button class="btn danger" data-del>${icon('trash')}</button>` : ''}
      <button class="btn secondary" data-cancel>Abbrechen</button>
      <button class="btn primary" data-ok>Speichern</button>
    </div>`);
  wireAddrSearch($('.addr', dlg), (r) => { picked = r; if (!$('#p-name').value && r.name) $('#p-name').value = r.name; });
  $('[data-cancel]', dlg).onclick = closeDialog;
  $('[data-del]', dlg)?.addEventListener('click', async () => {
    if (!(await confirmDialog(`„${place.name}“ löschen? Eingetragene Fahrten bleiben erhalten.`))) return;
    state.places = state.places.filter((p) => p !== place);
    save(); toast('Ort gelöscht'); rerender();
  });
  $('[data-ok]', dlg).onclick = async (e) => {
    const name = $('#p-name').value.trim();
    if (!name) return toast('Bitte einen Namen eingeben');
    if (!picked) return toast('Bitte die Adresse suchen und auswählen');
    e.currentTarget.disabled = true; e.currentTarget.textContent = 'Berechne km …';
    const p = place || { id: uid() };
    const moved = p.lat !== picked.lat || p.lon !== picked.lon;
    Object.assign(p, { name, category: $('#p-cat').value, address: picked.label, lat: picked.lat, lon: picked.lon, note: $('#p-note').value.trim() });
    if (moved || p.kmTo == null) {
      p.kmTo = null; p.kmBack = null;
      try { await computeTargetKm(p); } catch { toast('km konnten nicht berechnet werden'); }
    }
    if (!editing) state.places.push(p);
    save(); closeDialog(); rerender();
  };
}

// ---------- Textvorlagen ----------
export function viewTemplates() {
  header('Textvorlagen', { back: 'mehr', actions: [{ icon: 'plus', label: 'Neue Vorlage', onClick: () => openTemplateDialog() }] });
  view().innerHTML = `
    <p class="small muted pad" style="margin-top:0">Vorlagen für Schreiben, die du immer wieder brauchst. Beim Klienten unter „Schreiben“ werden die Platzhalter automatisch ausgefüllt.</p>
    <div class="list">${state.templates.map((t) => `
      <button class="item" data-tpl="${t.id}">${icon('mail')}<div class="main"><div class="t1">${esc(t.title)}</div><div class="t2">${esc(t.subject)}</div></div><span class="chev">›</span></button>`).join('')
      || '<div class="item muted">Keine Vorlagen.</div>'}</div>`;
  $$('[data-tpl]').forEach((b) => b.onclick = () => openTemplateDialog(state.templates.find((t) => t.id === b.dataset.tpl)));
}

function openTemplateDialog(tpl) {
  const editing = !!tpl;
  const dlg = openDialog(`
    <h3>${editing ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</h3>
    <div class="stack">
      <label class="field">Name der Vorlage<input type="text" id="t-title" value="${esc(tpl?.title || '')}"></label>
      <label class="field">Betreff<input type="text" id="t-subj" value="${esc(tpl?.subject || '')}"></label>
      <label class="field">Text<textarea id="t-body" rows="12">${esc(tpl?.body || '')}</textarea></label>
      <div><div class="small muted">Platzhalter antippen zum Einfügen:</div>
        <div class="chips">${PLACEHOLDERS.map(([k, l]) => `<button type="button" class="chip" data-ph="${k}" title="${l}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="dlg-actions">
      ${editing ? `<button class="btn danger" data-del>${icon('trash')}</button>` : ''}
      <button class="btn secondary" data-cancel>Abbrechen</button>
      <button class="btn primary" data-ok>Speichern</button>
    </div>`, 'wide');
  let lastField = $('#t-body');
  $('#t-subj').onfocus = (e) => { lastField = e.target; };
  $('#t-body').onfocus = (e) => { lastField = e.target; };
  $$('[data-ph]', dlg).forEach((b) => b.onclick = () => {
    const ins = `{{${b.dataset.ph}}}`;
    const el = lastField, pos = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, pos) + ins + el.value.slice(el.selectionEnd ?? pos);
    el.focus(); el.selectionStart = el.selectionEnd = pos + ins.length;
  });
  $('[data-cancel]', dlg).onclick = closeDialog;
  $('[data-del]', dlg)?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Vorlage „${tpl.title}“ löschen?`))) return;
    state.templates = state.templates.filter((t) => t !== tpl);
    save(); rerender();
  });
  $('[data-ok]', dlg).onclick = () => {
    const data = { title: $('#t-title').value.trim(), subject: $('#t-subj').value, body: $('#t-body').value };
    if (!data.title) return toast('Bitte einen Namen eingeben');
    if (editing) Object.assign(tpl, data); else state.templates.push({ id: uid(), ...data });
    save(); closeDialog(); toast('Vorlage gespeichert'); rerender();
  };
}

// ---------- Export ----------
let exportYear = new Date().getFullYear();
export function viewExport() {
  header('Fahrtenbuch exportieren', { back: 'fahrten' });
  const trips = tripsOfYear(exportYear);
  const km = trips.reduce((a, t) => a + t.km, 0);
  const dis = trips.length ? '' : 'disabled';
  view().innerHTML = `
    <select id="ex-year" style="width:100%">${tripYears().map((y) => `<option ${y === exportYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${trips.length}</b><span>Fahrten</span></div>
      <div class="stat"><b>${fmtKm(km)}</b><span>km</span></div>
      <div class="stat"><b>${fmtEur(km * state.settings.rate)}</b><span>Pauschale</span></div>
    </div>
    <div class="stack" style="margin-top:16px">
      <button class="btn primary big" id="ex-xlsx" ${dis}>${icon('download')} Excel-Tabelle herunterladen</button>
      <div class="row">
        <button class="btn secondary grow" id="ex-print" ${dis}>Drucken / PDF</button>
        <button class="btn secondary grow" id="ex-csv" ${dis}>CSV</button>
      </div>
    </div>
    <p class="small muted pad">Die Excel-Datei enthält drei Blätter: alle Fahrten mit Summen, eine Monatsübersicht und die Besuche je Ziel.
      Hinweis: Bei Berufsbetreuern sind Fahrtkosten in der Vergütungspauschale enthalten – das Fahrtenbuch dient vor allem der Steuer.</p>`;
  $('#ex-year').onchange = (e) => { exportYear = +e.target.value; viewExport(); };
  $('#ex-xlsx').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Erstelle Excel …';
    try { await exportXlsx(exportYear); } catch (err) { toast(err.message); }
    b.disabled = false; b.innerHTML = `${icon('download')} Excel-Tabelle herunterladen`;
  };
  $('#ex-print').onclick = () => printTrips(exportYear);
  $('#ex-csv').onclick = () => exportCsv(exportYear);
}

// ---------- Datensicherung ----------
function cloudSectionHTML() {
  if (!cloudAvailable()) return '';
  const c = state.cloud || {};
  const when = c.lastUpload ? new Date(c.lastUpload).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie';
  return `<h2>Google Drive</h2>
    <div class="card stack">
      ${c.connected ? `
        <div class="row">${icon('shield')}<div class="grow"><b>Verbunden</b><div class="small muted">${esc(c.email || '')}</div></div></div>
        <p class="small" style="margin:0">Letzte Sicherung in Google Drive: <b>${when}</b></p>
        <p class="small muted" style="margin:0">Gesichert wird automatisch: beim Entsperren (wenn die letzte Sicherung älter als 12 Stunden ist) und – solange du angemeldet bist – kurz nach jeder Änderung.</p>
        <button class="btn primary block" id="cl-now">Jetzt in Google Drive sichern</button>
        <div class="row">
          <button class="btn secondary grow" id="cl-load">Von dort laden</button>
          <button class="btn secondary grow" id="cl-off">Trennen</button>
        </div>`
      : `
        <p style="margin:0">Sichert alle Daten <b>automatisch und verschlüsselt</b> in deinem Google Drive. Geht das Handy verloren, holst du dir alles auf dem neuen Gerät zurück – und am PC kannst du den Stand ebenfalls laden.</p>
        <p class="small muted" style="margin:0">Google sieht nur eine verschlüsselte Datei, nicht die Inhalte. Die App bekommt nur Zugriff auf ihren eigenen versteckten Ordner, nicht auf deine anderen Dateien.</p>
        <button class="btn primary block" id="cl-connect">Mit Google verbinden</button>`}
    </div>`;
}

export function viewBackup() {
  header('Datensicherung', { back: 'mehr' });
  view().innerHTML = `
    ${cloudSectionHTML()}
    ${cloudAvailable() ? '<h2>Sicherungsdatei</h2>' : ''}
    <div class="card stack">
      <p style="margin:0">Alle Daten liegen nur auf diesem Gerät. Geht es verloren oder kaputt, hilft nur eine Sicherung.</p>
      <p class="small muted" style="margin:0">Die Sicherungsdatei ist <b>verschlüsselt</b> – mit dem Passwort, das jetzt gilt. Du kannst sie also gefahrlos in deine Cloud legen oder dir per Mail schicken.</p>
      <p class="small" style="margin:0">Letzte Sicherung: <b>${state.lastBackup ? fmtDate(state.lastBackup.slice(0, 10)) : 'noch nie'}</b></p>
      <button class="btn primary big" id="bk-save">${icon('download')} Sicherung speichern</button>
    </div>
    <p class="small muted pad">Wiederherstellen: App sperren → „Passwort vergessen?“ → „Sicherungsdatei einspielen“ – oder auf einem neuen Gerät beim ersten Start „Ich habe eine Sicherung“.</p>`;
  $('#bk-save').onclick = async (e) => {
    e.currentTarget.disabled = true;
    state.lastBackup = new Date().toISOString();
    const data = await exportBackup();
    download(`Betreuerbuch-Sicherung-${todayISO()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    toast('Sicherung erstellt');
    viewBackup();
  };

  $('#cl-connect')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Verbinde …';
    try {
      const email = await connect();
      toast('Verbunden mit ' + email);
      await backupNow({ silent: true });
      toast('Erste Sicherung in Google Drive erstellt');
    } catch (err) { toast(err.message); }
    viewBackup();
  });
  $('#cl-now')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = 'Sichere …';
    await backupNow();
  });
  $('#cl-load')?.addEventListener('click', () => restoreInteractive());
  $('#cl-off')?.addEventListener('click', async () => {
    const dlg = openDialog(`<h3>Google Drive trennen?</h3>
      <p>Danach wird nicht mehr automatisch gesichert.</p>
      <div class="stack">
        <button class="btn secondary block" data-keep>Trennen, Sicherung in Drive behalten</button>
        <button class="btn danger block" data-del>Trennen und Sicherung in Drive löschen</button>
        <button class="link" data-cancel>Abbrechen</button>
      </div>`);
    const run = async (deleteRemote) => {
      closeDialog();
      try { await disconnect({ deleteRemote }); toast(deleteRemote ? 'Getrennt, Sicherung gelöscht' : 'Getrennt'); } catch (err) { toast(err.message); }
      viewBackup();
    };
    $('[data-cancel]', dlg).onclick = closeDialog;
    $('[data-keep]', dlg).onclick = () => run(false);
    $('[data-del]', dlg).onclick = async () => { if (await confirmDialog('Die Sicherung in Google Drive endgültig löschen?', 'Löschen')) run(true); };
  });
}

// ---------- Sicherheit ----------
export function viewSecurity() {
  header('Passwort & Sperre', { back: 'mehr' });
  view().innerHTML = `
    <h2>Fingerabdruck</h2>
    <div class="card stack" id="bio-card"><p class="small muted" style="margin:0">Prüfe Gerät …</p></div>
    <h2>Automatisch sperren</h2>
    <div class="card">
      <label class="field">Sperren, wenn die App so lange nicht benutzt wurde
        <select id="sec-lock">${[1, 5, 15, 60].map((m) => `<option value="${m}" ${m === state.settings.autoLockMin ? 'selected' : ''}>${m} ${m === 1 ? 'Minute' : 'Minuten'}</option>`).join('')}</select>
      </label>
    </div>
    <h2>Passwort ändern</h2>
    <div class="card stack">
      <input type="password" id="sec-old" placeholder="Aktuelles Passwort" autocomplete="current-password">
      <input type="password" id="sec-new" placeholder="Neues Passwort (mind. 6 Zeichen)" autocomplete="new-password">
      <input type="password" id="sec-new2" placeholder="Neues Passwort wiederholen" autocomplete="new-password">
      <button class="btn primary" id="sec-go">Passwort ändern</button>
      <p class="small muted" style="margin:0">Ältere Sicherungsdateien behalten ihr altes Passwort.</p>
    </div>`;
  $('#sec-lock').onchange = (e) => { state.settings.autoLockMin = +e.target.value; save(); toast('Gespeichert'); };
  $('#sec-go').onclick = async (e) => {
    const o = $('#sec-old').value, n = $('#sec-new').value;
    if (n.length < 6) return toast('Neues Passwort: mindestens 6 Zeichen');
    if (n !== $('#sec-new2').value) return toast('Die neuen Passwörter stimmen nicht überein');
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Verschlüssele neu …';
    const ok = await changePassword(o, n);
    b.disabled = false; b.textContent = 'Passwort ändern';
    if (!ok) return toast('Aktuelles Passwort ist falsch');
    $$('input[type=password]').forEach((i) => { i.value = ''; });
    if (await bioEnabled()) {
      await disableBio();
      toast('Passwort geändert – bitte den Fingerabdruck neu einrichten');
      viewSecurity();
    } else toast('Passwort geändert');
  };
  renderBioCard();
}

async function renderBioCard() {
  const card = $('#bio-card');
  const [supported, enabled] = await Promise.all([bioSupported(), bioEnabled()]);
  if (!card.isConnected) return;
  if (enabled) {
    card.innerHTML = `
      <div class="row">${icon('finger')}<div class="grow"><b>Eingeschaltet</b><div class="small muted">Beim Öffnen reicht der Fingerabdruck. Das Passwort funktioniert weiterhin.</div></div></div>
      <button class="btn secondary block" id="bio-off">Ausschalten</button>`;
    $('#bio-off').onclick = async () => {
      await disableBio();
      toast('Fingerabdruck ausgeschaltet');
      renderBioCard();
    };
  } else if (!supported) {
    card.innerHTML = '<p class="small muted" style="margin:0">Auf diesem Gerät ist kein Fingerabdruck bzw. keine Displaysperre für Apps verfügbar.</p>';
  } else {
    card.innerHTML = `
      <p class="small" style="margin:0">Statt des Passworts den Fingerabdruck (oder die Gesichtserkennung) zum Entsperren nutzen.</p>
      <input type="password" id="bio-pw" placeholder="Zur Bestätigung: aktuelles Passwort" autocomplete="current-password">
      <button class="btn primary block" id="bio-on">${icon('finger')} Fingerabdruck einrichten</button>`;
    $('#bio-on').onclick = async (e) => {
      const b = e.currentTarget, pw = $('#bio-pw').value;
      if (!pw) return toast('Bitte das aktuelle Passwort eingeben');
      b.disabled = true; b.textContent = 'Prüfe Passwort …';
      if (!(await verifyPassword(pw))) { b.disabled = false; b.innerHTML = `${icon('finger')} Fingerabdruck einrichten`; return toast('Passwort ist falsch'); }
      b.textContent = 'Bitte Finger auflegen …';
      try {
        await enableBio(pw);
        toast('Fingerabdruck eingerichtet');
      } catch (err) {
        if (!isCancel(err)) toast(err.message);
      }
      renderBioCard();
    };
  }
}
