// Home: what needs attention today, what's coming, and how each area of life is doing.
// Interviews from Career show up next to tasks; later stages add finance and thesis cards.

import * as store from '../store.js';
import { AREAS } from '../schema.js';
import { esc, plural } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { todayISO, formatLong, addDays, relativeLabel, startOfWeek, formatShort, weekday, WEEKDAY_SHORT, parseISO } from '../lib/dates.js';
import { isOpen, isOverdue, compareTasks, countsByArea, doneSince } from '../lib/tasks.js';
import { taskRow, toggleTask, openTaskForm, addSampleTasks, removeSampleTasks, hasSamples } from './task-ui.js';
import { downloadBackup, needsBackupReminder } from './data-tools.js';
import { setFilters } from './tasks.js';
import { STATUSES, isActive, interviewTypeLabel, countByStatus, gapSummary } from '../lib/career.js';
import { openApplicationDetail } from './career-actions.js';
import { latestSnapshot, snapshotTotals, netWorthSeries, monthTotals, goalProgress, monthLabel, monthName, monthOf } from '../lib/finance.js';
import { formatRupiah, formatRupiahShort } from '../lib/money.js';
import { setFinanceTab } from './finance.js';

export const title = 'Home';

const TODAY_LIMIT = 8;
const AHEAD_DAYS = 14;

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function mount(root, { navigate }) {
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const id = el.closest('[data-id]')?.dataset.id;
    switch (el.dataset.action) {
      case 'new': openTaskForm({ defaults: { due: todayISO() } }); break;
      case 'toggle': if (id) toggleTask(id); break;
      case 'edit': { const t = id && store.get('tasks', id); if (t) openTaskForm({ task: t }); break; }
      case 'samples': addSampleTasks(); break;
      case 'remove-samples': removeSampleTasks(); break;
      case 'backup': downloadBackup(); break;
      case 'open-app': openApplicationDetail(el.dataset.app); break;
      case 'go-career': navigate('career'); break;
      case 'go-finance': setFinanceTab(el.dataset.tab || 'overview'); navigate('finance'); break;
      case 'go-tasks':
        setFilters({ view: el.dataset.view || 'today', area: el.dataset.area || 'all', query: '' });
        navigate('tasks');
        break;
    }
  });

  function refresh() {
    const today = todayISO();
    const name = store.settings().name;
    const tasks = store.all('tasks');
    const open = tasks.filter(isOpen);
    const overdue = open.filter((t) => isOverdue(t, today)).sort(compareTasks);
    const dueToday = open.filter((t) => t.due === today).sort(compareTasks);
    const focus = [...overdue, ...dueToday];
    const horizon = addDays(today, AHEAD_DAYS);
    const ahead = open.filter((t) => t.due && t.due > today && t.due <= horizon).sort(compareTasks);
    const doneWeek = doneSince(tasks, startOfWeek(today));
    const apps = store.all('applications');
    const interviews = [];
    for (const a of apps.filter(isActive)) {
      for (const iv of a.interviews || []) {
        if (iv.outcome === 'upcoming' && iv.date >= today && iv.date <= horizon) interviews.push({ ...iv, app: a });
      }
    }
    interviews.sort((x, y) => (x.date + (x.time || '99')).localeCompare(y.date + (y.time || '99')));
    const ivToday = interviews.filter((i) => i.date === today);

    const summary = [];
    summary.push(dueToday.length ? `${plural(dueToday.length, 'task')} due today` : 'Nothing due today');
    if (overdue.length) summary.push(`<span class="text-warn">${overdue.length} overdue</span>`);
    if (ivToday.length) summary.push(`<strong>${plural(ivToday.length, 'interview')} today</strong>`);
    if (doneWeek) summary.push(`${doneWeek} done this week`);

    const banners = [];
    if (hasSamples()) {
      banners.push(`<div class="banner banner--soft">${icon('sparkle', 18)}<p>These are example tasks so you can try things out.</p><button type="button" class="btn btn--ghost btn--sm" data-action="remove-samples">Remove examples</button></div>`);
    }
    if (needsBackupReminder()) {
      const last = store.settings().lastExportAt;
      banners.push(`<div class="banner">${icon('shield', 18)}<p>${last ? 'It has been over two weeks since your last backup.' : "You haven't downloaded a backup yet."} Your data only lives in this browser until you do.</p><button type="button" class="btn btn--ghost btn--sm" data-action="backup">${icon('download', 16)}Download backup</button></div>`);
    }

    const head = `
      <header class="page-head page-head--home">
        <div>
          <p class="eyebrow">${esc(formatLong(today))}</p>
          <h1 class="page-title">${esc(greeting())}${name ? `, ${esc(name)}` : ''}</h1>
          ${tasks.length || apps.length ? `<p class="page-sub">${summary.join(' · ')}</p>` : ''}
        </div>
        <button type="button" class="btn btn--primary hide-mobile" data-action="new">${icon('plus', 18)}New task</button>
      </header>
      ${banners.join('')}`;

    if (!tasks.length && !apps.length && !store.all('accounts').length) {
      root.innerHTML = head + `
        <section class="welcome card">
          <h2 class="welcome__title">Start with this week</h2>
          <p class="welcome__text">Add the things you need to get done this week, from work reports to thesis revisions to errands. louvi sorts them by date and area and shows today's on this page.</p>
          <div class="welcome__actions">
            <button type="button" class="btn btn--primary" data-action="new">${icon('plus', 18)}Add your first task</button>
            <button type="button" class="btn btn--ghost" data-action="samples">${icon('sparkle', 16)}Try with example tasks</button>
          </div>
          <p class="welcome__foot">Moving from another device? <a href="#settings">Restore a backup</a> in Settings.</p>
        </section>`;
      return;
    }

    const focusList = focus.slice(0, TODAY_LIMIT);
    const todayCard = `
      <section class="card card--today" aria-labelledby="h-today">
        <header class="card__head">
          <h2 class="card__title" id="h-today">Today</h2>
          <button type="button" class="link-btn" data-action="go-tasks" data-view="today">Open list ${icon('arrow', 16)}</button>
        </header>
        ${ivToday.length ? `<ul class="event-list">${ivToday.map((iv) => `
          <li><button type="button" class="event" data-action="open-app" data-app="${esc(iv.app.id)}">
            <span class="event__time">${esc(iv.time || 'Today')}</span>
            <span class="event__main"><span class="event__title">${esc(interviewTypeLabel(iv.type))}</span>
            <span class="event__sub">${esc(iv.app.position)} · ${esc(iv.app.company)}</span></span>
            ${icon('briefcase', 18)}
          </button></li>`).join('')}</ul>` : ''}
        ${focusList.length ? `<ul class="task-list">${focusList.map((t) => taskRow(t, today)).join('')}</ul>` : ivToday.length ? '' : `
          <div class="empty empty--inline">
            <p class="empty__title">You're clear for today.</p>
            <p class="empty__text">${ahead.length ? `Next up: ${esc(ahead[0].title)} (${esc(relativeLabel(ahead[0].due, today))}).` : 'Nothing scheduled in the next two weeks either.'}</p>
          </div>`}
        ${focus.length > TODAY_LIMIT ? `<button type="button" class="link-btn more" data-action="go-tasks" data-view="today">${focus.length - TODAY_LIMIT} more for today</button>` : ''}
      </section>`;

    // Next 14 days, grouped by date.
    const byDate = new Map();
    const push = (day, item) => { if (!byDate.has(day)) byDate.set(day, []); byDate.get(day).push(item); };
    for (const iv of interviews) if (iv.date > today) push(iv.date, { kind: 'interview', iv });
    for (const t of ahead) push(t.due, { kind: 'task', t });
    const days = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const aheadCard = `
      <section class="card" aria-labelledby="h-ahead">
        <header class="card__head">
          <h2 class="card__title" id="h-ahead">Next ${AHEAD_DAYS} days</h2>
          <button type="button" class="link-btn" data-action="go-tasks" data-view="upcoming">All upcoming ${icon('arrow', 16)}</button>
        </header>
        ${days.length ? `<ol class="agenda">${days.slice(0, 7).map(([day, list]) => `
          <li class="agenda__day">
            <div class="agenda__date"><span class="agenda__dow">${esc(WEEKDAY_SHORT[weekday(day)])}</span><span class="agenda__num">${parseISO(day).getDate()}</span></div>
            <ul class="agenda__items">${list.map((item) => item.kind === 'interview' ? `
              <li><button type="button" class="agenda__item agenda__item--event" data-action="open-app" data-app="${esc(item.iv.app.id)}">
                ${icon('briefcase', 14)}<span class="agenda__title">${item.iv.time ? `<span class="agenda__time">${esc(item.iv.time)}</span> ` : ''}${esc(interviewTypeLabel(item.iv.type))} · ${esc(item.iv.app.company)}</span>
              </button></li>` : `
              <li data-id="${esc(item.t.id)}"><button type="button" class="agenda__item" data-action="edit">
                <span class="dot dot--${esc(item.t.area)}" aria-hidden="true"></span><span class="agenda__title">${esc(item.t.title)}</span>
              </button></li>`).join('')}</ul>
          </li>`).join('')}</ol>
          ${days.length > 7 ? `<button type="button" class="link-btn more" data-action="go-tasks" data-view="upcoming">More dates after ${esc(formatShort(days[6][0], today))}</button>` : ''}` : `
          <div class="empty empty--inline"><p class="empty__text">No deadlines in the next ${AHEAD_DAYS} days.</p></div>`}
      </section>`;

    const counts = countsByArea(tasks, AREAS.map((a) => a.id), today);
    const areasCard = `
      <section class="card" aria-labelledby="h-areas">
        <header class="card__head"><h2 class="card__title" id="h-areas">Open by area</h2></header>
        <ul class="area-list">${AREAS.map((a) => {
          const c = counts[a.id];
          return `<li><button type="button" class="area-row" data-action="go-tasks" data-view="open" data-area="${a.id}">
            <span class="dot dot--${a.id}" aria-hidden="true"></span>
            <span class="area-row__name">${esc(a.label)}</span>
            ${c.overdue ? `<span class="area-row__warn">${c.overdue} overdue</span>` : ''}
            <span class="area-row__count">${c.open}</span>
          </button></li>`;
        }).join('')}</ul>
      </section>`;

    let careerCard = '';
    if (apps.length) {
      const counts = countByStatus(apps);
      const activeN = apps.filter(isActive).length;
      const gap = gapSummary(apps, store.all('skills'))[0];
      careerCard = `
        <section class="card" aria-labelledby="h-career">
          <header class="card__head">
            <h2 class="card__title" id="h-career">Job search</h2>
            <button type="button" class="link-btn" data-action="go-career">Open Career ${icon('arrow', 16)}</button>
          </header>
          <p class="card__sub">${plural(activeN, 'active application')}</p>
          <div class="mini-pipeline">${STATUSES.filter((st) => st.group === 'active').map((st) => `
            <div class="mini-stage ${counts[st.id] ? '' : 'is-zero'}"><span class="mini-stage__n">${counts[st.id]}</span><span class="mini-stage__label">${esc(st.label.split(" &")[0])}</span></div>`).join('')}
          </div>
          ${gap ? `<p class="card__note">${icon('star', 16)}<span>Most-requested skill to work on: <strong>${esc(gap.name)}</strong> (${plural(gap.appIds.length, 'application')})</span></p>` : ''}
        </section>`;
    }

    let financeCard = '';
    const accounts = store.all('accounts');
    if (accounts.length) {
      const snaps = store.all('snapshots');
      const latest = latestSnapshot(snaps);
      const series = netWorthSeries(snaps, accounts);
      const prev = series.length >= 2 ? series[series.length - 2] : null;
      const cm = monthOf(today);
      const mt = monthTotals(store.all('transactions'), cm, store.settings().financeCategories);
      const goal = store.all('savingsGoals')
        .map((g) => ({ g, p: goalProgress(g, accounts, snaps, cm) }))
        .filter((x) => x.p.status !== 'achieved')
        .sort((a, b) => (a.g.targetDate || '9999').localeCompare(b.g.targetDate || '9999'))[0];
      const nw = latest ? snapshotTotals(latest, accounts).netWorth : null;
      const change = prev ? nw - prev.netWorth : null;
      financeCard = `
        <section class="card" aria-labelledby="h-fin">
          <header class="card__head">
            <h2 class="card__title" id="h-fin">Money</h2>
            <button type="button" class="link-btn" data-action="go-finance">Open Finance ${icon('arrow', 16)}</button>
          </header>
          ${latest ? `<p class="fin-mini__nw"><span>Net worth</span><strong>${esc(formatRupiah(nw))}</strong>
            ${change !== null ? `<span class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : '−'}${esc(formatRupiahShort(Math.abs(change)) || 'Rp0')} vs ${esc(monthName(prev.month).slice(0, 3))}</span>` : ''}</p>` : ''}
          ${!latest || latest.month < cm ? `<button type="button" class="banner banner--soft banner--btn" data-action="go-finance" data-tab="accounts">${icon('calendar', 16)}<span>Update ${esc(monthName(cm))} balances</span></button>` : ''}
          <p class="muted">${mt.count ? `${esc(monthName(cm))}: spent ${esc(formatRupiahShort(mt.spending) || 'Rp0')}, saved ${esc(formatRupiahShort(mt.saving) || 'Rp0')} (${plural(mt.count, 'transaction')} logged)` : `No transactions logged in ${esc(monthName(cm))} yet.`}</p>
          ${goal ? `<div class="goal-mini"><div class="goal-mini__top"><span class="goal-mini__name">${esc(goal.g.name)}</span><span class="goal-mini__pct">${goal.p.pct}%</span></div>
            <div class="meter" role="progressbar" aria-valuenow="${goal.p.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(goal.g.name)}"><span style="width:${goal.p.pct}%"></span></div>
            <span class="goal-mini__sub">${esc(formatRupiahShort(goal.p.current) || 'Rp0')} of ${esc(formatRupiahShort(goal.p.target))}${goal.g.targetDate ? ` · by ${esc(monthLabel(monthOf(goal.g.targetDate)))}` : ''}</span></div>` : ''}
        </section>`;
    }

    root.innerHTML = head + `
      <div class="home-grid">
        <div class="home-grid__main">${todayCard}${financeCard}${careerCard}</div>
        <div class="home-grid__side">${aheadCard}${areasCard}</div>
      </div>`;
  }

  refresh();
  return { refresh, newTask: () => openTaskForm({ defaults: { due: todayISO() } }) };
}
