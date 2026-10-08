// Repeating tasks.
//
// A rule looks like one of:
//   { freq: 'daily' }
//   { freq: 'weekdays' }                 Mon–Fri
//   { freq: 'weekly', days: [1, 3] }     0 = Sun … 6 = Sat
//   { freq: 'monthly', day: 15 }         clamped to the month's last day (31 → 30 Nov, 28/29 Feb)
//
// When a repeating task is completed, the next copy is due on the first matching
// date AFTER the completed task's due date that is also not in the past.
// So finishing an overdue daily report doesn't create a pile of missed copies.

import { addDays, weekday, daysInMonth, WEEKDAY_SHORT, isValidISO } from './dates.js';

export const FREQS = ['daily', 'weekdays', 'weekly', 'monthly'];

export function isValidRule(rule) {
  if (!rule || typeof rule !== 'object' || !FREQS.includes(rule.freq)) return false;
  if (rule.freq === 'weekly') {
    return Array.isArray(rule.days) && rule.days.length > 0 &&
      rule.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  }
  if (rule.freq === 'monthly') {
    return Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 31;
  }
  return true;
}

export function matches(rule, iso) {
  const wd = weekday(iso);
  switch (rule.freq) {
    case 'daily': return true;
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekly': return rule.days.includes(wd);
    case 'monthly': {
      const [y, m, d] = iso.split('-').map(Number);
      return d === Math.min(rule.day, daysInMonth(y, m));
    }
    default: return false;
  }
}

// First date strictly after `fromISO` that matches the rule and is >= `todayISO`.
export function nextDue(rule, fromISO, todayISO) {
  if (!isValidRule(rule) || !isValidISO(fromISO)) return null;
  let start = fromISO;
  // Jump close to today first so very old tasks don't loop through years of dates.
  if (todayISO && start < todayISO) start = addDays(todayISO, -1);
  let d = addDays(start, 1);
  // Monthly rules can need up to ~31 steps; weekly up to 7. 400 is a safe ceiling.
  for (let i = 0; i < 400; i++) {
    if (matches(rule, d) && (!todayISO || d >= todayISO)) return d;
    d = addDays(d, 1);
  }
  return null;
}

export function describe(rule) {
  if (!isValidRule(rule)) return '';
  switch (rule.freq) {
    case 'daily': return 'Every day';
    case 'weekdays': return 'Every weekday';
    case 'weekly': {
      const sorted = [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Mon first
      return 'Weekly on ' + sorted.map((d) => WEEKDAY_SHORT[d]).join(', ');
    }
    case 'monthly': return `Monthly on day ${rule.day}`;
  }
  return '';
}

export function shortDescribe(rule) {
  if (!isValidRule(rule)) return '';
  if (rule.freq === 'daily') return 'Daily';
  if (rule.freq === 'weekdays') return 'Weekdays';
  if (rule.freq === 'weekly') return 'Weekly';
  return 'Monthly';
}
