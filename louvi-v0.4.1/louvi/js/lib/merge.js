// Combines two copies of louvi's data (this device + the synced copy).
// Pure function, no network.
//
// Rules:
//   - Records are matched by id. When both copies have one, the most recently edited
//     (updatedAt) wins. Deleting is an edit too, so deletions travel between devices.
//   - Records that exist on only one side are kept.
//   - Settings merge key by key: each key keeps the side changed most recently
//     (settings._ts[key]); lastExportAt keeps the latest date from either side.
//
// Edits to the SAME record on two devices before either syncs: the later edit wins
// and the other is overwritten. Edits to different records never conflict.

import { COLLECTIONS } from '../schema.js';

const later = (a, b) => ((a || '') >= (b || '') ? a : b);

function sortRecords(list) {
  return [...list].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
}

// JSON with object keys sorted, so key order never makes two equal values look different.
export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}

// Stable text used to tell whether two documents hold the same data.
export function canonical(doc) {
  const out = { settings: { ...(doc.settings || {}), _ts: doc.settings?._ts || {} } };
  for (const c of COLLECTIONS) out[c] = sortRecords(doc[c] || []);
  return stableStringify(out);
}

export function mergeDocs(local, remote) {
  const merged = {
    app: local.app,
    schemaVersion: local.schemaVersion,
    meta: {
      createdAt: [local.meta?.createdAt, remote.meta?.createdAt].filter(Boolean).sort()[0] || new Date().toISOString(),
      updatedAt: later(local.meta?.updatedAt, remote.meta?.updatedAt) || new Date().toISOString(),
    },
  };

  const ls = local.settings || {}, rs = remote.settings || {};
  const lts = ls._ts || {}, rts = rs._ts || {};
  const settings = { _ts: {} };
  for (const key of new Set([...Object.keys(ls), ...Object.keys(rs)])) {
    if (key === '_ts') continue;
    const useRemote = !(key in ls) || ((rts[key] || '') > (lts[key] || ''));
    settings[key] = structuredClone(useRemote ? rs[key] : ls[key]);
    const ts = useRemote ? rts[key] : lts[key];
    if (ts) settings._ts[key] = ts;
  }
  settings.lastExportAt = later(ls.lastExportAt, rs.lastExportAt) || null;
  merged.settings = settings;

  for (const c of COLLECTIONS) {
    const byId = new Map();
    for (const r of remote[c] || []) byId.set(r.id, r);
    for (const r of local[c] || []) {
      const other = byId.get(r.id);
      if (!other || (r.updatedAt || '') >= (other.updatedAt || '')) byId.set(r.id, r);
    }
    merged[c] = sortRecords([...byId.values()]);
  }

  const m = canonical(merged);
  return {
    doc: merged,
    changedLocal: m !== canonical(local),
    changedRemote: m !== canonical(remote),
  };
}
