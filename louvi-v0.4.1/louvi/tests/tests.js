// Unit tests for Louvi's logic (dates, repeats, task grouping, backup import, migrations).
// Run in a browser: open tests/index.html (through the same local server as the app).
// Run in a terminal: node tests/run-node.mjs

import * as D from '../js/lib/dates.js';
import * as R from '../js/lib/recurrence.js';
import * as T from '../js/lib/tasks.js';
import { validateTaskInput, normalizeImportedTask, SCHEMA_VERSION, emptyDoc } from '../js/schema.js';
import { migrate } from '../js/migrations.js';
import { parseBackup, buildExport, countDoc } from '../js/backup.js';
import * as L from '../js/lib/links.js';
import * as M from '../js/lib/money.js';
import * as C from '../js/lib/career.js';
import * as F from '../js/lib/finance.js';
import { parseCSV } from '../js/lib/csv.js';
import * as I from '../js/lib/career-import.js';
import { mergeDocs, canonical } from '../js/lib/merge.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}
function ok(v, msg = 'expected truthy') { if (!v) throw new Error(msg); }

// ---------- dates ----------
test('isValidISO accepts real dates only', () => {
  eq(D.isValidISO('2026-10-08'), true);
  eq(D.isValidISO('2026-02-29'), false, 'not a leap year:');
  eq(D.isValidISO('2028-02-29'), true);
  eq(D.isValidISO('2026-13-01'), false);
  eq(D.isValidISO('2026-1-1'), false);
  eq(D.isValidISO(''), false);
  eq(D.isValidISO(null), false);
});
test('addDays crosses months and years', () => {
  eq(D.addDays('2026-10-31', 1), '2026-11-01');
  eq(D.addDays('2026-12-31', 1), '2027-01-01');
  eq(D.addDays('2026-03-01', -1), '2026-02-28');
});
test('diffDays', () => {
  eq(D.diffDays('2026-10-08', '2026-10-15'), 7);
  eq(D.diffDays('2026-10-08', '2026-10-01'), -7);
  eq(D.diffDays('2026-12-31', '2027-01-01'), 1);
});
test('weekday and startOfWeek (Monday)', () => {
  eq(D.weekday('2026-10-08'), 4); // Thursday
  eq(D.startOfWeek('2026-10-08'), '2026-10-05');
  eq(D.startOfWeek('2026-10-11'), '2026-10-05'); // Sunday belongs to the week that started Monday
  eq(D.startOfWeek('2026-10-05'), '2026-10-05');
});
test('relativeLabel', () => {
  const t = '2026-10-08';
  eq(D.relativeLabel('2026-10-08', t), 'Today');
  eq(D.relativeLabel('2026-10-09', t), 'Tomorrow');
  eq(D.relativeLabel('2026-10-07', t), 'Yesterday');
  eq(D.relativeLabel('2026-10-12', t), 'Mon');
  eq(D.relativeLabel('2026-10-20', t), '20 Oct');
  eq(D.relativeLabel('2027-01-05', t), '5 Jan 2027');
});
test('formatLong', () => {
  eq(D.formatLong('2026-10-08'), 'Thursday, 8 October 2026');
});

// ---------- recurrence ----------
test('daily: next day after due', () => {
  eq(R.nextDue({ freq: 'daily' }, '2026-10-08', '2026-10-08'), '2026-10-09');
});
test('weekdays: Friday → Monday', () => {
  eq(R.nextDue({ freq: 'weekdays' }, '2026-10-09', '2026-10-09'), '2026-10-12');
});
test('weekdays: overdue Monday finished on Wednesday → Wednesday (no pile-up)', () => {
  eq(R.nextDue({ freq: 'weekdays' }, '2026-10-05', '2026-10-07'), '2026-10-07');
});
test('weekly on Mon & Thu', () => {
  const rule = { freq: 'weekly', days: [1, 4] };
  eq(R.nextDue(rule, '2026-10-05', '2026-10-05'), '2026-10-08');
  eq(R.nextDue(rule, '2026-10-08', '2026-10-08'), '2026-10-12');
});
test('weekly: finished early keeps the schedule', () => {
  // Due next Monday (12th), ticked off on Thursday the 8th → following Monday.
  eq(R.nextDue({ freq: 'weekly', days: [1] }, '2026-10-12', '2026-10-08'), '2026-10-19');
});
test('monthly on 31 clamps to short months', () => {
  const rule = { freq: 'monthly', day: 31 };
  eq(R.nextDue(rule, '2026-10-31', '2026-10-31'), '2026-11-30');
  eq(R.nextDue(rule, '2027-01-31', '2027-01-31'), '2027-02-28');
  eq(R.nextDue(rule, '2026-11-30', '2026-11-30'), '2026-12-31');
});
test('monthly on 15', () => {
  eq(R.nextDue({ freq: 'monthly', day: 15 }, '2026-10-15', '2026-10-15'), '2026-11-15');
});
test('very old repeat jumps forward to today', () => {
  eq(R.nextDue({ freq: 'daily' }, '2020-01-01', '2026-10-08'), '2026-10-08');
});
test('invalid rules', () => {
  eq(R.isValidRule({ freq: 'weekly', days: [] }), false);
  eq(R.isValidRule({ freq: 'monthly', day: 0 }), false);
  eq(R.isValidRule({ freq: 'yearly' }), false);
  eq(R.nextDue({ freq: 'weekly', days: [] }, '2026-10-08', '2026-10-08'), null);
});
test('describe', () => {
  eq(R.describe({ freq: 'weekly', days: [0, 3, 1] }), 'Weekly on Mon, Wed, Sun');
  eq(R.describe({ freq: 'monthly', day: 5 }), 'Monthly on day 5');
});

