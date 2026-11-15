// Gemeinsame Oberflächen-Bausteine: Navigation, Kopfzeile, Auswahlfelder.
import { $, $$, esc, icon } from './util.js';
import { activeClients, clientName } from './model.js';

export const view = () => $('#view');
export const navigate = (path) => { location.hash = '#/' + path; };

let rerenderFn = () => {};
export const setRerender = (fn) => { rerenderFn = fn; };
export const rerender = () => rerenderFn();

/** Kopfzeile: Titel, optionaler Zurück-Pfad, optionale Aktionsknöpfe. */
export function header(title, { back = null, actions = [] } = {}) {
  $('#title').textContent = title;
  document.title = title + ' · Betreuerbuch';
  const b = $('#back');
  b.hidden = !back;
  b.onclick = () => navigate(back);
  const a = $('#actions');
  a.innerHTML = actions.map((x, i) => `<button class="icon-btn" data-act="${i}" title="${esc(x.label)}" aria-label="${esc(x.label)}">${icon(x.icon)}</button>`).join('');
  $$('[data-act]', a).forEach((btn) => btn.onclick = () => actions[+btn.dataset.act].onClick());
}

export function clientSelectHTML(id, selected = '', allowNone = true) {
  return `<select id="${id}">
    ${allowNone ? `<option value="">– kein Klient –</option>` : ''}
    ${activeClients().map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(clientName(c))}</option>`).join('')}
  </select>`;
}

export const emptyState = (iconName, text, button = '') =>
  `<div class="empty">${icon(iconName, 'big')}<p>${text}</p>${button}</div>`;
