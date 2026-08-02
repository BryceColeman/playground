// db.js — tiny promise wrapper around IndexedDB. No external deps so it works
// fully offline. Everything (names + photo blobs + study progress) lives here,
// on the device only. Nothing is ever uploaded.

const DB_NAME = 'wardNames';
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('people')) {
        const s = db.createObjectStore('people', { keyPath: 'id' });
        s.createIndex('householdId', 'householdId', { unique: false });
        s.createIndex('dueDate', 'srs.dueDate', { unique: false });
      }
      if (!db.objectStoreNames.contains('households')) {
        db.createObjectStore('households', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const os = t.objectStore(store);
        let result;
        Promise.resolve(fn(os))
          .then((r) => {
            result = r;
          })
          .catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ── People ──
export const putPerson = (p) => tx('people', 'readwrite', (os) => os.put(p));
export const getPerson = (id) =>
  tx('people', 'readonly', (os) => reqToPromise(os.get(id)));
export const allPeople = () =>
  tx('people', 'readonly', (os) => reqToPromise(os.getAll()));
export const deletePerson = (id) =>
  tx('people', 'readwrite', (os) => os.delete(id));

// ── Households ──
export const putHousehold = (h) =>
  tx('households', 'readwrite', (os) => os.put(h));
export const allHouseholds = () =>
  tx('households', 'readonly', (os) => reqToPromise(os.getAll()));
export const deleteHousehold = (id) =>
  tx('households', 'readwrite', (os) => os.delete(id));

// ── Meta (settings, streak, etc.) ──
export const getMeta = (key, fallback = null) =>
  tx('meta', 'readonly', (os) => reqToPromise(os.get(key))).then((r) =>
    r === undefined ? fallback : r.value
  );
export const setMeta = (key, value) =>
  tx('meta', 'readwrite', (os) => os.put({ key, value }));

// ── Bulk (used by backup import/export) ──
export async function clearAll() {
  await tx('people', 'readwrite', (os) => os.clear());
  await tx('households', 'readwrite', (os) => os.clear());
  await tx('meta', 'readwrite', (os) => os.clear());
}

// Find-or-create a household by (case-insensitive) name. Returns its id.
export async function ensureHousehold(name) {
  const clean = (name || '').trim();
  if (!clean) return null;
  const all = await allHouseholds();
  const found = all.find(
    (h) => h.name.toLowerCase() === clean.toLowerCase()
  );
  if (found) return found.id;
  const id = uid();
  await putHousehold({ id, name: clean });
  return id;
}
