// Turns a spreadsheet of job applications (CSV) into louvi applications.
// Pure logic: the Career page shows the preview and asks before adding anything.

import { parseCSV } from './csv.js';
import { isValidISO, diffDays, pad } from './dates.js';
import { normalizeUrl } from './links.js';
import { CAREER_LIMITS, skillKey } from './career.js';

// Header names we recognise (lower-case, Indonesian and English).
const COLUMN_ALIASES = {
  appliedAt: ['tanggal apply', 'tanggal lamar', 'tanggal melamar', 'tanggal', 'tgl', 'applied', 'applied on', 'date applied', 'date', 'apply date'],
  source: ['platform', 'source', 'sumber', 'via', 'found on'],
  link: ['web link', 'link', 'url', 'website', 'job link', 'link lowongan'],
  company: ['perusahaan', 'company', 'nama perusahaan', 'instansi', 'employer'],
  location: ['lokasi', 'location', 'kota', 'city'],
  position: ['position', 'posisi', 'jabatan', 'role', 'job title', 'title', 'lowongan'],
  progress: ['progress', 'stage', 'tahap', 'tahapan', 'step'],
  final: ['final progress', 'status', 'hasil', 'result', 'final status', 'outcome'],
  notes: ['catatan', 'notes', 'note', 'keterangan', 'remarks'],
  salary: ['gaji', 'salary', 'expected salary'],
};

export const FIELD_LABELS = {
  appliedAt: 'Applied on', source: 'Found on', link: 'Link', company: 'Company', location: 'Location',
  position: 'Position', progress: 'Progress', final: 'Final status', notes: 'Notes', salary: 'Salary (kept in notes)',
};

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function detectColumns(headers) {
  const map = {};
  const used = new Set();
  // Exact matches first, so "Final Progress" isn't taken by "Progress".
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && aliases.includes(norm(h)));
    if (i >= 0) { map[field] = i; used.add(i); }
  }
  const ignored = headers.map((h, i) => (used.has(i) || !String(h).trim() ? null : String(h).trim())).filter(Boolean);
  return { map, ignored };
}

// ---------- dates ----------

const MONTHS = {
  januari: 1, jan: 1, january: 1,
  februari: 2, feb: 2, pebruari: 2, february: 2,
  maret: 3, mar: 3, march: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, agt: 8, ags: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nov: 11, nop: 11,
  desember: 12, des: 12, dec: 12, december: 12,
};

// "Kamis, 13 Maret 2025", "13 Mar 2025", "13/03/2025" (day first), "2025-03-13".
export function parseIndoDate(input) {
  let s = norm(input);
  if (!s) return null;
  s = s.replace(/^[a-z]+,\s*/, ''); // weekday prefix
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return build(fullYear(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})\s+([a-z]+)\.?\s+(\d{2,4})$/.exec(s);
  if (m && MONTHS[m[2]]) return build(fullYear(+m[3]), MONTHS[m[2]], +m[1]);
  m = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1]]) return build(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);
function build(y, mo, d) {
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return isValidISO(iso) ? iso : null;
}

// ---------- status ----------

export function statusFrom(progress, final) {
  const f = norm(final), p = norm(progress);
  if (/declin|reject|tolak|gagal|tidak lolos|not selected|unsuccessful/.test(f)) return 'rejected';
  if (/withdr|mundur|cancel|batal/.test(f)) return 'withdrawn';
  if (/accept|diterima|hired|join|lolos akhir/.test(f)) return 'accepted';
  if (/offer/.test(f) || /offer/.test(p)) return 'offer';
  if (/no response|ghost|tidak ada kabar/.test(f)) return 'ghosted';
  if (/interview|intv|wawancara|user/.test(p)) return 'interview';
  if (/test|tes|psiko|assess|screen|mcu|seleksi/.test(p)) return 'screening';
  if (/saved|draft|belum/.test(p)) return 'saved';
  return 'applied';
}

