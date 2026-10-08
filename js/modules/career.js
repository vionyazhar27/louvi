// Career page: job applications and skills.

import * as store from '../store.js';
import { esc, plural } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { todayISO, relativeLabel, addDays } from '../lib/dates.js';
import { formatRange } from '../lib/money.js';
import {
  STATUSES, isActive, statusLabel, workModeLabel, skillMap, matchFor, nextStep, staleDays, compareApplications,
  matchesAppSearch, countByStatus, gapSummary, demandFor, SKILL_CATEGORIES, levelLabel, skillKey,
} from '../lib/career.js';
import {
  openApplicationForm, openApplicationDetail, openSkillForm, followUpTaskFor, statusPill, nextStepText, openApplicationImport,
} from './career-actions.js';

export const title = 'Career';

const state = { tab: 'applications', filter: 'active', status: 'all', query: '' };

export function setCareerFilters(patch) {
  Object.assign(state, patch);
}

export function mount(root) {
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 class="page-title">Career</h1>
        <p class="page-sub" data-summary></p>
      </div>
      <div class="btn-row hide-mobile" data-head-actions></div>
    </header>
    <div class="segmented segmented--tabs" role="tablist" aria-label="Career sections" data-tabs></div>
    <div class="career-body" data-body></div>`;

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const a = el.dataset.action;
    if (a === 'tab') { state.tab = el.dataset.value; render(); }
    if (a === 'new-app') openApplicationForm();
    if (a === 'import') openApplicationImport();
    if (a === 'new-skill') openSkillForm();
    if (a === 'open-app') openApplicationDetail(el.dataset.id);
    if (a === 'filter') { state.filter = el.dataset.value; state.status = 'all'; render(); }
    if (a === 'status') { state.status = state.status === el.dataset.value ? 'all' : el.dataset.value; if (state.status !== 'all') state.filter = isActive({ status: state.status }) ? 'active' : 'closed'; render(); }
    if (a === 'edit-skill') { const s = store.get('skills', el.dataset.id); if (s) openSkillForm({ skill: s }); }
    if (a === 'gap') openSkillForm({ defaults: { name: el.dataset.name } });
    if (a === 'clear-search') { state.query = ''; render(); }
  });

  function render() {
    const apps = store.all('applications');
    const skills = store.all('skills');
    const active = apps.filter(isActive);
    const today = todayISO();
    const weekEnd = addDays(today, 7);
    const ivWeek = active.reduce((n, a) => n + (a.interviews || []).filter((i) => i.outcome === 'upcoming' && i.date >= today && i.date <= weekEnd).length, 0);

    root.querySelector('[data-summary]').textContent = apps.length
      ? `${plural(active.length, 'active application')}${ivWeek ? ` · ${plural(ivWeek, 'interview')} in the next 7 days` : ''}`
      : 'Job applications and the skills they ask for';

    root.querySelector('[data-head-actions]').innerHTML = state.tab === 'applications'
      ? `<button type="button" class="btn btn--primary" data-action="new-app">${icon('plus', 18)}New application</button>`
      : `<button type="button" class="btn btn--primary" data-action="new-skill">${icon('plus', 18)}Add skill</button>`;

    root.querySelector('[data-tabs]').innerHTML = [['applications', 'Applications', apps.length], ['skills', 'Skills', skills.length]]
      .map(([id, label, n]) => `<button type="button" class="seg-btn ${state.tab === id ? 'is-active' : ''}" role="tab" aria-selected="${state.tab === id}"
        data-action="tab" data-value="${id}">${label}<span class="count">${n}</span></button>`).join('');

    const body = root.querySelector('[data-body]');
    if (state.tab === 'skills') body.innerHTML = skillsHTML(apps, skills);
    else renderApplications(body, apps, skills, today);
  }

  function renderApplications(body, apps, skills, today) {
    if (!apps.length) {
      body.innerHTML = `
        <div class="empty">
          <div class="empty__icon">${icon('briefcase', 28)}</div>
          <h2 class="empty__title">No applications yet</h2>
          <p class="empty__text">Add each job you apply for, or save one you're interested in. Track interviews and follow-ups, and see which skills keep coming up.</p>
          <div class="btn-row">
            <button type="button" class="btn btn--primary" data-action="new-app">${icon('plus', 18)}Add your first application</button>
            <button type="button" class="btn btn--ghost" data-action="import">${icon('upload', 18)}Import from a spreadsheet</button>
          </div>
        </div>`;
      return;
    }
    const counts = countByStatus(apps);
    const searchFocused = document.activeElement?.id === 'app-search';
    const caret = searchFocused ? document.activeElement.selectionStart : null;

    const activeStatuses = STATUSES.filter((s) => s.group === 'active');
    const closedStatuses = STATUSES.filter((s) => s.group === 'closed');
    const pipeline = (state.filter === 'closed' ? closedStatuses : activeStatuses);

    const byKey = skillMap(skills);
    let list = apps.filter((a) =>
      (state.filter === 'all' || (state.filter === 'active') === isActive(a)) &&
      (state.status === 'all' || a.status === state.status) &&
      matchesAppSearch(a, state.query));
    list.sort(compareApplications);

    body.innerHTML = `
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Show">
          ${[['active', 'Active'], ['closed', 'Closed'], ['all', 'All']].map(([id, label]) =>
            `<button type="button" class="seg-btn ${state.filter === id ? 'is-active' : ''}" aria-pressed="${state.filter === id}" data-action="filter" data-value="${id}">${label}</button>`).join('')}
        </div>
        <div class="btn-row">
          <label class="search">${icon('search', 18)}<span class="sr-only">Search applications</span>
            <input class="input" type="search" id="app-search" placeholder="Search company, role, skill" value="${esc(state.query)}"></label>
          <button type="button" class="btn btn--ghost btn--sm" data-action="import">${icon('upload', 16)}Import</button>
        </div>
      </div>
      ${state.filter !== 'all' ? `<div class="pipeline" role="group" aria-label="Filter by status">
        ${pipeline.map((s) => `<button type="button" class="stage ${state.status === s.id ? 'is-active' : ''}" aria-pressed="${state.status === s.id}" data-action="status" data-value="${s.id}">
          <span class="stage__n">${counts[s.id]}</span><span class="stage__label">${esc(s.label)}</span></button>`).join('')}
      </div>` : ''}
      ${list.length ? `<ul class="app-list">${list.map((a) => appRow(a, byKey, today)).join('')}</ul>` : `
        <div class="empty empty--compact">
          <p class="empty__title">${state.query ? `No applications match “${esc(state.query)}”.` : state.status !== 'all' ? `Nothing in ${esc(statusLabel(state.status))}.` : `No ${state.filter} applications.`}</p>
          ${state.query ? '<button type="button" class="btn btn--ghost btn--sm" data-action="clear-search">Clear search</button>' : ''}
        </div>`}`;

    const search = body.querySelector('#app-search');
    search.addEventListener('input', () => { state.query = search.value; render(); });
    if (searchFocused) { search.focus(); search.setSelectionRange(caret, caret); }
  }

  function appRow(a, byKey, today) {
    const step = nextStep(a, today, followUpTaskFor(a));
    const match = matchFor(a, byKey);
    const salary = formatRange(a.salaryMin, a.salaryMax);
    const stale = staleDays(a);
    const place = [a.location, workModeLabel(a.workMode)].filter(Boolean).join(' · ');
    return `
      <li><button type="button" class="app" data-action="open-app" data-id="${esc(a.id)}">
        <span class="app__main">
          <span class="app__title">${esc(a.position)}</span>
          <span class="app__company">${esc(a.company)}${place ? ` · ${esc(place)}` : ''}</span>
          <span class="app__meta">
            ${statusPill(a.status)}
            ${step ? `<span class="meta ${step.date === today ? 'meta--today' : ''}">${icon(step.kind === 'interview' ? 'calendar' : 'flag', 14)}${esc(nextStepText(step, today))}</span>` : ''}
            ${stale ? `<span class="meta meta--warn">${icon('clock', 14)}No news for ${stale} days</span>` : ''}
            ${a.appliedAt && !step && !stale && isActive(a) && a.status !== 'saved' ? `<span class="meta">Applied ${esc(relativeLabel(a.appliedAt, today))}</span>` : ''}
            ${salary ? `<span class="meta">${esc(salary)}</span>` : ''}
          </span>
        </span>
        ${match.pct !== null ? `<span class="match" title="${match.covered.length} of ${match.total} required skills at Solid or above"><span class="match__pct">${match.pct}%</span><span class="match__label">match</span></span>` : ''}
      </button></li>`;
  }

  function skillsHTML(apps, skills) {
    const gaps = gapSummary(apps, skills);
    const demand = demandFor(apps);
    const intro = '<p class="s-text">Rate yourself honestly. louvi only shows skills you add yourself, and compares them with what your active applications ask for.</p>';

    const gapCard = `
      <section class="card" aria-labelledby="h-gaps">
        <header class="card__head"><h2 class="card__title" id="h-gaps">Worth improving</h2></header>
        ${gaps.length ? `<p class="card__sub">Skills your active applications ask for that you don't have yet, or have below Solid.</p>
          <ul class="gap-list">${gaps.slice(0, 12).map((g) => `
            <li><button type="button" class="gap" data-action="gap" data-name="${esc(g.name)}">
              <span class="gap__name">${esc(g.name)}</span>
              <span class="gap__level">${g.level ? esc(levelLabel(g.level)) : 'Not in your list'}</span>
              <span class="gap__count">${plural(g.appIds.length, 'application')}</span>
            </button></li>`).join('')}</ul>`
          : `<p class="muted">${apps.some(isActive) ? 'No gaps: your skills cover what your active applications ask for, or they have no skills listed yet.' : 'Add active applications with their required skills to see what to work on.'}</p>`}
      </section>`;

    if (!skills.length) {
      return `<div class="stack">${intro}${gapCard}
        <div class="empty empty--compact">
          <p class="empty__title">Your skill list is empty</p>
          <p class="empty__text">Add the skills you actually use: software, technical, management, languages.</p>
          <button type="button" class="btn btn--primary btn--sm" data-action="new-skill">${icon('plus', 16)}Add a skill</button>
        </div></div>`;
    }

    const groups = SKILL_CATEGORIES.map((c) => ({ ...c, items: skills.filter((s) => s.category === c.id).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)) }))
      .filter((g) => g.items.length);

    return `<div class="stack">${intro}${gapCard}
      ${groups.map((g) => `
        <div class="group">
          <h2 class="group__label">${esc(g.label)} <span class="group__count">${g.items.length}</span></h2>
          <ul class="skill-list">${g.items.map((s) => {
            const d = demand.get(skillKey(s.name)) || 0;
            return `<li><button type="button" class="skill" data-action="edit-skill" data-id="${esc(s.id)}">
              <span class="skill__name">${esc(s.name)}</span>
              ${d ? `<span class="skill__demand">${plural(d, 'application')}</span>` : ''}
              <span class="skill__level"><span class="dots" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= s.level ? 'on' : ''}"></span>`).join('')}</span>${esc(levelLabel(s.level))}</span>
            </button></li>`;
          }).join('')}</ul>
        </div>`).join('')}
    </div>`;
  }

  render();
  return {
    refresh: render,
    newTask: () => (state.tab === 'skills' ? openSkillForm() : openApplicationForm()),
  };
}
