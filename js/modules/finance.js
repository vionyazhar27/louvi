// Finance page: overview, transactions, accounts & monthly balances, savings goals.

import * as store from '../store.js';
import { esc, plural } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mountLineChart } from '../ui/line-chart.js';
import { todayISO, relativeLabel, formatLong } from '../lib/dates.js';
import { formatRupiah, formatRupiahShort } from '../lib/money.js';
import {
  monthOf, addMonths, monthLabel, monthShort, monthName, latestSnapshot, snapshotFor, snapshotTotals, netWorthSeries,
  monthTotals, yearSummary, goalProgress, accountValue, accountTypeLabel, isGold, isDebt, formatGrams, categoryKind, matchesTxSearch,
} from '../lib/finance.js';
import {
  categories, currentMonth, openAccountForm, openSnapshotForm, openTransactionForm, openCategoryEditor, openGoalForm,
} from './finance-actions.js';

export const title = 'Finance';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'goals', label: 'Goals' },
];

const state = { tab: 'overview', month: null, year: null, query: '' };

export function setFinanceTab(tab) { state.tab = tab; }

const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + formatRupiah(Math.abs(n));
const signedShort = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + (formatRupiahShort(Math.abs(n)) || 'Rp0');

const STATUS_TEXT = {
  'achieved': ['ok', 'Reached'],
  'on-track': ['ok', 'On track'],
  'behind': ['warn', 'Behind pace'],
  'overdue': ['warn', 'Past target date'],
  'no-deadline': ['neutral', 'No deadline'],
  'unknown-pace': ['neutral', 'Need 2+ months of balances'],
  'no-data': ['neutral', 'No balances yet'],
};

