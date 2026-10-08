// louvi entry point: loads data, draws the shell, and switches pages.
//
// Adding a page later:
//   1. Create js/modules/<name>.js exporting `title` and `mount(root, ctx)` → { refresh }.
//   2. Add it to ROUTES below and add a nav link in index.html.

import * as store from './store.js';
import * as sync from './sync.js';
import { applyTheme } from './theme.js';
import { icon } from './ui/icons.js';
import { esc } from './ui/dom.js';
import { openTaskForm } from './modules/task-ui.js';
import * as home from './modules/home.js';
import * as tasks from './modules/tasks.js';
import * as settings from './modules/settings.js';
import * as career from './modules/career.js';
import * as finance from './modules/finance.js';

const ROUTES = { home, tasks, career, finance, settings };
const DEFAULT_ROUTE = 'home';

let current = null; // { name, view }
const main = document.getElementById('main');
const viewEl = document.getElementById('view');

function routeFromHash() {
  const name = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES[name] ? name : DEFAULT_ROUTE;
}

export function navigate(name) {
  if (location.hash === '#' + name) render();
  else location.hash = name;
}

function render() {
  const name = routeFromHash();
  const mod = ROUTES[name];
  const page = document.createElement('div');
  page.className = 'page page--' + name;
  viewEl.replaceChildren(page);
  try {
    const view = mod.mount(page, { navigate });
    current = { name, view };
  } catch (e) {
    console.error(e);
    current = null;
    page.innerHTML = `<div class="empty"><h1 class="empty__title">This page couldn't load</h1>
      <p class="empty__text">${esc(e.message || 'Unexpected error')}. Your data is safe. Try reloading the page.</p></div>`;
  }
  document.title = name === DEFAULT_ROUTE ? 'louvi' : `${mod.title} · louvi`;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// Sidebar status line + the red banner for problems that need attention.
function renderStatus() {
  const s = store.getSaveStatus();
  const y = sync.getState();
  const el = document.getElementById('save-status');
  const kind = store.info().storage;
  let text, bad = false;
  if (kind === 'memory') { text = 'Not saved on this device'; bad = true; }
  else if (s.state === 'error') { text = 'Not saved. See Settings'; bad = true; }
  else if (s.state === 'saving') text = 'Saving…';
  else if (y.status === 'syncing') text = 'Syncing…';
  else if (y.status === 'error') { text = 'Sync problem. See Settings'; bad = true; }
  else if (y.status === 'offline') text = 'Saved here · offline';
  else if (y.status === 'synced' || y.status === 'idle') text = 'Saved & synced';
  else text = 'Saved on this device';
  if (el) { el.textContent = text; el.classList.toggle('is-error', bad); }

  const banner = document.getElementById('global-banner');
  const msg = kind === 'memory'
    ? 'This browser is blocking storage, so louvi can\'t save anything here. Open louvi in a normal (not private) window, or download a backup before closing.'
    : s.state === 'error' ? s.error
    : y.status === 'error' && y.kind === 'auth' ? `Sync stopped: ${y.message}` : '';
  banner.hidden = !msg;
  banner.querySelector('p').textContent = msg || '';
}

// Offline support + "new version" prompt. Only on a real site (not file:// or a preview).
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
      });
    });
  }).catch(() => { /* offline support is optional */ });
  // Reload only when an UPDATE takes over (not when offline support is first switched on).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });
}

function showUpdateBanner(worker) {
  const bar = document.createElement('div');
  bar.className = 'banner banner--soft update-banner';
  bar.innerHTML = '<p>A new version of louvi is ready.</p><button type="button" class="btn btn--primary btn--sm">Update now</button>';
  bar.querySelector('button').addEventListener('click', async () => {
    await store.saveNow();
    worker.postMessage('skipWaiting');
  });
  document.getElementById('main').prepend(bar);
}

async function boot() {
  try {
    const result = await store.init();
    applyTheme(store.settings().theme);
    store.onSaveStatus(renderStatus);
    sync.onState(renderStatus);
    renderStatus();

    store.subscribe((change) => {
      if (change.type === 'sync' || change.type === 'replace') applyTheme(store.settings().theme);
      if (current?.view?.refresh) current.view.refresh();
    });
    addEventListener('hashchange', render);

    document.querySelectorAll('[data-quick-add]').forEach((b) => {
      b.innerHTML = icon('plus', 22) + '<span class="sr-only">Add new</span>';
      b.addEventListener('click', () => (current?.view?.newTask ? current.view.newTask() : openTaskForm()));
    });

    // Refresh "today" if the app stays open past midnight.
    let day = new Date().toDateString();
    setInterval(() => {
      const now = new Date().toDateString();
      if (now !== day) { day = now; current?.view?.refresh?.(); }
    }, 60_000);

    // Warn before closing only if a save is still in progress.
    addEventListener('beforeunload', (ev) => {
      if (store.hasUnsavedChanges()) { store.flush(); ev.preventDefault(); }
    });

    document.documentElement.dataset.ready = '1';
    render();
    sync.startAutoSync();
    registerServiceWorker();
    return result;
  } catch (e) {
    console.error(e);
    document.documentElement.dataset.ready = 'error';
    viewEl.innerHTML = `<div class="page"><div class="empty">
      <h1 class="empty__title">louvi couldn't start</h1>
      <p class="empty__text">${esc(e.message || 'Unexpected error')}</p>
      <p class="empty__text">Nothing was changed. Reload the page to try again. If this keeps happening, restore from a backup file in a different browser.</p>
      <button type="button" class="btn btn--primary" onclick="location.reload()">Reload</button></div></div>`;
  }
}

boot();
