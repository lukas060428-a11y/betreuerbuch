// Adresssuche (OpenStreetMap Nominatim) und Strecken (OSRM).
import { state, save } from './store.js';
import { $, $$, esc, round1 } from './util.js';

function shortAddr(d) {
  const a = d.address || {};
  const street = [a.road || a.pedestrian || a.footway || a.square || '', a.house_number || ''].join(' ').trim();
  const city = a.city || a.town || a.village || a.municipality || a.suburb || '';
  return [street, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || d.display_name;
}

export async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=de&accept-language=de&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Adresssuche nicht erreichbar (' + r.status + ')');
  return (await r.json()).map((d) => ({ label: shortAddr(d), name: d.name || '', lat: +d.lat, lon: +d.lon }));
}

export async function route(points) {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`);
  if (!r.ok) throw new Error('Routenberechnung nicht erreichbar (' + r.status + ')');
  const d = await r.json();
  if (d.code !== 'Ok' || !d.routes?.length) throw new Error('Keine Route gefunden');
  return { total: d.routes[0].distance / 1000, legs: d.routes[0].legs.map((l) => l.distance / 1000) };
}

/** Berechnet Hin- und Rückweg Zuhause ↔ Ziel und merkt sie am Objekt (Klient oder Ort). */
export async function computeTargetKm(t) {
  const home = state.settings.home;
  if (!home || t.lat == null) return;
  const r = await route([home, t, home]);
  t.kmTo = round1(r.legs[0]);
  t.kmBack = round1(r.legs[1]);
}

export async function recomputeAllTargets() {
  let fail = 0;
  for (const t of [...state.clients, ...state.places]) {
    if (t.lat == null) continue;
    try { await computeTargetKm(t); } catch { fail++; }
  }
  await save();
  return fail;
}

export const mapsLink = (t) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(t.address || `${t.lat},${t.lon}`)}`;

// ---------- Baustein: Adresse suchen ----------
export function addrSearchHTML(value = '') {
  return `<div class="addr">
    <div class="row">
      <input type="search" class="addr-q grow" placeholder="Straße Hausnr., PLZ Ort" value="${esc(value)}" enterkeyhint="search" autocomplete="off">
      <button type="button" class="btn secondary addr-go">Suchen</button>
    </div>
    <div class="addr-res"></div>
  </div>`;
}

export function wireAddrSearch(root, onPick) {
  const q = $('.addr-q', root), res = $('.addr-res', root);
  const pick = (r) => { q.value = r.label; res.innerHTML = `<div class="addr-ok">✓ ${esc(r.label)}</div>`; onPick(r); };
  const run = async () => {
    const text = q.value.trim();
    if (!text) return;
    res.innerHTML = '<div class="muted small">Suche …</div>';
    try {
      const list = await geocode(text);
      if (!list.length) { res.innerHTML = '<div class="err">Nichts gefunden. Tipp: Straße, Hausnummer und Ort angeben.</div>'; return; }
      if (list.length === 1) return pick(list[0]);
      res.innerHTML = '<div class="muted small">Bitte die richtige Adresse antippen:</div>' +
        list.map((r, i) => `<button type="button" class="addr-item" data-i="${i}">${esc(r.label)}</button>`).join('');
      $$('.addr-item', res).forEach((b) => b.onclick = () => pick(list[+b.dataset.i]));
    } catch (e) {
      res.innerHTML = `<div class="err">${esc(e.message)}. Besteht eine Internetverbindung?</div>`;
    }
  };
  $('.addr-go', root).onclick = run;
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
}
