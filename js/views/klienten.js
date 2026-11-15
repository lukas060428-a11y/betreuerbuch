// Klientenakte: Liste, Detailansicht, Bearbeiten.
import { state, save, delDoc } from '../store.js';
import { $, $$, esc, uid, fmtDate, fmtKm, fmtEur, ageOn, parseNum, toast, confirmDialog, copyText, icon } from '../util.js';
import {
  clientById, clientName, activeClients, initials, TASK_AREAS, LOG_TYPES, timeline, billingPeriods, billingIsLate, routeLabel,
} from '../model.js';
import { view, header, navigate, emptyState } from '../ui.js';
import { addrSearchHTML, wireAddrSearch, computeTargetKm, mapsLink } from '../geo.js';
import { openLogDialog, openDocDialog, openDocView, openLetterDialog, openReportDialog, openBillingDialog } from '../actions.js';
import { openDeadlineDialog, deadlineItemHTML, wireDeadlineItems } from './fristen.js';

// ---------- Liste ----------
let search = '';
let showArchived = false;

export function viewClients() {
  header('Klienten', { actions: [{ icon: 'plus', label: 'Neuer Klient', onClick: () => navigate('klient/neu') }] });
  const archivedCount = state.clients.filter((c) => c.archived).length;
  view().innerHTML = `
    <input type="search" id="c-search" placeholder="Suchen …" value="${esc(search)}" style="width:100%">
    <div id="c-list"></div>
    ${archivedCount ? `<button class="link" id="c-arch" style="margin-top:14px">${showArchived ? 'Archiv ausblenden' : `Archiv anzeigen (${archivedCount})`}</button>` : ''}
  `;
  const renderList = () => {
    const q = search.trim().toLowerCase();
    const list = (showArchived ? state.clients : activeClients())
      .filter((c) => !q || [clientName(c), c.address, c.court?.fileNo].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'de'));
    $('#c-list').innerHTML = !state.clients.length
      ? emptyState('users', 'Noch keine Klienten. Lege deinen ersten Klienten an – mit Adresse, Gericht, Bank und allem, was du brauchst.',
        '<button class="btn primary" id="c-first">Ersten Klienten anlegen</button>')
      : list.length ? `<div class="list" style="margin-top:12px">${list.map((c) => `
        <button class="item" data-client="${c.id}">
          <span class="avatar">${esc(initials(c))}</span>
          <div class="main"><div class="t1">${esc(clientName(c))}${c.archived ? ' <span class="badge">Archiv</span>' : ''}</div>
          <div class="t2">${esc(c.address || 'keine Adresse')}</div></div>
          ${c.kmTo != null ? `<div class="small muted">${fmtKm(c.kmTo)} km</div>` : ''}
        </button>`).join('')}</div>`
      : '<p class="muted" style="margin:16px 4px">Niemand gefunden.</p>';
    $$('[data-client]').forEach((b) => b.onclick = () => navigate('klient/' + b.dataset.client));
    $('#c-first')?.addEventListener('click', () => navigate('klient/neu'));
  };
  renderList();
  $('#c-search').oninput = (e) => { search = e.target.value; renderList(); };
  $('#c-arch')?.addEventListener('click', () => { showArchived = !showArchived; viewClients(); });
}

// ---------- Detail ----------
const telLink = (p) => 'tel:' + p.replace(/[^\d+]/g, '');
function waLink(p) {
  let n = p.replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = '49' + n.slice(1);
  return 'https://wa.me/' + n;
}
const kv = (label, value) => value ? `<div class="kv"><span>${label}</span><b>${value}</b></div>` : '';

