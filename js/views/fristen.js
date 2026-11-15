// Fristen & Wiedervorlagen.
import { state, save } from '../store.js';
import { $, $$, esc, uid, todayISO, addMonths, addDays, daysUntil, relDays, fmtDate, openDialog, closeDialog, confirmDialog, toast, icon } from '../util.js';
import { clientById, clientName, openDeadlines, completeDeadline, DEADLINE_PRESETS, REPEATS } from '../model.js';
import { view, header, clientSelectHTML, rerender, emptyState } from '../ui.js';
import { downloadIcs } from '../export.js';

let showDone = false;

export function deadlineItemHTML(d) {
  const n = daysUntil(d.due);
  const cls = n < 0 ? 'overdue' : n <= 7 ? 'soon' : '';
  const c = clientById(d.clientId);
  return `<div class="item deadline ${cls}">
    <button class="check" data-done="${d.id}" aria-label="Erledigt">${icon('check')}</button>
    <button class="main plain" data-deadline="${d.id}">
      <div class="t1">${esc(d.title)}</div>
      <div class="t2">${esc([c && clientName(c), d.repeat && REPEATS[d.repeat], d.note].filter(Boolean).join(' · '))}</div>
    </button>
    <div class="due">${relDays(d.due)}</div>
  </div>`;
}

/** Verdrahtet Erledigt-Haken und Antippen in einem Container. */
export function wireDeadlineItems(root) {
  $$('[data-done]', root).forEach((b) => b.onclick = () => {
    const d = state.deadlines.find((x) => x.id === b.dataset.done);
    completeDeadline(d);
    toast(d.repeat ? 'Erledigt – nächster Termin angelegt' : 'Erledigt');
    rerender();
  });
  $$('[data-deadline]', root).forEach((b) => b.onclick = () => openDeadlineDialog({ deadline: state.deadlines.find((x) => x.id === b.dataset.deadline) }));
}

export function viewDeadlines() {
  header('Fristen', { actions: [{ icon: 'download', label: 'Alle in den Kalender', onClick: () => downloadIcs(openDeadlines(), 'Fristen') }] });
  const open = openDeadlines();
  const groups = [
    ['Überfällig', open.filter((d) => daysUntil(d.due) < 0)],
    ['Nächste 7 Tage', open.filter((d) => daysUntil(d.due) >= 0 && daysUntil(d.due) <= 7)],
    ['Nächste 30 Tage', open.filter((d) => daysUntil(d.due) > 7 && daysUntil(d.due) <= 30)],
    ['Später', open.filter((d) => daysUntil(d.due) > 30)],
  ].filter(([, l]) => l.length);
  const done = state.deadlines.filter((d) => d.doneAt).sort((a, b) => b.doneAt.localeCompare(a.doneAt)).slice(0, 50);

  view().innerHTML = `
    <button class="btn primary big" id="dl-add">${icon('plus')} Frist / Wiedervorlage anlegen</button>
    ${groups.length ? groups.map(([t, l]) => `<h2>${t} <span class="count">${l.length}</span></h2><div class="list">${l.map(deadlineItemHTML).join('')}</div>`).join('')
      : emptyState('clock', 'Keine offenen Fristen. Lege z. B. Weiterbewilligungsanträge, Widerspruchsfristen oder den Jahresbericht an.')}
    <button class="link" id="dl-toggle" style="margin-top:18px">${showDone ? 'Erledigte ausblenden' : `Erledigte anzeigen (${done.length})`}</button>
    ${showDone ? `<div class="list" style="margin-top:8px">${done.map((d) => `
      <div class="item deadline done"><button class="main plain" data-reopen="${d.id}">
        <div class="t1">${esc(d.title)}</div><div class="t2">${esc(clientName(clientById(d.clientId) || {}))} · erledigt ${fmtDate(d.doneAt)} – antippen zum Wiederöffnen</div>
      </button></div>`).join('') || '<div class="item muted">Noch nichts erledigt.</div>'}</div>` : ''}
  `;
  $('#dl-add').onclick = () => openDeadlineDialog();
  $('#dl-toggle').onclick = () => { showDone = !showDone; viewDeadlines(); };
  $$('[data-reopen]').forEach((b) => b.onclick = () => {
    const d = state.deadlines.find((x) => x.id === b.dataset.reopen);
    d.doneAt = null; save(); toast('Wieder offen'); viewDeadlines();
  });
  wireDeadlineItems(view());
}

