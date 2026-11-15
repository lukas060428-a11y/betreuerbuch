// Dialoge, die von mehreren Seiten aus geöffnet werden:
// Kontakt notieren, Post/Dokument erfassen, Dokument ansehen, Schreiben erstellen, Jahresbericht-Kontakte, Vergütung.
import { state, save, putDoc, getDoc, delDoc } from './store.js';
import { $, $$, esc, uid, todayISO, fmtDate, fmtEur, parseNum, openDialog, closeDialog, confirmDialog, toast, copyText, icon } from './util.js';
import { clientById, clientName, LOG_TYPES, personalContacts, fillTemplate, setBilling } from './model.js';
import { clientSelectHTML, rerender } from './ui.js';
import { openDeadlineDialog } from './views/fristen.js';
import { printLetter, printReport } from './export.js';

const dlg = () => $('#dlg');

// ---------- Kontakt notieren ----------
export function openLogDialog({ clientId = '', log = null, type = 'telefon' } = {}) {
  const editing = !!log;
  let current = log?.type || type;
  openDialog(`
    <h3>${editing ? 'Eintrag bearbeiten' : 'Kontakt notieren'}</h3>
    <div class="stack">
      <label class="field">Klient/in${clientSelectHTML('l-client', log?.clientId || clientId, false)}</label>
      <div class="chips" id="l-types">${Object.entries(LOG_TYPES).map(([k, v]) =>
        `<button type="button" class="chip ${k === current ? 'on' : ''}" data-type="${k}">${icon(v.icon, 'sm')} ${v.label}</button>`).join('')}</div>
      <label class="field">Datum<input type="date" id="l-date" value="${log?.date || todayISO()}"></label>
      <label class="field">Worum ging es?<textarea id="l-text" placeholder="z. B. Termin beim Jobcenter besprochen, Unterlagen fehlen noch">${esc(log?.text || '')}</textarea></label>
      ${editing ? '' : '<label class="switch"><input type="checkbox" id="l-follow"> <span>Wiedervorlage dazu anlegen</span></label>'}
    </div>
    <div class="dlg-actions">
      ${editing ? `<button class="btn danger" data-del>Löschen</button>` : ''}
      <button class="btn secondary" data-cancel>Abbrechen</button>
      <button class="btn primary" data-ok>Speichern</button>
    </div>`);
  if (!state.clients.length) $('#l-client').outerHTML = '<p class="err small">Bitte zuerst einen Klienten anlegen.</p>';
  $$('[data-type]', dlg()).forEach((b) => b.onclick = () => {
    current = b.dataset.type;
    $$('[data-type]', dlg()).forEach((x) => x.classList.toggle('on', x === b));
  });
  $('[data-cancel]', dlg()).onclick = closeDialog;
  $('[data-del]', dlg())?.addEventListener('click', async () => {
    if (!(await confirmDialog('Eintrag löschen?'))) return;
    state.logs = state.logs.filter((l) => l !== log);
    save(); rerender();
  });
  $('[data-ok]', dlg()).onclick = () => {
    const cid = $('#l-client')?.value;
    if (!cid) return toast('Bitte einen Klienten wählen');
    const data = { clientId: cid, type: current, date: $('#l-date').value || todayISO(), text: $('#l-text').value.trim() };
    if (editing) Object.assign(log, data);
    else state.logs.push({ id: uid(), ...data });
    save();
    const follow = $('#l-follow')?.checked;
    closeDialog();
    toast('Gespeichert');
    if (follow) openDeadlineDialog({ clientId: cid, title: 'Wiedervorlage: ' + (data.text.split('\n')[0].slice(0, 50) || LOG_TYPES[current].label) });
    rerender();
  };
}

// ---------- Post / Dokument erfassen ----------
const DOC_TITLES = ['Bescheid', 'Brief', 'Rechnung', 'Kontoauszug', 'Arztbrief', 'Vertrag'];

async function fileToStored(file) {
  if (file.type === 'application/pdf') return { bytes: new Uint8Array(await file.arrayBuffer()), mime: 'application/pdf' };
  // Fotos verkleinern: lesbar, aber deutlich kleiner
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
}

