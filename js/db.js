// Minimaler Schlüssel-Wert-Speicher auf IndexedDB (hält auch große Dateien wie Fotos).

let dbPromise;
function open() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('betreuerbuch', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
  });
}

export const idbGet = (k) => run('readonly', (s) => s.get(k));
export const idbSet = (k, v) => run('readwrite', (s) => s.put(v, k));
export const idbDel = (k) => run('readwrite', (s) => s.delete(k));
export const idbKeys = () => run('readonly', (s) => s.getAllKeys());

/** Schreibt/löscht mehrere Einträge in EINER Transaktion – ganz oder gar nicht. */
export function idbBatch({ set = [], del = [], clear = false }) {
  return run('readwrite', (s) => {
    if (clear) s.clear();
    for (const k of del) s.delete(k);
    for (const [k, v] of set) s.put(v, k);
    return null;
  });
}
