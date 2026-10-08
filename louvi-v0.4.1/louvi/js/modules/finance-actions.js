// Finance forms and actions: accounts, monthly balances, transactions, goals, categories.

import * as store from '../store.js';
import { esc, plural } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { todayISO } from '../lib/dates.js';
import { formatRupiah, formatRupiahShort, parseRupiah } from '../lib/money.js';
import {
  ACCOUNT_TYPES, accountTypeLabel, isGold, isDebt, FIN_LIMITS, monthOf, addMonths, monthLabel,
  latestSnapshot, snapshotFor, snapshotTotals, formatGrams, parseGrams,
  validateAccountInput, validateSnapshotInput, validateTransactionInput, validateGoalInput,
} from '../lib/finance.js';

export const categories = () => store.settings().financeCategories;
export const currentMonth = () => monthOf(todayISO());

function fieldErrors(el, errors, form) {
  el.querySelectorAll('[data-error]').forEach((e) => { e.hidden = true; e.textContent = ''; });
  el.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  for (const [field, msg] of Object.entries(errors)) {
    const errEl = el.querySelector(`[data-error="${field}"]`);
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
    const input = form?.querySelector(`[name="${field}"]`);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  (el.querySelector('[aria-invalid="true"]') || el.querySelector('[data-error]:not([hidden])'))?.focus?.();
}

const err = (name) => `<span class="field__error" data-error="${name}" hidden></span>`;

// ---------- accounts ----------

export function openAccountForm({ account = null } = {}) {
  const v = account || { name: '', type: 'bank', notes: '', archived: false };
  const body = `
    <form class="form" id="acct-form" novalidate>
      <label class="field">
        <span class="field__label">Name</span>
        <input class="input" name="name" maxlength="${FIN_LIMITS.name}" value="${esc(v.name)}" placeholder="e.g. BCA payroll, Reksadana Bibit, Emas Pegadaian" autocomplete="off" autofocus>
        ${err('name')}
      </label>
      <fieldset class="field">
        <legend class="field__label">Type</legend>
        <div class="type-grid">
          ${ACCOUNT_TYPES.map((t) => `
            <label class="type-opt">
              <input type="radio" name="type" value="${t.id}" ${t.id === v.type ? 'checked' : ''} ${account ? 'disabled' : ''}>
              <span class="type-opt__box"><span class="type-opt__name">${esc(t.label)}</span>${t.hint ? `<span class="type-opt__hint">${esc(t.hint)}</span>` : ''}</span>
            </label>`).join('')}
        </div>
        ${account ? '<span class="field__hint">The type can\'t change after balances are recorded. Add a new account instead.</span>' : ''}
        ${err('type')}
      </fieldset>
      <label class="field">
        <span class="field__label">Notes <span class="field__optional">optional</span></span>
        <textarea class="input" name="notes" rows="2" maxlength="${FIN_LIMITS.notes}" placeholder="What it's for, account number hint, contract end date…">${esc(v.notes || '')}</textarea>
      </label>
      ${account ? `<label class="check-row"><input type="checkbox" name="archived" ${v.archived ? 'checked' : ''}><span>Archived: hide it from new monthly balances (old months keep its history)</span></label>` : ''}
    </form>`;
  openDialog({
    title: account ? 'Edit account' : 'Add account',
    body, backdropClose: false,
    footer: `
      ${account ? `<button type="button" class="btn btn--ghost btn--danger-text" data-remove>${icon('trash', 16)}Delete</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
      <button type="submit" form="acct-form" class="btn btn--primary">${account ? 'Save' : 'Add account'}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#acct-form');
      el.querySelector('[data-remove]')?.addEventListener('click', async () => {
        const used = store.all('snapshots').filter((s) => s.balances?.[account.id] !== undefined).length;
        const goals = store.all('savingsGoals').filter((g) => g.accountIds.includes(account.id));
        const ok = await confirmDialog({
          title: 'Delete this account?',
          message: `${used ? `It has balances in ${plural(used, 'month')}; those months will no longer count it, so past net worth changes. ` : ''}${goals.length ? `It's linked to ${plural(goals.length, 'savings goal')}. ` : ''}${used ? 'If you just stopped using it, <strong>archive</strong> it instead.' : 'You can restore it from Trash for 30 days.'}`,
          confirmLabel: 'Move to Trash', danger: true,
        });
        if (!ok) return;
        store.trash('accounts', account.id);
        close();
        toast('Account moved to Trash.', { action: { label: 'Undo', onClick: () => store.restore('accounts', account.id) } });
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const res = validateAccountInput({ name: fd.get('name'), type: account ? account.type : fd.get('type'), notes: fd.get('notes'), archived: fd.get('archived') === 'on' }, store.all('accounts'), account?.id ?? null);
        if (!res.ok) { fieldErrors(el, res.errors, form); return; }
        if (account) store.update('accounts', account.id, res.value);
        else store.add('accounts', res.value);
        close();
        toast(account ? 'Account updated.' : 'Account added. Record its balance with “Update balances”.');
      });
    },
  });
}

