// Export and import. Pure functions (no DOM, no storage) so they can be unit-tested.

import { APP_ID, APP_VERSION, COLLECTIONS, NORMALIZERS, THEMES, LIMITS, defaultSettings } from './schema.js';
import { migrate } from './migrations.js';
import { sanitizeCategories } from './lib/finance.js';

export function buildExport(doc, now = new Date()) {
  return JSON.stringify({ ...doc, appVersion: APP_VERSION, exportedAt: now.toISOString() }, null, 2);
}

export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `louvi-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

// Counts used in previews and backup lists.
export function countDoc(doc) {
  const out = {};
  for (const c of COLLECTIONS) {
    const list = Array.isArray(doc?.[c]) ? doc[c] : [];
    const live = list.filter((r) => !r.purged);
    out[c] = {
      total: live.filter((r) => !r.deletedAt).length,
      done: live.filter((r) => !r.deletedAt && r.status === 'done').length,
      trash: live.filter((r) => r.deletedAt).length,
    };
  }
  return out;
}

function sanitizeSettings(raw) {
  const s = { ...defaultSettings() };
  if (raw && typeof raw === 'object') {
    if (typeof raw.name === 'string') s.name = raw.name.trim().slice(0, LIMITS.name);
    if (THEMES.includes(raw.theme)) s.theme = raw.theme;
    if (typeof raw.lastExportAt === 'string') s.lastExportAt = raw.lastExportAt;
    if (typeof raw.lastArea === 'string') s.lastArea = raw.lastArea;
    s.financeCategories = sanitizeCategories(raw.financeCategories);
    if (raw._ts && typeof raw._ts === 'object') {
      s._ts = Object.fromEntries(Object.entries(raw._ts).filter(([k, v]) => k in s && typeof v === 'string'));
    }
  }
  return s;
}

// Reads a backup file's text and returns either
//   { ok: false, error }  with a message for the user, or
//   { ok: true, doc, report } where report explains exactly what will be imported.
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON. Pick a louvi backup file (.json)." };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: "This file doesn't contain louvi data." };
  }
  if (raw.app !== APP_ID) {
    return { ok: false, error: "This file isn't a louvi backup. It's missing the louvi marker." };
  }

  let migrated;
  try {
    migrated = migrate(raw);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const doc = migrated.doc;

  const report = {
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : null,
    upgradedFrom: migrated.from < migrated.to ? migrated.from : null,
    skipped: {},
    fixed: {},
    duplicates: {},
  };

  for (const c of COLLECTIONS) {
    const normalize = NORMALIZERS[c];
    const byId = new Map();
    let skipped = 0, fixed = 0, duplicates = 0;
    for (const item of doc[c]) {
      const res = normalize(item);
      if (!res) { skipped++; continue; }
      if (res.fixed.length) fixed++;
      const prev = byId.get(res.record.id);
      if (prev) {
        duplicates++;
        if ((res.record.updatedAt || '') <= (prev.updatedAt || '')) continue;
      }
      byId.set(res.record.id, res.record);
    }
    doc[c] = [...byId.values()];
    report.skipped[c] = skipped;
    report.fixed[c] = fixed;
    report.duplicates[c] = duplicates;
  }

  doc.app = APP_ID;
  doc.settings = sanitizeSettings(doc.settings);
  doc.meta = {
    createdAt: typeof doc.meta?.createdAt === 'string' ? doc.meta.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  delete doc.exportedAt;
  delete doc.appVersion;

  report.counts = countDoc(doc);
  return { ok: true, doc, report };
}
