// Settings: profile, theme, backups, restore, Trash, storage and reset.

import * as store from '../store.js';
import { APP_VERSION, SCHEMA_VERSION, TRASH_DAYS, LIMITS, areaLabel, COLLECTIONS, COLLECTION_LABELS } from '../schema.js';
import { parseBackup, countDoc, buildExport } from '../backup.js';
import { esc, plural } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { formatStamp, formatShort, todayISO, toISO } from '../lib/dates.js';
import { requestPersistence, persistenceStatus } from '../storage.js';
import { downloadBackup, copyBackup } from './data-tools.js';
import { applyTheme } from '../theme.js';
import * as sync from '../sync.js';

export const title = 'Settings';

const STORAGE_LABEL = {
  indexeddb: 'Saved in this browser on this device.',
  localstorage: 'Saved in this browser (basic storage, about 5 MB).',
  memory: 'Not saved. This browser is blocking storage, so everything disappears when you close the tab.',
};

function countsText(counts) {
  if (!counts) return '';
  const parts = [];
  for (const c of COLLECTIONS) {
    const x = counts[c];
    if (!x || (!x.total && c !== 'tasks')) continue;
    const L = COLLECTION_LABELS[c];
    parts.push(`${x.total} ${x.total === 1 ? L.one : L.many}${c === 'tasks' && x.done ? ` (${x.done} done)` : ''}`);
  }
  const trash = COLLECTIONS.reduce((n, c) => n + (counts[c]?.trash || 0), 0);
  return parts.join(', ') + (trash ? ` · ${trash} in Trash` : '');
}

function trashLabel(collection, r) {
  if (collection === 'applications') return { title: `${r.position || 'Application'}`, sub: `Application at ${r.company || '—'}` };
  if (collection === 'skills') return { title: r.name || 'Skill', sub: 'Skill' };
  if (collection === 'accounts') return { title: r.name || 'Account', sub: 'Finance account' };
  if (collection === 'snapshots') return { title: `Balances for ${r.month || '?'}`, sub: 'Monthly balances' };
  if (collection === 'transactions') return { title: `${r.category || 'Transaction'} · Rp${String(r.amount ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`, sub: `Transaction on ${r.date || '?'}` };
  if (collection === 'savingsGoals') return { title: r.name || 'Savings goal', sub: 'Savings goal' };
  return { title: r.title || 'Untitled', sub: `${areaLabel(r.area)} task` };
}

