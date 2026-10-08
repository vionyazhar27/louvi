// Finance: accounts, monthly balance snapshots, transactions and savings goals.
// Pure logic (no DOM, no storage).
//
// How the numbers fit together:
//   - Net worth comes ONLY from balance snapshots (one per month). It's accurate even if
//     you skip logging transactions.
//   - Transactions explain where money went (income vs spending vs saving) in a month.
//   - Savings goals are linked to accounts, so their progress follows those balances.

import { isValidISO } from './dates.js';
import { parseRupiah, MAX_RUPIAH } from './money.js';
import { tombstoneFrom } from './career.js';

// ---------- constants ----------

export const ACCOUNT_TYPES = [
  { id: 'bank', label: 'Bank account', group: 'asset' },
  { id: 'ewallet', label: 'E-wallet', group: 'asset' },
  { id: 'cash', label: 'Cash', group: 'asset' },
  { id: 'investment', label: 'Investment', group: 'asset', hint: 'Mutual funds, stocks, bonds/SBN, deposits. Enter the current market value.' },
  { id: 'gold', label: 'Gold', group: 'asset', hint: 'Physical or digital. Enter grams; louvi uses the gold price you enter each month.' },
  { id: 'debt', label: 'Debt / installment', group: 'debt', hint: 'Gold installment, credit card, loans. Enter what you still owe.' },
];
export const ACCOUNT_TYPE_IDS = ACCOUNT_TYPES.map((t) => t.id);
export const accountTypeLabel = (id) => ACCOUNT_TYPES.find((t) => t.id === id)?.label ?? id;
export const isDebt = (account) => account.type === 'debt';
export const isGold = (account) => account.type === 'gold';

// Default categories. `kind: 'saving'` = money moved into savings/investments or paying
// down debt. It leaves your wallet, but it isn't spending.
export const DEFAULT_CATEGORIES = {
  income: ['Salary', 'THR & bonus', 'Side income', 'Gifts received', 'Other income'],
  expense: [
    { name: 'Food & drinks', kind: 'spend' },
    { name: 'Transport', kind: 'spend' },
    { name: 'Rent & housing', kind: 'spend' },
    { name: 'Bills & utilities', kind: 'spend' },
    { name: 'Phone & internet', kind: 'spend' },
    { name: 'Shopping', kind: 'spend' },
    { name: 'Health', kind: 'spend' },
    { name: 'Education', kind: 'spend' },
    { name: 'Fun & hobbies', kind: 'spend' },
    { name: 'Family & gifts', kind: 'spend' },
    { name: 'Charity & zakat', kind: 'spend' },
    { name: 'Personal care', kind: 'spend' },
    { name: 'Other spending', kind: 'spend' },
    { name: 'Gold installment', kind: 'saving' },
    { name: 'Investment top-up', kind: 'saving' },
    { name: 'Savings transfer', kind: 'saving' },
  ],
};

export const FIN_LIMITS = { name: 60, note: 300, notes: 1000, category: 40, grams: 100000, gramsDecimals: 4 };

// ---------- months ----------