// ---------- tasks ----------
const mk = (o) => ({ id: Math.random().toString(36).slice(2), title: 't', area: 'work', priority: 'normal', status: 'todo', due: null, createdAt: '2026-10-01T00:00:00Z', ...o });
test('groupOpen buckets by date', () => {
  const today = '2026-10-08';
  const g = T.groupOpen([
    mk({ due: '2026-10-01' }), mk({ due: today }), mk({ due: '2026-10-09' }),
    mk({ due: '2026-10-15' }), mk({ due: '2026-10-16' }), mk({}),
  ], today);
  eq(g.map((x) => [x.id, x.tasks.length]), [['overdue', 1], ['today', 1], ['tomorrow', 1], ['week', 1], ['later', 1], ['nodate', 1]]);
});
test('sort: date, then priority', () => {
  const a = mk({ due: '2026-10-08', priority: 'low', title: 'a' });
  const b = mk({ due: '2026-10-08', priority: 'high', title: 'b' });
  const c = mk({ due: '2026-10-07', priority: 'low', title: 'c' });
  eq([a, b, c].sort(T.compareTasks).map((t) => t.title), ['c', 'b', 'a']);
});
test('views', () => {
  const today = '2026-10-08';
  eq(T.inView(mk({ due: '2026-10-01' }), 'today', today), true);
  eq(T.inView(mk({ due: '2026-10-09' }), 'today', today), false);
  eq(T.inView(mk({ due: '2026-10-22' }), 'upcoming', today), true);
  eq(T.inView(mk({ due: '2026-10-23' }), 'upcoming', today), false);
  eq(T.inView(mk({}), 'open', today), true);
  eq(T.inView(mk({ status: 'done' }), 'open', today), false);
  eq(T.inView(mk({ status: 'done' }), 'done', today), true);
});
test('search matches title and notes, ignoring case', () => {
  eq(T.matchesSearch(mk({ title: 'Laporan Harian' }), 'harian'), true);
  eq(T.matchesSearch(mk({ title: 'x', notes: 'Shop drawing rev.2' }), 'SHOP'), true);
  eq(T.matchesSearch(mk({ title: 'x' }), 'y'), false);
});
test('countsByArea', () => {
  const c = T.countsByArea([mk({ area: 'thesis', due: '2026-10-01' }), mk({ area: 'thesis' }), mk({ area: 'work', status: 'done' })], ['work', 'thesis'], '2026-10-08');
  eq(c, { work: { open: 0, overdue: 0 }, thesis: { open: 2, overdue: 1 } });
});
test('nextRepeatFor copies the task with the new date', () => {
  const t = mk({ title: 'Daily report', due: '2026-10-08', repeat: { freq: 'weekdays' }, notes: 'n', area: 'work', priority: 'high' });
  const n = T.nextRepeatFor(t, '2026-10-08');
  eq([n.title, n.due, n.status, n.priority, n.notes], ['Daily report', '2026-10-09', 'todo', 'high', 'n']);
  eq(T.nextRepeatFor(mk({ due: '2026-10-08' }), '2026-10-08'), null);
});

// ---------- validation ----------
test('validateTaskInput', () => {
  const base = { title: ' Write ', notes: '', area: 'work', priority: 'normal', due: null, repeat: null };
  const r = validateTaskInput(base);
  eq([r.ok, r.value.title], [true, 'Write']);
  eq(validateTaskInput({ ...base, title: '  ' }).errors.title !== undefined, true);
  eq(validateTaskInput({ ...base, due: '2026-02-30' }).errors.due !== undefined, true);
  eq(validateTaskInput({ ...base, repeat: { freq: 'daily' } }).errors.due !== undefined, true, 'repeat needs due');
  eq(validateTaskInput({ ...base, due: '2026-10-08', repeat: { freq: 'weekly', days: [] } }).errors.repeat !== undefined, true);
  eq(validateTaskInput({ ...base, area: 'nope' }).ok, false);
  eq(validateTaskInput({ ...base, title: 'x'.repeat(201) }).ok, false);
});

