// Upgrades data saved by an older version of louvi to the current shape.
//
// How to add a migration when the data shape changes:
//   1. Bump SCHEMA_VERSION in schema.js (e.g. 1 → 2).
//   2. Add an entry here keyed by the NEW version: 2: (doc) => { ...; return doc; }
//   3. Never edit an old migration once released; backups out there depend on it.
//   4. Add a test in tests/tests.js.

import { SCHEMA_VERSION, COLLECTIONS, defaultSettings } from './schema.js';
import { DEFAULT_CATEGORIES } from './lib/finance.js';

const MIGRATIONS = {
  // Version 1 is the first release. This also repairs documents missing pieces.
  1: (doc) => {
    doc.meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
    doc.settings = { ...defaultSettings(), ...(doc.settings || {}) };
    for (const c of COLLECTIONS) if (!Array.isArray(doc[c])) doc[c] = [];
    return doc;
  },
  // 0.2.0: Career module adds applications and skills.
  2: (doc) => {
    if (!Array.isArray(doc.applications)) doc.applications = [];
    if (!Array.isArray(doc.skills)) doc.skills = [];
    return doc;
  },
  // 0.3.0: Finance module.
  3: (doc) => {
    for (const c of ['accounts', 'snapshots', 'transactions', 'savingsGoals']) if (!Array.isArray(doc[c])) doc[c] = [];
    doc.settings = doc.settings || {};
    if (!doc.settings.financeCategories) doc.settings.financeCategories = structuredClone(DEFAULT_CATEGORIES);
    return doc;
  },
};

// Returns { doc, from, to }. Throws if the data is from a newer app version.
export function migrate(input) {
  const doc = structuredClone(input);
  const from = Number.isInteger(doc.schemaVersion) ? doc.schemaVersion : 0;
  if (from > SCHEMA_VERSION) {
    throw new Error(`This data was saved by a newer version of louvi (data version ${from}). Update the app first.`);
  }
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) MIGRATIONS[v](doc);
    doc.schemaVersion = v;
  }
  // Always make sure every collection exists, even when no migration ran.
  MIGRATIONS[1](doc);
  return { doc, from, to: SCHEMA_VERSION };
}
