// Einstieg: Sperre, Router, automatische Sperre bei Inaktivität.
import { $, $$, closeDialog } from './util.js';
import { hasVault, isUnlocked, lock, state, setAfterSave } from './store.js';
import { overdueCount } from './model.js';
import { preloadGoogle, autoBackupOnUnlock, scheduleLiveBackup, setCloudUiRefresh, cloudConnected } from './cloud.js';
import { showSetup, showUnlock, hideLock } from './lock.js';
import { setRerender, navigate } from './ui.js';
import { viewToday } from './views/heute.js';
import { viewClients, viewClient, viewClientEdit } from './views/klienten.js';
import { viewTrips, viewTripEdit } from './views/fahrten.js';
import { viewDeadlines } from './views/fristen.js';
import { viewMore, viewSettings, viewPlaces, viewTemplates, viewExport, viewBackup, viewSecurity } from './views/mehr.js';

const ROUTES = [
  [/^heute$/, 'heute', () => viewToday()],
  [/^klienten$/, 'klienten', () => viewClients()],
  [/^klient\/([\w-]+)\/bearbeiten$/, 'klienten', (m) => viewClientEdit(m[1])],
  [/^klient\/([\w-]+)$/, 'klienten', (m) => (m[1] === 'neu' ? viewClientEdit('neu') : viewClient(m[1]))],
  [/^fahrten$/, 'fahrten', () => viewTrips()],
  [/^fahrt\/([\w-]+)$/, 'fahrten', (m, q) => viewTripEdit(m[1], q)],
  [/^export$/, 'fahrten', () => viewExport()],
  [/^fristen$/, 'fristen', () => viewDeadlines()],
  [/^mehr$/, 'mehr', () => viewMore(lockApp)],
  [/^einstellungen$/, 'mehr', () => viewSettings()],
  [/^orte$/, 'mehr', () => viewPlaces()],
  [/^vorlagen$/, 'mehr', () => viewTemplates()],
  [/^sicherung$/, 'mehr', () => viewBackup()],
  [/^sicherheit$/, 'mehr', () => viewSecurity()],
];

let lastPath = '';
function render() {
  if (!isUnlocked()) return;
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  for (const [re, tab, fn] of ROUTES) {
    const m = (path || 'heute').match(re);
    if (!m) continue;
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const n = overdueCount();
    $('#tab-badge').textContent = n || '';
    $('#tab-badge').hidden = !n;
    fn(m, new URLSearchParams(qs || ''));
    if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
    return;
  }
  navigate('heute');
}
setRerender(render);
setCloudUiRefresh(render);
setAfterSave(scheduleLiveBackup);
window.addEventListener('hashchange', () => { closeDialog(); render(); });
$$('.tabbar button').forEach((b) => b.onclick = () => navigate(b.dataset.tab));

// ---------- Sperre ----------
function onUnlocked() {
  hideLock();
  touch();
  render();
  if (cloudConnected()) preloadGoogle().then(autoBackupOnUnlock).catch(() => {});
}
function lockApp() {
  closeDialog();
  lock();
  $('#view').innerHTML = '';
  $('#print').innerHTML = '';
  showUnlock(onUnlocked);
}

let lastActive = Date.now();
const touch = () => { lastActive = Date.now(); };
['pointerdown', 'keydown', 'scroll'].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
function checkIdle() {
  if (!isUnlocked()) return;
  const limit = (state.settings.autoLockMin || 5) * 60000;
  if (Date.now() - lastActive > limit) lockApp();
}
setInterval(checkIdle, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkIdle(); });

// ---------- Start ----------
if (!window.isSecureContext || !crypto.subtle) {
  document.body.innerHTML = '<p style="padding:24px">Die App braucht eine sichere Verbindung (https). Bitte über die richtige Adresse öffnen.</p>';
} else {
  (await hasVault()) ? showUnlock(onUnlocked) : showSetup(onUnlocked);
}
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