export function openDocDialog({ clientId = '' } = {}) {
  let files = [];
  openDialog(`
    <h3>Post / Dokument erfassen</h3>
    <div class="stack">
      <label class="field">Klient/in${clientSelectHTML('d-client', clientId, false)}</label>
      <label class="field">Was ist es?<input type="text" id="d-title" placeholder="z. B. Bescheid Jobcenter"></label>
      <div class="chips">${DOC_TITLES.map((t) => `<button type="button" class="chip" data-t="${t}">${t}</button>`).join('')}</div>
      <label class="field">Datum des Schreibens<input type="date" id="d-date" value="${todayISO()}"></label>
      <div class="row">
        <label class="btn secondary grow">${icon('camera')} Foto aufnehmen<input type="file" id="d-cam" accept="image/*" capture="environment" hidden></label>
        <label class="btn secondary grow">${icon('doc')} Datei wählen<input type="file" id="d-file" accept="image/*,application/pdf" multiple hidden></label>
      </div>
      <div id="d-list" class="small muted">Noch keine Seite hinzugefügt. Mehrere Seiten? Einfach nochmal fotografieren.</div>
      <label class="field">Notiz (optional)<input type="text" id="d-note"></label>
      <label class="switch"><input type="checkbox" id="d-frist"> <span>Frist dazu anlegen (z. B. Widerspruch)</span></label>
    </div>
    <div class="dlg-actions"><button class="btn secondary" data-cancel>Abbrechen</button><button class="btn primary" data-ok>Speichern</button></div>`);
  const d = dlg();
  $$('[data-t]', d).forEach((b) => b.onclick = () => { $('#d-title').value = b.dataset.t + ' '; $('#d-title').focus(); });
  const showList = () => {
    $('#d-list').innerHTML = files.length
      ? files.map((f, i) => `<div class="row"><span class="grow">Seite ${i + 1}: ${esc(f.name)}</span><button type="button" class="icon-btn" data-rmf="${i}">×</button></div>`).join('')
      : 'Noch keine Seite hinzugefügt.';
    $$('[data-rmf]', d).forEach((b) => b.onclick = () => { files.splice(+b.dataset.rmf, 1); showList(); });
  };
  const add = (e) => { files.push(...e.target.files); e.target.value = ''; showList(); };
  $('#d-cam').onchange = add;
  $('#d-file').onchange = add;
  $('[data-cancel]', d).onclick = closeDialog;
  $('[data-ok]', d).onclick = async (e) => {
    const cid = $('#d-client')?.value;
    if (!cid) return toast('Bitte einen Klienten wählen');
    if (!files.length) return toast('Bitte ein Foto oder eine Datei hinzufügen');
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Verschlüssele …';
    try {
      const fileIds = [];
      let mime = 'image/jpeg';
      for (const f of files) {
        const s = await fileToStored(f);
        const fid = uid();
        await putDoc(fid, s.bytes);
        fileIds.push({ id: fid, mime: s.mime });
        mime = s.mime;
      }
      const doc = {
        id: uid(), clientId: cid, title: $('#d-title').value.trim() || 'Dokument', date: $('#d-date').value || todayISO(),
        note: $('#d-note').value.trim(), files: fileIds, mime,
      };
      state.docs.push(doc);
      await save();
      const frist = $('#d-frist').checked;
      closeDialog();
      toast('Dokument verschlüsselt gespeichert');
      if (frist) openDeadlineDialog({ clientId: cid, title: doc.title.startsWith('Bescheid') ? 'Widerspruchsfrist' : doc.title, noticeDate: doc.date, docId: doc.id });
      rerender();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Speichern';
      toast('Fehler: ' + err.message);
    }
  };
}