// ---------- import / export ----------
test('round trip: export then import gives the same tasks', () => {
  const doc = emptyDoc();
  doc.tasks.push(mk({ id: 'a', title: 'One', due: '2026-10-08', updatedAt: '2026-10-08T01:00:00Z', deletedAt: null, notes: '', doneAt: null, repeat: { freq: 'daily' }, nextId: null, sample: false }));
  const res = parseBackup(buildExport(doc));
  eq(res.ok, true);
  eq(res.doc.tasks.length, 1);
  eq(res.doc.tasks[0].title, 'One');
  eq(res.doc.tasks[0].repeat, { freq: 'daily' });
  eq(res.doc.schemaVersion, SCHEMA_VERSION);
});
test('import rejects non-JSON and non-Louvi files', () => {
  eq(parseBackup('hello').ok, false);
  eq(parseBackup('[1,2]').ok, false);
  eq(parseBackup('{"tasks": []}').ok, false);
});
test('import rejects data from a newer version', () => {
  const res = parseBackup(JSON.stringify({ app: 'louvi', schemaVersion: SCHEMA_VERSION + 1, tasks: [] }));
  eq(res.ok, false);
  ok(/newer version/.test(res.error));
});
test('import reports skipped, fixed and duplicate records', () => {
  const res = parseBackup(JSON.stringify({
    app: 'louvi', schemaVersion: 1, settings: { name: 'Viony', theme: 'neon' },
    tasks: [
      { id: 'a', title: 'ok', area: 'work', priority: 'normal', status: 'todo', due: '2026-10-08', updatedAt: '2026-10-01T00:00:00Z' },
      { id: 'a', title: 'ok newer', area: 'work', priority: 'normal', status: 'todo', due: '2026-10-08', updatedAt: '2026-10-02T00:00:00Z' },
      { id: 'b', title: '', area: 'work' },
      { title: 'no id' },
      { id: 'c', title: 'bad fields', area: 'mars', priority: 'urgent', status: 'maybe', due: '2026-99-99', repeat: { freq: 'hourly' } },
    ],
  }));
  eq(res.ok, true);
  eq(res.report.skipped.tasks, 2);
  eq(res.report.fixed.tasks, 1);
  eq(res.report.duplicates.tasks, 1);
  eq(res.doc.tasks.find((t) => t.id === 'a').title, 'ok newer');
  const c = res.doc.tasks.find((t) => t.id === 'c');
  eq([c.area, c.priority, c.status, c.due, c.repeat], ['personal', 'normal', 'todo', null, null]);
  eq(res.doc.settings.theme, 'system');
  eq(res.doc.settings.name, 'Viony');
});
test('import keeps deletion markers (tombstones)', () => {
  const res = parseBackup(JSON.stringify({ app: 'louvi', schemaVersion: 1, tasks: [{ id: 'z', purged: true, deletedAt: '2026-10-01T00:00:00Z' }] }));
  eq(res.doc.tasks[0].purged, true);
  eq(countDoc(res.doc).tasks, { total: 0, done: 0, trash: 0 });
});
test('countDoc', () => {
  const doc = emptyDoc();
  doc.tasks = [mk({}), mk({ status: 'done' }), mk({ deletedAt: '2026-10-01T00:00:00Z' }), { id: 'p', purged: true, deletedAt: 'x' }];
  eq(countDoc(doc).tasks, { total: 2, done: 1, trash: 1 });
});

// ---------- links ----------
test('normalizeUrl adds https and rejects unsafe or broken links', () => {
  eq(L.normalizeUrl('drive.google.com/file/d/abc'), 'https://drive.google.com/file/d/abc');
  eq(L.normalizeUrl('  https://doi.org/10.1000/xyz '), 'https://doi.org/10.1000/xyz');
  eq(L.normalizeUrl('javascript:alert(1)'), null);
  eq(L.normalizeUrl('mailto:a@b.com'), null);
  eq(L.normalizeUrl('not a link'), null);
  eq(L.normalizeUrl('hello'), null);
  eq(L.normalizeUrl(''), null);
});
test('defaultLabel recognises common sites', () => {
  eq(L.defaultLabel('https://drive.google.com/file/d/1'), 'Google Drive');
  eq(L.defaultLabel('https://www.linkedin.com/jobs/view/1'), 'LinkedIn');
  eq(L.defaultLabel('https://doi.org/10.1/x'), 'DOI');
  eq(L.defaultLabel('https://www.example.co.id/a'), 'example.co.id');
});
test('task validation keeps valid links and rejects bad ones', () => {
  const base = { title: 'x', notes: '', area: 'work', priority: 'normal', due: null, repeat: null };
  const good = validateTaskInput({ ...base, links: [{ label: 'CV', url: 'drive.google.com/x' }] });
  eq(good.value.links, [{ label: 'CV', url: 'https://drive.google.com/x' }]);
  eq(validateTaskInput({ ...base, links: [{ url: 'javascript:alert(1)' }] }).ok, false);
});
test('import drops unsafe links and reports it', () => {
  const res = parseBackup(JSON.stringify({ app: 'louvi', schemaVersion: 1, tasks: [
    { id: 'a', title: 'x', area: 'work', priority: 'normal', status: 'todo', links: [{ label: 'ok', url: 'https://a.com' }, { url: 'javascript:x' }] },
    { id: 'b', title: 'old task without links', area: 'work', priority: 'normal', status: 'todo' },
  ] }));
  eq(res.doc.tasks[0].links, [{ label: 'ok', url: 'https://a.com/' }]);
  eq(res.report.fixed.tasks, 1);
  eq(res.doc.tasks[1].links, []);
});
test('repeat copies keep links', () => {
  const t = mk({ due: '2026-10-08', repeat: { freq: 'daily' }, links: [{ label: 'Form', url: 'https://a.com/' }] });
  eq(T.nextRepeatFor(t, '2026-10-08').links, [{ label: 'Form', url: 'https://a.com/' }]);
});
test('search also matches link labels', () => {
  eq(T.matchesSearch(mk({ title: 'x', links: [{ label: 'Shop drawing rev 3', url: 'https://a.com' }] }), 'rev 3'), true);
});

