// The shape of louvi's data, in one place.
// See docs/DATA_MODEL.md for the human-readable version.
//
// Every record in a collection has:
//   id         string, unique
//   createdAt  ISO timestamp
//   updatedAt  ISO timestamp (used later to merge edits from two devices)
//   deletedAt  ISO timestamp or null (null = active, set = in Trash)
//   purged     true once removed from Trash for good (only the id + dates stay,
//              so a second device knows it was deleted)

import { isValidISO } from './lib/dates.js';
import { isValidRule } from './lib/recurrence.js';
import { cleanLinks, LINK_LIMITS } from './lib/links.js';
import { normalizeImportedApplication, normalizeImportedSkill, tombstoneFrom } from './lib/career.js';
import {
  normalizeImportedAccount, normalizeImportedSnapshot, normalizeImportedTransaction, normalizeImportedGoal, DEFAULT_CATEGORIES,
} from './lib/finance.js';

export const APP_ID = 'louvi';
export const APP_VERSION = '0.4.1';
export const SCHEMA_VERSION = 3;

export const TRASH_DAYS = 30;

// Collections that hold records. New modules add their collection here.
export const COLLECTIONS = ['tasks', 'applications', 'skills', 'accounts', 'snapshots', 'transactions', 'savingsGoals'];

// Shown in Trash, import previews and backup lists.
export const COLLECTION_LABELS = {
  tasks: { one: 'task', many: 'tasks' },
  applications: { one: 'application', many: 'applications' },
  skills: { one: 'skill', many: 'skills' },
  accounts: { one: 'account', many: 'accounts' },
  snapshots: { one: 'monthly balance', many: 'monthly balances' },
  transactions: { one: 'transaction', many: 'transactions' },
  savingsGoals: { one: 'savings goal', many: 'savings goals' },
};

export const AREAS = [
  { id: 'work', label: 'Work' },
  { id: 'thesis', label: 'Thesis' },
  { id: 'career', label: 'Career' },
  { id: 'personal', label: 'Personal' },
  { id: 'plans', label: 'Plans' },
];
export const AREA_IDS = AREAS.map((a) => a.id);
export const areaLabel = (id) => AREAS.find((a) => a.id === id)?.label ?? 'Personal';

export const PRIORITIES = [
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];
export const PRIORITY_IDS = PRIORITIES.map((p) => p.id);

export const THEMES = ['system', 'light', 'dark'];

export const LIMITS = { title: 200, notes: 5000, name: 60 };

export function defaultSettings() {
  return {
    name: '',
    theme: 'system',
    lastExportAt: null,
    lastArea: 'personal',
    financeCategories: structuredClone(DEFAULT_CATEGORIES),
  };
}

export function emptyDoc() {
  const now = new Date().toISOString();
  const doc = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    meta: { createdAt: now, updatedAt: now },
    settings: defaultSettings(),
  };
  for (const c of COLLECTIONS) doc[c] = [];
  return doc;
}

// ---------- Task ----------
//
// title       string, required
// notes       string
// area        one of AREA_IDS
// due         "YYYY-MM-DD" or null
// priority    'high' | 'normal' | 'low'
// status      'todo' | 'done'
// doneAt      ISO timestamp or null
// repeat      recurrence rule or null (see lib/recurrence.js)
// links       [{ label, url }]  http(s) links, e.g. a Google Drive file (max 20)
// nextId      id of the copy created when this repeating task was completed
// ref         { type: 'application', id } when the task belongs to another record (e.g. a follow-up)
// sample      true for example tasks added from the welcome screen

// Checks user input from the task form. Returns { ok, errors, value }.
export function validateTaskInput(input) {
  const errors = {};
  const title = String(input.title ?? '').trim();
  const notes = String(input.notes ?? '').trim();
  const due = input.due ? String(input.due) : null;

  if (!title) errors.title = 'Give the task a name.';
  else if (title.length > LIMITS.title) errors.title = `Keep the name under ${LIMITS.title} characters.`;
  if (notes.length > LIMITS.notes) errors.notes = `Notes can be up to ${LIMITS.notes} characters.`;
  if (due && !isValidISO(due)) errors.due = 'Pick a valid date.';
  if (!AREA_IDS.includes(input.area)) errors.area = 'Pick an area.';
  if (!PRIORITY_IDS.includes(input.priority)) errors.priority = 'Pick a priority.';

  const linkRes = cleanLinks(input.links || []);
  if (linkRes.invalid) errors.links = `Remove the link that isn't a valid web address (or keep it under ${LINK_LIMITS.count} links).`;

  let repeat = input.repeat || null;
  if (repeat) {
    if (!due) errors.due = 'Repeating tasks need a due date to start from.';
    if (repeat.freq === 'weekly' && (!repeat.days || repeat.days.length === 0)) {
      errors.repeat = 'Pick at least one day of the week.';
    } else if (!isValidRule(repeat)) {
      errors.repeat = 'This repeat setting is not valid.';
    }
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok ? { title, notes, due, area: input.area, priority: input.priority, repeat, links: linkRes.links } : null,
  };
}

// Checks a task coming from a backup file. Returns { record, fixed } or null if unusable.
// `fixed` lists fields that had to be reset to a default, so the import preview can say so.
export function normalizeImportedTask(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const fixed = [];
  const stamp = (v) => (typeof v === 'string' && !isNaN(new Date(v)) ? v : null);

  if (raw.purged) return { record: tombstoneFrom(raw), fixed };

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;

  const task = {
    id: raw.id,
    createdAt: stamp(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: stamp(raw.updatedAt) ?? stamp(raw.createdAt) ?? new Date().toISOString(),
    deletedAt: stamp(raw.deletedAt),
    title: title.slice(0, LIMITS.title),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, LIMITS.notes) : '',
    area: raw.area,
    due: raw.due ?? null,
    priority: raw.priority,
    status: raw.status,
    doneAt: stamp(raw.doneAt),
    repeat: raw.repeat ?? null,
    nextId: typeof raw.nextId === 'string' ? raw.nextId : null,
    links: [],
    ref: raw.ref && typeof raw.ref.id === 'string' && raw.ref.type === 'application' ? { type: 'application', id: raw.ref.id } : null,
    sample: raw.sample === true,
  };
  if (title.length > LIMITS.title) fixed.push('title');
  if (!AREA_IDS.includes(task.area)) { task.area = 'personal'; fixed.push('area'); }
  if (task.due !== null && !isValidISO(task.due)) { task.due = null; fixed.push('due'); }
  if (!PRIORITY_IDS.includes(task.priority)) { task.priority = 'normal'; fixed.push('priority'); }
  if (task.status !== 'todo' && task.status !== 'done') { task.status = 'todo'; fixed.push('status'); }
  if (raw.links !== undefined) {
    const lr = cleanLinks(raw.links);
    task.links = lr.links;
    if (lr.invalid) fixed.push('links');
  }
  if (task.status === 'done' && !task.doneAt) task.doneAt = task.updatedAt;
  if (task.status === 'todo') task.doneAt = null;
  if (task.repeat !== null && (!isValidRule(task.repeat) || !task.due)) { task.repeat = null; fixed.push('repeat'); }
  return { record: task, fixed };
}

export const NORMALIZERS = {
  tasks: normalizeImportedTask,
  applications: normalizeImportedApplication,
  skills: normalizeImportedSkill,
  accounts: normalizeImportedAccount,
  snapshots: normalizeImportedSnapshot,
  transactions: normalizeImportedTransaction,
  savingsGoals: normalizeImportedGoal,
};