export async function openDocView(doc) {
  const urls = [];
  openDialog(`<h3>${esc(doc.title)}</h3><p class="muted small" style="margin-top:-8px">${fmtDate(doc.date)} · ${esc(clientName(clientById(doc.clientId) || {}))}${doc.note ? ' · ' + esc(doc.note) : ''}</p>
    <div id="doc-pages" class="doc-pages"><p class="muted">Entschlüssele …</p></div>
    <div class="dlg-actions">
      <button class="btn danger" data-del>Löschen</button>
      <button class="btn secondary" data-frist>Frist anlegen</button>
      <button class="btn primary" data-close>Schließen</button>
    </div>`, 'wide');
  const d = dlg();
  const cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));
  d.addEventListener('close', cleanup, { once: true });
  $('[data-close]', d).onclick = closeDialog;
  $('[data-frist]', d).onclick = () => openDeadlineDialog({ clientId: doc.clientId, title: doc.title, noticeDate: doc.date, docId: doc.id });
  $('[data-del]', d).onclick = async () => {
    if (!(await confirmDialog(`„${doc.title}“ endgültig löschen?`))) return;
    for (const f of doc.files) await delDoc(f.id);
    state.docs = state.docs.filter((x) => x !== doc);
    save(); toast('Dokument gelöscht'); rerender();
  };
  const parts = [];
  for (const [i, f] of doc.files.entries()) {
    const bytes = await getDoc(f.id);
    if (!bytes) { parts.push('<p class="err">Seite fehlt</p>'); continue; }
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    urls.push(url);
    parts.push(f.mime === 'application/pdf'
      ? `<a class="btn secondary block" href="${url}" target="_blank" rel="noopener">${icon('doc')} PDF öffnen (Teil ${i + 1})</a>`
      : `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Seite ${i + 1}"></a>`);
  }
  const box = $('#doc-pages');
  if (box) box.innerHTML = parts.join('');
}

// ---------- Schreiben aus Vorlage ----------
export function openLetterDialog({ clientId = '' } = {}) {
  const tpls = state.templates;
  if (!tpls.length) return toast('Keine Vorlagen vorhanden – unter „Mehr → Textvorlagen“ anlegen');
  openDialog(`
    <h3>Schreiben erstellen</h3>
    <div class="stack">
      <label class="field">Klient/in${clientSelectHTML('w-client', clientId)}</label>
      <label class="field">Vorlage<select id="w-tpl">${tpls.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></label>
      <label class="field">An (E-Mail, optional)<input type="email" id="w-to" list="w-mails" placeholder="empfaenger@beispiel.de"><datalist id="w-mails"></datalist></label>
      <label class="field">Betreff<input type="text" id="w-subj"></label>
      <label class="field">Text<textarea id="w-body" rows="12"></textarea></label>
      <label class="switch"><input type="checkbox" id="w-log" checked> <span>Im Verlauf des Klienten vermerken</span></label>
    </div>
    <div class="dlg-grid">
      <button class="btn secondary" data-copy>${icon('copy')} Kopieren</button>
      <button class="btn secondary" data-print>${icon('doc')} Drucken / PDF</button>
      ${navigator.share ? `<button class="btn secondary" data-share>${icon('chat')} Teilen</button>` : ''}
      <button class="btn primary" data-mail>${icon('mail')} Als E-Mail</button>
    </div>
    <button class="link" data-cancel style="margin-top:10px">Schließen</button>`, 'wide');
  const d = dlg();
  const fill = () => {
    const c = clientById($('#w-client').value);
    const t = tpls.find((x) => x.id === $('#w-tpl').value);
    $('#w-subj').value = fillTemplate(t.subject, c);
    $('#w-body').value = fillTemplate(t.body, c);
    $('#w-mails').innerHTML = (c?.contacts || []).filter((x) => x.email).map((x) => `<option value="${esc(x.email)}">${esc(x.role || x.name)}</option>`).join('');
  };
  fill();
  $('#w-client').onchange = fill;
  $('#w-tpl').onchange = fill;
  const done = (how) => {
    const cid = $('#w-client').value;
    if (cid && $('#w-log').checked) {
      state.logs.push({ id: uid(), clientId: cid, type: how === 'mail' ? 'mail' : 'brief', date: todayISO(), text: $('#w-subj').value });
      save();
      $('#w-log').checked = false; // nur einmal vermerken
      rerender();
    }
  };
  const subj = () => $('#w-subj').value, body = () => $('#w-body').value;
  $('[data-cancel]', d).onclick = closeDialog;
  $('[data-copy]', d).onclick = () => { copyText(subj() + '\n\n' + body()); done('brief'); };
  $('[data-print]', d).onclick = () => { done('brief'); printLetter(subj(), body()); };
  $('[data-share]', d)?.addEventListener('click', async () => {
    try { await navigator.share({ title: subj(), text: body() }); done('brief'); } catch { /* abgebrochen */ }
  });
  $('[data-mail]', d).onclick = () => {
    done('mail');
    location.href = `mailto:${encodeURIComponent($('#w-to').value.trim())}?subject=${encodeURIComponent(subj())}&body=${encodeURIComponent(body())}`;
  };
}

