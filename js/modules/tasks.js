// Tasks page: one list for every area of life (work, thesis, career, personal, plans).

import * as store from '../store.js';
import { AREAS, areaLabel, LIMITS, validateTaskInput } from '../schema.js';
import { esc, plural } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { todayISO, relativeLabel, formatLong } from '../lib/dates.js';
import { VIEWS, inView, matchesSearch, groupOpen, groupDone, isOverdue, isOpen, UPCOMING_DAYS } from '../lib/tasks.js';
import { taskRow, toggleTask, openTaskForm, addSampleTasks, removeSampleTasks, hasSamples } from './task-ui.js';

const DONE_LIMIT = 100;

// Filter state lives for the session so switching pages keeps your place.
const state = { view: 'today', area: 'all', query: '' };

export function setFilters(patch) {
  Object.assign(state, patch);
}

export const title = 'Tasks';

export function mount(root) {
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 class="page-title">Tasks</h1>
        <p class="page-sub" data-summary></p>
      </div>
      <button type="button" class="btn btn--primary hide-mobile" data-action="new">${icon('plus', 18)}New task</button>
    </header>

    <div data-sample-banner></div>

    <form class="quick-add" data-quick novalidate>
      <label class="sr-only" for="qa-title">New task</label>
      <input class="input quick-add__title" id="qa-title" name="title" maxlength="${LIMITS.title}"
        placeholder="Add a task, then press Enter" autocomplete="off">
      <div class="quick-add__opts">
        <label class="sr-only" for="qa-area">Area</label>
        <select class="input input--sm" id="qa-area" name="area">
          ${AREAS.map((a) => `<option value="${a.id}">${esc(a.label)}</option>`).join('')}
        </select>
        <label class="sr-only" for="qa-due">Due date</label>
        <input class="input input--sm" type="date" id="qa-due" name="due">
        <button type="submit" class="btn btn--primary btn--sm">Add</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="more">More options</button>
      </div>
      <p class="field__error" data-qa-error hidden></p>
    </form>

    <div class="toolbar">
      <div class="segmented" role="tablist" aria-label="Show tasks" data-views></div>
      <label class="search">
        ${icon('search', 18)}
        <span class="sr-only">Search tasks</span>
        <input class="input" type="search" id="task-search" placeholder="Search tasks" value="${esc(state.query)}">
      </label>
    </div>
    <div class="area-filter" role="group" aria-label="Filter by area" data-areas></div>

    <section class="task-groups" data-list aria-live="polite"></section>
  `;

  const quick = root.querySelector('[data-quick]');
  const qaArea = quick.elements.area;
  const qaDue = quick.elements.due;

  const syncQuickDefaults = () => {
    qaArea.value = state.area !== 'all' ? state.area : (store.settings().lastArea || 'personal');
    if (!qaDue.value || qaDue.dataset.auto === '1') {
      qaDue.value = state.view === 'today' ? todayISO() : '';
      qaDue.dataset.auto = '1';
    }
  };
  qaDue.addEventListener('input', () => { qaDue.dataset.auto = '0'; });

  quick.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const err = quick.querySelector('[data-qa-error]');
    const res = validateTaskInput({
      title: quick.elements.title.value, notes: '', area: qaArea.value, priority: 'normal',
      due: qaDue.value || null, repeat: null, links: [],
    });
    if (!res.ok) {
      err.textContent = Object.values(res.errors)[0];
      err.hidden = false;
      quick.elements.title.focus();
      return;
    }
    err.hidden = true;
    store.add('tasks', { ...res.value, status: 'todo', doneAt: null, nextId: null });
    if (res.value.area !== store.settings().lastArea) store.updateSettings({ lastArea: res.value.area });
    quick.elements.title.value = '';
    const where = res.value.due ? relativeLabel(res.value.due, todayISO()) : 'no date';
    const visible = inView({ status: 'todo', due: res.value.due }, state.view, todayISO()) &&
      (state.area === 'all' || state.area === res.value.area);
    toast(visible ? 'Task added.' : `Task added (${areaLabel(res.value.area)}, ${where}). It's not in this view.`);
  });

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const action = el.dataset.action;
    const id = el.closest('[data-id]')?.dataset.id;
    if (action === 'new') openTaskForm({ defaults: newDefaults() });
    if (action === 'more') {
      openTaskForm({ defaults: { ...newDefaults(), title: quick.elements.title.value.trim(), area: qaArea.value, due: qaDue.value || null } });
      quick.elements.title.value = '';
    }
    if (action === 'toggle' && id) toggleTask(id);
    if (action === 'edit' && id) {
      const t = store.get('tasks', id);
      if (t) openTaskForm({ task: t });
    }
    if (action === 'view') { state.view = el.dataset.value; syncQuickDefaults(); refresh(); }
    if (action === 'area') { state.area = el.dataset.value; syncQuickDefaults(); refresh(); }
    if (action === 'clear-search') {
      state.query = '';
      root.querySelector('#task-search').value = '';
      refresh();
    }
    if (action === 'samples') addSampleTasks();
    if (action === 'remove-samples') removeSampleTasks();
  });

  // Arrow keys move between view tabs.
  root.querySelector('[data-views]').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const i = VIEWS.findIndex((v) => v.id === state.view);
    const n = (i + (ev.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length;
    state.view = VIEWS[n].id;
    syncQuickDefaults();
    refresh();
    root.querySelector(`[data-views] [data-value="${state.view}"]`)?.focus();
  });

  root.querySelector('#task-search').addEventListener('input', (ev) => {
    state.query = ev.target.value;
    refresh();
  });

  function newDefaults() {
    return {
      area: state.area !== 'all' ? state.area : (store.settings().lastArea || 'personal'),
      due: state.view === 'today' ? todayISO() : null,
    };
  }

  function refresh() {
    const today = todayISO();
    const tasks = store.all('tasks');
    const open = tasks.filter(isOpen);
    const overdue = open.filter((t) => isOverdue(t, today)).length;

    root.querySelector('[data-summary]').textContent = tasks.length
      ? `${plural(open.length, 'open task')}${overdue ? ` · ${overdue} overdue` : ''}`
      : formatLong(today);

    root.querySelector('[data-sample-banner]').innerHTML = hasSamples()
      ? `<div class="banner banner--soft">${icon('sparkle', 18)}<p>You're looking at example tasks. Remove them when you're ready to start for real.</p><button type="button" class="btn btn--ghost btn--sm" data-action="remove-samples">Remove examples</button></div>`
      : '';

    const byArea = (t) => state.area === 'all' || t.area === state.area;
    const bySearch = (t) => matchesSearch(t, state.query);

    root.querySelector('[data-views]').innerHTML = VIEWS.map((v) => {
      const n = v.id === 'done' ? null : tasks.filter((t) => inView(t, v.id, today) && byArea(t)).length;
      const active = v.id === state.view;
      return `<button type="button" class="seg-btn ${active ? 'is-active' : ''}" role="tab" aria-selected="${active}"
        tabindex="${active ? 0 : -1}" data-action="view" data-value="${v.id}">${esc(v.label)}${n !== null ? `<span class="count">${n}</span>` : ''}</button>`;
    }).join('');

    root.querySelector('[data-areas]').innerHTML = [{ id: 'all', label: 'All areas' }, ...AREAS].map((a) => {
      const active = state.area === a.id;
      return `<button type="button" class="filter-chip ${a.id !== 'all' ? 'filter-chip--' + a.id : ''} ${active ? 'is-active' : ''}"
        aria-pressed="${active}" data-action="area" data-value="${a.id}">${a.id !== 'all' ? '<span class="dot"></span>' : ''}${esc(a.label)}</button>`;
    }).join('');

    const list = root.querySelector('[data-list]');
    const visible = tasks.filter((t) => inView(t, state.view, today) && byArea(t) && bySearch(t));

    if (!tasks.length) {
      list.innerHTML = `
        <div class="empty">
          <div class="empty__icon">${icon('tasks', 28)}</div>
          <h2 class="empty__title">No tasks yet</h2>
          <p class="empty__text">Type one in the box above. Work, thesis, job applications and personal errands all go in the same list, sorted by area.</p>
          <button type="button" class="btn btn--ghost" data-action="samples">${icon('sparkle', 16)}Show me with example tasks</button>
        </div>`;
      return;
    }

    if (!visible.length) {
      list.innerHTML = emptyFor(tasks, today, byArea);
      return;
    }

    if (state.view === 'done') {
      const groups = groupDone(visible, today);
      let shown = 0;
      const html = [];
      for (const g of groups) {
        if (shown >= DONE_LIMIT) break;
        const items = g.tasks.slice(0, DONE_LIMIT - shown);
        shown += items.length;
        html.push(groupHTML(g.day === 'unknown' ? 'Earlier' : relativeLabel(g.day, today), items, today));
      }
      if (visible.length > DONE_LIMIT) html.push(`<p class="list-note">Showing the latest ${DONE_LIMIT} of ${visible.length} finished tasks. Search to find older ones.</p>`);
      list.innerHTML = html.join('');
      return;
    }

    list.innerHTML = groupOpen(visible, today)
      .map((g) => groupHTML(g.label, g.tasks, today, g.id === 'overdue'))
      .join('');
  }

  function groupHTML(label, items, today, warn = false) {
    return `
      <div class="group">
        <h2 class="group__label ${warn ? 'group__label--warn' : ''}">${esc(label)} <span class="group__count">${items.length}</span></h2>
        <ul class="task-list">${items.map((t) => taskRow(t, today, { showArea: state.area === 'all' })).join('')}</ul>
      </div>`;
  }

  function emptyFor(tasks, today, byArea) {
    if (state.query.trim()) {
      return `<div class="empty empty--compact">
        <p class="empty__text">No tasks match “${esc(state.query.trim())}”${state.area !== 'all' ? ` in ${esc(areaLabel(state.area))}` : ''}.</p>
        <button type="button" class="btn btn--ghost btn--sm" data-action="clear-search">Clear search</button></div>`;
    }
    const where = state.area !== 'all' ? ` in ${areaLabel(state.area)}` : '';
    const upcoming = tasks.filter((t) => inView(t, 'upcoming', today) && byArea(t)).length;
    const msg = {
      today: [`Nothing due today${where}.`, upcoming ? `${plural(upcoming, 'task')} coming up in the next ${UPCOMING_DAYS} days.` : 'Tasks due today or overdue show up here.'],
      upcoming: [`Nothing due in the next ${UPCOMING_DAYS} days${where}.`, 'Tasks with a due date after today show up here.'],
      open: [`No open tasks${where}.`, 'Everything is done. Add something new above.'],
      done: [`No finished tasks${where} yet.`, 'Ticked-off tasks are kept here so you can look back.'],
    }[state.view];
    return `<div class="empty empty--compact"><p class="empty__title">${esc(msg[0])}</p><p class="empty__text">${esc(msg[1])}</p>
      ${upcoming && state.view === 'today' ? '<button type="button" class="btn btn--ghost btn--sm" data-action="view" data-value="upcoming">See upcoming</button>' : ''}</div>`;
  }

  syncQuickDefaults();
  refresh();
  return { refresh, newTask: () => openTaskForm({ defaults: newDefaults() }) };
}