export function openDeadlineDialog({ deadline = null, clientId = '', title = '', noticeDate = null, docId = null } = {}) {
  const editing = !!deadline;
  const d0 = deadline || { title, clientId, due: noticeDate && title === 'Widerspruchsfrist' ? addMonths(noticeDate, 1) : '', repeat: '', note: '', docId };
  const dlg = openDialog(`
    <h3>${editing ? 'Frist bearbeiten' : 'Neue Frist / Wiedervorlage'}</h3>
    <div class="stack">
      ${editing ? '' : `<div><div class="small muted">Vorlage</div><div class="chips">${DEADLINE_PRESETS.map((p, i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.title)}</button>`).join('')}</div></div>`}
      <label class="field">Was?<input type="text" id="dl-title" value="${esc(d0.title)}" placeholder="z. B. Weiterbewilligungsantrag Jobcenter"></label>
      <label class="field">Klient/in${clientSelectHTML('dl-client', d0.clientId)}</label>
      <div id="dl-notice" class="card soft" ${d0.title === 'Widerspruchsfrist' && !editing ? '' : 'hidden'}>
        <label class="field">Datum des Bescheids<input type="date" id="dl-notice-date" value="${noticeDate || ''}"></label>
        <p class="small muted" style="margin:6px 0 0">Frist = 1 Monat ab Bescheiddatum (zur Sicherheit ohne die Tage für die Zustellung).</p>
      </div>
      <label class="field">Fällig am<input type="date" id="dl-due" value="${d0.due}"></label>
      <div class="chips" id="dl-quick">
        ${[['+1 Woche', 7], ['+2 Wochen', 14], ['+1 Monat', 'm1'], ['+3 Monate', 'm3']].map(([l, v]) => `<button type="button" class="chip" data-quick="${v}">${l}</button>`).join('')}
      </div>
      <label class="field">Wiederholen<select id="dl-repeat">${Object.entries(REPEATS).map(([k, v]) => `<option value="${k}" ${k === d0.repeat ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">Notiz<textarea id="dl-note" rows="2">${esc(d0.note || '')}</textarea></label>
    </div>
    <div class="dlg-actions">
      ${editing ? `<button class="btn danger" data-del>${icon('trash')}</button>` : ''}
      <button class="btn secondary" data-ics title="In den Handy-Kalender übernehmen">${icon('bell')} Kalender</button>
      <button class="btn primary" data-ok>Speichern</button>
    </div>
    <button class="link" data-cancel style="margin-top:10px">Abbrechen</button>`);

  const setDue = (v) => { $('#dl-due').value = v; };
  $$('[data-preset]', dlg).forEach((b) => b.onclick = () => {
    const p = DEADLINE_PRESETS[+b.dataset.preset];
    $('#dl-title').value = p.title;
    $('#dl-repeat').value = p.repeat || '';
    if (p.note && !$('#dl-note').value) $('#dl-note').value = p.note;
    $('#dl-notice').hidden = !p.fromNotice;
    $$('[data-preset]', dlg).forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#dl-notice-date').onchange = (e) => { if (e.target.value) setDue(addMonths(e.target.value, 1)); };
  $$('[data-quick]', dlg).forEach((b) => b.onclick = () => {
    const v = b.dataset.quick, base = todayISO();
    setDue(v.startsWith('m') ? addMonths(base, +v.slice(1)) : addDays(base, +v));
  });

  const collect = () => ({
    title: $('#dl-title').value.trim(), clientId: $('#dl-client').value || null, due: $('#dl-due').value,
    repeat: $('#dl-repeat').value, note: $('#dl-note').value.trim(),
  });
  const valid = (x) => {
    if (!x.title) { toast('Bitte eintragen, worum es geht'); return false; }
    if (!x.due) { toast('Bitte ein Fälligkeitsdatum wählen'); return false; }
    return true;
  };
  const persist = () => {
    const x = collect();
    if (!valid(x)) return null;
    if (editing) Object.assign(deadline, x);
    else state.deadlines.push(deadline = { id: uid(), doneAt: null, docId: d0.docId || null, ...x });
    save();
    return deadline;
  };
  $('[data-cancel]', dlg).onclick = closeDialog;
  $('[data-ok]', dlg).onclick = () => { if (persist()) { closeDialog(); toast('Frist gespeichert'); rerender(); } };
  $('[data-ics]', dlg).onclick = () => { const d = persist(); if (d) { downloadIcs([d], d.title); rerender(); } };
  $('[data-del]', dlg)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Diese Frist löschen?'))) return;
    state.deadlines = state.deadlines.filter((x) => x !== deadline);
    save(); rerender();
  });
}
