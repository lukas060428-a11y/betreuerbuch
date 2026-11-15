// Allgemeine Helfer: DOM, Formatierung, Datum, Dialoge, Icons.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const round1 = (n) => Math.round(n * 10) / 10;
export const parseNum = (s) => { const v = parseFloat(String(s).replace(',', '.')); return isNaN(v) ? null : v; };

// ---------- Zahlen ----------
export const fmtKm = (n) => (n == null || isNaN(n)) ? '–' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtEur = (n) => Number(n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

// ---------- Datum (immer als "YYYY-MM-DD" gespeichert) ----------
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => toISO(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (s) => s ? parseISO(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const fmtDateShort = (s) => parseISO(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
export const weekday = (s) => parseISO(s).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
export const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
export function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
export function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}
export const daysUntil = (iso) => Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
export function relDays(iso) {
  const n = daysUntil(iso);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'seit gestern';
  if (n < 0) return `seit ${-n} Tagen`;
  if (n < 14) return `in ${n} Tagen`;
  return fmtDate(iso);
}
export function ageOn(birthISO, onISO = todayISO()) {
  const b = parseISO(birthISO), o = parseISO(onISO);
  let a = o.getFullYear() - b.getFullYear();
  if (o.getMonth() < b.getMonth() || (o.getMonth() === b.getMonth() && o.getDate() < b.getDate())) a--;
  return a;
}
export function monthsBetween(fromISO, toISO_) {
  const a = parseISO(fromISO), b = parseISO(toISO_);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) m--;
  return m;
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---------- Dialoge ----------
export function openDialog(html, cls = '') {
  const dlg = $('#dlg');
  dlg.className = cls;
  dlg.innerHTML = `<div class="dlg-body">${html}</div>`;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  return dlg;
}
export function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }
export function confirmDialog(text, okLabel = 'Löschen', danger = true) {
  return new Promise((resolve) => {
    const dlg = openDialog(`<p style="margin-top:0">${esc(text)}</p>
      <div class="dlg-actions"><button class="btn secondary" data-no>Abbrechen</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`);
    $('[data-no]', dlg).onclick = () => { closeDialog(); resolve(false); };
    $('[data-yes]', dlg).onclick = () => { closeDialog(); resolve(true); };
  });
}

export function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert'); }
  catch { toast('Kopieren nicht möglich'); }
}

// ---------- Icons ----------
const PATHS = {
  home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v3h3v-3M16 16v3h3v-3M5 11h14"/><circle cx="8" cy="13.5" r=".6"/><circle cx="16" cy="13.5" r=".6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M4 18.5l1.2-3.6A7.5 7.5 0 1 1 8.6 18z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  euro: '<path d="M17 6.5A6.5 6.5 0 1 0 17 17.5M5 10.5h9M5 13.5h9"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2"/>',
  cake: '<path d="M4 20h16v-7H4zM4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1.5 4 0M12 13V9M12 5.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z"/>',
  download: '<path d="M4 17v3h16v-3M12 4v11M7 10l5 5 5-5"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  shield: '<path d="M12 3l7.5 3v6c0 4.5-3.2 7.8-7.5 9-4.3-1.2-7.5-4.5-7.5-9V6z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  nav: '<path d="M3.5 11l17-7.5-7.5 17-2-7.5z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
export const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;
