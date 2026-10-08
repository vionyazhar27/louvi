// Pure task logic: sorting, grouping, filtering. No DOM, no storage.

import { addDays, diffDays } from './dates.js';
import { nextDue, isValidRule } from './recurrence.js';

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export const isOpen = (t) => t.status !== 'done';
export const isOverdue = (t, today) => isOpen(t) && !!t.due && t.due < today;

export function compareTasks(a, b) {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  const p = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  if (p) return p;
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

export function compareDone(a, b) {
  return (b.doneAt || '').localeCompare(a.doneAt || '');
}

export const VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'open', label: 'All open' },
  { id: 'done', label: 'Done' },
];

export const UPCOMING_DAYS = 14;

export function inView(task, view, today) {
  switch (view) {
    case 'today': return isOpen(task) && !!task.due && task.due <= today;
    case 'upcoming': return isOpen(task) && !!task.due && task.due > today && task.due <= addDays(today, UPCOMING_DAYS);
    case 'open': return isOpen(task);
    case 'done': return !isOpen(task);
    default: return true;
  }
}

export function matchesSearch(task, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return task.title.toLowerCase().includes(q) || (task.notes || '').toLowerCase().includes(q) ||
    (task.links || []).some((l) => (l.label || '').toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
}

// Groups open tasks under date headings.
export function groupOpen(tasks, today) {
  const order = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate'];
  const labels = {
    overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow',
    week: 'Next 7 days', later: 'Later', nodate: 'No date',
  };
  const buckets = Object.fromEntries(order.map((k) => [k, []]));
  for (const t of [...tasks].sort(compareTasks)) {
    if (!t.due) buckets.nodate.push(t);
    else {
      const n = diffDays(today, t.due);
      if (n < 0) buckets.overdue.push(t);
      else if (n === 0) buckets.today.push(t);
      else if (n === 1) buckets.tomorrow.push(t);
      else if (n <= 7) buckets.week.push(t);
      else buckets.later.push(t);
    }
  }
  return order.filter((k) => buckets[k].length).map((k) => ({ id: k, label: labels[k], tasks: buckets[k] }));
}

// Groups done tasks by the day they were completed (most recent first).
export function groupDone(tasks, today) {
  const groups = new Map();
  for (const t of [...tasks].sort(compareDone)) {
    const day = localDay(t.doneAt);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  return [...groups.entries()].map(([day, list]) => ({ id: day, day, tasks: list }));
}

export function localDay(stamp) {
  if (!stamp) return 'unknown';
  const d = new Date(stamp);
  if (isNaN(d)) return 'unknown';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function countsByArea(tasks, areaIds, today) {
  const out = Object.fromEntries(areaIds.map((a) => [a, { open: 0, overdue: 0 }]));
  for (const t of tasks) {
    if (!isOpen(t) || !out[t.area]) continue;
    out[t.area].open++;
    if (isOverdue(t, today)) out[t.area].overdue++;
  }
  return out;
}

// What should happen when a task is ticked off.
// Returns the data for the next repeat, or null.
export function nextRepeatFor(task, today) {
  if (!task.repeat || !isValidRule(task.repeat) || !task.due) return null;
  const due = nextDue(task.repeat, task.due, today);
  if (!due) return null;
  return {
    title: task.title,
    notes: task.notes || '',
    area: task.area,
    priority: task.priority,
    repeat: structuredClone(task.repeat),
    due,
    status: 'todo',
    doneAt: null,
    nextId: null,
    links: structuredClone(task.links || []),
    ref: task.ref ? { ...task.ref } : null,
    sample: task.sample === true,
  };
}

// Done this week (Mon–Sun) — used on Home.
export function doneSince(tasks, sinceISO) {
  return tasks.filter((t) => !isOpen(t) && t.doneAt && localDay(t.doneAt) >= sinceISO).length;
}
