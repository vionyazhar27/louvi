// Sync between devices through a PRIVATE GitHub repository you own.
//
// - Each device keeps its own connection settings (repo + token) in this browser only.
//   The token is never put in louvi's data, so it never ends up in backups or in the repo.
// - The repo holds one file, louvi-data.json. Every sync is a commit, so GitHub keeps
//   a full version history you can go back to.
// - Sync = download the file, merge it with this device (lib/merge.js), save the result
//   here, and upload it if anything changed. If another device uploaded in between,
//   GitHub rejects the upload and louvi simply tries again.

import * as store from './store.js';
import { mergeDocs } from './lib/merge.js';
import { parseBackup } from './backup.js';
import { APP_VERSION } from './schema.js';
import { nowStamp } from './lib/dates.js';

const KEY = 'louvi:sync';
const API = 'https://api.github.com';
export const DATA_PATH = 'louvi-data.json';
const AUTO_DELAY = 20_000; // after the last change
const RESYNC_ON_FOCUS = 60_000;

let state = { status: 'off', message: '', at: null };
const listeners = new Set();
let running = null;
let queued = false;
let timer = null;

// ---------- config (per device) ----------

export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && c.owner && c.repo && c.token ? c : null;
  } catch {
    return null;
  }
}

function saveConfig(c) {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function disconnect() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  clearTimeout(timer);
  setState({ status: 'off', message: '' });
}

// ---------- status ----------

export function getState() { return state; }
export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

// ---------- GitHub API ----------

export class SyncError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

async function gh(path, { method = 'GET', token, body } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new SyncError("You're offline or GitHub can't be reached. louvi will try again later.", 'offline');
  }
  return res;
}

async function failure(res, what) {
  if (res.status === 401) return new SyncError('GitHub rejected the token. It may have expired or been deleted. Create a new token and reconnect.', 'auth');
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') return new SyncError('GitHub says too many requests. Sync will work again within an hour.', 'error');
    return new SyncError(`The token isn't allowed to ${what}. Give it "Contents: Read and write" access to this repository.`, 'auth');
  }
  if (res.status === 404) return new SyncError("Repository not found. Check the owner and repository name, and that the token has access to this repository.", 'auth');
  return new SyncError(`GitHub returned an error (${res.status}) while trying to ${what}.`, 'error');
}

const b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

const repoPath = (c) => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

// Checks the repo before saving the connection. Refuses public repositories.
export async function testConnection({ owner, repo, token }) {
  const c = { owner: owner.trim(), repo: repo.trim(), token: token.trim() };
  if (!c.owner || !c.repo || !c.token) throw new SyncError('Fill in the username, repository and token.');
  const res = await gh(repoPath(c), { token: c.token });
  if (!res.ok) throw await failure(res, 'read the repository');
  const info = await res.json();
  if (!info.private) {
    throw new SyncError('This repository is public, so anyone could read your data. Make it private on GitHub (Settings → General → Danger Zone → Change visibility) or use a new private repository.', 'auth');
  }
  if (info.permissions && info.permissions.push === false) {
    throw new SyncError('The token can read this repository but not write to it. Give it "Contents: Read and write" access.', 'auth');
  }
  return { ...c, defaultBranch: info.default_branch || 'main', htmlUrl: info.html_url };
}

async function readRemote(c) {
  const res = await gh(`${repoPath(c)}/contents/${DATA_PATH}`, { token: c.token });
  if (res.status === 404) {
    // Either the file doesn't exist yet (fine) or the repo is gone (not fine).
    const repo = await gh(repoPath(c), { token: c.token });
    if (!repo.ok) throw await failure(repo, 'read the repository');
    return { text: null, sha: null };
  }
  if (!res.ok) throw await failure(res, 'read the synced data');
  const json = await res.json();
  let content = json.content;
  if (!content && json.size > 0) {
    // Files over 1 MB come without content; fetch the blob instead.
    const blob = await gh(`${repoPath(c)}/git/blobs/${json.sha}`, { token: c.token });
    if (!blob.ok) throw await failure(blob, 'read the synced data');
    content = (await blob.json()).content;
  }
  return { text: content ? b64decode(content) : '', sha: json.sha };
}

