// Career actions shared by the Career page, Home and the task form:
// application form + detail, interviews, follow-up tasks, and skills.

import * as store from '../store.js';
import { esc, plural } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { linkFieldHTML, mountLinkEditor, linkListHTML } from '../ui/link-editor.js';
import { todayISO, formatShort, formatLong, relativeLabel, diffDays, nowStamp } from '../lib/dates.js';
import { formatRupiah, formatRange, parseRupiah } from '../lib/money.js';
import { uid } from '../lib/id.js';
import {
  STATUSES, statusLabel, isActive, WORK_MODES, workModeLabel, INTERVIEW_TYPES, interviewTypeLabel, OUTCOMES,
  SKILL_CATEGORIES, SKILL_LEVELS, levelLabel, CAREER_LIMITS, skillMap, matchFor, nextStep, staleDays, withStatus,
  validateApplicationInput, validateInterviewInput, validateSkillInput, parseSkillList, demandFor,
} from '../lib/career.js';

const SOURCES = ['LinkedIn', 'JobStreet', 'Glints', 'Kalibrr', 'Company website', 'Rekrutmen Bersama BUMN', 'Referral', 'Job fair', 'Campus career center'];

// ---------- helpers ----------

export function followUpTaskFor(app) {
  if (!app?.followUpTaskId) return null;
  const t = store.get('tasks', app.followUpTaskId);
  return t && !t.deletedAt ? t : null;
}

function openFollowUp(app) {
  const t = followUpTaskFor(app);
  return t && t.status !== 'done' ? t : null;
}

const followUpTitle = (v) => `Follow up: ${v.position} at ${v.company}`;

export function statusPill(status) {
  return `<span class="pill pill--${esc(status)}">${esc(statusLabel(status))}</span>`;
}

export function nextStepText(step, today) {
  if (!step) return '';
  const when = relativeLabel(step.date, today) + (step.time ? `, ${step.time}` : '');
  return `${step.label} · ${when}`;
}

function fieldErrors(el, errors, form) {
  el.querySelectorAll('[data-error]').forEach((e) => { e.hidden = true; e.textContent = ''; });
  el.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  for (const [field, msg] of Object.entries(errors)) {
    const errEl = el.querySelector(`[data-error="${field}"]`);
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
    const input = form?.elements?.[field];
    if (input?.setAttribute) input.setAttribute('aria-invalid', 'true');
  }
  (el.querySelector('[aria-invalid="true"]') || el.querySelector('[data-error]:not([hidden])'))?.focus?.();
}

// ---------- applications: save / status / delete ----------

// Creates or updates an application and keeps its follow-up task in sync.
export function saveApplication(existing, value) {
  const { followUp, ...data } = value;
  const today = todayISO();
  let app;
  if (existing) {
    const patch = { ...data };
    delete patch.status;
    Object.assign(patch, withStatus(existing, data.status)); // adds status + log entry only if it changed
    if (existing.status === 'saved' && data.status !== 'saved' && !data.appliedAt) patch.appliedAt = today;
    app = store.update('applications', existing.id, patch);
  } else {
    if (data.status !== 'saved' && !data.appliedAt) data.appliedAt = today;
    app = store.add('applications', {
      ...data, interviews: [], statusLog: [{ status: data.status, at: nowStamp() }], followUpTaskId: null,
    });
  }

  // Follow-up lives in Tasks, so it shows up in Today and Upcoming with everything else.
  const open = openFollowUp(app);
  let note = '';
  if (followUp) {
    if (open) {
      if (open.due !== followUp || open.title !== followUpTitle(app)) {
        store.update('tasks', open.id, { due: followUp, title: followUpTitle(app) });
      }
    } else {
      const t = store.add('tasks', {
        title: followUpTitle(app), notes: '', area: 'career', due: followUp, priority: 'normal',
        status: 'todo', doneAt: null, repeat: null, nextId: null, links: [], ref: { type: 'application', id: app.id },
      });
      store.update('applications', app.id, { followUpTaskId: t.id });
      note = ' Follow-up added to Tasks.';
    }
  } else if (open) {
    store.trash('tasks', open.id);
    note = ' Follow-up task moved to Trash.';
  }
  return { app: store.get('applications', app.id), note };
}

