// Fachlogik: Klienten, Ziele, Fristen, Vergütung, Verlauf. Arbeitet direkt auf `state`.
import { state, save } from './store.js';
import { uid, todayISO, addMonths, addDays, daysUntil, parseISO, fmtDate, monthsBetween } from './util.js';

// ---------- Klienten ----------
export const clientName = (c) => [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Ohne Namen';
export const clientById = (id) => state.clients.find((c) => c.id === id);
export const activeClients = () => state.clients.filter((c) => !c.archived)
  .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'de') || (a.firstName || '').localeCompare(b.firstName || '', 'de'));
export const initials = (c) => ((c.firstName || '')[0] || '') + ((c.lastName || '')[0] || '');

export const TASK_AREAS = [
  'Vermögenssorge', 'Gesundheitssorge', 'Aufenthaltsbestimmung', 'Wohnungsangelegenheiten',
  'Behörden, Ämter, Versicherungen', 'Post (Entgegennahme & Öffnen)', 'Heim- / Pflegeangelegenheiten', 'Ambulante Versorgung organisieren',
];

// ---------- Ziele für Fahrten (Klienten + feste Orte) ----------
/** Ein Ziel hat immer: id, name, address, lat, lon, kmTo, kmBack. */
export function targetById(id) {
  const c = clientById(id);
  if (c) return { ...c, name: clientName(c), isClient: true };
  return state.places.find((p) => p.id === id) || null;
}
export function usageCounts() {
  const n = {};
  for (const t of state.trips) for (const s of t.stops) if (s.ref) n[s.ref] = (n[s.ref] || 0) + 1;
  return n;
}