export function mount(root) {
  let pending = null; // parsed backup waiting for confirmation

  root.innerHTML = `
    <header class="page-head"><div><h1 class="page-title">Settings</h1></div></header>
    <div class="settings">
      <section class="s-section" aria-labelledby="s-profile">
        <h2 class="s-title" id="s-profile">Profile</h2>
        <label class="field">
          <span class="field__label">Your name</span>
          <input class="input" id="set-name" maxlength="${LIMITS.name}" autocomplete="given-name" placeholder="e.g. Viony">
          <span class="field__hint">Used in the greeting on Home.</span>
        </label>
      </section>

      <section class="s-section" aria-labelledby="s-look">
        <h2 class="s-title" id="s-look">Appearance</h2>
        <fieldset class="field">
          <legend class="field__label">Theme</legend>
          <div class="segmented" role="radiogroup" data-theme-group>
            ${['system', 'light', 'dark'].map((t) => `
              <label class="seg"><input type="radio" name="theme" value="${t}"><span>${t === 'system' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}</span></label>`).join('')}
          </div>
        </fieldset>
      </section>

      <section class="s-section" aria-labelledby="s-sync">
        <h2 class="s-title" id="s-sync">Sync between devices</h2>
        <div data-sync></div>
      </section>

      <section class="s-section" aria-labelledby="s-install" data-install-section>
        <h2 class="s-title" id="s-install">Install on your phone or laptop</h2>
        <p class="s-text">Installed, louvi opens like an app, works offline, and your browser is less likely to clear its data.</p>
        <ul class="steps steps--plain">
          <li><strong>Android (Chrome):</strong> menu ⋮ → <em>Add to Home screen</em> or <em>Install app</em>.</li>
          <li><strong>iPhone (Safari):</strong> Share button → <em>Add to Home Screen</em>.</li>
          <li><strong>Laptop (Chrome or Edge):</strong> the install icon at the right of the address bar.</li>
        </ul>
        <p class="s-text s-text--muted">Works on the GitHub Pages address, not inside a preview.</p>
      </section>

      <section class="s-section" aria-labelledby="s-backup">
        <h2 class="s-title" id="s-backup">Backup</h2>
        <p class="s-text">A backup is one .json file with everything in louvi. Download one regularly and keep it in Google Drive or similar. It's the only copy outside this browser.</p>
        <p class="s-status" data-last-backup></p>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" data-action="download">${icon('download', 18)}Download backup</button>
          <button type="button" class="btn btn--ghost" data-action="copy">${icon('copy', 18)}Copy backup text</button>
        </div>
        <div data-copy-fallback hidden>
          <label class="field">
            <span class="field__label">Copying isn't allowed here. Select all of this text and copy it yourself.</span>
            <textarea class="input mono" rows="6" readonly data-copy-text></textarea>
          </label>
        </div>
      </section>

      <section class="s-section" aria-labelledby="s-restore">
        <h2 class="s-title" id="s-restore">Restore from a backup</h2>
        <p class="s-text">Replaces everything in louvi with the backup's contents. Your current data is saved as an automatic backup first, so you can undo this. With sync on, your other devices get the restored data too.</p>
        <div class="btn-row">
          <label class="btn btn--ghost file-btn">
            ${icon('upload', 18)}Choose backup file
            <input type="file" accept=".json,application/json" id="restore-file" class="sr-only">
          </label>
        </div>
        <details class="paste-box">
          <summary>Or paste backup text</summary>
          <label class="field">
            <span class="sr-only">Backup text</span>
            <textarea class="input mono" rows="5" id="restore-text" placeholder='{"app": "louvi", ...}'></textarea>
          </label>
          <button type="button" class="btn btn--ghost btn--sm" data-action="check-paste">Check backup</button>
        </details>
        <p class="field__error" data-restore-error role="alert" hidden></p>
        <div data-preview></div>
      </section>

      <section class="s-section" aria-labelledby="s-auto">
        <h2 class="s-title" id="s-auto">Automatic backups</h2>
        <p class="s-text">louvi saves a copy here before any restore or reset. The latest few are kept, on this device only.</p>
        <div data-auto-list><p class="s-status">Loading…</p></div>
      </section>

      <section class="s-section" aria-labelledby="s-trash">
        <h2 class="s-title" id="s-trash">Trash</h2>
        <p class="s-text">Deleted items stay here for ${TRASH_DAYS} days, then they're removed for good.</p>
        <div data-trash></div>
      </section>

      <section class="s-section" aria-labelledby="s-storage">
        <h2 class="s-title" id="s-storage">Storage</h2>
        <p class="s-text" data-storage-kind></p>
        <p class="s-status" data-persist>Checking…</p>
        <p class="s-text s-text--muted">Clearing your browser's site data, or removing the browser, also removes louvi's data. Backups protect you from that.</p>
      </section>

      <section class="s-section s-section--danger" aria-labelledby="s-reset">
        <h2 class="s-title" id="s-reset">Reset</h2>
        <p class="s-text">Deletes all tasks, career and finance data and starts fresh. Your name and theme stay. An automatic backup is made first. With sync on, other devices are cleared too at their next sync.</p>
        <button type="button" class="btn btn--danger-outline" data-action="reset">Reset all data</button>
      </section>

      <p class="about">louvi ${APP_VERSION} · data version ${SCHEMA_VERSION}</p>
    </div>`;

  // ----- profile & theme -----
  const nameInput = root.querySelector('#set-name');
  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim().slice(0, LIMITS.name);
    nameInput.value = name;
    if (name !== store.settings().name) {
      store.updateSettings({ name });
      toast(name ? 'Name saved.' : 'Name removed.');
    }
  });

  root.querySelector('[data-theme-group]').addEventListener('change', (ev) => {
    const theme = ev.target.value;
    store.updateSettings({ theme });
    applyTheme(theme);
  });

  // ----- actions -----
  root.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const a = el.dataset.action;

    if (a === 'download') downloadBackup();
    if (a === 'sync-setup') openSyncSetup();
    if (a === 'sync-now') sync.syncNow();
    if (a === 'sync-disconnect') {
      const ok = await confirmDialog({
        title: 'Disconnect this device?',
        message: 'This device stops syncing and forgets the token. Your data stays here and on GitHub. You can set it up again any time.',
        confirmLabel: 'Disconnect',
      });
      if (ok) { sync.disconnect(); toast('This device no longer syncs.'); renderSync(); }
    }
    if (a === 'copy') {
      const ok = await copyBackup();
      const box = root.querySelector('[data-copy-fallback]');
      if (!ok) {
        box.hidden = false;
        const ta = root.querySelector('[data-copy-text]');
        ta.value = buildExport(store.getDoc());
        ta.focus();
        ta.select();
      } else box.hidden = true;
    }
    if (a === 'check-paste') checkBackup(root.querySelector('#restore-text').value, 'pasted text');
    if (a === 'cancel-restore') { pending = null; renderPreview(); }
    if (a === 'confirm-restore' && pending) {
      try {
        await store.replaceAll(pending.doc, 'Before restoring a backup');
        applyTheme(store.settings().theme);
        pending = null;
        root.querySelector('#restore-file').value = '';
        root.querySelector('#restore-text').value = '';
        toast('Backup restored.');
      } catch (e) {
        showRestoreError(e.message || 'Restore failed. Nothing was changed.');
      }
    }
    if (a === 'restore-auto') restoreAuto(el.dataset.id);
    if (a === 'trash-restore') {
      store.restore(el.dataset.collection, el.dataset.id);
      toast('Restored.');
    }
    if (a === 'trash-purge') {
      const ok = await confirmDialog({
        title: 'Delete for good?',
        message: 'This item will be removed permanently. This can\'t be undone.',
        confirmLabel: 'Delete for good',
        danger: true,
      });
      if (ok) { store.purge(el.dataset.collection, el.dataset.id); toast('Deleted for good.'); }
    }
    if (a === 'trash-empty') {
      const n = store.trashed().length;
      const ok = await confirmDialog({
        title: 'Empty the Trash?',
        message: `${plural(n, 'item')} will be removed permanently. This can't be undone.`,
        confirmLabel: 'Empty Trash',
        danger: true,
      });
      if (ok) { store.emptyTrash(); toast('Trash emptied.'); }
    }
    if (a === 'persist') {
      const granted = await requestPersistence();
      toast(granted ? 'Your browser will keep louvi\'s data.' : 'The browser said no for now. It often allows this after you use louvi more, or install it to your home screen.');
      renderStorage();
    }
    if (a === 'reset') {
      const ok = await confirmDialog({
        title: 'Reset all data?',
        message: `Everything will be deleted: ${esc(countsText(countDoc(store.getDoc())))}. An automatic backup is saved first, so you can restore it from Settings.`,
        confirmLabel: 'Reset everything',
        danger: true,
        typeToConfirm: 'RESET',
      });
      if (ok) {
        try {
          await store.resetAll();
          toast('louvi was reset. The old data is in Automatic backups.');
        } catch (e) {
          toast(e.message, { tone: 'error' });
        }
      }
    }
  });

  root.querySelector('#restore-file').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      showRestoreError('This file is too large to be a louvi backup.');
      return;
    }
    try {
      checkBackup(await file.text(), file.name);
    } catch {
      showRestoreError('Could not read that file. Try choosing it again.');
    }
  });

  function showRestoreError(msg) {
    const err = root.querySelector('[data-restore-error]');
    err.textContent = msg;
    err.hidden = !msg;
  }

  function checkBackup(text, sourceName) {
    showRestoreError('');
    if (!text.trim()) { showRestoreError('Paste the backup text first.'); return; }
    const res = parseBackup(text);
    if (!res.ok) { pending = null; renderPreview(); showRestoreError(res.error); return; }
    pending = { ...res, sourceName };
    renderPreview();
    root.querySelector('[data-preview] .preview')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function renderPreview() {
    const box = root.querySelector('[data-preview]');
    if (!pending) { box.innerHTML = ''; return; }
    const r = pending.report;
    const notes = [];
    if (r.upgradedFrom !== null) notes.push(`Made with an older version of louvi. It will be upgraded to the current format.`);
    for (const c of COLLECTIONS) {
      const L = COLLECTION_LABELS[c];
      const n = (k) => `${r[k][c]} ${r[k][c] === 1 ? L.one : L.many}`;
      if (r.skipped[c]) notes.push(`${n('skipped')} with missing required fields will be skipped.`);
      if (r.fixed[c]) notes.push(`${n('fixed')} had an invalid field (like a date, status or link) that will be reset or removed.`);
      if (r.duplicates[c]) notes.push(`${n('duplicates')} appeared twice; the most recently edited copy is kept.`);
    }
    const current = countDoc(store.getDoc());
    box.innerHTML = `
      <div class="preview" role="region" aria-label="Backup preview">
        <p class="preview__head">${icon('note', 18)}<strong>${esc(pending.sourceName)}</strong></p>
        <dl class="preview__grid">
          <dt>Created</dt><dd>${r.exportedAt ? esc(formatStamp(r.exportedAt)) : 'Unknown'}</dd>
          <dt>Contains</dt><dd>${esc(countsText(r.counts))}</dd>
          <dt>Replaces</dt><dd>${esc(countsText(current))} currently in louvi</dd>
        </dl>
        ${notes.length ? `<ul class="preview__notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <div class="btn-row">
          <button type="button" class="btn btn--danger" data-action="confirm-restore">Replace my data with this backup</button>
          <button type="button" class="btn btn--ghost" data-action="cancel-restore">Cancel</button>
        </div>
      </div>`;
  }

  async function restoreAuto(id) {
    const b = await store.getBackup(id);
    if (!b) { toast('That automatic backup is no longer available.', { tone: 'error' }); return refresh(); }
    const res = parseBackup(JSON.stringify(b.doc));
    if (!res.ok) { toast(res.error, { tone: 'error' }); return; }
    const ok = await confirmDialog({
      title: 'Restore this automatic backup?',
      message: `louvi goes back to how it was on ${esc(formatStamp(b.createdAt))} (${esc(countsText(b.counts))}). What you have now is saved as another automatic backup first.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      await store.replaceAll(res.doc, 'Before restoring an automatic backup');
      applyTheme(store.settings().theme);
      toast('Automatic backup restored.');
    } catch (e) {
      toast(e.message, { tone: 'error' });
    }
  }

  async function renderAutoBackups() {
    const box = root.querySelector('[data-auto-list]');
    let list = [];
    try { list = await store.listBackups(); } catch { /* shown as empty */ }
    if (!document.contains(box)) return;
    box.innerHTML = list.length
      ? `<ul class="rows">${list.map((b) => `
          <li class="row">
            <div class="row__main">
              <span class="row__title">${esc(b.reason)}</span>
              <span class="row__sub">${esc(formatStamp(b.createdAt))} · ${esc(countsText(b.counts))}</span>
            </div>
            <button type="button" class="btn btn--ghost btn--sm" data-action="restore-auto" data-id="${esc(b.id)}">${icon('restore', 16)}Restore</button>
          </li>`).join('')}</ul>`
      : `<p class="s-status">None yet.</p>`;
  }

  function renderTrash() {
    const items = store.trashed();
    const box = root.querySelector('[data-trash]');
    if (!items.length) { box.innerHTML = '<p class="s-status">Trash is empty.</p>'; return; }
    box.innerHTML = `
      <ul class="rows">${items.map(({ collection, record }) => {
        const goneOn = new Date(record.deletedAt);
        goneOn.setDate(goneOn.getDate() + TRASH_DAYS);
        const lbl = trashLabel(collection, record);
        return `
          <li class="row">
            <div class="row__main">
              <span class="row__title">${esc(lbl.title)}</span>
              <span class="row__sub">${esc(lbl.sub)} · deleted ${esc(formatShort(toISO(new Date(record.deletedAt)), todayISO()))} · removed for good on ${esc(formatShort(toISO(goneOn), todayISO()))}</span>
            </div>
            <div class="row__actions">
              <button type="button" class="btn btn--ghost btn--sm" data-action="trash-restore" data-collection="${collection}" data-id="${esc(record.id)}">${icon('restore', 16)}Restore</button>
              <button type="button" class="icon-btn icon-btn--danger" data-action="trash-purge" data-collection="${collection}" data-id="${esc(record.id)}" aria-label="Delete “${esc(lbl.title)}” for good">${icon('trash', 18)}</button>
            </div>
          </li>`;
      }).join('')}</ul>
      <button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-action="trash-empty">Empty Trash</button>`;
  }

  async function renderStorage() {
    const kind = store.info().storage;
    root.querySelector('[data-storage-kind]').textContent = STORAGE_LABEL[kind];
    const el = root.querySelector('[data-persist]');
    if (kind === 'memory') { el.innerHTML = ''; return; }
    const p = await persistenceStatus();
    if (!document.contains(el)) return;
    el.innerHTML = p === true
      ? `${icon('shield', 16)} Protected: the browser won't clear this data on its own when space runs low.`
      : p === false
        ? `Not protected yet. The browser may clear data if the device runs very low on space. <button type="button" class="link-btn" data-action="persist">Ask the browser to keep it</button>`
        : 'This browser doesn\'t report whether data is protected.';
  }

  // ----- sync -----
  const timeAgo = (stamp) => {
    if (!stamp) return 'never';
    const mins = Math.round((Date.now() - new Date(stamp)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h} h ago`;
    return formatStamp(stamp);
  };
  function renderSync() {
    const box = root.querySelector('[data-sync]');
    if (!box) return;
    const c = sync.getConfig();
    const st = sync.getState();
    if (!c) {
      box.innerHTML = `
        <p class="s-text">Use louvi on your phone and laptop with the same data. louvi saves a copy in a <strong>private GitHub repository</strong> you own, and every sync is kept in its history. Setup takes about 10 minutes, once per device.</p>
        <div class="btn-row"><button type="button" class="btn btn--primary" data-action="sync-setup">Set up sync</button></div>`;
      return;
    }
    const stateLine = {
      syncing: `${icon('restore', 16)} Syncing…`,
      synced: `${icon('check', 16)} Synced ${timeAgo(st.at)}`,
      idle: `Last synced ${timeAgo(c.lastSyncAt)}`,
      offline: `${icon('alert', 16)} ${esc(st.message)}`,
      error: `${icon('alert', 16)} ${esc(st.message)}`,
    }[st.status] || `Last synced ${timeAgo(c.lastSyncAt)}`;
    box.innerHTML = `
      <p class="s-status ${st.status === 'error' ? 's-status--error' : ''}" role="status">${stateLine}</p>
      <dl class="preview__grid">
        <dt>Repository</dt><dd><a href="https://github.com/${esc(c.owner)}/${esc(c.repo)}" target="_blank" rel="noopener noreferrer">${esc(c.owner)}/${esc(c.repo)}</a> (private)</dd>
        <dt>This device</dt><dd>${esc(c.device || 'this device')}</dd>
      </dl>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" data-action="sync-now" ${st.status === 'syncing' ? 'disabled' : ''}>Sync now</button>
        <a class="btn btn--ghost" href="https://github.com/${esc(c.owner)}/${esc(c.repo)}/commits" target="_blank" rel="noopener noreferrer">Version history</a>
        <button type="button" class="btn btn--ghost btn--danger-text" data-action="sync-disconnect">Disconnect this device</button>
      </div>
      ${st.kind === 'auth' ? '<p class="s-text">To fix: create a new token (steps in <strong>Set up sync</strong>), then disconnect and set up again.</p>' : ''}
      <p class="s-text s-text--muted">louvi syncs when it opens, about 20 seconds after you change something, and when you come back to it. If you edit the same item on two devices before they sync, the later edit is kept.</p>`;
  }

  function openSyncSetup() {
    const isPhone = matchMedia('(max-width: 860px)').matches;
    openDialog({
      title: 'Set up sync',
      size: 'lg',
      backdropClose: false,
      body: `
        <form class="form" id="sync-form" novalidate>
          <ol class="steps">
            <li><strong>Create a private repository</strong> on GitHub: <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">github.com/new</a>. Name it e.g. <code>louvi-data</code>, choose <strong>Private</strong>, then Create. (Only once. Your second device uses the same one.)</li>
            <li><strong>Create a token</strong>: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained token</a>.
              Name: <code>louvi</code> · Expiration: the longest offered · Repository access: <strong>Only select repositories → louvi-data</strong> · Permissions → Repository → <strong>Contents: Read and write</strong>. Generate, then copy the token.</li>
            <li>Fill in the form below. Do this on each device; you can reuse the same token or make one per device.</li>
          </ol>
          <div class="form-grid">
            <label class="field"><span class="field__label">GitHub username</span>
              <input class="input" name="owner" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="e.g. vionyazhar"></label>
            <label class="field"><span class="field__label">Repository name</span>
              <input class="input" name="repo" value="louvi-data" autocapitalize="off" spellcheck="false"></label>
          </div>
          <label class="field"><span class="field__label">Token</span>
            <input class="input mono" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
            <span class="field__hint">Stays in this browser only. It's never included in backups or in the synced file.</span></label>
          <label class="field"><span class="field__label">Name this device</span>
            <input class="input" name="device" value="${isPhone ? 'Phone' : 'Laptop'}" maxlength="30"></label>
          <p class="field__error" data-sync-error role="alert" hidden></p>
          <p class="s-text s-text--muted">If both this device and GitHub already have data, louvi combines them; nothing is deleted. An automatic backup of this device is saved first.</p>
        </form>`,
      footer: '<span class="spacer"></span><button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button><button type="submit" form="sync-form" class="btn btn--primary" data-connect>Connect &amp; sync</button>',
      onMount(el, close) {
        const form = el.querySelector('#sync-form');
        const err = el.querySelector('[data-sync-error]');
        const btn = el.querySelector('[data-connect]');
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          err.hidden = true;
          btn.disabled = true;
          btn.textContent = 'Checking…';
          try {
            const tested = await sync.testConnection({ owner: form.elements.owner.value, repo: form.elements.repo.value, token: form.elements.token.value });
            btn.textContent = 'Syncing…';
            const st = await sync.connect(tested, form.elements.device.value.trim());
            if (st.status === 'error') throw new Error(st.message);
            close();
            toast(st.received ? 'Sync is on. Data from your other device was added.' : 'Sync is on.');
          } catch (e) {
            err.textContent = e.message;
            err.hidden = false;
            btn.disabled = false;
            btn.textContent = 'Connect & sync';
          }
        });
      },
    });
  }

  sync.onState(() => { if (document.contains(root)) renderSync(); });

  function refresh() {
    renderSync();
    const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    root.querySelector('[data-install-section]').hidden = installed;
    const s = store.settings();
    if (document.activeElement !== nameInput) nameInput.value = s.name || '';
    root.querySelectorAll('[name="theme"]').forEach((r) => { r.checked = r.value === s.theme; });
    root.querySelector('[data-last-backup]').textContent = s.lastExportAt
      ? `Last backup: ${formatStamp(s.lastExportAt)}`
      : 'No backup downloaded yet.';
    renderTrash();
    renderAutoBackups();
  }

  refresh();
  renderStorage();
  return { refresh };
}