export function changeStatus(id, status) {
  const app = store.get('applications', id);
  if (!app || app.status === status) return;
  const patch = withStatus(app, status);
  if (app.status === 'saved' && status !== 'saved' && !app.appliedAt) patch.appliedAt = todayISO();
  const before = { status: app.status, statusLog: app.statusLog, appliedAt: app.appliedAt };
  store.update('applications', id, patch);

  const open = openFollowUp(app);
  if (!isActive({ status }) && open) {
    store.trash('tasks', open.id);
    toast(`Moved to ${statusLabel(status)}. Its follow-up task went to Trash.`, {
      action: { label: 'Undo', onClick: () => { store.update('applications', id, before); store.restore('tasks', open.id); } },
    });
  } else {
    toast(`Moved to ${statusLabel(status)}.`, { action: { label: 'Undo', onClick: () => store.update('applications', id, before) } });
  }
}

export function deleteApplication(id) {
  const app = store.get('applications', id);
  if (!app) return;
  const linked = store.all('tasks').filter((t) => t.ref?.id === id && t.status !== 'done');
  store.trash('applications', id);
  for (const t of linked) store.trash('tasks', t.id);
  toast(linked.length ? `Application and ${plural(linked.length, 'follow-up task')} moved to Trash.` : 'Application moved to Trash.', {
    action: { label: 'Undo', onClick: () => { store.restore('applications', id); for (const t of linked) store.restore('tasks', t.id); } },
  });
}

// ---------- application form ----------