export const monthOf = (iso) => iso.slice(0, 7);
export const isValidMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m) => `${MONTHS_LONG[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m) => `${MONTHS_SHORT[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
export const monthName = (m) => MONTHS_LONG[+m.slice(5) - 1];

// ---------- grams ----------

export function parseGrams(input) {
  const s = String(input ?? '').trim().replace(/\s*(g|gr|gram)$/i, '').replace(',', '.');
  if (!s) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
  const v = Math.round(parseFloat(s) * 10000) / 10000;
  if (v > FIN_LIMITS.grams) return { ok: false };
  return { ok: true, value: v };
}

export const formatGrams = (g) => (g === null || g === undefined ? '' : `${String(Math.round(g * 10000) / 10000).replace('.', ',')} g`);

// ---------- balances & net worth ----------

export function latestSnapshot(snapshots) {
  let best = null;
  for (const s of snapshots) if (!best || s.month > best.month) best = s;
  return best;
}

export function snapshotFor(snapshots, month) {
  return snapshots.find((s) => s.month === month) || null;
}

// Value in rupiah of one account in a snapshot. Debts are negative. Null if unknown.
export function accountValue(account, snapshot) {
  if (!snapshot) return null;
  const raw = snapshot.balances?.[account.id];
  if (raw === undefined || raw === null) return null;
  if (isGold(account)) {
    if (!Number.isFinite(snapshot.goldPrice)) return null;
    return Math.round(raw * snapshot.goldPrice);
  }
  return isDebt(account) ? -raw : raw;
}

export function snapshotTotals(snapshot, accounts) {
  let assets = 0, debts = 0, missingGoldPrice = false, counted = 0;
  if (!snapshot) return { assets: 0, debts: 0, netWorth: 0, missingGoldPrice: false, counted: 0 };
  for (const a of accounts) {
    const raw = snapshot.balances?.[a.id];
    if (raw === undefined || raw === null) continue;
    if (isGold(a) && !Number.isFinite(snapshot.goldPrice)) { missingGoldPrice = true; continue; }
    const v = accountValue(a, snapshot);
    counted++;
    if (v < 0) debts += -v;
    else assets += v;
  }
  return { assets, debts, netWorth: assets - debts, missingGoldPrice, counted };
}

export function netWorthSeries(snapshots, accounts) {
  return [...snapshots]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((s) => ({ month: s.month, ...snapshotTotals(s, accounts) }));
}

// ---------- transactions ----------

export function categoryKind(name, categories) {
  return categories.expense.find((c) => c.name === name)?.kind ?? 'spend';
}

export function monthTotals(transactions, month, categories) {
  let income = 0, spending = 0, saving = 0, count = 0;
  const byCat = new Map();
  for (const t of transactions) {
    if (monthOf(t.date) !== month) continue;
    count++;
    if (t.type === 'income') { income += t.amount; continue; }
    const kind = categoryKind(t.category, categories);
    if (kind === 'saving') saving += t.amount;
    else spending += t.amount;
    byCat.set(t.category, (byCat.get(t.category) || 0) + t.amount);
  }
  const byCategory = [...byCat.entries()]
    .map(([category, amount]) => ({ category, amount, kind: categoryKind(category, categories) }))
    .sort((a, b) => b.amount - a.amount);
  return { income, spending, saving, leftover: income - spending - saving, count, byCategory };
}

// One row per month of a year: cash flow from transactions, net worth from snapshots.
export function yearSummary(year, transactions, snapshots, accounts, categories) {
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    const t = monthTotals(transactions, month, categories);
    const snap = snapshotFor(snapshots, month);
    rows.push({ month, ...t, netWorth: snap ? snapshotTotals(snap, accounts).netWorth : null });
  }
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  return {
    rows,
    totals: { income: sum('income'), spending: sum('spending'), saving: sum('saving'), leftover: sum('leftover'), count: sum('count') },
  };
}

export function matchesTxSearch(tx, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return (tx.category || '').toLowerCase().includes(q) || (tx.note || '').toLowerCase().includes(q) ||
    (digits.length >= 3 && String(tx.amount).includes(digits));
}

// ---------- savings goals ----------

// Rupiah value of a set of accounts in a snapshot. Null if none of them has a balance.
export function accountsValue(accountIds, accounts, snapshot) {
  if (!snapshot) return null;
  let total = 0, any = false;
  for (const id of accountIds) {
    const a = accounts.find((x) => x.id === id);
    if (!a) continue;
    const v = accountValue(a, snapshot);
    if (v === null) continue;
    any = true;
    total += v;
  }
  return any ? total : null;
}

// Progress of a savings goal. All figures are nominal rupiah: no returns, no inflation.
export function goalProgress(goal, accounts, snapshots, currentMonth) {
  const sorted = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));
  const last = sorted[sorted.length - 1] || null;
  const current = accountsValue(goal.accountIds || [], accounts, last) ?? 0;
  const target = goal.target;
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  // Average monthly change of the linked accounts over the last (up to) 3 months of snapshots.
  const history = sorted
    .map((s) => ({ month: s.month, value: accountsValue(goal.accountIds || [], accounts, s) }))
    .filter((h) => h.value !== null);
  let recentAvg = null;
  if (history.length >= 2) {
    const end = history[history.length - 1];
    const start = history[Math.max(0, history.length - 4)];
    const span = monthsBetween(start.month, end.month);
    if (span > 0) recentAvg = Math.round((end.value - start.value) / span);
  }

  const targetMonth = goal.targetDate ? monthOf(goal.targetDate) : null;
  const monthsLeft = targetMonth ? monthsBetween(currentMonth, targetMonth) : null;
  const neededPerMonth = targetMonth && remaining > 0 ? Math.ceil(remaining / Math.max(1, monthsLeft)) : null;

  let status;
  if (current >= target && target > 0) status = 'achieved';
  else if (!history.length) status = 'no-data';
  else if (!targetMonth) status = 'no-deadline';
  else if (monthsLeft <= 0) status = 'overdue';
  else if (recentAvg === null) status = 'unknown-pace';
  else status = recentAvg >= neededPerMonth ? 'on-track' : 'behind';

  // At the recent pace, when would the goal be reached? (Only if the pace is positive.)
  let etaMonth = null;
  if (remaining > 0 && recentAvg > 0 && last) etaMonth = addMonths(last.month, Math.ceil(remaining / recentAvg));

  return { current, target, remaining, pct, recentAvg, monthsLeft, neededPerMonth, status, etaMonth, asOf: last?.month ?? null };
}

