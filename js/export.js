// Ausgaben: Fahrtenbuch als Excel/CSV/Druck, Kalenderdateien (.ics), Briefe und Berichte drucken.
import { state } from './store.js';
import { $, esc, fmtDate, fmtKm, fmtEur, todayISO, parseISO, weekday, monthName, round1, download } from './util.js';
import { tripsOfYear, clientById, initials } from './model.js';

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = XLSX_URL;
    sc.onload = () => resolve(window.XLSX);
    sc.onerror = () => reject(new Error('Excel-Export braucht beim ersten Mal Internet'));
    document.head.appendChild(sc);
  });
}

function tripRows(y) {
  const rate = state.settings.rate;
  return tripsOfYear(y).map((t, i) => ({
    nr: i + 1, date: t.date, weekday: weekday(t.date),
    start: t.start?.address || state.settings.home?.address || '',
    goals: t.stops.map((s) => s.name).join(' → '),
    addresses: t.stops.map((s) => s.address).join(' | '),
    purpose: t.purpose || '', note: t.note || '', back: t.roundTrip ? 'ja' : 'nein',
    km: t.km, eur: Math.round(t.km * rate * 100) / 100,
  }));
}
function titleLine(y) {
  const s = state.settings;
  return [`Fahrtenbuch ${y}`, s.ownerName, s.vehicle ? 'Kennzeichen ' + s.vehicle : ''].filter(Boolean).join(' – ');
}
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

export async function exportXlsx(y) {
  const XLSX = await loadXLSX();
  const rows = tripRows(y);
  const rate = state.settings.rate;
  const EUR = '#,##0.00 "€"';
  const wb = XLSX.utils.book_new();

  // Blatt 1: Fahrtenbuch
  const head = ['Nr.', 'Datum', 'Tag', 'Start', 'Ziel(e)', 'Adresse(n)', 'Zweck', 'Notiz', 'Rückfahrt', 'km', `Betrag (${fmtEur(rate)}/km)`];
  const aoa = [[titleLine(y)], [], head, ...rows.map((r) => [r.nr, parseISO(r.date), r.weekday, r.start, r.goals, r.addresses, r.purpose, r.note, r.back, r.km, r.eur])];
  const first = 4, last = 3 + rows.length;
  aoa.push([], ['', '', '', '', '', '', '', '', 'Summe', null, null]);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const sumRow = aoa.length;
  ws[`J${sumRow}`] = { t: 'n', f: `SUM(J${first}:J${last})`, v: sum(rows, 'km'), z: '0.0' };
  ws[`K${sumRow}`] = { t: 'n', f: `SUM(K${first}:K${last})`, v: sum(rows, 'eur'), z: EUR };
  for (let r = first; r <= last; r++) { ws[`B${r}`].z = 'dd.mm.yyyy'; ws[`J${r}`].z = '0.0'; ws[`K${r}`].z = EUR; }
  ws['!cols'] = [6, 11, 5, 32, 34, 50, 22, 24, 9, 9, 16].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: `A3:K${last}` };
  XLSX.utils.book_append_sheet(wb, ws, 'Fahrtenbuch');

  // Blatt 2: Monate
  const months = {};
  for (const r of rows) { const m = (months[r.date.slice(0, 7)] ||= { n: 0, km: 0 }); m.n++; m.km += r.km; }
  const mAoa = [[`Monatsübersicht ${y}`], [], ['Monat', 'Fahrten', 'km', 'Betrag']];
  for (const [m, v] of Object.entries(months)) mAoa.push([monthName(m), v.n, round1(v.km), Math.round(v.km * rate * 100) / 100]);
  mAoa.push(['Gesamt', rows.length, round1(sum(rows, 'km')), Math.round(sum(rows, 'eur') * 100) / 100]);
  const ms = XLSX.utils.aoa_to_sheet(mAoa);
  for (let r = 4; r <= mAoa.length; r++) { ms[`C${r}`].z = '0.0'; ms[`D${r}`].z = EUR; }
  ms['!cols'] = [{ wch: 18 }, { wch: 9 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ms, 'Monate');

  // Blatt 3: Besuche je Ziel
  const goals = {};
  for (const t of tripsOfYear(y)) for (const s of t.stops) {
    const g = (goals[s.name] ||= { n: 0, address: s.address, dates: [] });
    g.n++; g.dates.push(fmtDate(t.date));
  }
  const gAoa = [[`Besuche je Ziel ${y}`], [], ['Ziel', 'Adresse', 'Anzahl', 'Daten']];
  Object.entries(goals).sort((a, b) => b[1].n - a[1].n).forEach(([name, g]) => gAoa.push([name, g.address, g.n, g.dates.join(', ')]));
  const gs = XLSX.utils.aoa_to_sheet(gAoa);
  gs['!cols'] = [{ wch: 26 }, { wch: 40 }, { wch: 8 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, gs, 'Besuche je Ziel');

  XLSX.writeFile(wb, `Fahrtenbuch-${y}.xlsx`, { compression: true });
}

export function exportCsv(y) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['Nr.', 'Datum', 'Tag', 'Start', 'Ziel(e)', 'Adresse(n)', 'Zweck', 'Notiz', 'Rückfahrt', 'km', 'Betrag EUR'].map(q).join(';')];
  for (const r of tripRows(y)) lines.push([r.nr, fmtDate(r.date), r.weekday, r.start, r.goals, r.addresses, r.purpose, r.note, r.back,
    r.km.toLocaleString('de-DE'), r.eur.toLocaleString('de-DE', { minimumFractionDigits: 2 })].map(q).join(';'));
  download(`Fahrtenbuch-${y}.csv`, new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
}