export function openApplicationForm({ app = null, defaults = {} } = {}) {
  const today = todayISO();
  const v = app ? structuredClone(app) : {
    company: '', position: '', location: '', workMode: '', source: '', status: 'applied', appliedAt: today,
    salaryMin: null, salaryMax: null, jobDescription: '', requiredSkills: [], notes: '', links: [], ...defaults,
  };
  const follow = app ? openFollowUp(app)?.due ?? '' : '';
  const L = CAREER_LIMITS;

  const body = `
    <form class="form" id="app-form" novalidate>
      <div class="form-grid">
        <label class="field">
          <span class="field__label">Position</span>
          <input class="input" name="position" maxlength="${L.position}" value="${esc(v.position)}" placeholder="e.g. Project Control Engineer" autocomplete="off" autofocus>
          <span class="field__error" data-error="position" hidden></span>
        </label>
        <label class="field">
          <span class="field__label">Company</span>
          <input class="input" name="company" maxlength="${L.company}" value="${esc(v.company)}" placeholder="e.g. PT Contoh Konstruksi" autocomplete="off">
          <span class="field__error" data-error="company" hidden></span>
        </label>
      </div>

      <div class="form-grid">
        <label class="field">
          <span class="field__label">Status</span>
          <select class="input" name="status">
            ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === v.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
          <span class="field__hint" data-status-hint></span>
        </label>
        <label class="field">
          <span class="field__label">Applied on</span>
          <input class="input" type="date" name="appliedAt" value="${esc(v.appliedAt || '')}">
          <span class="field__error" data-error="appliedAt" hidden></span>
        </label>
      </div>

      <div class="form-grid">
        <label class="field">
          <span class="field__label">Location <span class="field__optional">optional</span></span>
          <input class="input" name="location" maxlength="${L.location}" value="${esc(v.location)}" placeholder="e.g. Jakarta Selatan" autocomplete="off">
        </label>
        <label class="field">
          <span class="field__label">Found on <span class="field__optional">optional</span></span>
          <input class="input" name="source" maxlength="${L.source}" value="${esc(v.source)}" list="source-list" placeholder="e.g. LinkedIn" autocomplete="off">
          <datalist id="source-list">${SOURCES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
        </label>
      </div>

      <fieldset class="field">
        <legend class="field__label">Work mode</legend>
        <div class="segmented segmented--wrap">
          ${WORK_MODES.map((m) => `<label class="seg"><input type="radio" name="workMode" value="${m.id}" ${m.id === (v.workMode || '') ? 'checked' : ''}><span>${esc(m.label)}</span></label>`).join('')}
        </div>
      </fieldset>

      <div class="field">
        <span class="field__label">Salary range per month <span class="field__optional">optional, as posted</span></span>
        <div class="form-grid form-grid--tight">
          <label class="field">
            <span class="sr-only">Minimum</span>
            <input class="input" name="salaryMin" inputmode="decimal" value="${v.salaryMin ?? ''}" placeholder="Min, e.g. 8jt" autocomplete="off">
            <span class="field__hint" data-money="salaryMin"></span>
            <span class="field__error" data-error="salaryMin" hidden></span>
          </label>
          <label class="field">
            <span class="sr-only">Maximum</span>
            <input class="input" name="salaryMax" inputmode="decimal" value="${v.salaryMax ?? ''}" placeholder="Max, e.g. 12jt" autocomplete="off">
            <span class="field__hint" data-money="salaryMax"></span>
            <span class="field__error" data-error="salaryMax" hidden></span>
          </label>
        </div>
      </div>

      <label class="field">
        <span class="field__label">Follow up on <span class="field__optional">optional</span></span>
        <input class="input input--date" type="date" name="followUp" value="${esc(follow)}">
        <span class="field__hint">Adds a “Follow up” task to Tasks on this date. Clear it to remove the task.</span>
        <span class="field__error" data-error="followUp" hidden></span>
      </label>

      <label class="field">
        <span class="field__label">Skills this job asks for <span class="field__optional">optional</span></span>
        <textarea class="input" name="requiredSkills" rows="2" placeholder="Separate with commas, e.g. Primavera P6, Cost control, AutoCAD">${esc((v.requiredSkills || []).join(', '))}</textarea>
        <span class="field__hint">Copy them from the job post. louvi compares them with your skill list.</span>
        <span class="field__error" data-error="requiredSkills" hidden></span>
      </label>

      <label class="field">
        <span class="field__label">Job description <span class="field__optional">optional</span></span>
        <textarea class="input" name="jobDescription" rows="5" maxlength="${L.jobDescription}" placeholder="Paste the job description so you still have it after the post is taken down.">${esc(v.jobDescription || '')}</textarea>
        <span class="field__error" data-error="jobDescription" hidden></span>
      </label>

      <label class="field">
        <span class="field__label">Notes <span class="field__optional">optional</span></span>
        <textarea class="input" name="notes" rows="3" maxlength="${L.notes}" placeholder="Contact person, referral, what they asked, your impressions…">${esc(v.notes || '')}</textarea>
        <span class="field__error" data-error="notes" hidden></span>
      </label>

      ${linkFieldHTML({ hint: 'Job post, the CV you sent (Google Drive link), company page…', placeholder: 'Paste a link: job post, CV on Google Drive…' })}
    </form>`;

  const footer = `
    <span class="spacer"></span>
    <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
    <button type="submit" form="app-form" class="btn btn--primary">${app ? 'Save changes' : 'Add application'}</button>`;

  openDialog({
    title: app ? 'Edit application' : 'New application',
    body, footer, size: 'lg', backdropClose: false,
    onMount(el, close) {
      const form = el.querySelector('#app-form');
      const linkEd = mountLinkEditor(el, v.links || []);
      const statusHint = el.querySelector('[data-status-hint]');
      const refreshStatus = () => {
        statusHint.textContent = STATUSES.find((s) => s.id === form.elements.status.value)?.hint || '';
        if (form.elements.status.value !== 'saved' && !form.elements.appliedAt.value && (!app || app.status === 'saved')) {
          form.elements.appliedAt.value = today;
        }
      };
      form.elements.status.addEventListener('change', refreshStatus);
      refreshStatus();

      const moneyPreview = (name) => {
        const out = el.querySelector(`[data-money="${name}"]`);
        const r = parseRupiah(form.elements[name].value);
        out.textContent = r.ok && r.value !== null ? `= ${formatRupiah(r.value)}` : '';
      };
      ['salaryMin', 'salaryMax'].forEach((n) => {
        form.elements[n].addEventListener('input', () => moneyPreview(n));
        moneyPreview(n);
      });

      form.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); form.requestSubmit(); }
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!linkEd.addPending()) return;
        const fd = new FormData(form);
        const res = validateApplicationInput({
          company: fd.get('company'), position: fd.get('position'), location: fd.get('location'),
          workMode: fd.get('workMode') ?? '', source: fd.get('source'), status: fd.get('status'),
          appliedAt: fd.get('appliedAt') || null, salaryMin: fd.get('salaryMin'), salaryMax: fd.get('salaryMax'),
          jobDescription: fd.get('jobDescription'), requiredSkills: parseSkillList(fd.get('requiredSkills')),
          notes: fd.get('notes'), links: linkEd.links, followUp: fd.get('followUp') || null,
        });
        if (!res.ok) { fieldErrors(el, res.errors, form); return; }
        const { app: saved, note } = saveApplication(app, res.value);
        close();
        toast((app ? 'Application updated.' : 'Application added.') + note);
        if (!app) openApplicationDetail(saved.id);
      });
    },
  });
}

// ---------- application detail ----------