// ---------- Fahrten ----------
export const routeLabel = (t) => [...t.stops.map((s) => s.name), t.roundTrip ? 'zurück' : null].filter(Boolean).join(' → ');
export const tripsOfYear = (y) => state.trips.filter((t) => t.date.startsWith(String(y))).sort((a, b) => a.date.localeCompare(b.date));
export function tripYears() {
  const ys = new Set(state.trips.map((t) => +t.date.slice(0, 4)));
  ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

// ---------- Kontakt-Protokoll / Verlauf ----------
export const LOG_TYPES = {
  telefon: { label: 'Telefonat', icon: 'phone' },
  whatsapp: { label: 'WhatsApp', icon: 'chat' },
  mail: { label: 'E-Mail', icon: 'mail' },
  besuch: { label: 'Persönlicher Besuch', icon: 'users' },
  brief: { label: 'Brief', icon: 'doc' },
  notiz: { label: 'Notiz', icon: 'edit' },
};
/** Verlauf eines Klienten: Protokolleinträge + Fahrten + Dokumente, neueste zuerst. */
export function timeline(clientId) {
  const items = [];
  for (const l of state.logs) if (l.clientId === clientId) items.push({ kind: 'log', date: l.date, item: l });
  for (const t of state.trips) if (t.stops.some((s) => s.ref === clientId)) items.push({ kind: 'trip', date: t.date, item: t });
  for (const d of state.docs) if (d.clientId === clientId) items.push({ kind: 'doc', date: d.date, item: d });
  return items.sort((a, b) => b.date.localeCompare(a.date));
}
/** Persönliche Kontakte für den Jahresbericht (Besuche aus Fahrten + Protokoll). */
export function personalContacts(clientId, year) {
  return timeline(clientId)
    .filter((e) => e.date.startsWith(String(year)) && e.kind !== 'doc')
    .map((e) => e.kind === 'trip'
      ? { date: e.date, type: 'Besuch', text: e.item.purpose || 'Besuch' }
      : { date: e.date, type: LOG_TYPES[e.item.type]?.label || e.item.type, text: e.item.text || '' })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Fristen & Wiedervorlagen ----------
export const REPEATS = { '': 'einmalig', monthly: 'monatlich', quarterly: 'alle 3 Monate', yearly: 'jährlich' };
const REPEAT_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

export const DEADLINE_PRESETS = [
  { title: 'Weiterbewilligungsantrag', repeat: 'yearly', note: 'Bürgergeld / Grundsicherung – rechtzeitig vor Ablauf des Bewilligungszeitraums stellen.' },
  { title: 'Widerspruchsfrist', fromNotice: true, note: '1 Monat ab Bescheid. Zur Sicherheit ab Bescheiddatum gerechnet.' },
  { title: 'Jahresbericht ans Gericht', repeat: 'yearly' },
  { title: 'Rechnungslegung', repeat: 'yearly' },
  { title: 'Ausweis läuft ab' },
  { title: 'Schwerbehindertenausweis läuft ab' },
  { title: 'Rundfunkbeitrag-Befreiung verlängern' },
  { title: 'Überprüfung der Betreuung' },
  { title: 'Wiedervorlage' },
];

export const openDeadlines = () => state.deadlines.filter((d) => !d.doneAt).sort((a, b) => a.due.localeCompare(b.due));
export const overdueCount = () => openDeadlines().filter((d) => daysUntil(d.due) < 0).length;

export function completeDeadline(d) {
  d.doneAt = todayISO();
  if (d.repeat && REPEAT_MONTHS[d.repeat]) {
    state.deadlines.push({ ...d, id: uid(), doneAt: null, due: addMonths(d.due, REPEAT_MONTHS[d.repeat]) });
  }
  save();
}

// ---------- Vergütung ----------
// Abrechnung je 3 Monate ab Bestellung. Erledigte Zeiträume werden in state.billing gemerkt.
export function billingPeriods(client) {
  if (!client.appointedAt) return [];
  const today = todayISO();
  const out = [];
  for (let i = 0; i < 400; i++) {
    const from = addMonths(client.appointedAt, 3 * i);
    if (from > today) break;
    const to = addDays(addMonths(client.appointedAt, 3 * (i + 1)), -1);
    if (client.billedUntil && to <= client.billedUntil) continue;
    const entry = state.billing.find((b) => b.clientId === client.id && b.from === from) || null;
    const running = to >= today;
    const status = running ? 'laufend' : entry?.paidAt ? 'bezahlt' : entry?.filedAt ? 'beantragt' : 'fällig';
    out.push({ index: i, from, to, entry, status, months: monthsBetween(client.appointedAt, from) + 1 });
  }
  return out;
}
export function dueBilling() {
  const out = [];
  for (const c of activeClients()) for (const p of billingPeriods(c)) if (p.status === 'fällig') out.push({ client: c, period: p });
  return out.sort((a, b) => a.period.to.localeCompare(b.period.to));
}
/** Warnhinweis, wenn ein Zeitraum lange nicht abgerechnet wurde (Anspruch kann nach 15 Monaten erlöschen). */
export const billingIsLate = (p) => p.status === 'fällig' && daysUntil(addMonths(p.to, 12)) < 0;

export function setBilling(client, period, patch) {
  let e = state.billing.find((b) => b.clientId === client.id && b.from === period.from);
  if (!e) { e = { id: uid(), clientId: client.id, from: period.from, to: period.to }; state.billing.push(e); }
  Object.assign(e, patch);
  if (!e.filedAt && !e.paidAt) state.billing = state.billing.filter((b) => b !== e);
  save();
}

// ---------- Geburtstage ----------
export function upcomingBirthdays(days = 14) {
  const today = todayISO();
  const out = [];
  for (const c of activeClients()) {
    if (!c.birthDate) continue;
    const b = parseISO(c.birthDate);
    const y = +today.slice(0, 4);
    let next = `${y}-${c.birthDate.slice(5)}`;
    if (next < today) next = `${y + 1}-${c.birthDate.slice(5)}`;
    const n = daysUntil(next);
    if (n <= days) out.push({ client: c, date: next, days: n, age: +next.slice(0, 4) - b.getFullYear() });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ---------- Vorlagen ----------
export function fillTemplate(text, client) {
  const s = state.settings;
  const contact = [s.office, s.phone && 'Tel. ' + s.phone, s.email].filter(Boolean).join('\n');
  const map = {
    name: client ? clientName(client) : '', vorname: client?.firstName || '', nachname: client?.lastName || '',
    geburtsdatum: fmtDate(client?.birthDate), adresse: client?.address || '',
    gericht: client?.court?.name || '', aktenzeichen: client?.court?.fileNo || '',
    krankenkasse: client?.insurance?.name || '', versichertennummer: client?.insurance?.number || '',
    datum: fmtDate(todayISO()), betreuer: s.ownerName || '', betreuer_kontakt: contact,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}
