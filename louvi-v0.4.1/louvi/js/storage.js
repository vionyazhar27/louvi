// Where data physically lives in the browser.
//
// Preferred: IndexedDB (large, durable). Fallback: localStorage. Last resort: memory only
// (e.g. a locked-down private window), in which case the app warns that nothing is saved.
//
// Two things are stored:
//   doc      the whole louvi document (one JSON object)
//   backups  automatic snapshots taken before risky actions (import, reset, restore, upgrade)

const DB_NAME = 'louvi';
const DB_VERSION = 1;
const DOC_KEY = 'main';
const LS_DOC = 'louvi:doc';
const LS_BACKUPS = 'louvi:backups';
export const MAX_BACKUPS = 5;

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openIDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB not available'));
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      return reject(e);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('doc')) db.createObjectStore('doc');
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another open louvi tab. Close other tabs and reload.'));
  });
}

function idbAdapter(db) {
  const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
  const done = (t) => new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Save was aborted'));
  });
  return {
    kind: 'indexeddb',
    async loadDoc() {
      return (await idbRequest(tx('doc').get(DOC_KEY))) ?? null;
    },
    async saveDoc(doc) {
      const t = db.transaction('doc', 'readwrite');
      t.objectStore('doc').put(doc, DOC_KEY);
      await done(t);
    },
    async listBackups() {
      const all = await idbRequest(tx('backups').getAll());
      return all.map(({ doc, ...meta }) => meta).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getBackup(id) {
      return (await idbRequest(tx('backups').get(id))) ?? null;
    },
    async addBackup(backup) {
      const t = db.transaction('backups', 'readwrite');
      t.objectStore('backups').put(backup);
      await done(t);
      await this.pruneBackups();
    },
    async pruneBackups() {
      const list = await this.listBackups();
      const extra = list.slice(MAX_BACKUPS);
      if (!extra.length) return;
      const t = db.transaction('backups', 'readwrite');
      for (const b of extra) t.objectStore('backups').delete(b.id);
      await done(t);
    },
  };
}

function lsAdapter() {
  const readBackups = () => {
    try { return JSON.parse(localStorage.getItem(LS_BACKUPS) || '[]'); } catch { return []; }
  };
  return {
    kind: 'localstorage',
    async loadDoc() {
      const s = localStorage.getItem(LS_DOC);
      return s ? JSON.parse(s) : null;
    },
    async saveDoc(doc) {
      localStorage.setItem(LS_DOC, JSON.stringify(doc));
    },
    async listBackups() {
      return readBackups().map(({ doc, ...meta }) => meta).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getBackup(id) {
      return readBackups().find((b) => b.id === id) ?? null;
    },
    async addBackup(backup) {
      // localStorage is small (~5 MB), so keep fewer backups here.
      const list = [backup, ...readBackups()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
      localStorage.setItem(LS_BACKUPS, JSON.stringify(list));
    },
  };
}

function memoryAdapter() {
  let doc = null;
  let backups = [];
  return {
    kind: 'memory',
    async loadDoc() { return doc; },
    async saveDoc(d) { doc = structuredClone(d); },
    async listBackups() { return backups.map(({ doc, ...meta }) => meta); },
    async getBackup(id) { return backups.find((b) => b.id === id) ?? null; },
    async addBackup(b) { backups = [b, ...backups].slice(0, MAX_BACKUPS); },
  };
}

function localStorageWorks() {
  try {
    const k = 'louvi:probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export async function openStorage({ prefer } = {}) {
  if (prefer !== 'localstorage' && prefer !== 'memory') {
    try {
      return idbAdapter(await openIDB());
    } catch (e) {
      console.warn('[louvi] IndexedDB unavailable, falling back.', e);
    }
  }
  if (prefer !== 'memory' && localStorageWorks()) return lsAdapter();
  return memoryAdapter();
}

// Asks the browser not to clear louvi's data when the device runs low on space.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

export async function persistenceStatus() {
  try {
    if (navigator.storage?.persisted) return await navigator.storage.persisted();
  } catch { /* ignore */ }
  return null; // unknown
}