function detailHTML(app) {
  const today = todayISO();
  const skills = store.all('skills');
  const match = matchFor(app, skillMap(skills));
  const follow = openFollowUp(app);
  const step = nextStep(app, today, follow);
  const stale = staleDays(app);
  const salary = formatRange(app.salaryMin, app.salaryMax);
  const since = app.appliedAt ? diffDays(app.appliedAt, today) : null;
  const interviews = [...(app.interviews || [])].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

  const facts = [
    app.appliedAt ? ['Applied', `${formatShort(app.appliedAt, today)}${since !== null && since >= 0 ? ` · ${since === 0 ? 'today' : plural(since, 'day') + ' ago'}` : ''}`] : ['Applied', 'Not yet'],
    salary ? ['Salary', `${salary} / month`] : null,
    app.location || app.workMode ? ['Location', [app.location, workModeLabel(app.workMode)].filter(Boolean).join(' · ')] : null,
    app.source ? ['Found on', app.source] : null,
  ].filter(Boolean);

  return `
    <div class="detail">
      <div class="detail__top">
        <label class="field detail__status">
          <span class="field__label">Status</span>
          <select class="input" data-status>
            ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === app.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
        </label>
        <dl class="facts">${facts.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>
      </div>

      ${stale ? `<div class="banner">${icon('clock', 18)}<p>No news for ${stale} days. Still waiting, or mark it as no response?</p>
        <button type="button" class="btn btn--ghost btn--sm" data-act="ghosted">Mark as no response</button></div>` : ''}

      <section class="detail__sec" aria-labelledby="d-next">
        <div class="detail__head"><h3 id="d-next">Next step</h3></div>
        ${step ? `<p class="next-step ${step.kind}">${icon(step.kind === 'interview' ? 'calendar' : 'flag', 18)}<span><strong>${esc(step.label)}</strong> · ${esc(formatLong(step.date))}${step.time ? `, ${esc(step.time)}` : ''}</span></p>`
          : `<p class="muted">Nothing scheduled.${isActive(app) ? ' Add an interview or a follow-up date.' : ''}</p>`}
        <div class="btn-row">
          <button type="button" class="btn btn--ghost btn--sm" data-act="add-interview">${icon('plus', 16)}Interview or test</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="followup">${icon('flag', 16)}${follow ? `Follow-up: ${esc(relativeLabel(follow.due, today))}` : 'Set follow-up'}</button>
        </div>
        <div class="inline-form" data-followup-form hidden>
          <label class="field"><span class="field__label">Follow up on</span>
            <input class="input input--date" type="date" data-followup-date value="${esc(follow?.due || '')}"></label>
          <div class="btn-row">
            <button type="button" class="btn btn--primary btn--sm" data-act="followup-save">Save</button>
            ${follow ? '<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-act="followup-clear">Remove follow-up</button>' : ''}
          </div>
        </div>
      </section>

      <section class="detail__sec" aria-labelledby="d-iv">
        <div class="detail__head"><h3 id="d-iv">Interviews &amp; tests</h3><span class="count">${interviews.length || ''}</span></div>
        ${interviews.length ? `<ul class="iv-list">${interviews.map((iv) => `
          <li><button type="button" class="iv" data-act="edit-interview" data-iv="${esc(iv.id)}">
            <span class="iv__date"><span>${esc(formatShort(iv.date, today))}</span>${iv.time ? `<span class="iv__time">${esc(iv.time)}</span>` : ''}</span>
            <span class="iv__main"><span class="iv__type">${esc(interviewTypeLabel(iv.type))}</span>${iv.notes ? `<span class="iv__notes">${esc(iv.notes)}</span>` : ''}</span>
            <span class="outcome outcome--${esc(iv.outcome)}">${esc(OUTCOMES.find((o) => o.id === iv.outcome)?.label.split(' /')[0] || '')}</span>
          </button></li>`).join('')}</ul>` : '<p class="muted">None yet. Psikotes, MCU and interviews all go here.</p>'}
      </section>

      <section class="detail__sec" aria-labelledby="d-skills">
        <div class="detail__head"><h3 id="d-skills">Skill match</h3>${match.total ? `<span class="count">${match.covered.length} of ${match.total} at Solid or above</span>` : ''}</div>
        ${match.total ? `
          <div class="skill-chips">
            ${match.covered.map((n) => `<span class="schip schip--ok" title="You have this at Solid or above">${icon('check', 14)}${esc(n)}</span>`).join('')}
            ${match.weak.map((w) => `<button type="button" class="schip schip--weak" data-act="skill" data-name="${esc(w.name)}" title="Your level: ${esc(levelLabel(w.level))}">${esc(w.name)} <span>${esc(levelLabel(w.level))}</span></button>`).join('')}
            ${match.missing.map((n) => `<button type="button" class="schip schip--missing" data-act="skill" data-name="${esc(n)}" title="Not in your skill list. Add it if you have it.">${icon('plus', 14)}${esc(n)}</button>`).join('')}
          </div>
          ${match.missing.length ? '<p class="field__hint">Dashed skills aren\'t in your list. Tap one to add it, but only if you really have it.</p>' : ''}`
          : '<p class="muted">Add the skills this job asks for (Edit) to see how well you match.</p>'}
      </section>

      ${app.jobDescription ? `<details class="detail__sec jd"><summary>Job description</summary><div class="prewrap">${esc(app.jobDescription)}</div></details>` : ''}
      ${app.notes ? `<section class="detail__sec"><div class="detail__head"><h3>Notes</h3></div><div class="prewrap">${esc(app.notes)}</div></section>` : ''}
      ${app.links?.length ? `<section class="detail__sec"><div class="detail__head"><h3>Links</h3></div>${linkListHTML(app.links)}</section>` : ''}
    </div>`;
}