export function mount(root) {
  state.month = state.month || currentMonth();
  state.year = state.year || todayISO().slice(0, 4);
  let cleanups = [];

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 class="page-title">Finance</h1>
        <p class="page-sub" data-summary></p>
      </div>
      <div class="btn-row hide-mobile" data-head-actions></div>
    </header>
    <div class="segmented segmented--tabs" role="tablist" aria-label="Finance sections" data-tabs></div>
    <div class="career-body" data-body></div>`;

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === 'tab') { state.tab = el.dataset.value; render(); }
    if (a === 'add-account') openAccountForm();
    if (a === 'edit-account') { const x = store.get('accounts', id); if (x) openAccountForm({ account: x }); }
    if (a === 'balances') openSnapshotForm({ month: el.dataset.month || currentMonth() });
    if (a === 'add-tx') openTransactionForm({ defaults: state.tab === 'transactions' && state.month !== currentMonth() ? { date: `${state.month}-01` } : {} });
    if (a === 'edit-tx') { const x = store.get('transactions', id); if (x) openTransactionForm({ tx: x }); }
    if (a === 'categories') openCategoryEditor();
    if (a === 'add-goal') openGoalForm();
    if (a === 'edit-goal') { const x = store.get('savingsGoals', id); if (x) openGoalForm({ goal: x }); }
    if (a === 'month') { state.month = addMonths(state.month, +el.dataset.step); render(); }
    if (a === 'year') { state.year = String(+state.year + +el.dataset.step); render(); }
    if (a === 'go-tab') { state.tab = el.dataset.value; if (el.dataset.month) state.month = el.dataset.month; render(); }
    if (a === 'clear-search') { state.query = ''; render(); }
  });

  function render() {
    cleanups.forEach((f) => f());
    cleanups = [];
    const accounts = store.all('accounts');
    const snapshots = store.all('snapshots');
    const latest = latestSnapshot(snapshots);
    const totals = latest ? snapshotTotals(latest, accounts) : null;

    root.querySelector('[data-summary]').textContent = latest
      ? `Net worth ${formatRupiah(totals.netWorth)} · balances from ${monthLabel(latest.month)}`
      : 'Accounts, monthly balances, spending and savings goals';

    const actions = {
      overview: `<button type="button" class="btn btn--ghost" data-action="balances">${icon('restore', 18)}Update balances</button><button type="button" class="btn btn--primary" data-action="add-tx">${icon('plus', 18)}Add transaction</button>`,
      transactions: `<button type="button" class="btn btn--primary" data-action="add-tx">${icon('plus', 18)}Add transaction</button>`,
      accounts: `<button type="button" class="btn btn--ghost" data-action="add-account">${icon('plus', 18)}Add account</button><button type="button" class="btn btn--primary" data-action="balances">Update balances</button>`,
      goals: `<button type="button" class="btn btn--primary" data-action="add-goal">${icon('plus', 18)}New goal</button>`,
    };
    root.querySelector('[data-head-actions]').innerHTML = accounts.length || state.tab === 'transactions' ? actions[state.tab] : '';

    root.querySelector('[data-tabs]').innerHTML = TABS.map((t) =>
      `<button type="button" class="seg-btn ${state.tab === t.id ? 'is-active' : ''}" role="tab" aria-selected="${state.tab === t.id}" data-action="tab" data-value="${t.id}">${t.label}</button>`).join('');

    const body = root.querySelector('[data-body]');
    if (!accounts.length && state.tab !== 'transactions') {
      body.innerHTML = setupHTML();
      return;
    }
    if (state.tab === 'overview') renderOverview(body, accounts, snapshots, latest, totals);
    if (state.tab === 'transactions') renderTransactions(body);
    if (state.tab === 'accounts') body.innerHTML = accountsHTML(accounts, snapshots, latest);
    if (state.tab === 'goals') body.innerHTML = goalsHTML(accounts, snapshots);
  }

  function setupHTML() {
    return `
      <div class="welcome card">
        <h2 class="welcome__title">Set up your money map</h2>
        <ol class="steps">
          <li><strong>Add your accounts.</strong> Bank, e-wallet, investments, gold (in grams), and debts like a gold installment.</li>
          <li><strong>Once a month, update balances.</strong> This gives your net worth. It stays correct even if you skip logging spending.</li>
          <li><strong>Log transactions when you can.</strong> Daily, or one total per category at month end. Both work.</li>
          <li><strong>Add savings goals</strong> and link them to the accounts that hold the money.</li>
        </ol>
        <div class="welcome__actions">
          <button type="button" class="btn btn--primary" data-action="add-account">${icon('plus', 18)}Add your first account</button>
        </div>
        <p class="welcome__foot">Numbers stay on your device. louvi never connects to your bank.</p>
      </div>`;
  }

  // ----- overview -----
  function renderOverview(body, accounts, snapshots, latest, totals) {
    const cm = currentMonth();
    const series = netWorthSeries(snapshots, accounts);
    const prev = series.length >= 2 ? series[series.length - 2] : null;
    const change = prev ? totals.netWorth - prev.netWorth : null;
    const cats = categories();
    const txs = store.all('transactions');
    const mt = monthTotals(txs, cm, cats);
    const goals = store.all('savingsGoals');

    const needsUpdate = !latest || latest.month < cm;
    const hero = latest ? `
      <section class="card nw" aria-labelledby="h-nw">
        <div class="nw__top">
          <div>
            <h2 class="nw__label" id="h-nw">Net worth</h2>
            <p class="nw__value">${esc(formatRupiah(totals.netWorth))}</p>
            <p class="nw__sub">${change !== null ? `<span class="${change >= 0 ? 'up' : 'down'}">${esc(signedShort(change))}</span> vs ${esc(monthLabel(prev.month))} · ` : ''}Balances from ${esc(monthLabel(latest.month))}</p>
          </div>
          <dl class="nw__parts">
            <div><dt>Assets</dt><dd>${esc(formatRupiah(totals.assets))}</dd></div>
            <div><dt>Debts</dt><dd>${esc(totals.debts ? '−' + formatRupiah(totals.debts) : 'Rp0')}</dd></div>
          </dl>
        </div>
        ${totals.missingGoldPrice ? `<p class="nw__warn">${icon('alert', 16)}Gold isn't counted: add the gold price for ${esc(monthLabel(latest.month))}.</p>` : ''}
        ${series.length >= 2 ? '<div class="nw__chart" data-chart></div>' : '<p class="muted">Your net worth trend appears after two months of balances.</p>'}
      </section>` : `
      <section class="card">
        <h2 class="card__title">Net worth</h2>
        <p class="muted">Record this month's balances to see your net worth.</p>
        <button type="button" class="btn btn--primary btn--sm" data-action="balances" style="align-self:flex-start">Update balances</button>
      </section>`;

    const banner = latest && needsUpdate ? `
      <div class="banner banner--soft">${icon('calendar', 18)}<p>You haven't recorded balances for ${esc(monthName(cm))} yet.</p>
        <button type="button" class="btn btn--ghost btn--sm" data-action="balances" data-month="${cm}">Update ${esc(monthName(cm))}</button></div>` : '';

    const maxCat = mt.byCategory[0]?.amount || 1;
    const monthCard = `
      <section class="card" aria-labelledby="h-month">
        <header class="card__head">
          <h2 class="card__title" id="h-month">${esc(monthName(cm))} so far</h2>
          <button type="button" class="link-btn" data-action="go-tab" data-value="transactions" data-month="${cm}">Transactions ${icon('arrow', 16)}</button>
        </header>
        ${mt.count ? `
          <dl class="flow">
            <div><dt>Money in</dt><dd>${esc(formatRupiah(mt.income))}</dd></div>
            <div><dt>Spent</dt><dd>${esc(formatRupiah(mt.spending))}</dd></div>
            <div><dt>Saved</dt><dd>${esc(formatRupiah(mt.saving))}</dd></div>
            <div><dt>Left over</dt><dd class="${mt.leftover < 0 ? 'neg' : ''}">${esc(signed(mt.leftover))}</dd></div>
          </dl>
          <ul class="bars" aria-label="Money out by category">
            ${mt.byCategory.slice(0, 6).map((c) => `
              <li class="bar-row">
                <span class="bar-row__label">${esc(c.category)}${c.kind === 'saving' ? ' <span class="tag">saving</span>' : ''}</span>
                <span class="bar-row__track"><span class="bar-row__fill ${c.kind === 'saving' ? 'is-saving' : ''}" style="width:${Math.max(2, (c.amount / maxCat) * 100).toFixed(1)}%"></span></span>
                <span class="bar-row__value">${esc(formatRupiahShort(c.amount))}</span>
              </li>`).join('')}
          </ul>
          <p class="muted">${plural(mt.count, 'transaction')} logged this month. Totals only include what you've logged.</p>` : `
          <p class="muted">Nothing logged for ${esc(monthName(cm))} yet. Log as you go, or add one total per category at the end of the month.</p>
          <button type="button" class="btn btn--ghost btn--sm" data-action="add-tx" style="align-self:flex-start">${icon('plus', 16)}Add transaction</button>`}
      </section>`;

    const goalsCard = goals.length ? `
      <section class="card" aria-labelledby="h-goals">
        <header class="card__head">
          <h2 class="card__title" id="h-goals">Savings goals</h2>
          <button type="button" class="link-btn" data-action="go-tab" data-value="goals">All goals ${icon('arrow', 16)}</button>
        </header>
        <ul class="goal-mini">${goals.map((g) => {
          const p = goalProgress(g, accounts, snapshots, cm);
          return `<li>
            <div class="goal-mini__top"><span class="goal-mini__name">${esc(g.name)}</span><span class="goal-mini__pct">${p.pct}%</span></div>
            <div class="meter" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(g.name)}"><span style="width:${p.pct}%"></span></div>
            <span class="goal-mini__sub">${esc(formatRupiahShort(p.current) || 'Rp0')} of ${esc(formatRupiahShort(p.target))}${g.targetDate ? ` · by ${esc(monthLabel(monthOf(g.targetDate)))}` : ''}</span>
          </li>`;
        }).join('')}</ul>
      </section>` : `
      <section class="card">
        <h2 class="card__title">Savings goals</h2>
        <p class="muted">Add a goal like a wedding or emergency fund and link it to the accounts that hold it.</p>
        <button type="button" class="btn btn--ghost btn--sm" data-action="add-goal" style="align-self:flex-start">${icon('plus', 16)}New goal</button>
      </section>`;

    const y = yearSummary(state.year, txs, snapshots, accounts, cats);
    const yearCard = `
      <section class="card" aria-labelledby="h-year">
        <header class="card__head">
          <h2 class="card__title" id="h-year">Year ${esc(state.year)}</h2>
          <div class="stepper">
            <button type="button" class="icon-btn" data-action="year" data-step="-1" aria-label="Previous year">‹</button>
            <button type="button" class="icon-btn" data-action="year" data-step="1" aria-label="Next year">›</button>
          </div>
        </header>
        <div class="table-wrap">
          <table class="ytable">
            <thead><tr><th scope="col">Month</th><th scope="col">Money in</th><th scope="col">Spent</th><th scope="col">Saved</th><th scope="col">Net worth</th></tr></thead>
            <tbody>${y.rows.map((r) => `
              <tr class="${r.month === cm ? 'is-now' : ''} ${!r.count && r.netWorth === null ? 'is-empty' : ''}">
                <th scope="row">${esc(monthName(r.month).slice(0, 3))}</th>
                <td>${r.count ? esc(formatRupiahShort(r.income) || 'Rp0') : '–'}</td>
                <td>${r.count ? esc(formatRupiahShort(r.spending) || 'Rp0') : '–'}</td>
                <td>${r.count ? esc(formatRupiahShort(r.saving) || 'Rp0') : '–'}</td>
                <td>${r.netWorth !== null ? esc(formatRupiahShort(r.netWorth)) : '–'}</td>
              </tr>`).join('')}</tbody>
            <tfoot><tr><th scope="row">Total</th><td>${esc(formatRupiahShort(y.totals.income) || 'Rp0')}</td><td>${esc(formatRupiahShort(y.totals.spending) || 'Rp0')}</td><td>${esc(formatRupiahShort(y.totals.saving) || 'Rp0')}</td><td></td></tr></tfoot>
          </table>
        </div>
        <p class="muted">Money in/out comes from logged transactions; net worth from monthly balances.</p>
      </section>`;

    body.innerHTML = banner + `
      <div class="fin-grid">
        <div class="fin-grid__main">${hero}${monthCard}</div>
        <div class="fin-grid__side">${goalsCard}${yearCard}</div>
      </div>`;

    const chartEl = body.querySelector('[data-chart]');
    if (chartEl) {
      const pts = series.slice(-24).map((s) => ({ x: monthShort(s.month), title: monthLabel(s.month), value: s.netWorth }));
      cleanups.push(mountLineChart(chartEl, pts, { format: formatRupiah, formatAxis: (v) => formatRupiahShort(v) || 'Rp0', label: 'Net worth by month' }));
    }
  }

  // ----- transactions -----
  function renderTransactions(body) {
    const cats = categories();
    const all = store.all('transactions');
    const mt = monthTotals(all, state.month, cats);
    const today = todayISO();
    const searchFocused = document.activeElement?.id === 'tx-search';
    const caret = searchFocused ? document.activeElement.selectionStart : null;
    const list = all.filter((t) => monthOf(t.date) === state.month && matchesTxSearch(t, state.query))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const byDay = new Map();
    for (const t of list) { if (!byDay.has(t.date)) byDay.set(t.date, []); byDay.get(t.date).push(t); }

    body.innerHTML = `
      <div class="toolbar">
        <div class="month-nav">
          <button type="button" class="icon-btn" data-action="month" data-step="-1" aria-label="Previous month">‹</button>
          <span class="month-nav__label">${esc(monthLabel(state.month))}</span>
          <button type="button" class="icon-btn" data-action="month" data-step="1" aria-label="Next month">›</button>
        </div>
        <div class="btn-row">
          <label class="search">${icon('search', 18)}<span class="sr-only">Search transactions</span>
            <input class="input" type="search" id="tx-search" placeholder="Search category or note" value="${esc(state.query)}"></label>
          <button type="button" class="btn btn--ghost btn--sm" data-action="categories">Categories</button>
        </div>
      </div>
      <dl class="flow flow--strip">
        <div><dt>Money in</dt><dd>${esc(formatRupiah(mt.income))}</dd></div>
        <div><dt>Spent</dt><dd>${esc(formatRupiah(mt.spending))}</dd></div>
        <div><dt>Saved</dt><dd>${esc(formatRupiah(mt.saving))}</dd></div>
        <div><dt>Left over</dt><dd class="${mt.leftover < 0 ? 'neg' : ''}">${esc(signed(mt.leftover))}</dd></div>
      </dl>
      ${list.length ? `<div class="task-groups">${[...byDay.entries()].map(([day, items]) => `
        <div class="group">
          <h2 class="group__label">${esc(relativeLabel(day, today))}${relativeLabel(day, today).length <= 9 && !/\d/.test(relativeLabel(day, today)) ? ` · ${esc(formatLong(day).split(', ')[1])}` : ''}</h2>
          <ul class="tx-list">${items.map((t) => {
            const saving = t.type === 'expense' && categoryKind(t.category, cats) === 'saving';
            return `<li><button type="button" class="tx" data-action="edit-tx" data-id="${esc(t.id)}">
              <span class="tx__main"><span class="tx__cat">${esc(t.category)}${saving ? ' <span class="tag">saving</span>' : ''}</span>${t.note ? `<span class="tx__note">${esc(t.note)}</span>` : ''}</span>
              <span class="tx__amt ${t.type === 'income' ? 'is-in' : ''}">${t.type === 'income' ? '+' : '−'}${esc(formatRupiah(t.amount))}</span>
            </button></li>`;
          }).join('')}</ul>
        </div>`).join('')}</div>` : `
        <div class="empty empty--compact">
          <p class="empty__title">${state.query ? `Nothing matches “${esc(state.query)}”.` : `No transactions in ${esc(monthLabel(state.month))}.`}</p>
          ${state.query ? '<button type="button" class="btn btn--ghost btn--sm" data-action="clear-search">Clear search</button>'
            : `<p class="empty__text">Log each one, or one total per category at the end of the month.</p><button type="button" class="btn btn--primary btn--sm" data-action="add-tx">${icon('plus', 16)}Add transaction</button>`}
        </div>`}`;

    const search = body.querySelector('#tx-search');
    search.addEventListener('input', () => { state.query = search.value; render(); });
    if (searchFocused) { search.focus(); search.setSelectionRange(caret, caret); }
  }

  // ----- accounts -----
  function accountsHTML(accounts, snapshots, latest) {
    const sorted = [...snapshots].sort((a, b) => b.month.localeCompare(a.month));
    const prev = sorted[1] || null;
    const row = (a) => {
      const v = accountValue(a, latest);
      const pv = accountValue(a, prev);
      const raw = latest?.balances?.[a.id];
      const delta = v !== null && pv !== null ? v - pv : null;
      return `<li><button type="button" class="acct" data-action="edit-account" data-id="${esc(a.id)}">
        <span class="acct__main"><span class="acct__name">${esc(a.name)}</span><span class="acct__type">${esc(accountTypeLabel(a.type))}${isGold(a) && raw !== undefined ? ` · ${esc(formatGrams(raw))}` : ''}</span></span>
        <span class="acct__val">${v !== null ? esc(isDebt(a) ? '−' + formatRupiah(-v) : formatRupiah(v)) : raw !== undefined && isGold(a) ? 'Needs gold price' : '<span class="muted">No balance yet</span>'}
          ${delta ? `<span class="acct__delta ${delta > 0 ? 'up' : 'down'}">${esc(signedShort(delta))}</span>` : ''}</span>
      </button></li>`;
    };
    const active = accounts.filter((a) => !a.archived);
    const assets = active.filter((a) => !isDebt(a));
    const debts = active.filter(isDebt);
    const archived = accounts.filter((a) => a.archived);
    return `
      ${!latest || latest.month < currentMonth() ? `<div class="banner banner--soft">${icon('calendar', 18)}<p>${latest ? `Last balances: ${esc(monthLabel(latest.month))}.` : 'No balances yet.'} Update once a month, e.g. right after payday.</p>
        <button type="button" class="btn btn--primary btn--sm" data-action="balances">Update balances</button></div>` : ''}
      <div class="group"><h2 class="group__label">Assets <span class="group__count">${assets.length}</span></h2>
        ${assets.length ? `<ul class="acct-list">${assets.map(row).join('')}</ul>` : '<p class="muted">No asset accounts.</p>'}</div>
      ${debts.length ? `<div class="group"><h2 class="group__label">Debts <span class="group__count">${debts.length}</span></h2><ul class="acct-list">${debts.map(row).join('')}</ul></div>` : ''}
      ${archived.length ? `<details class="group archived"><summary class="group__label">Archived <span class="group__count">${archived.length}</span></summary><ul class="acct-list">${archived.map(row).join('')}</ul></details>` : ''}
      <div class="group">
        <h2 class="group__label">Balance history</h2>
        ${sorted.length ? `<ul class="acct-list">${sorted.map((s) => {
          const t = snapshotTotals(s, accounts);
          return `<li><button type="button" class="acct" data-action="balances" data-month="${s.month}">
            <span class="acct__main"><span class="acct__name">${esc(monthLabel(s.month))}</span><span class="acct__type">${plural(Object.keys(s.balances || {}).length, 'account')}${s.note ? ` · ${esc(s.note)}` : ''}</span></span>
            <span class="acct__val">${esc(formatRupiah(t.netWorth))}</span>
          </button></li>`;
        }).join('')}</ul>` : '<p class="muted">Nothing recorded yet.</p>'}
      </div>
      <button type="button" class="btn btn--ghost btn--sm hide-desktop" data-action="add-account" style="align-self:flex-start">${icon('plus', 16)}Add account</button>`;
  }

  // ----- goals -----
  function goalsHTML(accounts, snapshots) {
    const goals = store.all('savingsGoals');
    const cm = currentMonth();
    if (!goals.length) {
      return `<div class="empty empty--compact">
        <p class="empty__title">No savings goals yet</p>
        <p class="empty__text">Add one, like a wedding fund or an emergency fund, and link the accounts where you keep that money.</p>
        <button type="button" class="btn btn--primary btn--sm" data-action="add-goal">${icon('plus', 16)}New goal</button></div>`;
    }
    return `<div class="goal-grid">${goals.map((g) => {
      const p = goalProgress(g, accounts, snapshots, cm);
      const [tone, label] = STATUS_TEXT[p.status];
      const linked = g.accountIds.map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean);
      return `
        <article class="card goal">
          <header class="card__head">
            <h2 class="card__title">${esc(g.name)}</h2>
            <button type="button" class="link-btn" data-action="edit-goal" data-id="${esc(g.id)}">Edit</button>
          </header>
          <div class="goal__nums"><span class="goal__current">${esc(formatRupiah(p.current))}</span><span class="goal__target">of ${esc(formatRupiah(p.target))}</span></div>
          <div class="meter meter--lg" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(g.name)} progress"><span style="width:${p.pct}%"></span></div>
          <p class="goal__status"><span class="status status--${tone}">${esc(label)}</span><span>${p.pct}%${g.targetDate ? ` · by ${esc(monthLabel(monthOf(g.targetDate)))}` : ''}</span></p>
          <dl class="calc">
            <div><dt>Kept in</dt><dd>${esc(linked.join(', ') || '—')}</dd></div>
            ${p.neededPerMonth ? `<div><dt>Needed per month</dt><dd>${esc(formatRupiah(p.neededPerMonth))}<span class="calc__how">(${esc(formatRupiahShort(p.remaining))} left ÷ ${plural(Math.max(1, p.monthsLeft), 'month')})</span></dd></div>` : ''}
            ${p.recentAvg !== null ? `<div><dt>Recent pace</dt><dd>${esc(signedShort(p.recentAvg))} / month<span class="calc__how">(average change of these accounts, last ${Math.min(3, snapshots.length - 1)} months)</span></dd></div>` : ''}
            ${p.etaMonth && p.status !== 'achieved' ? `<div><dt>At this pace</dt><dd>around ${esc(monthLabel(p.etaMonth))}</dd></div>` : ''}
          </dl>
          <p class="goal__fine">Plain rupiah math from your recorded balances. It doesn't include investment returns, gold price changes or inflation, and isn't a forecast. Try scenarios in Life Simulator.</p>
        </article>`;
    }).join('')}</div>`;
  }

  render();
  return {
    refresh: render,
    newTask: () => {
      if (state.tab === 'goals') return openGoalForm();
      if (state.tab === 'accounts') return openSnapshotForm();
      return openTransactionForm();
    },
  };
}
