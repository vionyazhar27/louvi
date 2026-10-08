// Task pieces shared by Home and Tasks: the row, the add/edit form, and the actions
// (complete, delete with undo). Keeping them here means both pages behave identically.

import * as store from '../store.js';
import { AREAS, PRIORITIES, areaLabel, validateTaskInput, LIMITS } from '../schema.js';
import { esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { todayISO, relativeLabel, diffDays, addDays, weekday, formatLong, WEEKDAY_SHORT, parseISO } from '../lib/dates.js';
import { describe, shortDescribe } from '../lib/recurrence.js';
import { isOverdue, nextRepeatFor } from '../lib/tasks.js';
import { linkText } from '../lib/links.js';
import { linkFieldHTML, mountLinkEditor } from '../ui/link-editor.js';

// ---------- row ----------

export function dueText(task, today) {
  if (!task.due) return '';
  if (task.status !== 'done' && isOverdue(task, today)) {
    const n = diffDays(task.due, today);
    return n === 1 ? 'Yesterday' : `${n} days overdue`;
  }
  return relativeLabel(task.due, today);
}

export function taskRow(task, today, { showArea = true } = {}) {
  const done = task.status === 'done';
  const overdue = isOverdue(task, today);
  const meta = [];
  if (showArea) meta.push(`<span class="chip chip--${esc(task.area)}">${esc(areaLabel(task.area))}</span>`);
  if (task.due) {
    meta.push(`<span class="meta ${overdue ? 'meta--overdue' : ''}">${icon('calendar', 14)}${esc(dueText(task, today))}</span>`);
  }
  if (task.repeat) meta.push(`<span class="meta" title="${esc(describe(task.repeat))}">${icon('repeat', 14)}${esc(shortDescribe(task.repeat))}</span>`);
  const links = task.links || [];
  if (links.length) meta.push(`<span class="meta">${icon('link', 14)}${links.length === 1 ? esc(linkText(links[0])) : `${links.length} links`}</span>`);
  if (task.notes) meta.push(`<span class="meta" title="Has notes">${icon('note', 14)}<span class="sr-only">Has notes</span></span>`);
  if (task.sample) meta.push(`<span class="meta meta--sample">Example</span>`);

  return `
    <li class="task ${done ? 'is-done' : ''} ${task.priority === 'low' ? 'is-low' : ''}" data-id="${esc(task.id)}">
      <button type="button" class="check" role="checkbox" aria-checked="${done}" data-action="toggle"
        aria-label="${done ? 'Mark as not done' : 'Mark as done'}: ${esc(task.title)}">${icon('check', 16)}</button>
      <button type="button" class="task__main" data-action="edit" aria-label="Edit task: ${esc(task.title)}">
        <span class="task__title">${task.priority === 'high' && !done ? `<span class="prio" title="High priority">${icon('flag', 14)}<span class="sr-only">High priority.</span></span>` : ''}${esc(task.title)}</span>
        ${meta.length ? `<span class="task__meta">${meta.join('')}</span>` : ''}
      </button>
      ${links.length === 1 ? `<a class="icon-btn task__open" href="${esc(links[0].url)}" target="_blank" rel="noopener noreferrer"
        title="Open ${esc(linkText(links[0]))}" aria-label="Open link: ${esc(linkText(links[0]))} (new tab)">${icon('external', 18)}</a>` : ''}
    </li>`;
}

// ---------- actions ----------

export function toggleTask(id) {
  const task = store.get('tasks', id);
  if (!task) return;
  const today = todayISO();

  if (task.status !== 'done') {
    let next = null;
    const existingNext = task.nextId ? store.get('tasks', task.nextId) : null;
    if (!existingNext || existingNext.deletedAt) {
      const data = nextRepeatFor(task, today);
      if (data) next = store.add('tasks', data);
    }
    store.update('tasks', id, { status: 'done', doneAt: new Date().toISOString(), ...(next ? { nextId: next.id } : {}) });
    toast(next ? `Done. Next one is due ${relativeLabel(next.due, today).replace(/^(Today|Tomorrow)$/, (m) => m.toLowerCase())}.` : 'Done.', {
      action: { label: 'Undo', onClick: () => toggleTask(id) },
    });
  } else {
    // Un-completing: if the auto-created next repeat hasn't been touched, remove it again.
    let removedNext = false;
    const next = task.nextId ? store.get('tasks', task.nextId) : null;
    if (next && !next.deletedAt && next.status !== 'done' && next.updatedAt === next.createdAt) {
      store.purge('tasks', next.id);
      removedNext = true;
    }
    store.update('tasks', id, { status: 'todo', doneAt: null, nextId: removedNext ? null : task.nextId });
    toast(removedNext ? 'Marked as not done. The next repeat was removed.' : 'Marked as not done.');
  }
}

export function deleteTask(id) {
  const task = store.get('tasks', id);
  if (!task) return;
  store.trash('tasks', id);
  toast('Task moved to Trash.', {
    action: { label: 'Undo', onClick: () => store.restore('tasks', id) },
  });
}

// ---------- form ----------

function nextMonday(today) {
  const wd = weekday(today);
  return addDays(today, wd === 1 ? 7 : ((8 - wd) % 7) || 7);
}

function radioGroup(name, options, value, label) {
  return `
    <fieldset class="field">
      <legend class="field__label">${esc(label)}</legend>
      <div class="segmented segmented--wrap" role="radiogroup">
        ${options.map((o) => `
          <label class="seg ${o.cls || ''}">
            <input type="radio" name="${name}" value="${esc(o.id)}" ${o.id === value ? 'checked' : ''}>
            <span>${esc(o.label)}</span>
          </label>`).join('')}
      </div>
      <p class="field__error" data-error="${name}" hidden></p>
    </fieldset>`;
}

// "Part of: Site Engineer at PT X  [Open]" inside the task form.
function refLine(appId) {
  const app = store.get('applications', appId);
  if (!app || app.deletedAt) return '';
  return `<div class="ref-line">${icon('briefcase', 16)}<span>Part of your application: <strong>${esc(app.position)}</strong> at ${esc(app.company)}</span>
    <button type="button" class="link-btn" data-open-ref="${esc(app.id)}">Open</button></div>`;
}

// Opens the add/edit dialog. `task` = existing task to edit; `defaults` = prefill for a new one.
export function openTaskForm({ task = null, defaults = {} } = {}) {
  const today = todayISO();
  const s = store.settings();
  const v = task ? structuredClone(task) : {
    title: '', notes: '', area: s.lastArea || 'personal', due: null, priority: 'normal', repeat: null, links: [], ...defaults,
  };
  const links = [...(v.links || [])];
  const repeat = v.repeat || null;
  const freq = repeat?.freq || 'none';
  const weeklyDays = repeat?.freq === 'weekly' ? repeat.days : (v.due ? [weekday(v.due)] : [weekday(today)]);

  const body = `
    <form class="form" id="task-form" novalidate>
      <label class="field">
        <span class="field__label">Task</span>
        <input class="input input--lg" name="title" id="task-title" maxlength="${LIMITS.title}" value="${esc(v.title)}"
          placeholder="What needs doing?" autocomplete="off" required autofocus>
        <span class="field__error" data-error="title" hidden></span>
      </label>

      ${radioGroup('area', AREAS.map((a) => ({ ...a, cls: 'seg--' + a.id })), v.area, 'Area')}

      <div class="field">
        <label class="field__label" for="task-due">Due date</label>
        <div class="due-row">
          <input class="input" type="date" name="due" id="task-due" value="${esc(v.due || '')}">
          <div class="quick-dates">
            <button type="button" class="chip-btn" data-set-due="${today}">Today</button>
            <button type="button" class="chip-btn" data-set-due="${addDays(today, 1)}">Tomorrow</button>
            <button type="button" class="chip-btn" data-set-due="${nextMonday(today)}">Next Mon</button>
            <button type="button" class="chip-btn" data-set-due="">No date</button>
          </div>
        </div>
        <span class="field__hint" data-due-hint>${v.due ? esc(formatLong(v.due)) : ''}</span>
        <span class="field__error" data-error="due" hidden></span>
      </div>

      ${radioGroup('priority', PRIORITIES, v.priority, 'Priority')}

      <div class="field">
        <label class="field__label" for="task-repeat">Repeat</label>
        <select class="input" name="repeat" id="task-repeat">
          <option value="none" ${freq === 'none' ? 'selected' : ''}>Does not repeat</option>
          <option value="daily" ${freq === 'daily' ? 'selected' : ''}>Every day</option>
          <option value="weekdays" ${freq === 'weekdays' ? 'selected' : ''}>Every weekday (Mon–Fri)</option>
          <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Weekly on chosen days</option>
          <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Monthly, same date</option>
        </select>
        <div class="weekdays" data-weekly ${freq === 'weekly' ? '' : 'hidden'}>
          ${[1, 2, 3, 4, 5, 6, 0].map((d) => `
            <label class="day">
              <input type="checkbox" name="days" value="${d}" ${weeklyDays.includes(d) ? 'checked' : ''}>
              <span>${WEEKDAY_SHORT[d]}</span>
            </label>`).join('')}
        </div>
        <span class="field__hint" data-repeat-hint></span>
        <span class="field__error" data-error="repeat" hidden></span>
      </div>

      <label class="field">
        <span class="field__label">Notes <span class="field__optional">optional</span></span>
        <textarea class="input" name="notes" rows="3" maxlength="${LIMITS.notes}" placeholder="Context, decisions, who to follow up with…">${esc(v.notes || '')}</textarea>
        <span class="field__error" data-error="notes" hidden></span>
      </label>

      ${task?.ref?.type === 'application' ? refLine(task.ref.id) : ''}

      ${linkFieldHTML()}
    </form>`;

  const footer = `
    ${task ? `<button type="button" class="btn btn--ghost btn--danger-text" data-delete>${icon('trash', 16)}Delete</button>` : ''}
    <span class="spacer"></span>
    <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
    <button type="submit" form="task-form" class="btn btn--primary">${task ? 'Save changes' : 'Add task'}</button>`;

  openDialog({
    title: task ? 'Edit task' : 'New task',
    body,
    footer,
    backdropClose: false,
    onMount(el, close) {
      const form = el.querySelector('#task-form');
      const dueInput = form.elements.due;
      const repeatSel = form.elements.repeat;
      const weeklyBox = el.querySelector('[data-weekly]');
      const dueHint = el.querySelector('[data-due-hint]');
      const repeatHint = el.querySelector('[data-repeat-hint]');

      const refreshHints = () => {
        const due = dueInput.value;
        dueHint.textContent = due ? formatLong(due) : '';
        weeklyBox.hidden = repeatSel.value !== 'weekly';
        if (repeatSel.value === 'monthly') {
          repeatHint.textContent = due ? `Repeats on day ${parseISO(due).getDate()} of each month.` : 'Set a due date to choose the day of the month.';
        } else if (repeatSel.value !== 'none' && !due) {
          repeatHint.textContent = 'Set a due date for the first one.';
        } else if (repeatSel.value !== 'none') {
          repeatHint.textContent = 'When you finish one, the next appears automatically.';
        } else {
          repeatHint.textContent = '';
        }
      };
      refreshHints();
      dueInput.addEventListener('change', refreshHints);
      dueInput.addEventListener('input', refreshHints);
      repeatSel.addEventListener('change', () => {
        if (repeatSel.value !== 'none' && !dueInput.value) dueInput.value = today;
        refreshHints();
      });
      el.querySelectorAll('[data-set-due]').forEach((b) => b.addEventListener('click', () => {
        dueInput.value = b.dataset.setDue;
        refreshHints();
      }));

      // ----- links -----
      const linkEd = mountLinkEditor(el, links);
      const linkUrl = el.querySelector('#link-url');
      const addPendingLink = linkEd.addPending;
      el.querySelector('[data-open-ref]')?.addEventListener('click', async (ev) => {
        const id = ev.currentTarget.dataset.openRef;
        close();
        const career = await import('./career-actions.js');
        career.openApplicationDetail(id);
      });

      el.querySelector('[data-delete]')?.addEventListener('click', () => {
        close();
        deleteTask(task.id);
      });

      form.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          form.requestSubmit();
        }
      });

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!addPendingLink()) return;
        const fd = new FormData(form);
        const freqVal = fd.get('repeat');
        const due = fd.get('due') || null;
        let rule = null;
        if (freqVal === 'weekly') rule = { freq: 'weekly', days: fd.getAll('days').map(Number) };
        else if (freqVal === 'monthly') rule = { freq: 'monthly', day: due ? parseISO(due).getDate() : 0 };
        else if (freqVal !== 'none') rule = { freq: freqVal };

        const res = validateTaskInput({
          title: fd.get('title'),
          notes: fd.get('notes'),
          area: fd.get('area'),
          priority: fd.get('priority'),
          due,
          repeat: rule,
          links: linkEd.links,
        });

        el.querySelectorAll('[data-error]').forEach((e) => { e.hidden = true; e.textContent = ''; });
        el.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
        if (!res.ok) {
          for (const [field, msg] of Object.entries(res.errors)) {
            const errEl = el.querySelector(`[data-error="${field}"]`);
            if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
            const input = field === 'links' ? linkUrl : form.elements[field];
            if (input && input.setAttribute) input.setAttribute('aria-invalid', 'true');
          }
          const firstBad = form.querySelector('[aria-invalid="true"]') || el.querySelector('[data-error]:not([hidden])');
          firstBad?.focus?.();
          return;
        }

        if (task) {
          store.update('tasks', task.id, res.value);
          toast('Task updated.');
        } else {
          store.add('tasks', { ...res.value, status: 'todo', doneAt: null, nextId: null });
          toast('Task added.');
        }
        if (res.value.area !== s.lastArea) store.updateSettings({ lastArea: res.value.area });
        close();
      });
    },
  });
}