export function openApplicationDetail(id) {
  const app = store.get('applications', id);
  if (!app || app.deletedAt) { toast('That application is no longer available.'); return; }
  const titleOf = (a) => `${a.position}`;
  let unsubscribe = () => {};

  const { el, close } = openDialog({
    title: titleOf(app),
    size: 'lg',
    body: '',
    footer: `
      <button type="button" class="btn btn--ghost btn--danger-text" data-act="delete">${icon('trash', 16)}Delete</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn--primary" data-act="edit">Edit</button>`,
    onClose: () => unsubscribe(),
    onMount(dlg, closeFn) {
      const bodyEl = dlg.querySelector('.dialog__body');
      const titleEl = dlg.querySelector('.dialog__title');
      const sub = document.createElement('p');
      sub.className = 'dialog__sub';
      titleEl.after(sub);
      const head = dlg.querySelector('.dialog__head');
      const wrap = document.createElement('div');
      wrap.className = 'dialog__titles';
      head.prepend(wrap);
      wrap.append(titleEl, sub);

      const render = () => {
        const cur = store.get('applications', id);
        if (!cur || cur.deletedAt) { closeFn(); return; }
        titleEl.textContent = titleOf(cur);
        sub.textContent = cur.company;
        const scroll = bodyEl.scrollTop;
        bodyEl.innerHTML = detailHTML(cur);
        bodyEl.scrollTop = scroll;
      };
      render();
      unsubscribe = store.subscribe(render);

      dlg.addEventListener('change', (ev) => {
        if (ev.target.matches('[data-status]')) changeStatus(id, ev.target.value);
      });
      dlg.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        const cur = store.get('applications', id);
        switch (b.dataset.act) {
          case 'edit': openApplicationForm({ app: cur }); break;
          case 'delete': {
            const ok = await confirmDialog({
              title: 'Delete this application?',
              message: `“${esc(cur.position)}” at ${esc(cur.company)} moves to Trash, with any open follow-up task. You can restore it for 30 days.`,
              confirmLabel: 'Move to Trash', danger: true,
            });
            if (ok) { closeFn(); deleteApplication(id); }
            break;
          }
          case 'ghosted': changeStatus(id, 'ghosted'); break;
          case 'add-interview': openInterviewForm(id); break;
          case 'edit-interview': openInterviewForm(id, b.dataset.iv); break;
          case 'followup': {
            const f = dlg.querySelector('[data-followup-form]');
            f.hidden = !f.hidden;
            if (!f.hidden) dlg.querySelector('[data-followup-date]').focus();
            break;
          }
          case 'followup-save': {
            const date = dlg.querySelector('[data-followup-date]').value;
            if (!date) { toast('Pick a date first.'); return; }
            const { note } = saveApplication(cur, { ...pick(cur), followUp: date });
            toast(note.trim() || 'Follow-up date updated.');
            break;
          }
          case 'followup-clear': {
            const { note } = saveApplication(cur, { ...pick(cur), followUp: null });
            toast(note.trim() || 'Follow-up removed.');
            break;
          }
          case 'skill': openSkillForm({ defaults: { name: b.dataset.name } }); break;
        }
      });
    },
  });
  return { el, close };
}

// The editable fields of an application, for re-saving without the form.
function pick(app) {
  const { company, position, location, workMode, source, status, appliedAt, salaryMin, salaryMax, jobDescription, requiredSkills, notes, links } = app;
  return { company, position, location, workMode, source, status, appliedAt, salaryMin, salaryMax, jobDescription, requiredSkills, notes, links };
}

// ---------- interviews ----------

