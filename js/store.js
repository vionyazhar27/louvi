// The app's single source of truth.
//
// Modules never touch storage directly. They read with store.all()/store.get()
// and change data with store.add()/update()/trash()... Every change:
//   1. updates the in-memory document,
//   2. notifies the UI (subscribe),
//   3. is saved to the browser shortly after (debounced), and immediately when the tab is hidden.

import { emptyDoc, COLLECTIONS, TRASH_DAYS, SCHEMA_VERSION } from './schema.js';
import { migrate } from './migrations.js';
import { openStorage, requestPersistence } from './storage.js';
import { countDoc } from './backup.js';
import { uid } from './lib/id.js';
import { nowStamp, daysSince } from './lib/dates.js';

let doc = null;
let storage = null;
let saveTimer = null;
let dirty = false;
let channel = null;
const listeners = new Set();
const statusListeners = new Set();
let saveStatus = { state: 'idle', error: null, savedAt: null };

const SAVE_DELAY = 300;

// ---------- lifecycle ----------

export async function init(options = {}) {
  storage = await openStorage(options);
  let raw = null;
  let loadError = null;
  try {
    raw = await storage.loadDoc();
  } catch (e) {
    loadError = e;
  }
  if (loadError) {
    // Don't overwrite data we couldn't read. Run in memory and tell the user.
    doc = emptyDoc();
    storage = await openStorage({ prefer: 'memory' });
    setStatus({ state: 'error', error: 'Your saved data could not be read, so changes are not being saved. Reload the page to try again.' });
    return info();
  }

  if (raw) {
    const { doc: upgraded, from } = migrate(raw);
    if (from < SCHEMA_VERSION && from > 0) {
      await snapshot('Before app upgrade', raw);
    }
    doc = upgraded;
  } else {
    doc = emptyDoc();
  }

  const purged = purgeExpiredTrash();
  if (!raw || purged || dirty) await saveNow();

  if (storage.kind !== 'memory') requestPersistence();
  listenToOtherTabs();
  addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  return info();
}

export function info() {
  return { storage: storage?.kind ?? 'memory' };
}

// ---------- reading ----------

export function getDoc() {
  return doc;
}

export function settings() {
  return doc.settings;
}

// Active records (not in Trash).
export function all(collection) {
  return doc[collection].filter((r) => !r.deletedAt);
}

export function get(collection, id) {
  return doc[collection].find((r) => r.id === id && !r.purged) ?? null;
}

export function trashed() {
  const out = [];
  for (const c of COLLECTIONS) {
    for (const r of doc[c]) if (r.deletedAt && !r.purged) out.push({ collection: c, record: r });
  }
  return out.sort((a, b) => b.record.deletedAt.localeCompare(a.record.deletedAt));
}

// ---------- writing ----------

// Runs `fn(doc)` and saves. Use the helpers below for normal edits.
export function commit(fn, change = {}) {
  const result = fn(doc);
  doc.meta.updatedAt = nowStamp();
  markDirty();
  emit(change);
  return result;
}

export function add(collection, data) {
  const now = nowStamp();
  const record = { ...data, id: uid(), createdAt: now, updatedAt: now, deletedAt: null };
  commit((d) => d[collection].push(record), { collection, id: record.id, type: 'add' });
  return record;
}

// Adds many records in one change (one save, one screen refresh).
export function addMany(collection, list) {
  const now = nowStamp();
  const records = list.map((data) => ({ ...data, id: uid(), createdAt: now, updatedAt: now, deletedAt: null }));
  commit((d) => d[collection].push(...records), { collection, type: 'add' });
  return records;
}

export function trashMany(collection, ids) {
  const now = nowStamp();
  const set = new Set(ids);
  return commit((d) => {
    for (const r of d[collection]) if (set.has(r.id)) Object.assign(r, { deletedAt: now, updatedAt: now });
  }, { collection, type: 'update' });
}

export function update(collection, id, patch) {
  return commit((d) => {
    const r = d[collection].find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: nowStamp() });
    return r;
  }, { collection, id, type: 'update' });
}

export function trash(collection, id) {
  return update(collection, id, { deletedAt: nowStamp() });
}

export function restore(collection, id) {
  return update(collection, id, { deletedAt: null });
}

// Removes a record for good. Keeps a tiny marker so a synced device knows it's gone.
function toTombstone(r) {
  const keep = { id: r.id, createdAt: r.createdAt, updatedAt: nowStamp(), deletedAt: r.deletedAt || nowStamp(), purged: true };
  for (const k of Object.keys(r)) delete r[k];
  Object.assign(r, keep);
}

export function purge(collection, id) {
  return commit((d) => {
    const r = d[collection].find((x) => x.id === id);
    if (r) toTombstone(r);
  }, { collection, id, type: 'purge' });
}

export function emptyTrash() {
  return commit((d) => {
    for (const c of COLLECTIONS) for (const r of d[c]) if (r.deletedAt && !r.purged) toTombstone(r);
  }, { type: 'purge' });
}

function purgeExpiredTrash() {
  let n = 0;
  for (const c of COLLECTIONS) {
    for (const r of doc[c]) {
      if (r.deletedAt && !r.purged && daysSince(r.deletedAt) >= TRASH_DAYS) {
        toTombstone(r);
        n++;
      }
    }
  }
  if (n) markDirty();
  return n;
}