const SOURCE_NAMES = [
  [/linked\s*in/, 'LinkedIn'], [/job\s*street/, 'JobStreet'], [/glints/, 'Glints'], [/kalibrr/, 'Kalibrr'],
  [/web\s*car+e+r|career\s*site|company\s*web|website|web\s*karir/, 'Company website'],
  [/referral|referensi|rekomendasi/, 'Referral'], [/job\s*fair/, 'Job fair'], [/rekrutmen bersama|fhci/, 'Rekrutmen Bersama BUMN'],
];
export function cleanSource(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  for (const [re, name] of SOURCE_NAMES) if (re.test(s.toLowerCase())) return name;
  return s.slice(0, CAREER_LIMITS.source);
}

// ---------- main ----------

// Returns { ok:false, error } or { ok:true, columns, ignored, rows, skipped, duplicates, staleCount }
// rows[i] = { line, value: <application fields>, stale: boolean }
export function prepareImport(text, existingApps = [], { today, staleAfterDays = 90 } = {}) {
  const table = parseCSV(text);
  if (table.length < 2) return { ok: false, error: 'The file needs a header row and at least one application.' };
  const headers = table[0];
  const { map, ignored } = detectColumns(headers);
  if (map.company === undefined) {
    return { ok: false, error: `Couldn't find a company column. Name it "Company" or "Perusahaan". Columns found: ${headers.filter(Boolean).join(', ')}` };
  }

  // Template placeholders: a cell that just repeats its column header ("Position", "Catatan").
  const cell = (row, field) => {
    const i = map[field];
    if (i === undefined) return '';
    const v = String(row[i] ?? '').trim();
    return norm(v) === norm(headers[i]) ? '' : v;
  };

  const existingKeys = new Set(existingApps.map((a) => [skillKey(a.company), skillKey(a.position), a.appliedAt || ''].join('|')));
  const seen = new Set();
  const rows = [];
  const skipped = [];
  let duplicates = 0;

  table.slice(1).forEach((row, idx) => {
    const line = idx + 2;
    const company = cell(row, 'company');
    if (!company) {
      if (row.some((c, i) => String(c).trim() && norm(c) !== norm(headers[i]))) skipped.push({ line, reason: 'No company name' });
      return;
    }
    const position = cell(row, 'position') || 'Position not recorded';
    const dateRaw = cell(row, 'appliedAt');
    const appliedAt = dateRaw ? parseIndoDate(dateRaw) : null;
    const notesParts = [];
    const n = cell(row, 'notes');
    if (n) notesParts.push(n);
    if (dateRaw && !appliedAt) notesParts.push(`Date in sheet: ${dateRaw}`);
    const salary = cell(row, 'salary');
    if (salary) notesParts.push(`Salary: ${salary}`);
    const progress = cell(row, 'progress');
    const final = cell(row, 'final');
    if (progress || final) notesParts.push(`Imported status: ${[progress, final].filter(Boolean).join(' → ')}`);

    const links = [];
    const linkRaw = cell(row, 'link');
    if (linkRaw) {
      const url = normalizeUrl(linkRaw);
      if (url && /\.[a-z]{2,}/i.test(new URL(url).hostname)) links.push({ label: '', url });
      else notesParts.push(`Link in sheet: ${linkRaw}`);
    }

    const value = {
      company: company.slice(0, CAREER_LIMITS.company),
      position: position.slice(0, CAREER_LIMITS.position),
      location: cell(row, 'location').slice(0, CAREER_LIMITS.location),
      workMode: '',
      source: cleanSource(cell(row, 'source')),
      status: statusFrom(progress, final),
      appliedAt,
      salaryMin: null, salaryMax: null,
      jobDescription: '',
      requiredSkills: [],
      notes: notesParts.join('\n').slice(0, CAREER_LIMITS.notes),
      links,
    };

    const key = [skillKey(value.company), skillKey(value.position), value.appliedAt || ''].join('|');
    if (existingKeys.has(key) || seen.has(key)) { duplicates++; return; }
    seen.add(key);

    const waiting = ['applied', 'screening', 'interview'].includes(value.status);
    const stale = waiting && !!appliedAt && !!today && diffDays(appliedAt, today) > staleAfterDays;
    rows.push({ line, value, stale });
  });

  return {
    ok: true,
    columns: Object.entries(map).map(([field, i]) => ({ field, header: String(headers[i]).trim() })),
    ignored,
    rows,
    skipped,
    duplicates,
    staleCount: rows.filter((r) => r.stale).length,
  };
}