export function openInterviewForm(appId, interviewId = null) {
  const app = store.get('applications', appId);
  if (!app) return;
  const existing = interviewId ? (app.interviews || []).find((i) => i.id === interviewId) : null;
  const v = existing || { date: todayISO(), time: '', type: app.interviews?.length ? 'user' : 'hr', outcome: 'upcoming', notes: '' };

  const body = `
    <form class="form" id="iv-form" novalidate>
      <p class="muted">${esc(app.position)} · ${esc(app.company)}</p>
      <label class="field">
        <span class="field__label">Type</span>
        <select class="input" name="type">${INTERVIEW_TYPES.map((t) => `<option value="${t.id}" ${t.id === v.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      </label>
      <div class="form-grid">
        <label class="field">
          <span class="field__label">Date</span>
          <input class="input" type="date" name="date" value="${esc(v.date)}">
          <span class="field__error" data-error="date" hidden></span>
        </label>
        <label class="field">
          <span class="field__label">Time <span class="field__optional">optional</span></span>
          <input class="input" type="time" name="time" value="${esc(v.time)}">
          <span class="field__error" data-error="time" hidden></span>
        </label>
      </div>
      <fieldset class="field">
        <legend class="field__label">Result</legend>
        <div class="segmented segmented--wrap">${OUTCOMES.map((o) => `<label class="seg"><input type="radio" name="outcome" value="${o.id}" ${o.id === v.outcome ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>
      </fieldset>
      <label class="field">
        <span class="field__label">Notes <span class="field__optional">optional</span></span>
        <textarea class="input" name="notes" rows="3" maxlength="${CAREER_LIMITS.interviewNotes}" placeholder="Who you met, what they asked, what to prepare…">${esc(v.notes)}</textarea>
        <span class="field__error" data-error="notes" hidden></span>
      </label>
    </form>`;

  openDialog({
    title: existing ? 'Edit interview or test' : 'Add interview or test',
    body, backdropClose: false,
    footer: `
      ${existing ? `<button type="button" class="btn btn--ghost btn--danger-text" data-remove>${icon('trash', 16)}Remove</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
      <button type="submit" form="iv-form" class="btn btn--primary">${existing ? 'Save' : 'Add'}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#iv-form');
      el.querySelector('[data-remove]')?.addEventListener('click', () => {
        const cur = store.get('applications', appId);
        const before = cur.interviews;
        store.update('applications', appId, { interviews: before.filter((i) => i.id !== interviewId) });
        close();
        toast('Interview removed.', { action: { label: 'Undo', onClick: () => store.update('applications', appId, { interviews: before }) } });
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const res = validateInterviewInput({ date: fd.get('date'), time: fd.get('time'), type: fd.get('type'), outcome: fd.get('outcome'), notes: fd.get('notes') });
        if (!res.ok) { fieldErrors(el, res.errors, form); return; }
        const cur = store.get('applications', appId);
        const list = [...(cur.interviews || [])];
        if (existing) {
          const i = list.findIndex((x) => x.id === interviewId);
          if (i >= 0) list[i] = { ...list[i], ...res.value };
        } else {
          if (list.length >= CAREER_LIMITS.interviews) { toast(`An application can hold up to ${CAREER_LIMITS.interviews} interviews.`); return; }
          list.push({ id: uid(), ...res.value });
        }
        const patch = { interviews: list };
        let moved = false;
        if (!existing && ['saved', 'applied', 'screening'].includes(cur.status)) {
          Object.assign(patch, withStatus(cur, 'interview'));
          if (!cur.appliedAt) patch.appliedAt = todayISO();
          moved = true;
        }
        const beforeStatus = { status: cur.status, statusLog: cur.statusLog };
        store.update('applications', appId, patch);
        close();
        if (moved) {
          toast('Interview added. Status moved to Interviewing.', { action: { label: 'Keep old status', onClick: () => store.update('applications', appId, beforeStatus) } });
        } else {
          toast(existing ? 'Interview updated.' : 'Interview added.');
        }
      });
    },
  });
}

// ---------- skills ----------

export function openSkillForm({ skill = null, defaults = {} } = {}) {
  const all = store.all('skills');
  // If the name already exists (e.g. tapped from a gap), edit that one instead.
  if (!skill && defaults.name) {
    const found = skillMap(all).get(defaults.name.trim().toLowerCase().replace(/\s+/g, ' '));
    if (found) skill = found;
  }
  const v = skill || { name: '', level: 0, category: 'technical', notes: '', ...defaults };
  const demand = demandFor(store.all('applications')).get((v.name || '').trim().toLowerCase().replace(/\s+/g, ' ')) || 0;

  const body = `
    <form class="form" id="skill-form" novalidate>
      <label class="field">
        <span class="field__label">Skill</span>
        <input class="input" name="name" maxlength="${CAREER_LIMITS.skillName}" value="${esc(v.name)}" placeholder="e.g. Primavera P6" autocomplete="off" ${v.name ? '' : 'autofocus'}>
        ${demand ? `<span class="field__hint">Asked for in ${plural(demand, 'active application')}.</span>` : ''}
        <span class="field__error" data-error="name" hidden></span>
      </label>
      <fieldset class="field">
        <legend class="field__label">Your honest level</legend>
        <div class="levels">
          ${SKILL_LEVELS.map((l) => `
            <label class="level">
              <input type="radio" name="level" value="${l.id}" ${l.id === v.level ? 'checked' : ''}>
              <span class="level__box"><span class="level__dots">${'●'.repeat(l.id)}${'○'.repeat(5 - l.id)}</span>
                <span class="level__name">${esc(l.label)}</span><span class="level__hint">${esc(l.hint)}</span></span>
            </label>`).join('')}
        </div>
        <span class="field__error" data-error="level" hidden></span>
      </fieldset>
      <label class="field">
        <span class="field__label">Category</span>
        <select class="input" name="category">${SKILL_CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === v.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      </label>
      <label class="field">
        <span class="field__label">Proof or notes <span class="field__optional">optional</span></span>
        <textarea class="input" name="notes" rows="2" maxlength="1000" placeholder="Where you used it, a course, a certificate…">${esc(v.notes || '')}</textarea>
      </label>
    </form>`;

  openDialog({
    title: skill ? 'Edit skill' : 'Add skill',
    body, backdropClose: false,
    footer: `
      ${skill ? `<button type="button" class="btn btn--ghost btn--danger-text" data-remove>${icon('trash', 16)}Delete</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
      <button type="submit" form="skill-form" class="btn btn--primary">${skill ? 'Save' : 'Add skill'}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#skill-form');
      if (v.name) form.querySelector('input[name="level"]')?.focus();
      el.querySelector('[data-remove]')?.addEventListener('click', () => {
        store.trash('skills', skill.id);
        close();
        toast('Skill moved to Trash.', { action: { label: 'Undo', onClick: () => store.restore('skills', skill.id) } });
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const res = validateSkillInput({ name: fd.get('name'), level: fd.get('level'), category: fd.get('category'), notes: fd.get('notes') }, store.all('skills'), skill?.id ?? null);
        if (!res.ok) { fieldErrors(el, res.errors, form); return; }
        if (skill) store.update('skills', skill.id, res.value);
        else store.add('skills', res.value);
        close();
        toast(skill ? 'Skill updated.' : 'Skill added.');
      });
    },
  });
}

// ---------- import from a spreadsheet (CSV) ----------

export function openApplicationImport() {
  openDialog({
    title: 'Import applications',
    size: 'lg',
    backdropClose: false,
    body: '<div data-import></div>',
    footer: '<span class="spacer"></span><button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button><button type="button" class="btn btn--primary" data-confirm-import hidden></button>',
    async onMount(el, close) {
      const { prepareImport, FIELD_LABELS } = await import('../lib/career-import.js');
      const host = el.querySelector('[data-import]');
      const confirmBtn = el.querySelector('[data-confirm-import]');
      let prepared = null, fileName = '';

      const pick = () => {
        prepared = null;
        confirmBtn.hidden = true;
        host.innerHTML = `
          <div class="form">
            <ol class="steps">
              <li>In Google Sheets, open your tracker and choose <strong>File → Download → Comma-separated values (.csv)</strong>. Excel: <strong>Save As → CSV</strong>.</li>
              <li>Choose that file here. louvi shows what it found before adding anything.</li>
            </ol>
            <label class="btn btn--primary file-btn" style="align-self:flex-start">${icon('upload', 18)}Choose CSV file
              <input type="file" accept=".csv,text/csv,.txt" id="import-file" class="sr-only"></label>
            <details class="paste-box"><summary>Or paste the rows (copy from the sheet)</summary>
              <textarea class="input mono" rows="6" id="import-text" placeholder="Paste here, including the header row"></textarea>
              <button type="button" class="btn btn--ghost btn--sm" data-check-paste>Check</button>
            </details>
            <p class="field__hint">Columns it understands: date applied, platform/source, link, company, location, position, progress, final status, notes. Indonesian or English headers both work.</p>
            <p class="field__error" data-import-error role="alert" hidden></p>
          </div>`;
        host.querySelector('#import-file').addEventListener('change', async (ev) => {
          const f = ev.target.files?.[0];
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) { showError('This file is too large (over 5 MB).'); return; }
          fileName = f.name;
          check(await f.text());
        });
        host.querySelector('[data-check-paste]').addEventListener('click', () => {
          fileName = 'pasted rows';
          // Rows copied from a sheet are tab-separated; the CSV reader detects that.
          check(host.querySelector('#import-text').value);
        });
      };
      const showError = (msg) => { const e = host.querySelector('[data-import-error]'); if (e) { e.textContent = msg; e.hidden = !msg; } };

      const check = (text) => {
        const res = prepareImport(text, store.all('applications'), { today: todayISO() });
        if (!res.ok) { showError(res.error); return; }
        if (!res.rows.length) { showError(res.duplicates ? `All ${plural(res.duplicates, 'row')} are already in louvi. Nothing new to add.` : 'No applications found in this file.'); return; }
        prepared = res;
        renderPreview();
      };

      const renderPreview = () => {
        const markStale = host.querySelector('#mark-stale')?.checked ?? true;
        const statusOf = (r) => (markStale && r.stale ? 'ghosted' : r.value.status);
        const counts = {};
        for (const r of prepared.rows) counts[statusOf(r)] = (counts[statusOf(r)] || 0) + 1;
        const noDate = prepared.rows.filter((r) => !r.value.appliedAt).length;
        host.innerHTML = `
          <div class="form">
            <p><strong>${plural(prepared.rows.length, 'application')}</strong> found in ${esc(fileName)}.</p>
            <div class="field">
              <span class="field__label">Columns matched</span>
              <div class="skill-chips">${prepared.columns.map((c) => `<span class="schip schip--ok">${esc(c.header)} → ${esc(FIELD_LABELS[c.field])}</span>`).join('')}
                ${prepared.ignored.map((h) => `<span class="schip schip--missing" title="Not imported">${esc(h)} (ignored)</span>`).join('')}</div>
            </div>
            <div class="field">
              <span class="field__label">Status after import</span>
              <div class="skill-chips">${STATUSES.filter((s) => counts[s.id]).map((s) => `${statusPill(s.id)} <span class="muted">${counts[s.id]}</span>`).join(' ')}</div>
            </div>
            ${prepared.staleCount ? `<label class="check-row"><input type="checkbox" id="mark-stale" ${markStale ? 'checked' : ''}>
              <span>Mark the <strong>${prepared.staleCount}</strong> applications that are still waiting after more than 90 days as <strong>No response</strong>. They'll show under Closed instead of filling your active list. Untick to keep their sheet status.</span></label>` : ''}
            <ul class="preview__notes">
              ${prepared.duplicates ? `<li>${plural(prepared.duplicates, 'row')} skipped: already in louvi or repeated in the file.</li>` : ''}
              ${prepared.skipped.map((s) => `<li>Row ${s.line} skipped: ${esc(s.reason)}.</li>`).join('')}
              ${noDate ? `<li>${plural(noDate, 'application')} without a readable date; the original text is kept in notes.</li>` : ''}
              <li>Your sheet's progress and final status are kept in each application's notes.</li>
            </ul>
            <div class="table-wrap">
              <table class="ytable import-table">
                <thead><tr><th scope="col">Applied</th><th scope="col">Company</th><th scope="col">Position</th><th scope="col">Status</th></tr></thead>
                <tbody>${prepared.rows.slice(0, 8).map((r) => `<tr><td>${r.value.appliedAt ? esc(formatShort(r.value.appliedAt, todayISO())) : '–'}</td><td>${esc(r.value.company)}</td><td>${esc(r.value.position)}</td><td>${statusPill(statusOf(r))}</td></tr>`).join('')}</tbody>
              </table>
            </div>
            ${prepared.rows.length > 8 ? `<p class="muted">and ${prepared.rows.length - 8} more.</p>` : ''}
            <button type="button" class="link-btn" data-back style="align-self:flex-start">Choose a different file</button>
          </div>`;
        host.querySelector('#mark-stale')?.addEventListener('change', renderPreview);
        host.querySelector('[data-back]').addEventListener('click', pick);
        confirmBtn.hidden = false;
        confirmBtn.textContent = `Add ${plural(prepared.rows.length, 'application')}`;
      };

      confirmBtn.addEventListener('click', () => {
        if (!prepared) return;
        const markStale = host.querySelector('#mark-stale')?.checked ?? false;
        const now = nowStamp();
        const list = prepared.rows.map((r) => {
          const at = r.value.appliedAt ? `${r.value.appliedAt}T00:00:00.000Z` : now;
          const log = [{ status: r.value.status, at }];
          let status = r.value.status;
          if (markStale && r.stale) { status = 'ghosted'; log.push({ status, at: now }); }
          return { ...r.value, status, statusLog: log, interviews: [], followUpTaskId: null };
        });
        const added = store.addMany('applications', list);
        close();
        toast(`${plural(added.length, 'application')} imported.`, {
          duration: 10000,
          action: { label: 'Undo', onClick: () => { store.trashMany('applications', added.map((a) => a.id)); toast('Import undone. The applications are in Trash.'); } },
        });
      });

      pick();
    },
  });
}