// ---------- monthly balances ----------

export function openSnapshotForm({ month = currentMonth() } = {}) {
  const accounts = store.all('accounts');
  if (!accounts.length) { toast('Add an account first.'); return; }
  const snapshots = store.all('snapshots');
  const today = currentMonth();
  const months = [];
  for (let i = 1; i >= -23; i--) months.push(addMonths(today, i));
  if (!months.includes(month)) months.push(month);

  openDialog({
    title: 'Monthly balances',
    size: 'lg', backdropClose: false, body: '<div data-snap></div>',
    footer: `
      <button type="button" class="btn btn--ghost btn--danger-text" data-delete-snap hidden>${icon('trash', 16)}Delete this month</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
      <button type="submit" form="snap-form" class="btn btn--primary">Save balances</button>`,
    onMount(el, close) {
      const host = el.querySelector('[data-snap]');
      const delBtn = el.querySelector('[data-delete-snap]');
      let cur = month;

      const render = () => {
        const existing = snapshotFor(snapshots, cur);
        const prev = latestSnapshot(snapshots.filter((s) => s.month < cur));
        const source = existing || prev;
        const visible = accounts.filter((a) => !a.archived || existing?.balances?.[a.id] !== undefined);
        const hasGold = visible.some(isGold);
        const valOf = (a) => {
          const raw = source?.balances?.[a.id];
          if (raw === undefined) return '';
          return isGold(a) ? String(raw).replace('.', ',') : String(raw);
        };
        delBtn.hidden = !existing;
        host.innerHTML = `
          <form class="form" id="snap-form" novalidate>
            <div class="snap-head">
              <label class="field">
                <span class="field__label">Month</span>
                <select class="input" name="month">${months.sort().reverse().map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${esc(monthLabel(m))}${snapshotFor(snapshots, m) ? ' ✓' : ''}</option>`).join('')}</select>
              </label>
              <p class="snap-note">${existing ? `Editing the balances you saved for ${esc(monthLabel(cur))}.`
                : prev ? `Prefilled from ${esc(monthLabel(prev.month))}. Update what changed; leave an account empty if you don't know it.`
                : 'Enter what each account holds right now. Leave one empty if you don\'t know it yet.'}</p>
            </div>
            ${err('form')}
            <div class="snap-list">
              ${visible.map((a) => {
                const prevRaw = prev?.balances?.[a.id];
                return `
                <label class="snap-row">
                  <span class="snap-row__name">${esc(a.name)}<span class="snap-row__type">${esc(accountTypeLabel(a.type))}${a.archived ? ' · archived' : ''}</span></span>
                  <span class="snap-row__input">
                    <input class="input" name="bal-${esc(a.id)}" data-acct="${esc(a.id)}" inputmode="decimal" autocomplete="off"
                      value="${esc(valOf(a))}" placeholder="${isGold(a) ? 'grams, e.g. 5' : isDebt(a) ? 'still owed' : 'e.g. 2.500.000'}">
                    <span class="snap-row__unit">${isGold(a) ? 'g' : 'Rp'}</span>
                  </span>
                  <span class="snap-row__hint" data-hint="${esc(a.id)}">${prev && prevRaw !== undefined && existing ? `${esc(monthLabel(prev.month).split(' ')[0])}: ${esc(isGold(a) ? formatGrams(prevRaw) : formatRupiah(prevRaw))}` : ''}</span>
                  ${err('bal-' + a.id)}
                </label>`;
              }).join('')}
            </div>
            ${hasGold ? `
              <label class="field snap-gold">
                <span class="field__label">Gold price per gram</span>
                <input class="input" name="goldPrice" inputmode="decimal" autocomplete="off" value="${esc(source?.goldPrice ?? '')}" placeholder="e.g. 1.450.000">
                <span class="field__hint">Use the same kind of price every month, e.g. the buy-back price from your gold provider.</span>
                ${err('goldPrice')}
              </label>` : ''}
            <label class="field">
              <span class="field__label">Note <span class="field__optional">optional</span></span>
              <input class="input" name="note" maxlength="${FIN_LIMITS.note}" value="${esc(existing?.note || '')}" placeholder="e.g. THR received, paid annual insurance">
            </label>
            <div class="snap-total" data-total></div>
          </form>`;
        const form = host.querySelector('#snap-form');
        form.elements.month.addEventListener('change', () => { cur = form.elements.month.value; render(); });
        form.addEventListener('input', () => updateTotal(form, visible));
        updateTotal(form, visible);
        form.addEventListener('submit', (ev) => {
          ev.preventDefault();
          const balancesText = {};
          for (const a of visible) balancesText[a.id] = form.querySelector(`[data-acct="${a.id}"]`).value;
          const res = validateSnapshotInput({ month: cur, balancesText, goldPriceText: form.elements.goldPrice?.value ?? '', note: form.elements.note.value }, visible);
          if (!res.ok) { fieldErrors(el, res.errors, form); return; }
          const same = snapshotFor(store.all('snapshots'), cur);
          if (same) {
            // Keep balances of accounts not shown in the form (e.g. archived later).
            const kept = Object.fromEntries(Object.entries(same.balances || {}).filter(([id]) => !visible.some((a) => a.id === id)));
            store.update('snapshots', same.id, { ...res.value, balances: { ...kept, ...res.value.balances } });
          } else {
            store.add('snapshots', res.value);
          }
          close();
          toast(`Balances for ${monthLabel(cur)} saved.`);
        });
        form.elements.month.focus();
      };

      const updateTotal = (form, visible) => {
        const balances = {};
        for (const a of visible) {
          const v = form.querySelector(`[data-acct="${a.id}"]`).value;
          const r = isGold(a) ? parseGrams(v) : parseRupiah(v);
          if (r.ok && r.value !== null) balances[a.id] = r.value;
        }
        const gp = parseRupiah(form.elements.goldPrice?.value ?? '');
        const t = snapshotTotals({ balances, goldPrice: gp.ok ? gp.value : null }, visible);
        form.querySelector('[data-total]').innerHTML = `
          <span>Net worth this month</span><strong>${esc(formatRupiah(t.netWorth))}</strong>
          <span class="snap-total__parts">Assets ${esc(formatRupiahShort(t.assets) || 'Rp0')} − debts ${esc(formatRupiahShort(t.debts) || 'Rp0')}${t.missingGoldPrice ? ' · gold not counted until you add its price' : ''}</span>`;
      };

      delBtn.addEventListener('click', async () => {
        const s = snapshotFor(store.all('snapshots'), cur);
        if (!s) return;
        const ok = await confirmDialog({ title: `Delete ${esc(monthLabel(cur))} balances?`, message: 'This month will drop out of your net worth history. You can restore it from Trash for 30 days.', confirmLabel: 'Move to Trash', danger: true });
        if (!ok) return;
        store.trash('snapshots', s.id);
        close();
        toast('Monthly balances moved to Trash.', { action: { label: 'Undo', onClick: () => store.restore('snapshots', s.id) } });
      });

      render();
    },
  });
}

// ---------- transactions ----------

export function openTransactionForm({ tx = null, defaults = {} } = {}) {
  const v = tx || { type: 'expense', amount: '', category: '', date: todayISO(), note: '', ...defaults };
  // Most-used categories first, so common ones are one tap away.
  const usage = new Map();
  for (const t of store.all('transactions').slice(-300)) usage.set(t.category, (usage.get(t.category) || 0) + 1);
  const sorted = (list) => [...list].sort((a, b) => (usage.get(b) || 0) - (usage.get(a) || 0));

  const catHTML = (type, selected) => {
    const c = categories();
    const names = type === 'income' ? sorted(c.income) : sorted(c.expense.map((x) => x.name));
    return names.map((name) => {
      const saving = type === 'expense' && c.expense.find((x) => x.name === name)?.kind === 'saving';
      return `<label class="cat ${saving ? 'cat--saving' : ''}"><input type="radio" name="category" value="${esc(name)}" ${name === selected ? 'checked' : ''}><span>${esc(name)}</span></label>`;
    }).join('') + `<button type="button" class="cat-new" data-new-cat>${icon('plus', 14)}New</button>`;
  };

  openDialog({
    title: tx ? 'Edit transaction' : 'Add transaction',
    backdropClose: false,
    body: `
      <form class="form" id="tx-form" novalidate>
        <div class="segmented segmented--type" role="radiogroup" aria-label="Type">
          <label class="seg"><input type="radio" name="type" value="expense" ${v.type === 'expense' ? 'checked' : ''}><span>Money out</span></label>
          <label class="seg"><input type="radio" name="type" value="income" ${v.type === 'income' ? 'checked' : ''}><span>Money in</span></label>
        </div>
        <label class="field">
          <span class="field__label">Amount</span>
          <input class="input input--amount" name="amount" inputmode="decimal" autocomplete="off" value="${esc(v.amount === '' ? '' : String(v.amount))}" placeholder="e.g. 45rb or 1,2jt" autofocus>
          <span class="field__hint" data-money></span>
          ${err('amount')}
        </label>
        <fieldset class="field">
          <legend class="field__label">Category</legend>
          <div class="cats" data-cats>${catHTML(v.type, v.category)}</div>
          <div class="new-cat" data-new-cat-box hidden>
            <label class="sr-only" for="new-cat-name">New category name</label>
            <input class="input" id="new-cat-name" maxlength="${FIN_LIMITS.category}" placeholder="New category, e.g. Kos, Parkir, Arisan" autocomplete="off">
            <label class="check-row check-row--sm" data-new-cat-saving><input type="checkbox" id="new-cat-saving"><span>Counts as saving</span></label>
            <button type="button" class="btn btn--primary btn--sm" data-add-cat>Add</button>
          </div>
          <span class="field__hint">Dashed categories count as <strong>saving</strong> (gold installment, investment top-up), not spending. Tap <strong>New</strong> to add your own.</span>
          ${err('category')}
        </fieldset>
        <div class="form-grid">
          <label class="field">
            <span class="field__label">Date</span>
            <input class="input" type="date" name="date" value="${esc(v.date)}">
            ${err('date')}
          </label>
          <label class="field">
            <span class="field__label">Note <span class="field__optional">optional</span></span>
            <input class="input" name="note" maxlength="${FIN_LIMITS.note}" value="${esc(v.note || '')}" placeholder="e.g. lunch with team" autocomplete="off">
            ${err('note')}
          </label>
        </div>
      </form>`,
    footer: `
      ${tx ? `<button type="button" class="btn btn--ghost btn--danger-text" data-remove>${icon('trash', 16)}Delete</button>` : ''}
      <span class="spacer"></span>
      ${tx ? '' : '<button type="button" class="btn btn--ghost" data-save-another>Save &amp; add another</button>'}
      <button type="submit" form="tx-form" class="btn btn--primary">${tx ? 'Save' : 'Save'}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#tx-form');
      const money = el.querySelector('[data-money]');
      const showMoney = () => {
        const r = parseRupiah(form.elements.amount.value);
        money.textContent = r.ok && r.value ? `= ${formatRupiah(r.value)}` : '';
      };
      form.elements.amount.addEventListener('input', showMoney);
      showMoney();
      const catsEl = el.querySelector('[data-cats]');
      const newBox = el.querySelector('[data-new-cat-box]');
      const newName = el.querySelector('#new-cat-name');
      const typeNow = () => form.querySelector('[name="type"]:checked').value;
      form.querySelectorAll('[name="type"]').forEach((r) => r.addEventListener('change', () => {
        catsEl.innerHTML = catHTML(r.value, '');
        newBox.hidden = true;
      }));
      catsEl.addEventListener('click', (ev) => {
        if (!ev.target.closest('[data-new-cat]')) return;
        newBox.hidden = false;
        el.querySelector('[data-new-cat-saving]').hidden = typeNow() !== 'expense';
        newName.focus();
      });
      const addCategory = () => {
        const name = newName.value.trim().replace(/\s+/g, ' ').slice(0, FIN_LIMITS.category);
        if (!name) { newName.focus(); return; }
        const type = typeNow();
        const c = structuredClone(categories());
        const existing = [...c.income, ...c.expense.map((x) => x.name)].find((x) => x.toLowerCase() === name.toLowerCase());
        if (existing) {
          const inThisType = type === 'income' ? c.income.includes(existing) : c.expense.some((x) => x.name === existing);
          if (!inThisType) { fieldErrors(el, { category: `“${existing}” already exists as a ${type === 'income' ? 'money-out' : 'money-in'} category. Use a different name.` }, form); return; }
          catsEl.innerHTML = catHTML(type, existing);
        } else {
          if (type === 'income') c.income.push(name);
          else c.expense.push({ name, kind: el.querySelector('#new-cat-saving').checked ? 'saving' : 'spend' });
          store.updateSettings({ financeCategories: c });
          catsEl.innerHTML = catHTML(type, name);
          toast(`Category “${name}” added.`);
        }
        newName.value = '';
        el.querySelector('#new-cat-saving').checked = false;
        newBox.hidden = true;
        el.querySelector('[data-error="category"]').hidden = true;
      };
      el.querySelector('[data-add-cat]').addEventListener('click', addCategory);
      newName.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); addCategory(); }
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); newBox.hidden = true; }
      });
      el.querySelector('[data-remove]')?.addEventListener('click', () => {
        store.trash('transactions', tx.id);
        close();
        toast('Transaction moved to Trash.', { action: { label: 'Undo', onClick: () => store.restore('transactions', tx.id) } });
      });

      const save = (again) => {
        const fd = new FormData(form);
        const res = validateTransactionInput({ type: fd.get('type'), amount: fd.get('amount'), category: fd.get('category'), date: fd.get('date'), note: fd.get('note') }, categories());
        if (!res.ok) { fieldErrors(el, res.errors, form); return; }
        if (tx) store.update('transactions', tx.id, res.value);
        else store.add('transactions', res.value);
        if (again) {
          form.elements.amount.value = '';
          form.elements.note.value = '';
          form.querySelectorAll('[name="category"]').forEach((x) => { x.checked = false; });
          showMoney();
          form.elements.amount.focus();
          toast(`Saved ${formatRupiah(res.value.amount)} · ${res.value.category}.`);
        } else {
          close();
          toast(tx ? 'Transaction updated.' : `Saved ${formatRupiah(res.value.amount)} · ${res.value.category}.`);
        }
      };
      el.querySelector('[data-save-another]')?.addEventListener('click', () => save(true));
      form.addEventListener('submit', (ev) => { ev.preventDefault(); save(false); });
    },
  });
}