export function viewClient(id) {
  const c = clientById(id);
  if (!c) return navigate('klienten');
  header(clientName(c), { back: 'klienten', actions: [{ icon: 'edit', label: 'Bearbeiten', onClick: () => navigate(`klient/${id}/bearbeiten`) }] });

  const deadlines = state.deadlines.filter((d) => d.clientId === id && !d.doneAt).sort((a, b) => a.due.localeCompare(b.due));
  const periods = billingPeriods(c).slice(-6).reverse();
  const tl = timeline(id);
  const docs = state.docs.filter((d) => d.clientId === id).sort((a, b) => b.date.localeCompare(a.date));
  const quick = [
    c.phone && `<a class="qa" href="${telLink(c.phone)}">${icon('phone')}<span>Anrufen</span></a>`,
    c.phone && `<a class="qa" href="${waLink(c.phone)}" target="_blank" rel="noopener">${icon('chat')}<span>WhatsApp</span></a>`,
    c.email && `<a class="qa" href="mailto:${esc(c.email)}">${icon('mail')}<span>E-Mail</span></a>`,
    c.address && `<a class="qa" href="${mapsLink(c)}" target="_blank" rel="noopener">${icon('nav')}<span>Route</span></a>`,
  ].filter(Boolean);

  view().innerHTML = `
    <div class="card client-head">
      <span class="avatar lg">${esc(initials(c))}</span>
      <div class="grow" style="min-width:0">
        <div class="client-name">${esc(clientName(c))}</div>
        <div class="muted small">${c.birthDate ? `geb. ${fmtDate(c.birthDate)} (${ageOn(c.birthDate)} J.)` : ''}${c.living === 'heim' ? ' · Heim' : ''}${c.language ? ' · ' + esc(c.language) : ''}</div>
        <div class="small">${esc(c.address || '')}${c.kmTo != null ? ` · <span class="muted">${fmtKm(c.kmTo)} km</span>` : ''}</div>
      </div>
    </div>
    ${quick.length ? `<div class="quick-actions">${quick.join('')}</div>` : ''}

    <div class="tiles">
      <button class="tile" data-do="fahrt">${icon('car')}<span>Fahrt</span></button>
      <button class="tile" data-do="log">${icon('phone')}<span>Kontakt</span></button>
      <button class="tile" data-do="doc">${icon('camera')}<span>Post</span></button>
      <button class="tile" data-do="frist">${icon('clock')}<span>Frist</span></button>
      <button class="tile" data-do="brief">${icon('mail')}<span>Schreiben</span></button>
    </div>

    <h2>Offene Fristen</h2>
    ${deadlines.length ? `<div class="list" id="c-deadlines">${deadlines.map(deadlineItemHTML).join('')}</div>` : '<p class="muted small pad">Keine offenen Fristen.</p>'}

    <h2>Vergütung</h2>
    ${!c.appointedAt ? `<p class="muted small pad">Trage unter „Bearbeiten“ ein, seit wann die Betreuung besteht – dann erinnert dich die App alle 3 Monate an den Vergütungsantrag.</p>`
      : `<div class="list">${periods.map((p) => `
        <button class="item" data-period="${p.from}">
          <div class="main"><div class="t1">${fmtDate(p.from)} – ${fmtDate(p.to)}</div>
          <div class="t2">${p.months}.–${p.months + 2}. Monat${p.entry?.amount ? ' · ' + fmtEur(p.entry.amount) : ''}${billingIsLate(p) ? ' · <span class="err">lange offen – bitte prüfen!</span>' : ''}</div></div>
          <span class="status s-${p.status}">${p.status}</span>
        </button>`).join('') || '<div class="item muted">Alles abgerechnet.</div>'}</div>`}

    <h2>Verlauf <span class="count">${tl.length}</span></h2>
    ${tl.length ? `<div class="list timeline">${tl.slice(0, 15).map(timelineItem).join('')}</div>` : '<p class="muted small pad">Noch keine Kontakte, Fahrten oder Dokumente.</p>'}
    <button class="btn secondary block" id="c-report" style="margin-top:10px">${icon('doc')} Kontakte für den Jahresbericht</button>

    ${docs.length ? `<h2>Dokumente <span class="count">${docs.length}</span></h2><div class="list">${docs.map((d) => `
      <button class="item" data-doc="${d.id}">${icon('doc')}<div class="main"><div class="t1">${esc(d.title)}</div><div class="t2">${fmtDate(d.date)} · ${d.files.length} ${d.files.length === 1 ? 'Seite' : 'Seiten'}</div></div></button>`).join('')}</div>` : ''}

    <h2>Akte</h2>
    <div class="card">
      ${kv('Betreuungsgericht', esc(c.court?.name || ''))}
      ${kv('Aktenzeichen', c.court?.fileNo ? `${esc(c.court.fileNo)} <button class="icon-btn sm" data-copy="${esc(c.court.fileNo)}">${icon('copy')}</button>` : '')}
      ${kv('Rechtspfleger/in', esc(c.court?.clerk || ''))}
      ${kv('Telefon Gericht', c.court?.phone ? `<a href="${telLink(c.court.phone)}">${esc(c.court.phone)}</a>` : '')}
      ${kv('Bestellt seit', c.appointedAt ? fmtDate(c.appointedAt) : '')}
      ${kv('Aufgabenkreise', esc([...(c.areas || []), c.areasOther].filter(Boolean).join(', ')))}
      ${kv('Wohnform', c.living === 'heim' ? 'Heim / stationär' : 'eigene Wohnung')}
      ${kv('Vermögen', c.assets === 'vermoegend' ? 'nicht mittellos' : 'mittellos')}
      ${kv('Krankenkasse', esc([c.insurance?.name, c.insurance?.number].filter(Boolean).join(' · ')))}
      ${kv('Telefon', c.phone ? `<a href="${telLink(c.phone)}">${esc(c.phone)}</a>` : '')}
      ${kv('E-Mail', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '')}
    </div>

    ${(c.banks || []).length ? `<h2>Bankverbindungen</h2><div class="list">${c.banks.map((b) => `
      <div class="item"><div class="main"><div class="t1">${esc(b.bank || 'Konto')}</div><div class="t2 mono">${esc(b.iban)}${b.note ? ' · ' + esc(b.note) : ''}</div></div>
      ${b.iban ? `<button class="icon-btn" data-copy="${esc(b.iban.replace(/\s/g, ''))}" title="IBAN kopieren">${icon('copy')}</button>` : ''}</div>`).join('')}</div>` : ''}

    ${(c.contacts || []).length ? `<h2>Kontaktpersonen</h2><div class="list">${c.contacts.map((p) => `
      <div class="item"><div class="main"><div class="t1">${esc(p.name || p.role)}</div><div class="t2">${esc(p.role || '')}${p.phone ? ' · ' + esc(p.phone) : ''}</div></div>
      ${p.phone ? `<a class="icon-btn" href="${telLink(p.phone)}" title="Anrufen">${icon('phone')}</a>` : ''}
      ${p.email ? `<a class="icon-btn" href="mailto:${esc(p.email)}" title="E-Mail">${icon('mail')}</a>` : ''}</div>`).join('')}</div>` : ''}

    ${(c.credentials || []).length ? `<h2>Zugangsdaten</h2><div class="list">${c.credentials.map((x, i) => `
      <div class="item"><div class="main"><div class="t1">${esc(x.label || 'Zugang')}</div>
        <div class="t2">${esc(x.user || '')}${x.user ? ' · ' : ''}<span class="mono" data-secret="${i}">••••••••</span>${x.note ? ' · ' + esc(x.note) : ''}</div></div>
        <button class="icon-btn" data-reveal="${i}" title="Anzeigen">${icon('eye')}</button>
        <button class="icon-btn" data-copy-secret="${i}" title="Passwort kopieren">${icon('copy')}</button>
      </div>`).join('')}</div>` : ''}

    ${c.notes ? `<h2>Notizen</h2><div class="card prewrap">${esc(c.notes)}</div>` : ''}
    <div style="height:8px"></div>
  `;

  const v = view();
  $$('[data-do]', v).forEach((b) => b.onclick = () => ({
    fahrt: () => navigate('fahrt/neu?ziel=' + id),
    log: () => openLogDialog({ clientId: id }),
    doc: () => openDocDialog({ clientId: id }),
    frist: () => openDeadlineDialog({ clientId: id }),
    brief: () => openLetterDialog({ clientId: id }),
  })[b.dataset.do]());
  wireDeadlineItems(v);
  $$('[data-period]', v).forEach((b) => b.onclick = () => openBillingDialog(c, billingPeriods(c).find((p) => p.from === b.dataset.period)));
  $$('[data-doc]', v).forEach((b) => b.onclick = () => openDocView(state.docs.find((d) => d.id === b.dataset.doc)));
  $$('[data-log]', v).forEach((b) => b.onclick = () => openLogDialog({ log: state.logs.find((l) => l.id === b.dataset.log) }));
  $$('[data-trip]', v).forEach((b) => b.onclick = () => navigate('fahrt/' + b.dataset.trip));
  $$('[data-copy]', v).forEach((b) => b.onclick = () => copyText(b.dataset.copy));
  $$('[data-reveal]', v).forEach((b) => b.onclick = () => {
    const s = $(`[data-secret="${b.dataset.reveal}"]`, v);
    const shown = s.dataset.shown === '1';
    s.textContent = shown ? '••••••••' : c.credentials[+b.dataset.reveal].password || '(leer)';
    s.dataset.shown = shown ? '0' : '1';
  });
  $$('[data-copy-secret]', v).forEach((b) => b.onclick = () => copyText(c.credentials[+b.dataset.copySecret].password || ''));
  $('#c-report').onclick = () => openReportDialog(c);
}