// ---------- validation ----------

export function validateAccountInput(input, existing = [], selfId = null) {
  const errors = {};
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Give the account a name.';
  else if (name.length > FIN_LIMITS.name) errors.name = `Keep it under ${FIN_LIMITS.name} characters.`;
  else if (existing.some((a) => a.id !== selfId && a.name.toLowerCase() === name.toLowerCase())) errors.name = 'You already have an account with this name.';
  if (!ACCOUNT_TYPE_IDS.includes(input.type)) errors.type = 'Pick a type.';
  const notes = String(input.notes ?? '').trim().slice(0, FIN_LIMITS.notes);
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, type: input.type, notes, archived: !!input.archived } : null };
}

// balancesText: { [accountId]: "what the user typed" }. Empty = not recorded this month.
export function validateSnapshotInput({ month, balancesText, goldPriceText, note }, accounts) {
  const errors = {};
  if (!isValidMonth(month)) errors.month = 'Pick a month.';
  const balances = {};
  let hasGold = false;
  for (const a of accounts) {
    const txt = balancesText[a.id];
    if (txt === undefined || String(txt).trim() === '') continue;
    if (isGold(a)) {
      const g = parseGrams(txt);
      if (!g.ok) errors['bal-' + a.id] = 'Use grams, e.g. 10 or 2,5.';
      else if (g.value !== null) { balances[a.id] = g.value; hasGold = true; }
    } else {
      const r = parseRupiah(txt);
      if (!r.ok) errors['bal-' + a.id] = 'Use an amount, e.g. 2.500.000 or 2,5jt.';
      else if (r.value !== null) balances[a.id] = r.value;
    }
  }
  let goldPrice = null;
  const gp = parseRupiah(goldPriceText);
  if (!gp.ok) errors.goldPrice = 'Use an amount per gram, e.g. 1.450.000.';
  else goldPrice = gp.value;
  if (hasGold && goldPrice === null && !errors.goldPrice) errors.goldPrice = 'Add the gold price per gram so gold can be counted.';
  if (!Object.keys(balances).length && !Object.keys(errors).length) errors.form = 'Enter at least one balance.';
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { month, balances, goldPrice, note: String(note ?? '').trim().slice(0, FIN_LIMITS.note) } : null };
}

export function validateTransactionInput(input, categories) {
  const errors = {};
  if (input.type !== 'income' && input.type !== 'expense') errors.type = 'Pick income or expense.';
  if (!input.date || !isValidISO(input.date)) errors.date = 'Pick a date.';
  const amt = parseRupiah(input.amount);
  if (!amt.ok || amt.value === null || amt.value <= 0) errors.amount = 'Enter an amount, e.g. 45000 or 45rb.';
  const names = input.type === 'income' ? categories.income : categories.expense.map((c) => c.name);
  if (!names.includes(input.category)) errors.category = 'Pick a category.';
  const note = String(input.note ?? '').trim();
  if (note.length > FIN_LIMITS.note) errors.note = `Keep the note under ${FIN_LIMITS.note} characters.`;
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { type: input.type, date: input.date, amount: amt.value, category: input.category, note } : null };
}

export function validateGoalInput(input, accounts) {
  const errors = {};
  const name = String(input.name ?? '').trim();
  if (!name) errors.name = 'Name the goal.';
  else if (name.length > FIN_LIMITS.name) errors.name = `Keep it under ${FIN_LIMITS.name} characters.`;
  const t = parseRupiah(input.target);
  if (!t.ok || t.value === null || t.value <= 0) errors.target = 'Enter the target amount, e.g. 150jt.';
  const targetDate = input.targetDate || null;
  if (targetDate && !isValidISO(targetDate)) errors.targetDate = 'Pick a valid date.';
  const accountIds = (input.accountIds || []).filter((id) => accounts.some((a) => a.id === id && !isDebt(a)));
  if (!accountIds.length) errors.accountIds = 'Link at least one account where this money is kept.';
  const notes = String(input.notes ?? '').trim().slice(0, FIN_LIMITS.notes);
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, target: t.value, targetDate, accountIds, notes } : null };
}

