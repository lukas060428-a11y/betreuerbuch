// Fahrtenbuch: Liste der Fahrten und Erfassen/Bearbeiten einer Fahrt.
import { state, save } from '../store.js';
import { $, $$, esc, uid, round1, parseNum, fmtKm, fmtEur, todayISO, weekday, monthName, toast, confirmDialog, openDialog, closeDialog, icon } from '../util.js';
import { activeClients, clientName, targetById, usageCounts, routeLabel, tripsOfYear, tripYears } from '../model.js';
import { view, header, navigate, emptyState } from '../ui.js';
import { route, computeTargetKm, addrSearchHTML, wireAddrSearch } from '../geo.js';

// ---------- Liste ----------
let listYear = new Date().getFullYear();

export function viewTrips() {
  header('Fahrten', { actions: [{ icon: 'download', label: 'Export', onClick: () => navigate('export') }] });
  const trips = tripsOfYear(listYear).reverse();
  const total = trips.reduce((s, t) => s + t.km, 0);
  const byMonth = {};
  for (const t of trips) (byMonth[t.date.slice(0, 7)] ||= []).push(t);

  view().innerHTML = `
    <button class="btn primary big" id="t-new">${icon('plus')} Neue Fahrt eintragen</button>
    <div class="row" style="margin-top:14px">
      <select id="year" class="grow">${tripYears().map((y) => `<option ${y === listYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
    </div>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><b>${trips.length}</b><span>Fahrten</span></div>
      <div class="stat"><b>${fmtKm(total)}</b><span>Kilometer</span></div>
      <div class="stat"><b>${fmtEur(total * state.settings.rate)}</b><span>à ${fmtEur(state.settings.rate)}/km</span></div>
    </div>
    ${trips.length ? Object.entries(byMonth).map(([ym, list]) => `
      <div class="month-head"><h2>${monthName(ym)}</h2><span>${list.length} Fahrten · ${fmtKm(list.reduce((s, t) => s + t.km, 0))} km</span></div>
      <div class="list">${list.map((t) => `
        <button class="item" data-trip="${t.id}">
          <div class="date-badge"><b>${t.date.slice(8, 10)}.</b><span>${weekday(t.date)}</span></div>
          <div class="main"><div class="t1">${esc(routeLabel(t))}</div><div class="t2">${esc(t.purpose || 'ohne Zweck')}${t.note ? ' · ' + esc(t.note) : ''}</div></div>
          <div class="km">${fmtKm(t.km)} km</div>
        </button>`).join('')}</div>`).join('')
    : emptyState('car', `Für ${listYear} sind noch keine Fahrten eingetragen.`)}
  `;
  $('#t-new').onclick = () => navigate('fahrt/neu');
  $('#year').onchange = (e) => { listYear = +e.target.value; viewTrips(); };
  $$('[data-trip]').forEach((b) => b.onclick = () => navigate('fahrt/' + b.dataset.trip));
}

// ---------- Erfassen / Bearbeiten ----------
let draft = null;

function newDraft(date = todayISO()) {
  return { editingId: null, date, stops: [], roundTrip: true, purpose: '', note: '', km: null, kmManual: false, calc: 'idle', calcError: '' };
}
const stopFromTarget = (t) => ({ ref: t.id, name: t.name, address: t.address, lat: t.lat, lon: t.lon });

export function viewTripEdit(id, query) {
  if (id === 'neu') {
    // Neuer Entwurf, außer wir kommen gerade von einem halbfertigen neuen Entwurf zurück
    if (!draft || draft.editingId) draft = newDraft();
    const ziel = query.get('ziel');
    if (ziel) {
      const t = targetById(ziel);
      draft = newDraft(draft.date);
      if (t?.lat != null) draft.stops.push(stopFromTarget(t));
      if (t?.isClient) draft.purpose = 'Hausbesuch';
      history.replaceState(null, '', '#/fahrt/neu');
    }
  } else {
    const t = state.trips.find((x) => x.id === id);
    if (!t) return navigate('fahrten');
    if (draft?.editingId !== id) {
      draft = { ...newDraft(), editingId: t.id, date: t.date, stops: t.stops.map((s) => ({ ...s })), roundTrip: t.roundTrip,
        purpose: t.purpose || '', note: t.note || '', km: t.km, kmManual: true };
    }
  }
  render();
  if (draft.km == null && draft.stops.length) recalc();
}

function render() {
  header(draft.editingId ? 'Fahrt bearbeiten' : 'Neue Fahrt', { back: 'fahrten' });
  const home = state.settings.home;
  const usage = usageCounts();
  const byUse = (a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name, 'de');
  const clients = activeClients().filter((c) => c.lat != null).map((c) => ({ ...c, name: clientName(c) })).sort(byUse);
  const places = [...state.places].sort(byUse);
  const btn = (t) => `<button type="button" class="quick" data-target="${t.id}"><b>${esc(t.name)}</b><small>${t.kmTo != null ? fmtKm(t.kmTo) + ' km' : esc(t.category || '')}</small></button>`;

  view().innerHTML = `
    ${!home ? `<div class="banner">Zuerst die <b>Wohnadresse</b> eintragen – von dort aus werden die Kilometer berechnet.<br><button class="btn primary" id="go-settings">Wohnadresse eintragen</button></div>` : ''}
    <h2>Datum</h2>
    <input type="date" id="f-date" value="${esc(draft.date)}" style="width:100%">

    <h2>Strecke</h2>
    <div class="card"><ul class="route" id="route"></ul></div>

    ${clients.length ? `<h2>Klienten</h2><div class="quick-grid">${clients.map(btn).join('')}</div>` : ''}
    ${places.length ? `<h2>Orte</h2><div class="quick-grid">${places.map(btn).join('')}</div>` : ''}
    ${!clients.length && !places.length ? `<p class="muted small pad">Lege Klienten (mit Adresse) oder feste Orte an – dann reicht hier ein Tipp.</p>` : ''}
    <button type="button" class="btn ghost block" id="add-adhoc" style="margin-top:8px">+ Andere Adresse eingeben</button>

    <div class="card" style="margin-top:12px">
      <label class="switch"><input type="checkbox" id="f-rt" ${draft.roundTrip ? 'checked' : ''}> <span>Danach zurück nach Hause</span></label>
    </div>

    <h2>Zweck der Fahrt</h2>
    <input type="text" id="f-purpose" value="${esc(draft.purpose)}" placeholder="z. B. Hausbesuch" style="width:100%">
    <div class="chips">${state.purposes.map((p) => `<button type="button" class="chip ${draft.purpose === p ? 'on' : ''}" data-purpose="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <input type="text" id="f-note" value="${esc(draft.note)}" placeholder="Notiz (optional)" style="width:100%;margin-top:10px">

    <h2>Gefahrene Kilometer</h2>
    <div class="card" id="kmcard"></div>

    <div style="margin-top:16px" class="stack">
      <button class="btn primary big" id="save-trip">${draft.editingId ? 'Änderungen speichern' : 'Fahrt speichern'}</button>
      ${draft.editingId ? `<button class="btn danger block" id="del-trip">Fahrt löschen</button>` : ''}
    </div>
  `;
  renderRoute();
  renderKm();

  $('#go-settings')?.addEventListener('click', () => navigate('einstellungen'));
  $('#f-date').oninput = (e) => { draft.date = e.target.value; };
  $('#f-purpose').oninput = (e) => { draft.purpose = e.target.value; markChips(); };
  $('#f-note').oninput = (e) => { draft.note = e.target.value; };
  $('#f-rt').onchange = (e) => { draft.roundTrip = e.target.checked; renderRoute(); recalc(); };
  $$('[data-purpose]').forEach((b) => b.onclick = () => {
    draft.purpose = draft.purpose === b.dataset.purpose ? '' : b.dataset.purpose;
    $('#f-purpose').value = draft.purpose;
    markChips();
  });
  $$('[data-target]').forEach((b) => b.onclick = () => {
    draft.stops.push(stopFromTarget(targetById(b.dataset.target)));
    if (!draft.purpose && targetById(b.dataset.target).isClient) { draft.purpose = 'Hausbesuch'; $('#f-purpose').value = draft.purpose; markChips(); }
    renderRoute(); recalc();
  });
  $('#add-adhoc').onclick = openAdhocDialog;
  $('#save-trip').onclick = saveTrip;
  $('#del-trip')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Diese Fahrt wirklich löschen?'))) return;
    state.trips = state.trips.filter((t) => t.id !== draft.editingId);
    save(); draft = null; toast('Fahrt gelöscht'); navigate('fahrten');
  });
}

const markChips = () => $$('[data-purpose]').forEach((b) => b.classList.toggle('on', b.dataset.purpose === draft.purpose));

function renderRoute() {
  const home = state.settings.home;
  const homeLi = (label) => `<li><span class="dot home">${icon('home')}</span><div class="grow"><div class="name">${label}</div><div class="addr-line">${esc(home?.address || 'Wohnadresse fehlt')}</div></div></li>`;
  $('#route').innerHTML = homeLi('Zuhause') +
    (draft.stops.length ? draft.stops.map((s, i) => `
      <li><span class="dot">${i + 1}</span>
        <div class="grow" style="min-width:0"><div class="name">${esc(s.name)}</div><div class="addr-line">${esc(s.address)}</div></div>
        ${i > 0 ? `<button class="icon-btn" data-up="${i}" title="Nach oben">↑</button>` : ''}
        <button class="icon-btn" data-rm="${i}" title="Entfernen">×</button>
      </li>`).join('')
    : `<li><span class="dot" style="opacity:.35">1</span><div class="muted">Noch kein Ziel – unten antippen</div></li>`) +
    (draft.roundTrip ? homeLi('Zurück nach Hause') : '');
  $$('[data-rm]').forEach((b) => b.onclick = () => { draft.stops.splice(+b.dataset.rm, 1); renderRoute(); recalc(); });
  $$('[data-up]').forEach((b) => b.onclick = () => {
    const i = +b.dataset.up;
    [draft.stops[i - 1], draft.stops[i]] = [draft.stops[i], draft.stops[i - 1]];
    renderRoute(); recalc();
  });
  $$('.quick').forEach((q) => q.classList.toggle('used', draft.stops.some((s) => s.ref === q.dataset.target)));
}

function renderKm() {
  const c = $('#kmcard');
  if (!c) return;
  const hint = draft.calc === 'busy' ? 'Wird berechnet …'
    : draft.calc === 'error' ? `<span class="err">${esc(draft.calcError)} – bitte km selbst eintragen.</span>`
    : draft.kmManual ? 'Von Hand eingetragen'
    : draft.km != null ? 'Automatisch berechnet (kürzeste Autoroute)'
    : 'Wird automatisch berechnet, sobald ein Ziel gewählt ist.';
  c.innerHTML = `
    <div class="kmbox">
      <input type="number" inputmode="decimal" step="0.1" min="0" id="f-km" value="${draft.km ?? ''}" placeholder="0,0">
      <span class="km-unit">km</span><span class="spacer"></span>
      <span class="muted small">${draft.km ? '≙ ' + fmtEur(draft.km * state.settings.rate) : ''}</span>
    </div>
    <div class="small muted" style="margin-top:6px">${hint}</div>
    ${draft.kmManual && draft.stops.length ? '<button class="link" id="km-reset">Automatisch neu berechnen</button>' : ''}`;
  $('#f-km').oninput = (e) => { draft.km = parseNum(e.target.value); draft.kmManual = true; };
  $('#f-km').onchange = renderKm;
  $('#km-reset')?.addEventListener('click', () => { draft.kmManual = false; recalc(); });
}

let calcToken = 0;
async function recalc() {
  if (draft.kmManual) return;
  const token = ++calcToken;
  const home = state.settings.home;
  draft.calcError = '';
  if (!draft.stops.length) { draft.km = null; draft.calc = 'idle'; return renderKm(); }
  if (!home) { draft.km = null; draft.calc = 'error'; draft.calcError = 'Wohnadresse fehlt'; return renderKm(); }
  // Schnellweg: ein bekanntes Ziel mit gespeicherten km – klappt auch offline
  if (draft.stops.length === 1 && draft.stops[0].ref) {
    const t = targetById(draft.stops[0].ref);
    if (t?.kmTo != null) {
      draft.km = round1(draft.roundTrip ? t.kmTo + (t.kmBack ?? t.kmTo) : t.kmTo);
      draft.calc = 'idle';
      return renderKm();
    }
  }
  draft.calc = 'busy'; renderKm();
  const d = draft;
  try {
    const r = await route([home, ...d.stops, ...(d.roundTrip ? [home] : [])]);
    if (token !== calcToken || d !== draft || d.kmManual) return;
    d.km = round1(r.total);
    d.calc = 'idle';
  } catch (e) {
    if (token !== calcToken || d !== draft) return;
    d.calc = 'error';
    d.calcError = navigator.onLine ? e.message : 'Keine Internetverbindung';
  }
  renderKm();
}

function openAdhocDialog() {
  let picked = null;
  const dlg = openDialog(`
    <h3>Andere Adresse</h3>
    <div class="stack">
      ${addrSearchHTML()}
      <label class="field">Bezeichnung (so erscheint es im Fahrtenbuch)<input type="text" id="a-name" placeholder="z. B. Sparkasse Innenstadt"></label>
      <label class="switch"><input type="checkbox" id="a-save"> <span>Als festen Ort speichern</span></label>
    </div>
    <div class="dlg-actions"><button class="btn secondary" data-cancel>Abbrechen</button><button class="btn primary" data-ok disabled>Hinzufügen</button></div>`);
  const ok = $('[data-ok]', dlg);
  wireAddrSearch($('.addr', dlg), (r) => {
    picked = r;
    const n = $('#a-name', dlg);
    if (!n.value) n.value = r.name || r.label.split(',')[0];
    ok.disabled = false;
  });
  $('[data-cancel]', dlg).onclick = closeDialog;
  ok.onclick = async () => {
    const name = $('#a-name', dlg).value.trim() || picked.label;
    const stop = { ref: null, name, address: picked.label, lat: picked.lat, lon: picked.lon };
    if ($('#a-save', dlg).checked) {
      const p = { id: uid(), name, category: 'Sonstiges', address: picked.label, lat: picked.lat, lon: picked.lon, kmTo: null, kmBack: null, note: '' };
      ok.disabled = true; ok.textContent = 'Speichere …';
      try { await computeTargetKm(p); } catch { /* km später */ }
      state.places.push(p); save();
      stop.ref = p.id;
    }
    closeDialog();
    draft.stops.push(stop);
    stop.ref ? render() : renderRoute();
    recalc();
  };
}

function saveTrip() {
  if (!draft.date) return toast('Bitte ein Datum wählen');
  if (!draft.stops.length) return toast('Bitte mindestens ein Ziel wählen');
  if (!draft.km || draft.km <= 0) return toast('Bitte die Kilometer eintragen');
  const old = draft.editingId && state.trips.find((t) => t.id === draft.editingId);
  const trip = {
    id: draft.editingId || uid(),
    date: draft.date,
    start: old?.start || (state.settings.home ? { address: state.settings.home.address } : null), // Startadresse von damals behalten
    stops: draft.stops.map((s) => ({ ...s })),
    roundTrip: draft.roundTrip,
    km: round1(draft.km),
    kmManual: draft.kmManual,
    purpose: draft.purpose.trim(),
    note: draft.note.trim(),
  };
  state.trips = old ? state.trips.map((t) => (t.id === trip.id ? trip : t)) : [...state.trips, trip];
  if (trip.purpose && !state.purposes.includes(trip.purpose)) state.purposes.push(trip.purpose);
  save();
  toast(`${old ? 'Geändert' : 'Gespeichert'} · ${fmtKm(trip.km)} km`);
  if (old) { draft = null; navigate('fahrten'); }
  else { draft = newDraft(draft.date); render(); window.scrollTo(0, 0); }
}