export function updateSettings(patch) {
  return commit((d) => {
    const now = nowStamp();
    d.settings._ts = { ...(d.settings._ts || {}) };
    for (const k of Object.keys(patch)) d.settings._ts[k] = now; // per-key time, used when syncing
    Object.assign(d.settings, patch);
  }, { type: 'settings' });
}

// Replaces everything (import / restore). Always snapshots the current data first.
// The restored data becomes the newest version: its records get a fresh edit time, and
// anything not in it is marked deleted. That way, with sync on, the restore reaches the
// other devices instead of being undone by their copies at the next sync.
export async function replaceAll(newDoc, reason) {
  await snapshot(reason);
  const now = nowStamp();
  const next = structuredClone(newDoc);
  for (const c of COLLECTIONS) {
    next[c] = (next[c] || []).map((r) => ({ ...r, updatedAt: now }));
    const keep = new Set(next[c].map((r) => r.id));
    for (const r of doc[c] || []) {
      if (!keep.has(r.id)) next[c].push({ id: r.id, createdAt: r.createdAt, updatedAt: now, deletedAt: r.deletedAt || now, purged: true });
    }
  }
  next.settings = { ...next.settings, _ts: Object.fromEntries(Object.keys(next.settings || {}).filter((k) => k !== '_ts').map((k) => [k, now])) };
  next.meta = { ...(next.meta || {}), updatedAt: now };
  doc = next;
  await saveNow();
  emit({ type: 'replace' });
}

// Deletes all records (as deletion markers, so synced devices delete them too).
// Name and theme stay.
export async function resetAll() {
  await snapshot('Before reset');
  const now = nowStamp();
  const fresh = emptyDoc();
  for (const c of COLLECTIONS) {
    fresh[c] = (doc[c] || []).map((r) => ({ id: r.id, createdAt: r.createdAt, updatedAt: now, deletedAt: r.deletedAt || now, purged: true }));
  }
  fresh.settings.name = doc.settings.name;
  fresh.settings.theme = doc.settings.theme;
  fresh.settings._ts = Object.fromEntries(Object.keys(fresh.settings).filter((k) => k !== '_ts').map((k) => [k, now]));
  doc = fresh;
  await saveNow();
  emit({ type: 'replace' });
}

// Replaces the data with the result of a sync merge (nothing is lost: merging only adds
// records or takes the newer edit). Emits a 'sync' change so sync doesn't re-trigger itself.
export async function applySynced(newDoc) {
  doc = structuredClone(newDoc);
  await saveNow();
  emit({ type: 'sync' });
}


// ---------- automatic backups ----------

export async function snapshot(reason, source = doc) {
  if (!storage || !source) return;
  try {
    await storage.addBackup({
      id: uid(),
      createdAt: nowStamp(),
      reason,
      counts: countDoc(source),
      doc: structuredClone(source),
    });
  } catch (e) {
    console.warn('[louvi] Could not create automatic backup', e);
    throw new Error('Could not save a safety backup first, so nothing was changed. ' + (e?.message || ''));
  }
}

export async function listBackups() {
  return storage ? storage.listBackups() : [];
}

export async function getBackup(id) {
  return storage ? storage.getBackup(id) : null;
}

// ---------- saving ----------

function markDirty() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), SAVE_DELAY);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  if (!storage) return;
  dirty = false;
  setStatus({ state: 'saving', error: null });
  try {
    await storage.saveDoc(doc);
    setStatus({ state: 'saved', error: null, savedAt: nowStamp() });
    channel?.postMessage({ type: 'saved', at: doc.meta.updatedAt });
  } catch (e) {
    dirty = true;
    const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message));
    setStatus({
      state: 'error',
      error: quota
        ? 'Your browser storage is full. Download a backup, then empty the Trash.'
        : 'Changes could not be saved. Download a backup to keep them safe.',
    });
  }
}

export function flush() {
  if (dirty) saveNow();
}

export function hasUnsavedChanges() {
  return dirty || saveStatus.state === 'saving';
}

function setStatus(s) {
  saveStatus = { ...saveStatus, ...s };
  for (const fn of statusListeners) fn(saveStatus);
}

export function getSaveStatus() {
  return saveStatus;
}

export function onSaveStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

// ---------- change notifications ----------

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(change) {
  for (const fn of listeners) {
    try {
      fn(change);
    } catch (e) {
      console.error('[louvi] listener failed', e);
    }
  }
}

// If louvi is open in two tabs, a save in one reloads the other,
// so the second tab never overwrites the first with stale data.
function listenToOtherTabs() {
  if (!('BroadcastChannel' in globalThis) || storage.kind === 'memory') return;
  channel = new BroadcastChannel('louvi');
  channel.onmessage = async (ev) => {
    if (ev.data?.type !== 'saved') return;
    try {
      const fresh = await storage.loadDoc();
      if (fresh && fresh.meta?.updatedAt !== doc.meta.updatedAt) {
        clearTimeout(saveTimer);
        dirty = false;
        doc = migrate(fresh).doc;
        emit({ type: 'replace', external: true });
      }
    } catch (e) {
      console.warn('[louvi] could not reload changes from another tab', e);
    }
  };
}