// ---------- money ----------
test('parseRupiah accepts common Indonesian formats', () => {
  const v = (x) => M.parseRupiah(x).value;
  eq(v('8000000'), 8000000);
  eq(v('8.000.000'), 8000000);
  eq(v('Rp 8.000.000'), 8000000);
  eq(v('Rp8.000.000,00'), 8000000);
  eq(v('8jt'), 8000000);
  eq(v('8,5 jt'), 8500000);
  eq(v('8.5 juta'), 8500000);
  eq(v('750rb'), 750000);
  eq(v('12k'), 12000);
  eq(v(''), null);
  eq(M.parseRupiah('abc').ok, false);
  eq(M.parseRupiah('-5jt').ok, false);
  eq(M.parseRupiah('8.00.000').ok, false);
});
test('formatRupiah and ranges', () => {
  eq(M.formatRupiah(8500000), 'Rp8.500.000');
  eq(M.formatRupiahShort(8500000), 'Rp8,5 jt');
  eq(M.formatRupiahShort(750000), 'Rp750 rb');
  eq(M.formatRange(8000000, 12000000), 'Rp8–12 jt');
  eq(M.formatRange(8000000, null), 'Rp8 jt+');
  eq(M.formatRange(null, 12000000), 'up to Rp12 jt');
  eq(M.formatRange(null, null), '');
});

// ---------- career ----------
const app = (o) => ({ id: Math.random().toString(36).slice(2), company: 'PT A', position: 'Engineer', status: 'applied', requiredSkills: [], interviews: [], statusLog: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...o });
test('parseSkillList splits and de-duplicates', () => {
  eq(C.parseSkillList('AutoCAD, Primavera P6; ms project\nautocad,  '), ['AutoCAD', 'Primavera P6', 'ms project']);
});
test('matchFor: covered, weak, missing', () => {
  const skills = C.skillMap([{ id: 's1', name: 'AutoCAD', level: 4 }, { id: 's2', name: 'Primavera P6', level: 2 }]);
  const m = C.matchFor(app({ requiredSkills: ['autocad', 'Primavera P6', 'BIM'] }), skills);
  eq([m.covered, m.weak.map((w) => w.name), m.missing, m.pct], [['autocad'], ['Primavera P6'], ['BIM'], 33]);
  eq(C.matchFor(app({}), skills).pct, null);
});
test('gapSummary counts only active applications and ranks by demand', () => {
  const skills = [{ id: 's1', name: 'AutoCAD', level: 4 }, { id: 's2', name: 'Primavera P6', level: 2 }];
  const apps = [
    app({ id: 'a', requiredSkills: ['BIM', 'Primavera P6', 'AutoCAD'] }),
    app({ id: 'b', requiredSkills: ['bim'] }),
    app({ id: 'c', status: 'rejected', requiredSkills: ['Revit'] }),
  ];
  const g = C.gapSummary(apps, skills);
  eq(g.map((x) => [x.name, x.appIds.length, x.level]), [['BIM', 2, null], ['Primavera P6', 1, 2]]);
});
test('nextStep picks the earliest interview or follow-up', () => {
  const a = app({ status: 'interview', interviews: [
    { id: '1', date: '2026-10-20', time: '', type: 'user', outcome: 'upcoming' },
    { id: '2', date: '2026-10-12', time: '09:00', type: 'hr', outcome: 'upcoming' },
    { id: '3', date: '2026-10-05', time: '', type: 'psych', outcome: 'passed' },
  ] });
  eq(C.nextStep(a, '2026-10-08', null).date, '2026-10-12');
  eq(C.nextStep(a, '2026-10-08', { status: 'todo', due: '2026-10-10' }).kind, 'followup');
  eq(C.nextStep(app({}), '2026-10-08', { status: 'done', due: '2026-10-10' }), null);
  eq(C.nextStep(app({ status: 'rejected', interviews: a.interviews }), '2026-10-08', null), null, 'closed apps have no next interview');
});
test('staleDays flags long silences', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  eq(C.staleDays(app({ statusLog: [{ status: 'applied', at: '2026-08-01T00:00:00Z' }] }), now) > 30, true);
  eq(C.staleDays(app({ statusLog: [{ status: 'applied', at: '2026-10-01T00:00:00Z' }] }), now), 0);
  eq(C.staleDays(app({ status: 'interview', statusLog: [{ status: 'interview', at: '2026-01-01T00:00:00Z' }] }), now), 0);
});
test('withStatus logs changes only', () => {
  eq(C.withStatus(app({ status: 'applied' }), 'applied'), {});
  const p = C.withStatus(app({ status: 'applied' }), 'interview', 'T');
  eq([p.status, p.statusLog], ['interview', [{ status: 'interview', at: 'T' }]]);
});
test('validateApplicationInput', () => {
  const base = { company: 'PT Wika', position: 'Project Control', status: 'applied', workMode: '', appliedAt: '2026-10-01', salaryMin: '8jt', salaryMax: '12.000.000', requiredSkills: 'Primavera, MS Project', links: [] };
  const r = C.validateApplicationInput(base);
  eq([r.ok, r.value.salaryMin, r.value.salaryMax, r.value.requiredSkills], [true, 8000000, 12000000, ['Primavera', 'MS Project']]);
  eq(C.validateApplicationInput({ ...base, company: '' }).errors.company !== undefined, true);
  eq(C.validateApplicationInput({ ...base, salaryMin: '15jt' }).errors.salaryMax !== undefined, true);
  eq(C.validateApplicationInput({ ...base, salaryMin: 'banyak' }).errors.salaryMin !== undefined, true);
  eq(C.validateApplicationInput({ ...base, status: 'maybe' }).ok, false);
});
test('validateSkillInput rejects duplicates by name', () => {
  const existing = [{ id: 's1', name: 'AutoCAD', level: 3, category: 'software' }];
  eq(C.validateSkillInput({ name: 'autocad', level: 2, category: 'software' }, existing).ok, false);
  eq(C.validateSkillInput({ name: 'autocad', level: 2, category: 'software' }, existing, 's1').ok, true, 'editing itself is fine');
  eq(C.validateSkillInput({ name: 'Revit', level: 9, category: 'software' }, existing).ok, false);
});
test('validateInterviewInput', () => {
  eq(C.validateInterviewInput({ date: '2026-10-12', time: '09:30', type: 'hr', outcome: 'upcoming' }).ok, true);
  eq(C.validateInterviewInput({ date: '2026-10-12', time: '25:00', type: 'hr', outcome: 'upcoming' }).ok, false);
  eq(C.validateInterviewInput({ date: '', type: 'hr', outcome: 'upcoming' }).ok, false);
});
test('import normalizes applications and skills', () => {
  const res = parseBackup(JSON.stringify({ app: 'louvi', schemaVersion: 2,
    applications: [
      { id: 'a', company: 'PT A', position: 'PE', status: 'weird', salaryMin: 12000000, salaryMax: 8000000, interviews: [{ id: 'i', date: '2026-10-12', type: 'zoom', outcome: 'x' }, { date: 'bad' }] },
      { id: 'b', company: '', position: 'x' },
    ],
    skills: [{ id: 's', name: ' AutoCAD ', level: 7, category: 'x' }],
  }));
  eq(res.ok, true);
  const a = res.doc.applications[0];
  eq([a.status, a.salaryMin, a.salaryMax, a.interviews.length, a.interviews[0].type, a.interviews[0].outcome], ['applied', 8000000, 12000000, 1, 'other', 'upcoming']);
  eq(res.report.skipped.applications, 1);
  eq(res.doc.skills[0].name, 'AutoCAD');
  eq([res.doc.skills[0].level, res.doc.skills[0].category], [1, 'technical']);
});
test('a version-1 backup upgrades to version 2 with empty career lists', () => {
  const res = parseBackup(JSON.stringify({ app: 'louvi', schemaVersion: 1, tasks: [] }));
  eq([res.ok, res.report.upgradedFrom, res.doc.applications, res.doc.skills], [true, 1, [], []]);
});