// ---------- import normalizers ----------

const stamp = (v) => (typeof v === 'string' && !isNaN(new Date(v)) ? v : null);
function base(raw) {
  return {
    id: raw.id,
    createdAt: stamp(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: stamp(raw.updatedAt) ?? stamp(raw.createdAt) ?? new Date().toISOString(),
    deletedAt: stamp(raw.deletedAt),
  };
}
const okId = (raw) => raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id;
const money = (v) => (Number.isFinite(v) && v >= 0 && v <= MAX_RUPIAH ? Math.round(v) : null);

export function normalizeImportedAccount(raw) {
  if (!okId(raw)) return null;
  if (raw.purged) return { record: tombstoneFrom(raw), fixed: [] };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const fixed = [];
  const rec = { ...base(raw), name: name.slice(0, FIN_LIMITS.name), type: raw.type, notes: typeof raw.notes === 'string' ? raw.notes.slice(0, FIN_LIMITS.notes) : '', archived: raw.archived === true };
  if (!ACCOUNT_TYPE_IDS.includes(rec.type)) { rec.type = 'bank'; fixed.push('type'); }
  return { record: rec, fixed };
}

export function normalizeImportedSnapshot(raw) {
  if (!okId(raw)) return null;
  if (raw.purged) return { record: tombstoneFrom(raw), fixed: [] };
  if (!isValidMonth(raw.month)) return null;
  const fixed = [];
  const balances = {};
  if (raw.balances && typeof raw.balances === 'object') {
    for (const [k, v] of Object.entries(raw.balances)) {
      if (Number.isFinite(v) && v >= 0 && v <= MAX_RUPIAH) balances[k] = v;
      else fixed.push('balance');
    }
  }
  const rec = {
    ...base(raw), month: raw.month, balances,
    goldPrice: raw.goldPrice == null ? null : money(raw.goldPrice),
    note: typeof raw.note === 'string' ? raw.note.slice(0, FIN_LIMITS.note) : '',
  };
  if (raw.goldPrice != null && rec.goldPrice === null) fixed.push('goldPrice');
  return { record: rec, fixed: [...new Set(fixed)] };
}

export function normalizeImportedTransaction(raw) {
  if (!okId(raw)) return null;
  if (raw.purged) return { record: tombstoneFrom(raw), fixed: [] };
  const amount = money(raw.amount);
  if (!amount || !isValidISO(raw.date) || (raw.type !== 'income' && raw.type !== 'expense')) return null;
  const category = typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim().slice(0, FIN_LIMITS.category) : null;
  const fixed = category ? [] : ['category'];
  return {
    record: {
      ...base(raw), type: raw.type, date: raw.date, amount,
      category: category ?? (raw.type === 'income' ? 'Other income' : 'Other spending'),
      note: typeof raw.note === 'string' ? raw.note.slice(0, FIN_LIMITS.note) : '',
    },
    fixed,
  };
}

export function normalizeImportedGoal(raw) {
  if (!okId(raw)) return null;
  if (raw.purged) return { record: tombstoneFrom(raw), fixed: [] };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const target = money(raw.target);
  if (!name || !target) return null;
  const fixed = [];
  const rec = {
    ...base(raw), name: name.slice(0, FIN_LIMITS.name), target,
    targetDate: raw.targetDate ?? null,
    accountIds: Array.isArray(raw.accountIds) ? raw.accountIds.filter((x) => typeof x === 'string') : [],
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, FIN_LIMITS.notes) : '',
  };
  if (rec.targetDate !== null && !isValidISO(rec.targetDate)) { rec.targetDate = null; fixed.push('targetDate'); }
  return { record: rec, fixed };
}

// Categories live in settings. Keeps defaults when a backup has none or invalid ones.
export function sanitizeCategories(raw) {
  const out = structuredClone(DEFAULT_CATEGORIES);
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.income)) {
    const inc = [...new Set(raw.income.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, FIN_LIMITS.category)))];
    if (inc.length) out.income = inc;
  }
  if (Array.isArray(raw.expense)) {
    const seen = new Set();
    const exp = [];
    for (const c of raw.expense) {
      const name = typeof c?.name === 'string' ? c.name.trim().slice(0, FIN_LIMITS.category) : '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      exp.push({ name, kind: c.kind === 'saving' ? 'saving' : 'spend' });
    }
    if (exp.length) out.expense = exp;
  }
  return out;
}
