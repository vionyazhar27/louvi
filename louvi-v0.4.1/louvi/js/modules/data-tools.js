// Backup download/copy, used by Settings and the backup reminder on Home.

import * as store from '../store.js';
import { buildExport, backupFileName } from '../backup.js';
import { toast } from '../ui/toast.js';
import { daysSince } from '../lib/dates.js';

export const BACKUP_REMINDER_DAYS = 14;

export function downloadBackup() {
  try {
    const json = buildExport(store.getDoc());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    store.updateSettings({ lastExportAt: new Date().toISOString() });
    toast('Backup downloaded. Keep it somewhere safe, like Google Drive.');
  } catch (e) {
    console.error(e);
    toast('Could not create the backup file. Try “Copy backup” instead.', { tone: 'error' });
  }
}

export async function copyBackup() {
  const json = buildExport(store.getDoc());
  try {
    await navigator.clipboard.writeText(json);
    store.updateSettings({ lastExportAt: new Date().toISOString() });
    toast('Backup copied. Paste it into a note or file to keep it.');
    return true;
  } catch {
    return false; // caller shows the text so it can be copied by hand
  }
}

export function needsBackupReminder() {
  const doc = store.getDoc();
  const hasData = doc.tasks.some((t) => !t.purged && !t.sample) ||
    ['applications', 'skills', 'accounts', 'snapshots', 'transactions', 'savingsGoals'].some((c) => (doc[c] || []).some((r) => !r.purged));
  if (!hasData) return false;
  const last = doc.settings.lastExportAt;
  return !last || daysSince(last) >= BACKUP_REMINDER_DAYS;
}