// ---------- finance ----------
const accts = [
  { id: 'bca', name: 'BCA', type: 'bank' },
  { id: 'rd', name: 'Reksadana', type: 'investment' },
  { id: 'au', name: 'Emas', type: 'gold' },
  { id: 'cicil', name: 'Cicilan emas', type: 'debt' },
];
const cats = structuredClone(F.DEFAULT_CATEGORIES);
test('months: add, between, labels', () => {
  eq(F.addMonths('2026-11', 2), '2027-01');
  eq(F.addMonths('2026-01', -1), '2025-12');
  eq(F.monthsBetween('2026-10', '2029-06'), 32);
  eq(F.monthLabel('2026-10'), 'October 2026');
  eq(F.isValidMonth('2026-13'), false);
});
test('parseGrams', () => {
  eq(F.parseGrams('10').value, 10);
  eq(F.parseGrams('2,5 gr').value, 2.5);
  eq(F.parseGrams('0.12345').value, 0.1235);
  eq(F.parseGrams('abc').ok, false);
  eq(F.parseGrams('').value, null);
});
test('net worth: assets, gold by price, debts subtracted', () => {
  const snap = { month: '2026-10', balances: { bca: 10000000, rd: 5000000, au: 10, cicil: 8000000 }, goldPrice: 1500000 };
  const t = F.snapshotTotals(snap, accts);
  eq([t.assets, t.debts, t.netWorth, t.missingGoldPrice], [30000000, 8000000, 22000000, false]);
});
test('net worth: gold without a price is flagged, not guessed', () => {
  const t = F.snapshotTotals({ month: '2026-10', balances: { bca: 1000, au: 5 }, goldPrice: null }, accts);
  eq([t.netWorth, t.missingGoldPrice], [1000, true]);
});
test('monthTotals separates spending from saving', () => {
  const tx = [
    { type: 'income', date: '2026-10-25', amount: 9000000, category: 'Salary' },
    { type: 'expense', date: '2026-10-02', amount: 50000, category: 'Food & drinks' },
    { type: 'expense', date: '2026-10-03', amount: 30000, category: 'Food & drinks' },
    { type: 'expense', date: '2026-10-05', amount: 1200000, category: 'Gold installment' },
    { type: 'expense', date: '2026-09-30', amount: 999, category: 'Shopping' },
  ];
  const m = F.monthTotals(tx, '2026-10', cats);
  eq([m.income, m.spending, m.saving, m.leftover, m.count], [9000000, 80000, 1200000, 7720000, 4]);
  eq(m.byCategory[0], { category: 'Gold installment', amount: 1200000, kind: 'saving' });
});
test('yearSummary has 12 months and totals', () => {
  const y = F.yearSummary('2026', [{ type: 'income', date: '2026-03-01', amount: 100, category: 'Salary' }], [{ month: '2026-03', balances: { bca: 500 }, goldPrice: null }], accts, cats);
  eq([y.rows.length, y.totals.income, y.rows[2].netWorth, y.rows[3].netWorth], [12, 100, 500, null]);
});
test('goalProgress: on track vs behind, nominal math', () => {
  const snaps = [
    { month: '2026-07', balances: { rd: 10000000 }, goldPrice: null },
    { month: '2026-08', balances: { rd: 12000000 }, goldPrice: null },
    { month: '2026-09', balances: { rd: 14000000 }, goldPrice: null },
    { month: '2026-10', balances: { rd: 16000000 }, goldPrice: null },
  ];
  const goal = { target: 40000000, targetDate: '2027-10-01', accountIds: ['rd'] };
  const p = F.goalProgress(goal, accts, snaps, '2026-10');
  eq([p.current, p.remaining, p.pct, p.recentAvg, p.monthsLeft, p.neededPerMonth, p.status, p.etaMonth], [16000000, 24000000, 40, 2000000, 12, 2000000, 'on-track', '2027-10']);
  const p2 = F.goalProgress({ ...goal, targetDate: '2027-04-01' }, accts, snaps, '2026-10');
  eq([p2.neededPerMonth, p2.status], [4000000, 'behind']);
  eq(F.goalProgress({ ...goal, target: 15000000 }, accts, snaps, '2026-10').status, 'achieved');
  eq(F.goalProgress({ ...goal, targetDate: null }, accts, snaps, '2026-10').status, 'no-deadline');
  eq(F.goalProgress(goal, accts, [], '2026-10').status, 'no-data');
});
test('goalProgress counts gold accounts at the snapshot gold price', () => {
  const p = F.goalProgress({ target: 30000000, targetDate: null, accountIds: ['au'] }, accts, [{ month: '2026-10', balances: { au: 10 }, goldPrice: 1500000 }], '2026-10');
  eq(p.current, 15000000);
});
test('validateSnapshotInput', () => {
  const ok = F.validateSnapshotInput({ month: '2026-10', balancesText: { bca: '10jt', au: '2,5', cicil: '8.000.000', rd: '' }, goldPriceText: '1.500.000' }, accts);
  eq(ok.value.balances, { bca: 10000000, au: 2.5, cicil: 8000000 });
  eq(F.validateSnapshotInput({ month: '2026-10', balancesText: { au: '2' }, goldPriceText: '' }, accts).errors.goldPrice !== undefined, true, 'gold needs a price');
  eq(F.validateSnapshotInput({ month: '2026-10', balancesText: {}, goldPriceText: '' }, accts).errors.form !== undefined, true);
  eq(F.validateSnapshotInput({ month: '2026-10', balancesText: { bca: 'banyak' }, goldPriceText: '' }, accts).errors['bal-bca'] !== undefined, true);
});
test('validateTransactionInput', () => {
  const r = F.validateTransactionInput({ type: 'expense', date: '2026-10-08', amount: '45rb', category: 'Food & drinks', note: 'Lunch' }, cats);
  eq([r.ok, r.value.amount], [true, 45000]);
  eq(F.validateTransactionInput({ type: 'expense', date: '2026-10-08', amount: '0', category: 'Food & drinks' }, cats).ok, false);
  eq(F.validateTransactionInput({ type: 'income', date: '2026-10-08', amount: '1jt', category: 'Food & drinks' }, cats).ok, false, 'category must match type');
});
test('validateGoalInput requires a non-debt account', () => {
  eq(F.validateGoalInput({ name: 'Wedding', target: '150jt', accountIds: ['cicil'] }, accts).errors.accountIds !== undefined, true);
  const g = F.validateGoalInput({ name: 'Wedding', target: '150jt', targetDate: '2029-06-01', accountIds: ['rd', 'au'] }, accts);
  eq([g.ok, g.value.target], [true, 150000000]);
});
test('validateAccountInput rejects duplicate names', () => {
  eq(F.validateAccountInput({ name: 'bca', type: 'bank' }, accts).ok, false);
  eq(F.validateAccountInput({ name: 'BCA', type: 'bank' }, accts, 'bca').ok, true);
});
test('import normalizes finance data and keeps categories', () => {
  const res = parseBackup(JSON.stringify({ app: 'louvi', schemaVersion: 3,
    settings: { financeCategories: { income: ['Gaji'], expense: [{ name: 'Makan', kind: 'spend' }, { name: 'Cicil', kind: 'saving' }, { name: 'Makan' }] } },
    accounts: [{ id: 'a', name: 'BCA', type: 'weird' }],
    snapshots: [{ id: 's', month: '2026-10', balances: { a: 100, b: -5 }, goldPrice: 'x' }, { id: 's2', month: 'bad' }],
    transactions: [{ id: 't', type: 'expense', date: '2026-10-01', amount: 5000, category: 'Makan' }, { id: 't2', type: 'expense', date: '2026-10-01', amount: -1 }],
    savingsGoals: [{ id: 'g', name: 'Nikah', target: 1000, accountIds: ['a', 5], targetDate: 'soon' }],
  }));
  eq(res.ok, true);
  eq(res.doc.accounts[0].type, 'bank');
  eq(res.doc.snapshots[0].balances, { a: 100 });
  eq(res.doc.snapshots[0].goldPrice, null);
  eq([res.report.skipped.snapshots, res.report.skipped.transactions], [1, 1]);
  eq(res.doc.savingsGoals[0].accountIds, ['a']);
  eq(res.doc.savingsGoals[0].targetDate, null);
  eq(res.doc.settings.financeCategories.income, ['Gaji']);
  eq(res.doc.settings.financeCategories.expense.length, 2);
});
test('older backups get finance collections and default categories', () => {
  const res = parseBackup(JSON.stringify({ app: 'louvi', schemaVersion: 2, tasks: [], applications: [], skills: [] }));
  eq([res.doc.schemaVersion, res.doc.accounts, res.doc.settings.financeCategories.income[0]], [3, [], 'Salary']);
});