function timelineItem(e) {
  if (e.kind === 'trip') return `<button class="item" data-trip="${e.item.id}">${icon('car')}
    <div class="main"><div class="t1">Besuch · ${esc(e.item.purpose || routeLabel(e.item))}</div><div class="t2">${fmtDate(e.date)} · ${fmtKm(e.item.km)} km</div></div></button>`;
  if (e.kind === 'doc') return `<button class="item" data-doc="${e.item.id}">${icon('doc')}
    <div class="main"><div class="t1">${esc(e.item.title)}</div><div class="t2">${fmtDate(e.date)} · Dokument</div></div></button>`;
  const t = LOG_TYPES[e.item.type] || LOG_TYPES.notiz;
  return `<button class="item" data-log="${e.item.id}">${icon(t.icon)}
    <div class="main"><div class="t1">${t.label}${e.item.text ? ' · ' + esc(e.item.text.split('\n')[0]) : ''}</div><div class="t2">${fmtDate(e.date)}</div></div></button>`;
}

// ---------- Bearbeiten ----------
const REPEATERS = {
  banks: { add: '+ Bankverbindung', fields: [['bank', 'Bank / Kontoart'], ['iban', 'IBAN'], ['note', 'Notiz']] },
  contacts: { add: '+ Kontaktperson', fields: [['role', 'Rolle (z. B. Hausarzt)', 'roles'], ['name', 'Name'], ['phone', 'Telefon', null, 'tel'], ['email', 'E-Mail', null, 'email']] },
  credentials: { add: '+ Zugangsdaten', fields: [['label', 'Wofür (z. B. Online-Banking)'], ['user', 'Benutzername'], ['password', 'Passwort / PIN'], ['note', 'Notiz']] },
};
const ROLES = ['Angehörige/r', 'Hausarzt', 'Facharzt', 'Pflegedienst', 'Heim', 'Jobcenter', 'Sozialamt', 'Rentenversicherung', 'Vermieter', 'Krankenkasse'];