async function writeRemote(c, doc, sha) {
  const text = JSON.stringify({ ...doc, appVersion: APP_VERSION, syncedAt: nowStamp() }, null, 2);
  const res = await gh(`${repoPath(c)}/contents/${DATA_PATH}`, {
    method: 'PUT',
    token: c.token,
    body: { message: `louvi sync from ${c.device || 'a device'}`, content: b64encode(text), ...(sha ? { sha } : {}) },
  });
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw await failure(res, 'save the synced data');
  return { conflict: false };
}

// ---------- sync ----------

export function syncNow() {
  const c = getConfig();
  if (!c) return Promise.resolve(state);
  if (running) { queued = true; return running; }
  running = run(c).finally(() => {
    running = null;
    if (queued) { queued = false; syncNow(); }
  });
  return running;
}

async function run(c) {
  clearTimeout(timer);
  timer = null;
  setState({ status: 'syncing', message: '' });
  try {
    await store.saveNow();
    let uploaded = false, received = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await readRemote(c);
      // Run this device's data through the same checks as the synced copy, so both sides
      // have identical shapes (e.g. optional fields filled in) and compare cleanly.
      const local = parseBackup(JSON.stringify(store.getDoc())).doc;
      let merged;
      if (remote.text) {
        const parsed = parseBackup(remote.text);
        if (!parsed.ok) {
          throw new SyncError(/newer version/.test(parsed.error)
            ? 'Another device synced with a newer version of louvi. Reload this page to update, then sync again.'
            : `The synced file on GitHub couldn't be read (${parsed.error}). Nothing was changed here.`);
        }
        merged = mergeDocs(local, parsed.doc);
      } else {
        merged = { doc: local, changedLocal: false, changedRemote: true };
      }
      if (merged.changedLocal) {
        if (!c.firstSyncDone) await store.snapshot('Before first sync');
        await store.applySynced(merged.doc);
        received = true;
      }
      if (merged.changedRemote) {
        const w = await writeRemote(c, store.getDoc(), remote.sha);
        if (w.conflict) continue; // someone else synced in between: read again and merge
        uploaded = true;
      }
      const next = { ...getConfig(), lastSyncAt: nowStamp(), firstSyncDone: true };
      saveConfig(next);
      setState({ status: 'synced', message: '', at: next.lastSyncAt, received, uploaded });
      return state;
    }
    throw new SyncError('Another device kept syncing at the same time. Try again in a moment.');
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError(`Sync failed: ${e.message || e}`);
    setState({ status: err.kind === 'offline' ? 'offline' : 'error', message: err.message, kind: err.kind });
    return state;
  }
}

// Saves a tested connection and runs the first sync.
export async function connect(tested, device) {
  saveConfig({ owner: tested.owner, repo: tested.repo, token: tested.token, device: device || 'this device', htmlUrl: tested.htmlUrl, lastSyncAt: null, firstSyncDone: false });
  return syncNow();
}

// Starts automatic syncing: on open, after changes, when the app comes back to the
// foreground, and when the device comes back online.
export function startAutoSync() {
  const c = getConfig();
  setState(c ? { status: 'idle', at: c.lastSyncAt } : { status: 'off' });
  if (c) syncNow();
  store.subscribe((change) => {
    if (change.type === 'sync' || !getConfig()) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, AUTO_DELAY);
  });
  document.addEventListener('visibilitychange', () => {
    const cfg = getConfig();
    if (document.visibilityState === 'visible' && cfg && (!cfg.lastSyncAt || Date.now() - new Date(cfg.lastSyncAt) > RESYNC_ON_FOCUS)) syncNow();
    if (document.visibilityState === 'hidden' && cfg && timer) { clearTimeout(timer); syncNow(); }
  });
  addEventListener('online', () => { if (getConfig()) syncNow(); });
}