// ---------- Drucken ----------
function print(html) {
  $('#print').innerHTML = html;
  window.print();
}

export function printTrips(y) {
  const rows = tripRows(y);
  print(`
    <h1>${esc(titleLine(y))}</h1>
    <div>Start jeweils: ${esc(state.settings.home?.address || '')} · Kilometerpauschale ${fmtEur(state.settings.rate)}/km · erstellt am ${fmtDate(todayISO())}</div>
    <table>
      <thead><tr><th>Nr.</th><th>Datum</th><th>Ziel(e)</th><th>Adresse(n)</th><th>Zweck</th><th>Rückf.</th><th class="num">km</th><th class="num">Betrag</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.nr}</td><td>${r.weekday} ${fmtDate(r.date)}</td><td>${esc(r.goals)}</td><td>${esc(r.addresses)}</td><td>${esc(r.purpose)}${r.note ? '<br><i>' + esc(r.note) + '</i>' : ''}</td><td>${r.back}</td><td class="num">${fmtKm(r.km)}</td><td class="num">${fmtEur(r.eur)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="6">Summe (${rows.length} Fahrten)</td><td class="num">${fmtKm(sum(rows, 'km'))}</td><td class="num">${fmtEur(sum(rows, 'eur'))}</td></tr></tfoot>
    </table>
    <div class="sign"><div>Ort, Datum</div><div>Unterschrift</div></div>`);
}

export function printLetter(subject, body) {
  const s = state.settings;
  print(`
    <div class="letter">
      <div class="sender">${esc([s.ownerName, s.title, s.office, s.phone && 'Tel. ' + s.phone, s.email].filter(Boolean).join(' · '))}</div>
      <div class="recipient"></div>
      <div class="date">${fmtDate(todayISO())}</div>
      <p><b>${esc(subject)}</b></p>
      <div class="prewrap">${esc(body)}</div>
    </div>`);
}

export function printReport(title, rows, summary) {
  print(`
    <h1>${esc(title)}</h1><div>${esc(summary)}</div>
    <table><thead><tr><th>Datum</th><th>Art</th><th>Inhalt</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>`);
}

// ---------- Kalender (.ics) ----------
// Aus Datenschutzgründen stehen im Kalender nur die Initialen des Klienten.
const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
const icsDate = (iso) => iso.replace(/-/g, '');

export function downloadIcs(deadlines, name) {
  if (!deadlines.length) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const events = deadlines.map((d) => {
    const c = clientById(d.clientId);
    const next = new Date(parseISO(d.due).getTime() + 86400000);
    const end = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
    const summary = d.title + (c ? ` (${initials(c)})` : '');
    return [
      'BEGIN:VEVENT', `UID:${d.id}@betreuerbuch`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(d.due)}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsEsc(summary)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(summary)}`, 'TRIGGER:-P3D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(summary)}`, 'TRIGGER:PT9H', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Betreuerbuch//DE', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
  download(`${name.replace(/[^\wäöüÄÖÜß -]/g, '').trim() || 'Frist'}.ics`, new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
}