// ---------- categories ----------

export function openCategoryEditor() {
  openDialog({
    title: 'Categories',
    backdropClose: false,
    body: '<div data-cat-editor></div>',
    footer: '<span class="spacer"></span><button type="button" class="btn btn--primary" data-dialog-close>Done</button>',
    onMount(el) {
      const host = el.querySelector('[data-cat-editor]');
      const count = (name) => store.all('transactions').filter((t) => t.category === name).length;
      const render = () => {
        const c = categories();
        const row = (type, name, kind) => {
          const n = count(name);
          return `<li class="cat-row">
            <span class="cat-row__name">${esc(name)}</span>
            ${type === 'expense' ? `<label class="check-row check-row--sm"><input type="checkbox" data-kind="${esc(name)}" ${kind === 'saving' ? 'checked' : ''}><span>Saving</span></label>` : ''}
            <span class="cat-row__n">${n ? plural(n, 'use') : ''}</span>
            <button type="button" class="icon-btn" data-rename="${type}" data-name="${esc(name)}" aria-label="Rename ${esc(name)}">${icon('note', 16)}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-del="${type}" data-name="${esc(name)}" aria-label="Remove ${esc(name)}">${icon('x', 16)}</button>
          </li>`;
        };
        host.innerHTML = `
          <p class="muted">Tick <strong>Saving</strong> for money you move into savings, investments or debt payments. It's left out of spending.</p>
          <h3 class="sub-h">Money out</h3>
          <ul class="cat-list">${c.expense.map((x) => row('expense', x.name, x.kind)).join('')}</ul>
          <form class="cat-add" data-add="expense"><input class="input" maxlength="${FIN_LIMITS.category}" placeholder="New category" aria-label="New money-out category"><button class="btn btn--ghost btn--sm">${icon('plus', 16)}Add</button></form>
          <h3 class="sub-h">Money in</h3>
          <ul class="cat-list">${c.income.map((x) => row('income', x)).join('')}</ul>
          <form class="cat-add" data-add="income"><input class="input" maxlength="${FIN_LIMITS.category}" placeholder="New category" aria-label="New money-in category"><button class="btn btn--ghost btn--sm">${icon('plus', 16)}Add</button></form>
          <p class="field__error" data-cat-error hidden></p>`;
      };
      const showError = (msg) => { const e = host.querySelector('[data-cat-error]'); e.textContent = msg; e.hidden = !msg; };
      const save = (next) => store.updateSettings({ financeCategories: next });
      const exists = (c, name) => c.income.includes(name) || c.expense.some((x) => x.name === name);

      host.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = ev.target.closest('[data-add]');
        const name = f.querySelector('input').value.trim().slice(0, FIN_LIMITS.category);
        if (!name) return;
        const c = structuredClone(categories());
        if (exists(c, name)) { showError(`“${name}” already exists.`); return; }
        if (f.dataset.add === 'income') c.income.push(name);
        else c.expense.push({ name, kind: 'spend' });
        save(c);
        render();
        host.querySelector(`[data-add="${f.dataset.add}"] input`).focus();
      });
      host.addEventListener('change', (ev) => {
        const k = ev.target.closest('[data-kind]');
        if (!k) return;
        const c = structuredClone(categories());
        const cat = c.expense.find((x) => x.name === k.dataset.kind);
        if (cat) cat.kind = k.checked ? 'saving' : 'spend';
        save(c);
      });
      host.addEventListener('click', async (ev) => {
        const del = ev.target.closest('[data-del]');
        const ren = ev.target.closest('[data-rename]');
        if (del) {
          const name = del.dataset.name;
          const n = count(name);
          if (n) { showError(`“${name}” is used by ${plural(n, 'transaction')}. Rename it instead, or change those transactions first.`); return; }
          const c = structuredClone(categories());
          if (del.dataset.del === 'income') c.income = c.income.filter((x) => x !== name);
          else c.expense = c.expense.filter((x) => x.name !== name);
          if (!c.income.length || !c.expense.length) { showError('Keep at least one category of each type.'); return; }
          save(c);
          render();
        }
        if (ren) {
          const name = ren.dataset.name;
          const li = ren.closest('li');
          li.innerHTML = `<form class="cat-add cat-add--inline"><input class="input" value="${esc(name)}" maxlength="${FIN_LIMITS.category}" aria-label="New name for ${esc(name)}"><button class="btn btn--primary btn--sm">Rename</button></form>`;
          const input = li.querySelector('input');
          input.focus();
          input.select();
          li.querySelector('form').addEventListener('submit', (e2) => {
            e2.preventDefault();
            e2.stopPropagation();
            const next = input.value.trim().slice(0, FIN_LIMITS.category);
            if (!next || next === name) { render(); return; }
            const c = structuredClone(categories());
            if (exists(c, next)) { showError(`“${next}” already exists.`); return; }
            if (ren.dataset.rename === 'income') c.income = c.income.map((x) => (x === name ? next : x));
            else c.expense = c.expense.map((x) => (x.name === name ? { ...x, name: next } : x));
            save(c);
            const affected = store.all('transactions').filter((t) => t.category === name);
            for (const t of affected) store.update('transactions', t.id, { category: next });
            toast(affected.length ? `Renamed. ${plural(affected.length, 'transaction')} updated.` : 'Renamed.');
            render();
          });
        }
      });
      render();
    },
  });
}