const repRow = (name, r = {}) => `<div class="rep-row">${REPEATERS[name].fields.map(([k, label, list, type]) =>
  `<input data-f="${k}" type="${type || 'text'}" placeholder="${label}" value="${esc(r[k] || '')}" ${list ? `list="${list}"` : ''} autocomplete="off">`).join('')}
  <button type="button" class="icon-btn" data-rm-row aria-label="Entfernen">${icon('trash')}</button></div>`;
const repeater = (name, rows) => `<div class="rep" data-rep="${name}">${(rows || []).map((r) => repRow(name, r)).join('')}</div>
  <button type="button" class="btn ghost block" data-add="${name}">${REPEATERS[name].add}</button>`;
const collectRep = (name) => $$(`[data-rep="${name}"] .rep-row`).map((row) =>
  Object.fromEntries($$('[data-f]', row).map((i) => [i.dataset.f, i.value.trim()]))).filter((o) => Object.values(o).some(Boolean));

export function viewClientEdit(id) {
  const isNew = id === 'neu';
  const c = isNew ? {} : clientById(id);
  if (!c) return navigate('klienten');
  header(isNew ? 'Neuer Klient' : 'Bearbeiten', { back: isNew ? 'klienten' : 'klient/' + id });
  let picked = c.lat != null ? { label: c.address, lat: c.lat, lon: c.lon } : null;
  const f = (k, label, type = 'text', val = c[k], extra = '') => `<label class="field">${label}<input type="${type}" id="e-${k}" value="${esc(val || '')}" ${extra}></label>`;

  view().innerHTML = `
    <form id="cform" class="stack" autocomplete="off">
      <h2>Person</h2>
      <div class="card stack">
        <div class="grid2">${f('firstName', 'Vorname')}${f('lastName', 'Nachname')}</div>
        <div class="grid2">${f('birthDate', 'Geburtsdatum', 'date')}${f('language', 'Sprache', 'text', c.language, 'placeholder="z. B. Russisch" list="langs"')}</div>
        <div class="grid2">${f('phone', 'Telefon', 'tel')}${f('email', 'E-Mail', 'email')}</div>
        <div><div class="small muted" style="margin-bottom:4px">Adresse ${c.address ? `<span class="addr-ok">· aktuell: ${esc(c.address)}</span>` : ''}</div>${addrSearchHTML(c.address || '')}</div>
        <label class="field">Wohnform<select id="e-living">
          <option value="wohnung">Eigene Wohnung</option><option value="heim" ${c.living === 'heim' ? 'selected' : ''}>Heim / stationäre Einrichtung</option></select></label>
      </div>

      <h2>Betreuung</h2>
      <div class="card stack">
        <div class="grid2">
          <label class="field">Betreuungsgericht<input type="text" id="e-court" value="${esc(c.court?.name || '')}" placeholder="z. B. Amtsgericht Köln"></label>
          <label class="field">Aktenzeichen<input type="text" id="e-fileNo" value="${esc(c.court?.fileNo || '')}"></label>
        </div>
        <div class="grid2">
          <label class="field">Rechtspfleger/in<input type="text" id="e-clerk" value="${esc(c.court?.clerk || '')}"></label>
          <label class="field">Telefon Gericht<input type="tel" id="e-courtPhone" value="${esc(c.court?.phone || '')}"></label>
        </div>
        ${f('appointedAt', 'Bestellt seit (für die Vergütung)', 'date')}
        <div><div class="small muted">Aufgabenkreise</div>
          <div class="checks">${TASK_AREAS.map((a) => `<label><input type="checkbox" data-area value="${esc(a)}" ${(c.areas || []).includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
          <input type="text" id="e-areasOther" value="${esc(c.areasOther || '')}" placeholder="Weitere Aufgabenkreise" style="width:100%;margin-top:8px">
        </div>
      </div>

      <h2>Vergütung</h2>
      <div class="card stack">
        <label class="field">Vermögen<select id="e-assets">
          <option value="mittellos">mittellos (Staatskasse zahlt)</option><option value="vermoegend" ${c.assets === 'vermoegend' ? 'selected' : ''}>nicht mittellos (Betreute/r zahlt)</option></select></label>
        <div class="grid2">
          ${f('monthlyFee', 'Monatspauschale in € (optional)', 'number', c.monthlyFee, 'step="0.01" inputmode="decimal"')}
          ${f('billedUntil', 'Schon abgerechnet bis (optional)', 'date')}
        </div>
        <p class="small muted" style="margin:0">Mit der Monatspauschale schätzt die App den Betrag je Antrag. „Schon abgerechnet bis“ blendet ältere Zeiträume aus.</p>
      </div>

      <h2>Krankenversicherung</h2>
      <div class="card grid2">
        <label class="field">Krankenkasse<input type="text" id="e-insName" value="${esc(c.insurance?.name || '')}"></label>
        <label class="field">Versichertennummer<input type="text" id="e-insNo" value="${esc(c.insurance?.number || '')}"></label>
      </div>

      <h2>Bankverbindungen</h2>${repeater('banks', c.banks)}
      <h2>Kontaktpersonen</h2>${repeater('contacts', c.contacts)}
      <h2>Zugangsdaten</h2>
      <p class="small muted pad" style="margin-top:0">Online-Banking, Portale usw. – wird verschlüsselt gespeichert und erst auf Antippen angezeigt.</p>
      ${repeater('credentials', c.credentials)}

      <h2>Notizen</h2>
      <textarea id="e-notes" rows="4" style="width:100%" placeholder="Alles Weitere …">${esc(c.notes || '')}</textarea>

      <button type="submit" class="btn primary big">${isNew ? 'Klient anlegen' : 'Speichern'}</button>
      ${isNew ? '' : `<div class="row">
        <button type="button" class="btn secondary grow" id="e-archive">${c.archived ? 'Aus Archiv holen' : 'Archivieren'}</button>
        <button type="button" class="btn danger grow" id="e-delete">Löschen</button></div>`}
    </form>
    <datalist id="roles">${ROLES.map((r) => `<option value="${r}">`).join('')}</datalist>
    <datalist id="langs"><option value="Russisch"><option value="Ukrainisch"><option value="Deutsch"></datalist>
  `;

  const form = $('#cform');
  wireAddrSearch($('.addr', form), (r) => { picked = r; });
  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) $(`[data-rep="${add.dataset.add}"]`).insertAdjacentHTML('beforeend', repRow(add.dataset.add));
    const rm = e.target.closest('[data-rm-row]');
    if (rm) rm.closest('.rep-row').remove();
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const val = (k) => $('#e-' + k).value.trim();
    if (!val('firstName') && !val('lastName')) return toast('Bitte einen Namen eingeben');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Speichere …';
    const target = isNew ? { id: uid(), created: new Date().toISOString() } : c;
    const moved = picked && (picked.lat !== target.lat || picked.lon !== target.lon);
    Object.assign(target, {
      firstName: val('firstName'), lastName: val('lastName'), birthDate: val('birthDate'), language: val('language'),
      phone: val('phone'), email: val('email'), living: $('#e-living').value,
      court: { name: val('court'), fileNo: val('fileNo'), clerk: val('clerk'), phone: val('courtPhone') },
      appointedAt: val('appointedAt'), areas: $$('[data-area]:checked').map((x) => x.value), areasOther: val('areasOther'),
      assets: $('#e-assets').value, monthlyFee: parseNum(val('monthlyFee')), billedUntil: val('billedUntil'),
      insurance: { name: val('insName'), number: val('insNo') },
      banks: collectRep('banks'), contacts: collectRep('contacts'), credentials: collectRep('credentials'),
      notes: $('#e-notes').value.trim(),
    });
    if (moved) {
      Object.assign(target, { address: picked.label, lat: picked.lat, lon: picked.lon, kmTo: null, kmBack: null });
      try { await computeTargetKm(target); } catch { toast('Kilometer konnten nicht berechnet werden'); }
    } else if (target.lat != null && target.kmTo == null) {
      try { await computeTargetKm(target); } catch { /* später erneut */ }
    }
    if (isNew) state.clients.push(target);
    await save();
    toast(isNew ? 'Klient angelegt' : 'Gespeichert');
    navigate('klient/' + target.id);
  };

  $('#e-archive')?.addEventListener('click', () => {
    c.archived = !c.archived; save();
    toast(c.archived ? 'Archiviert' : 'Wieder aktiv');
    navigate(c.archived ? 'klienten' : 'klient/' + id);
  });
  $('#e-delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`${clientName(c)} mit allen Notizen, Fristen und Dokumenten endgültig löschen? Fahrten im Fahrtenbuch bleiben erhalten. Tipp: „Archivieren“ behält alles.`, 'Endgültig löschen'))) return;
    for (const d of state.docs.filter((x) => x.clientId === id)) for (const fl of d.files) await delDoc(fl.id);
    state.docs = state.docs.filter((x) => x.clientId !== id);
    state.logs = state.logs.filter((x) => x.clientId !== id);
    state.deadlines = state.deadlines.filter((x) => x.clientId !== id);
    state.billing = state.billing.filter((x) => x.clientId !== id);
    state.clients = state.clients.filter((x) => x.id !== id);
    await save();
    toast('Gelöscht');
    navigate('klienten');
  });
}