// ---------- Kontakte für den Jahresbericht ----------
export function openReportDialog(client) {
  let year = new Date().getFullYear();
  const build = () => {
    const rows = personalContacts(client.id, year);
    const count = {};
    for (const r of rows) count[r.type] = (count[r.type] || 0) + 1;
    const summary = Object.entries(count).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'keine Kontakte';
    const text = `Kontakte ${year} – ${clientName(client)}\n${summary}\n\n` + rows.map((r) => `${fmtDate(r.date)}  ${r.type}${r.text ? ' – ' + r.text : ''}`).join('\n');
    return { rows, summary, text };
  };
  const render = () => {
    const { rows, summary } = build();
    $('#rep-body').innerHTML = `<p class="small"><b>${esc(summary)}</b></p>` + (rows.length
      ? `<div class="list">${rows.map((r) => `<div class="item"><div class="main"><div class="t1">${fmtDate(r.date)} · ${esc(r.type)}</div><div class="t2">${esc(r.text)}</div></div></div>`).join('')}</div>`
      : '<p class="muted">In diesem Jahr ist noch nichts eingetragen.</p>');
  };
  const years = [year, year - 1, year - 2];
  openDialog(`
    <h3>Kontakte für den Jahresbericht</h3>
    <p class="small muted" style="margin-top:-8px">Besuche (aus dem Fahrtenbuch) und notierte Kontakte mit ${esc(clientName(client))}.</p>
    <select id="rep-year" style="width:100%">${years.map((y) => `<option>${y}</option>`).join('')}</select>
    <div id="rep-body" style="margin-top:12px"></div>
    <div class="dlg-actions">
      <button class="btn secondary" data-copy>${icon('copy')} Kopieren</button>
      <button class="btn secondary" data-print>Drucken</button>
      <button class="btn primary" data-close>Fertig</button>
    </div>`, 'wide');
  render();
  $('#rep-year').onchange = (e) => { year = +e.target.value; render(); };
  $('[data-copy]', dlg()).onclick = () => copyText(build().text);
  $('[data-print]', dlg()).onclick = () => printReport(`Kontakte ${year} – ${clientName(client)}`, build().rows, build().summary);
  $('[data-close]', dlg()).onclick = closeDialog;
}

// ---------- Vergütung ----------
export function openBillingDialog(client, period) {
  const e = period.entry || {};
  const est = client.monthlyFee ? client.monthlyFee * 3 : null;
  openDialog(`
    <h3>Vergütung ${fmtDate(period.from)} – ${fmtDate(period.to)}</h3>
    <p class="small muted" style="margin-top:-8px">${esc(clientName(client))} · ${period.months}. bis ${period.months + 2}. Monat der Betreuung ·
      ${client.living === 'heim' ? 'stationär' : 'eigene Wohnung'} · ${client.assets === 'vermoegend' ? 'nicht mittellos' : 'mittellos'}</p>
    <div class="stack">
      <label class="field">Beantragt am<input type="date" id="b-filed" value="${e.filedAt || ''}"></label>
      <label class="field">Betrag in € ${est ? `(geschätzt ${fmtEur(est)})` : ''}<input type="number" step="0.01" inputmode="decimal" id="b-amount" value="${e.amount ?? (est ?? '')}"></label>
      <label class="field">Bezahlt am<input type="date" id="b-paid" value="${e.paidAt || ''}"></label>
    </div>
    <div class="dlg-grid">
      <button class="btn secondary" data-today-filed>Heute beantragt</button>
      <button class="btn secondary" data-today-paid>Heute bezahlt</button>
    </div>
    <div class="dlg-actions"><button class="btn secondary" data-cancel>Abbrechen</button><button class="btn primary" data-ok>Speichern</button></div>`);
  const d = dlg();
  $('[data-today-filed]', d).onclick = () => { $('#b-filed').value = todayISO(); };
  $('[data-today-paid]', d).onclick = () => { $('#b-paid').value = todayISO(); if (!$('#b-filed').value) $('#b-filed').value = todayISO(); };
  $('[data-cancel]', d).onclick = closeDialog;
  $('[data-ok]', d).onclick = () => {
    setBilling(client, period, { filedAt: $('#b-filed').value || null, paidAt: $('#b-paid').value || null, amount: parseNum($('#b-amount').value) });
    closeDialog(); toast('Gespeichert'); rerender();
  };
}