// ---------- savings goals ----------

export function openGoalForm({ goal = null } = {}) {
  const accounts = store.all('accounts').filter((a) => !isDebt(a));
  if (!accounts.length) { toast('Add the account where you keep this money first.'); return; }
  const v = goal || { name: '', target: '', targetDate: '', accountIds: [], notes: '' };
  openDialog({
    title: goal ? 'Edit savings goal' : 'New savings goal',
    backdropClose: false,
    body: `
      <form class="form" id="goal-form" novalidate>
        <label class="field">
          <span class="field__label">Goal</span>
          <input class="input" name="name" maxlength="${FIN_LIMITS.name}" value="${esc(v.name)}" placeholder="e.g. Wedding fund, Emergency fund" autocomplete="off" autofocus>
          ${err('name')}
        </label>
        <div class="form-grid">
          <label class="field">
            <span class="field__label">Target amount</span>
            <input class="input" name="target" inputmode="decimal" value="${esc(v.target === '' ? '' : String(v.target))}" placeholder="e.g. 150jt" autocomplete="off">
            <span class="field__hint" data-money></span>
            ${err('target')}
          </label>
          <label class="field">
            <span class="field__label">Reach it by <span class="field__optional">optional</span></span>
            <input class="input" type="date" name="targetDate" value="${esc(v.targetDate || '')}">
            ${err('targetDate')}
          </label>
        </div>
        <fieldset class="field">
          <legend class="field__label">Where this money is kept</legend>
          <div class="acct-checks">
            ${accounts.map((a) => `<label class="check-row"><input type="checkbox" name="accountIds" value="${esc(a.id)}" ${v.accountIds.includes(a.id) ? 'checked' : ''}><span>${esc(a.name)} <span class="muted">${esc(accountTypeLabel(a.type))}</span></span></label>`).join('')}
          </div>
          <span class="field__hint">Progress follows these accounts' latest monthly balances, so you don't log deposits twice.</span>
          ${err('accountIds')}
        </fieldset>
        <label class="field">
          <span class="field__label">Notes <span class="field__optional">optional</span></span>
          <textarea class="input" name="notes" rows="2" maxlength="${FIN_LIMITS.notes}">${esc(v.notes || '')}</textarea>
        </label>
      </form>`,
    footer: `
      ${goal ? `<button type="button" class="btn btn--ghost btn--danger-text" data-remove>${icon('trash', 16)}Delete</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
      <button type="submit" form="goal-form" class="btn btn--primary">${goal ? 'Save' : 'Add goal'}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#goal-form');
      const money = el.querySelector('[data-money]');
      const showMoney = () => { const r = parseRupiah(form.elements.target.value); money.textContent = r.ok && r.value ? `= ${formatRupiah(r.value)}` : ''; };
      form.elements.target.addEventListener('input', showMoney);
      showMoney();
      el.querySelector('[data-remove]')?.addEventListener('click', () => {
        store.trash('savingsGoals', goal.id);
        close();
        toast('Goal moved to Trash.', { action: { label: 'Undo', onClick: () => store.restore('savingsGoals', goal.id) } });
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const res = validateGoalInput({ name: fd.get('name'), target: fd.get('target'), targetDate: fd.get('targetDate') || null, accountIds: fd.getAll('accountIds'), notes: fd.get('notes') }, store.all('accounts'));
        if (!res.ok) { fieldErrors(el, res.errors, form); return; }
        if (goal) store.update('savingsGoals', goal.id, res.value);
        else store.add('savingsGoals', res.value);
        close();
        toast(goal ? 'Goal updated.' : 'Goal added.');
      });
    },
  });
}