// ---------- CSV import ----------
const SAMPLE_CSV = "Tanggal Apply,Platform,Web Link,Perusahaan,Lokasi,Position,Progress,Final Progress,Catatan\n\"Kamis, 13 Maret 2025\",Web Carreer,https://rekrutmenbersama2025.fhcibumn.id/login,FHCI BUMN (Jasa Marga),Jakarta,Engineering Assist,Submitted,Declined,Catatan\n\"Rabu, 14 Mei 2025\",Linkedin,,AFRY,Jakarta,Document Control,Submitted,Waiting,Catatan\n\"Rabu, 14 Mei 2025\",Web Carreer,/recruitment.polytechnic.astra.ac.id,Politeknik Astra,Cikarang,Instruktur,Interview,Waiting,intv 27/5/25\n\"Rabu, 28 Mei 2025\",Linkedin,,PT. PGN LGN,,Position,Submitted,Waiting,Catatan\n\"Selasa, 17 Juni 2025\",Web Carreer,disnakerja',Mandiri Sekuritas,,Management Trainee,Submitted,Waiting,apply via email\n\"Jumat, 04 Juli 2025\",Web Carreer,https://unilever.wd3.myworkdayjobs.com/en-US/Unilever_Experienced_Professionals/job/x,PT. Unilever,,\"Unilever Leadership Internship Program - Indonesia (August 2025)\",Online Test,Waiting,Catatan\n\"Senin, 26 Mei 2025\",Web Carreer,https://pwc.wd3.myworkdayjobs.com/en-US/Global_Campus_Careers/job/Associate,PWC Indonesia,Jakarta,\"Associate - Assurance, Cybersecurity\",Submitted,Waiting,Catatan\n\"Rabu, 14 Mei 2025\",Linkedin,,AFRY,Jakarta,Document Control,Submitted,Waiting,Catatan\n,,,,,Position,,,Catatan\n";
test('parseCSV handles quotes, commas, empty lines and semicolons', () => {
  eq(parseCSV('a,b\n"x, y","say ""hi"""\n\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  eq(parseCSV('﻿a;b\r\n1;2'), [['a', 'b'], ['1', '2']]);
});
test('parseIndoDate', () => {
  eq(I.parseIndoDate('Kamis, 13 Maret 2025'), '2025-03-13');
  eq(I.parseIndoDate('04 Juli 2025'), '2025-07-04');
  eq(I.parseIndoDate('15 Agustus 2025'), '2025-08-15');
  eq(I.parseIndoDate('13/03/2025'), '2025-03-13');
  eq(I.parseIndoDate('2025-03-13'), '2025-03-13');
  eq(I.parseIndoDate('May 14, 2025'), '2025-05-14');
  eq(I.parseIndoDate('31 Februari 2025'), null);
  eq(I.parseIndoDate('besok'), null);
});
test('statusFrom maps progress and final columns', () => {
  eq(I.statusFrom('Submitted', 'Declined'), 'rejected');
  eq(I.statusFrom('Interview', 'Waiting'), 'interview');
  eq(I.statusFrom('Online Test', 'Waiting'), 'screening');
  eq(I.statusFrom('Submitted', 'Waiting'), 'applied');
  eq(I.statusFrom('', 'Diterima'), 'accepted');
});
test('prepareImport maps the user sheet layout', () => {
  const r = I.prepareImport(SAMPLE_CSV, [], { today: '2026-10-08' });
  eq(r.ok, true);
  eq(r.columns.map((c) => c.field).sort(), ['appliedAt', 'company', 'final', 'link', 'location', 'notes', 'position', 'progress', 'source']);
  eq(r.rows.length, 7);
  eq(r.duplicates, 1, 'second AFRY row');
  const by = Object.fromEntries(r.rows.map((x) => [x.value.company, x.value]));
  eq([by['FHCI BUMN (Jasa Marga)'].status, by['FHCI BUMN (Jasa Marga)'].appliedAt, by['FHCI BUMN (Jasa Marga)'].source], ['rejected', '2025-03-13', 'Company website']);
  eq(by['AFRY'].source, 'LinkedIn');
  eq(by['Politeknik Astra'].status, 'interview');
  eq(by['Politeknik Astra'].links[0].url, 'https://recruitment.polytechnic.astra.ac.id/');
  eq(by['Politeknik Astra'].notes.split('\n')[0], 'intv 27/5/25');
  eq(by['PT. PGN LGN'].position, 'Position not recorded');
  eq(by['AFRY'].notes.includes('Catatan'), false, 'placeholder note dropped');
  eq(by['Mandiri Sekuritas'].links, []);
  eq(by['Mandiri Sekuritas'].notes.includes("Link in sheet: disnakerja'"), true);
  eq(by['PT. Unilever'].status, 'screening');
  eq(by['PWC Indonesia'].links[0].url.includes('Global_Campus_Careers'), true);
  eq(by['PWC Indonesia'].position, 'Associate - Assurance, Cybersecurity');
  eq(r.staleCount, 6, 'waiting > 90 days');
});
test('prepareImport skips duplicates of existing applications', () => {
  const r = I.prepareImport(SAMPLE_CSV, [{ company: 'afry', position: 'document control', appliedAt: '2025-05-14' }], { today: '2026-10-08' });
  eq([r.rows.length, r.duplicates], [6, 2]);
});
test('prepareImport needs a company column', () => {
  eq(I.prepareImport('Name,Date\nx,y').ok, false);
  eq(I.prepareImport('Perusahaan').ok, false);
});

// ---------- sync merge ----------
const base = () => { const d = emptyDoc(); d.meta.createdAt = '2026-10-01T00:00:00Z'; return d; };
const rec = (id, upd, extra = {}) => ({ id, title: id, area: 'work', priority: 'normal', status: 'todo', due: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: upd, deletedAt: null, ...extra });
test('merge keeps records from both sides', () => {
  const a = base(); a.tasks = [rec('a', '2026-10-02T00:00:00Z')];
  const b = base(); b.tasks = [rec('b', '2026-10-02T00:00:00Z')];
  const m = mergeDocs(a, b);
  eq(m.doc.tasks.map((t) => t.id), ['a', 'b']);
  eq([m.changedLocal, m.changedRemote], [true, true]);
});
test('merge: newer edit wins, deletions travel', () => {
  const a = base(); a.tasks = [rec('x', '2026-10-05T00:00:00Z', { title: 'laptop edit' }), rec('y', '2026-10-01T00:00:00Z')];
  const b = base(); b.tasks = [rec('x', '2026-10-04T00:00:00Z', { title: 'phone edit' }), rec('y', '2026-10-06T00:00:00Z', { deletedAt: '2026-10-06T00:00:00Z' })];
  const m = mergeDocs(a, b);
  eq(m.doc.tasks.find((t) => t.id === 'x').title, 'laptop edit');
  eq(m.doc.tasks.find((t) => t.id === 'y').deletedAt, '2026-10-06T00:00:00Z');
});
test('merge: purged tombstone beats an older live copy', () => {
  const a = base(); a.tasks = [rec('z', '2026-10-01T00:00:00Z')];
  const b = base(); b.tasks = [{ id: 'z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', deletedAt: '2026-10-07T00:00:00Z', purged: true }];
  eq(mergeDocs(a, b).doc.tasks[0].purged, true);
});
test('merge: identical data reports no change (key order ignored)', () => {
  const a = base(); a.tasks = [rec('a', '2026-10-02T00:00:00Z')];
  const b = structuredClone(a);
  b.tasks = [Object.fromEntries(Object.entries(b.tasks[0]).reverse())];
  const m = mergeDocs(a, b);
  eq([m.changedLocal, m.changedRemote], [false, false]);
});
test('merge: settings merge key by key', () => {
  const a = base(); a.settings.name = 'Viony'; a.settings._ts = { name: '2026-10-02T00:00:00Z' }; a.settings.theme = 'dark'; a.settings._ts.theme = '2026-10-09T00:00:00Z';
  const b = base(); b.settings.name = 'Vio'; b.settings._ts = { name: '2026-10-05T00:00:00Z', theme: '2026-10-01T00:00:00Z' }; b.settings.theme = 'light';
  b.settings.lastExportAt = '2026-10-08T00:00:00Z';
  const m = mergeDocs(a, b);
  eq([m.doc.settings.name, m.doc.settings.theme, m.doc.settings.lastExportAt], ['Vio', 'dark', '2026-10-08T00:00:00Z']);
});
test('merge: a fresh device takes the synced settings', () => {
  const fresh = base();
  const synced = base(); synced.settings.name = 'Viony'; synced.settings._ts = { name: '2026-10-02T00:00:00Z' };
  eq(mergeDocs(fresh, synced).doc.settings.name, 'Viony');
});
test('merge result is stable when merged again', () => {
  const a = base(); a.tasks = [rec('a', '2026-10-02T00:00:00Z')];
  const b = base(); b.tasks = [rec('b', '2026-10-03T00:00:00Z')];
  const m1 = mergeDocs(a, b).doc;
  const m2 = mergeDocs(m1, m1);
  eq([m2.changedLocal, m2.changedRemote, canonical(m2.doc) === canonical(m1)], [false, false, true]);
});

// ---------- migrations ----------
test('migrate fills missing parts of an old/partial document', () => {
  const { doc, from } = migrate({ app: 'louvi' });
  eq(from, 0);
  eq(doc.schemaVersion, SCHEMA_VERSION);
  eq(Array.isArray(doc.tasks), true);
  eq(doc.settings.theme, 'system');
});
test('migrate does not modify its input', () => {
  const input = { app: 'louvi', schemaVersion: 3, tasks: [] };
  migrate(input);
  eq(input.settings, undefined);
});

export async function run(log = console.log) {
  let passed = 0;
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (e) {
      failures.push({ name: t.name, error: e.message });
    }
  }
  log(`${passed}/${tests.length} tests passed`);
  for (const f of failures) log(`✗ ${f.name}: ${f.error}`);
  return { passed, total: tests.length, failures };
}