// ---------- examples ----------

export function addSampleTasks() {
  const t = todayISO();
  const samples = [
    { title: 'Send daily report', area: 'work', due: t, priority: 'high', repeat: { freq: 'weekdays' } },
    { title: 'Revise literature review notes', area: 'thesis', due: addDays(t, 2), priority: 'normal', notes: 'Example task. Edit or delete me.' },
    { title: 'Follow up on job application', area: 'career', due: addDays(t, -1), priority: 'normal', links: [{ label: 'Job posting', url: 'https://www.linkedin.com/jobs/' }] },
    { title: 'Compare wedding venue quotes', area: 'plans', due: addDays(t, 9), priority: 'low' },
    { title: 'Weekly review', area: 'personal', due: nextMonday(t), priority: 'normal', repeat: { freq: 'weekly', days: [1] } },
  ];
  for (const s of samples) store.add('tasks', { notes: '', links: [], ...s, status: 'todo', doneAt: null, nextId: null, sample: true });
}

export async function removeSampleTasks() {
  const samples = store.all('tasks').filter((t) => t.sample);
  if (!samples.length) return;
  const ok = await confirmDialog({
    title: 'Remove example tasks?',
    message: `This removes ${samples.length} example task${samples.length === 1 ? '' : 's'} (including any copies made by repeating). Your own tasks stay.`,
    confirmLabel: 'Remove examples',
  });
  if (!ok) return;
  store.commit((d) => {
    for (const r of d.tasks) if (r.sample && !r.purged) {
      for (const k of Object.keys(r)) if (!['id', 'createdAt'].includes(k)) delete r[k];
      Object.assign(r, { updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString(), purged: true });
    }
  }, { collection: 'tasks', type: 'purge' });
  toast('Example tasks removed.');
}

export function hasSamples() {
  return store.all('tasks').some((t) => t.sample);
}
