// Offline-Unterstützung: App-Dateien werden zwischengespeichert.
// Strategie: erst Netz (damit Updates sofort ankommen), sonst Cache.
const CACHE = 'betreuerbuch-v3';
const ASSETS = ['./', './index.html', './styles.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  ...['main', 'util', 'crypto', 'db', 'store', 'model', 'geo', 'ui', 'lock', 'actions', 'export', 'templates'].map((f) => `./js/${f}.js`),
  ...['heute', 'klienten', 'fahrten', 'fristen', 'mehr'].map((f) => `./js/views/${f}.js`)];
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Excel-Bibliothek: einmal laden, dann aus dem Cache
  if (req.url === XLSX_URL) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }

  // Eigene App-Dateien: Netz zuerst, Cache als Rückfall
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
  }
  // Adresssuche/Routen (OpenStreetMap) gehen immer direkt ins Netz.
});
