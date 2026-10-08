// Career: job applications, interviews and skills. Pure logic (no DOM, no storage).

import { isValidISO, diffDays, nowStamp } from './dates.js';
import { cleanLinks, LINK_LIMITS } from './links.js';
import { parseRupiah, MAX_RUPIAH } from './money.js';

// ---------- constants ----------

export const STATUSES = [
  { id: 'saved', label: 'Saved', group: 'active', hint: 'Interested, not applied yet' },
  { id: 'applied', label: 'Applied', group: 'active' },
  { id: 'screening', label: 'Screening & tests', group: 'active', hint: 'HR screening, online tests, psikotes' },
  { id: 'interview', label: 'Interviewing', group: 'active' },
  { id: 'offer', label: 'Offer', group: 'active' },
  { id: 'accepted', label: 'Accepted', group: 'closed' },
  { id: 'rejected', label: 'Rejected', group: 'closed' },
  { id: 'ghosted', label: 'No response', group: 'closed' },
  { id: 'withdrawn', label: 'Withdrawn', group: 'closed' },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label ?? id;
export const isActive = (app) => STATUSES.find((s) => s.id === app.status)?.group === 'active';

export const WORK_MODES = [
  { id: '', label: 'Not sure' },
  { id: 'onsite', label: 'On-site' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'remote', label: 'Remote' },
];
export const WORK_MODE_IDS = WORK_MODES.map((m) => m.id);
export const workModeLabel = (id) => WORK_MODES.find((m) => m.id === id && id)?.label ?? '';

export const INTERVIEW_TYPES = [
  { id: 'hr', label: 'HR interview' },
  { id: 'user', label: 'User interview' },
  { id: 'technical', label: 'Technical test' },
  { id: 'psych', label: 'Psychological test' },
  { id: 'mcu', label: 'Medical check-up' },
  { id: 'final', label: 'Final interview' },
  { id: 'other', label: 'Other' },
];
export const INTERVIEW_TYPE_IDS = INTERVIEW_TYPES.map((t) => t.id);
export const interviewTypeLabel = (id) => INTERVIEW_TYPES.find((t) => t.id === id)?.label ?? 'Interview';

export const OUTCOMES = [
  { id: 'upcoming', label: 'Upcoming / waiting' },
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: "Didn't pass" },
];
export const OUTCOME_IDS = OUTCOMES.map((o) => o.id);

export const SKILL_CATEGORIES = [
  { id: 'technical', label: 'Technical' },
  { id: 'software', label: 'Software & tools' },
  { id: 'management', label: 'Management' },
  { id: 'soft', label: 'Soft skills' },
  { id: 'language', label: 'Language' },
];
export const SKILL_CATEGORY_IDS = SKILL_CATEGORIES.map((c) => c.id);

export const SKILL_LEVELS = [
  { id: 1, label: 'Beginner', hint: 'Learning it; needs guidance' },
  { id: 2, label: 'Basic', hint: 'Can do simple work with it' },
  { id: 3, label: 'Solid', hint: 'Use it on the job without help' },
  { id: 4, label: 'Strong', hint: 'Handle complex work; others ask you' },
  { id: 5, label: 'Expert', hint: 'Could teach or lead it' },
];
export const levelLabel = (n) => SKILL_LEVELS.find((l) => l.id === n)?.label ?? 'Not set';
// A required skill counts as covered from this level up.
export const SOLID_LEVEL = 3;

export const STALE_DAYS = 30;

export const CAREER_LIMITS = {
  company: 120, position: 120, location: 120, source: 80,
  jobDescription: 20000, notes: 5000, skillName: 60, requiredSkills: 40, interviews: 30, interviewNotes: 2000,
};

// ---------- skills ----------

export const skillKey = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Splits "AutoCAD, Primavera P6; MS Project" into clean, de-duplicated names.
export function parseSkillList(text) {
  const out = [];
  const seen = new Set();
  for (const part of String(text ?? '').split(/[,;\n]/)) {
    const name = part.trim().replace(/\s+/g, ' ').slice(0, CAREER_LIMITS.skillName);
    const key = skillKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function skillMap(skills) {
  const m = new Map();
  for (const s of skills) m.set(skillKey(s.name), s);
  return m;
}

// How well your skills cover one application's required skills.
export function matchFor(app, skillsByKey) {
  const req = app.requiredSkills || [];
  const covered = [], weak = [], missing = [];
  for (const name of req) {
    const s = skillsByKey.get(skillKey(name));
    if (!s) missing.push(name);
    else if (s.level >= SOLID_LEVEL) covered.push(name);
    else weak.push({ name, level: s.level });
  }
  return {
    total: req.length,
    covered, weak, missing,
    pct: req.length ? Math.round((covered.length / req.length) * 100) : null,
  };
}

// Skills that active applications ask for but you don't have yet (or below Solid),
// most-requested first. This is the "what to improve" list.
export function gapSummary(apps, skills) {
  const byKey = skillMap(skills);
  const gaps = new Map();
  for (const app of apps) {
    if (!isActive(app)) continue;
    for (const name of app.requiredSkills || []) {
      const key = skillKey(name);
      const s = byKey.get(key);
      if (s && s.level >= SOLID_LEVEL) continue;
      if (!gaps.has(key)) gaps.set(key, { key, name: s?.name ?? name, level: s?.level ?? null, skillId: s?.id ?? null, appIds: [] });
      const g = gaps.get(key);
      if (!g.appIds.includes(app.id)) g.appIds.push(app.id);
    }
  }
  return [...gaps.values()].sort((a, b) => b.appIds.length - a.appIds.length || a.name.localeCompare(b.name));
}

// How many active applications ask for each of your skills.
export function demandFor(apps) {
  const m = new Map();
  for (const app of apps) {
    if (!isActive(app)) continue;
    for (const name of app.requiredSkills || []) {
      const k = skillKey(name);
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}

// ---------- applications ----------

export function upcomingInterviews(app, today) {
  return (app.interviews || [])
    .filter((iv) => iv.date >= today && iv.outcome === 'upcoming')
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

// The next dated thing to do for an application: an interview or a follow-up.
export function nextStep(app, today, followUpTask) {
  const steps = [];
  const iv = isActive(app) ? upcomingInterviews(app, today)[0] : null;
  if (iv) steps.push({ kind: 'interview', date: iv.date, time: iv.time || '', label: interviewTypeLabel(iv.type), interview: iv });
  if (followUpTask && followUpTask.status !== 'done' && !followUpTask.deletedAt && followUpTask.due) {
    steps.push({ kind: 'followup', date: followUpTask.due, time: '', label: 'Follow up' });
  }
  steps.sort((a, b) => a.date.localeCompare(b.date));
  return steps[0] || null;
}

export function lastStatusChange(app) {
  const log = app.statusLog || [];
  return log.length ? log[log.length - 1].at : app.createdAt;
}

// Days since anything happened, for applications still waiting on a reply.
export function staleDays(app, now = new Date()) {
  if (app.status !== 'applied' && app.status !== 'screening') return 0;
  const last = [lastStatusChange(app), ...(app.interviews || []).map((i) => i.date)].filter(Boolean).sort().pop();
  const days = Math.floor((now - new Date(last)) / 86400000);
  return days >= STALE_DAYS ? days : 0;
}

export function daysSinceApplied(app, today) {
  return app.appliedAt ? diffDays(app.appliedAt, today) : null;
}

const STATUS_ORDER = Object.fromEntries(['offer', 'interview', 'screening', 'applied', 'saved', 'accepted', 'rejected', 'ghosted', 'withdrawn'].map((s, i) => [s, i]));

export function compareApplications(a, b) {
  const s = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
  if (s) return s;
  return (b.updatedAt || '').localeCompare(a.updatedAt || '');
}

export function matchesAppSearch(app, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [app.company, app.position, app.location, app.source, app.notes, ...(app.requiredSkills || [])]
    .some((v) => (v || '').toLowerCase().includes(q));
}

export function countByStatus(apps) {
  const out = Object.fromEntries(STATUS_IDS.map((s) => [s, 0]));
  for (const a of apps) if (out[a.status] !== undefined) out[a.status]++;
  return out;
}

// Adds a status-log entry when the status changes.
export function withStatus(app, status, at = nowStamp()) {
  if (app.status === status) return {};
  const log = [...(app.statusLog || []), { status, at }].slice(-50);
  return { status, statusLog: log };
}

// ---------- validation (form input) ----------

function cleanText(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

// Returns { ok, errors, value }. Salary fields accept text like "8jt" or "8.000.000".
export function validateApplicationInput(input) {
  const L = CAREER_LIMITS;
  const errors = {};
  const company = String(input.company ?? '').trim();
  const position = String(input.position ?? '').trim();
  if (!company) errors.company = 'Add the company name.';
  else if (company.length > L.company) errors.company = `Keep it under ${L.company} characters.`;
  if (!position) errors.position = 'Add the position.';
  else if (position.length > L.position) errors.position = `Keep it under ${L.position} characters.`;
  if (!STATUS_IDS.includes(input.status)) errors.status = 'Pick a status.';
  if (!WORK_MODE_IDS.includes(input.workMode ?? '')) errors.workMode = 'Pick a work mode.';

  const appliedAt = input.appliedAt ? String(input.appliedAt) : null;
  if (appliedAt && !isValidISO(appliedAt)) errors.appliedAt = 'Pick a valid date.';
  const followUp = input.followUp ? String(input.followUp) : null;
  if (followUp && !isValidISO(followUp)) errors.followUp = 'Pick a valid date.';

  const min = parseRupiah(input.salaryMin);
  const max = parseRupiah(input.salaryMax);
  if (!min.ok) errors.salaryMin = 'Use a number, e.g. 8000000 or 8jt.';
  if (!max.ok) errors.salaryMax = 'Use a number, e.g. 12000000 or 12jt.';
  if (min.ok && max.ok && min.value !== null && max.value !== null && min.value > max.value) {
    errors.salaryMax = 'The maximum is lower than the minimum.';
  }

  const jd = String(input.jobDescription ?? '').trim();
  if (jd.length > L.jobDescription) errors.jobDescription = `Job description can be up to ${L.jobDescription.toLocaleString('en')} characters.`;
  const notes = String(input.notes ?? '').trim();
  if (notes.length > L.notes) errors.notes = `Notes can be up to ${L.notes} characters.`;

  const requiredSkills = Array.isArray(input.requiredSkills) ? input.requiredSkills : parseSkillList(input.requiredSkills);
  if (requiredSkills.length > L.requiredSkills) errors.requiredSkills = `Keep it to ${L.requiredSkills} skills or fewer.`;

  const linkRes = cleanLinks(input.links || []);
  if (linkRes.invalid) errors.links = `Remove the link that isn't a valid web address (or keep it under ${LINK_LIMITS.count} links).`;

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok ? {
      company, position,
      location: cleanText(input.location, L.location),
      workMode: input.workMode ?? '',
      source: cleanText(input.source, L.source),
      status: input.status,
      appliedAt,
      salaryMin: min.value, salaryMax: max.value,
      jobDescription: jd,
      requiredSkills,
      notes,
      links: linkRes.links,
      followUp,
    } : null,
  };
}

export function validateInterviewInput(input) {
  const errors = {};
  if (!input.date || !isValidISO(input.date)) errors.date = 'Pick the date.';
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) errors.time = 'Use a time like 09:30.';
  if (!INTERVIEW_TYPE_IDS.includes(input.type)) errors.type = 'Pick a type.';
  if (!OUTCOME_IDS.includes(input.outcome)) errors.outcome = 'Pick an outcome.';
  const notes = String(input.notes ?? '').trim();
  if (notes.length > CAREER_LIMITS.interviewNotes) errors.notes = `Notes can be up to ${CAREER_LIMITS.interviewNotes} characters.`;
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { date: input.date, time: input.time || '', type: input.type, outcome: input.outcome, notes } : null };
}

export function validateSkillInput(input, existing = [], selfId = null) {
  const errors = {};
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Add the skill name.';
  else if (name.length > CAREER_LIMITS.skillName) errors.name = `Keep it under ${CAREER_LIMITS.skillName} characters.`;
  else if (existing.some((s) => s.id !== selfId && skillKey(s.name) === skillKey(name))) errors.name = 'You already have this skill in your list.';
  const level = Number(input.level);
  if (!SKILL_LEVELS.some((l) => l.id === level)) errors.level = 'Pick your level.';
  if (!SKILL_CATEGORY_IDS.includes(input.category)) errors.category = 'Pick a category.';
  const notes = String(input.notes ?? '').trim().slice(0, 1000);
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, level, category: input.category, notes } : null };
}

// ---------- import normalizers ----------

const stamp = (v) => (typeof v === 'string' && !isNaN(new Date(v)) ? v : null);

export function tombstoneFrom(raw) {
  return {
    id: raw.id,
    createdAt: stamp(raw.createdAt) ?? stamp(raw.deletedAt) ?? new Date().toISOString(),
    updatedAt: stamp(raw.updatedAt) ?? new Date().toISOString(),
    deletedAt: stamp(raw.deletedAt) ?? new Date().toISOString(),
    purged: true,
  };
}

function baseFields(raw) {
  return {
    id: raw.id,
    createdAt: stamp(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: stamp(raw.updatedAt) ?? stamp(raw.createdAt) ?? new Date().toISOString(),
    deletedAt: stamp(raw.deletedAt),
  };
}

const validRupiah = (v) => (Number.isFinite(v) && v >= 0 && v <= MAX_RUPIAH ? Math.round(v) : null);

export function normalizeImportedApplication(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.purged) return { record: tombstoneFrom(raw), fixed: [] };
  const L = CAREER_LIMITS;
  const company = typeof raw.company === 'string' ? raw.company.trim() : '';
  const position = typeof raw.position === 'string' ? raw.position.trim() : '';
  if (!company || !position) return null;
  const fixed = [];
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  const app = {
    ...baseFields(raw),
    company: company.slice(0, L.company),
    position: position.slice(0, L.position),
    location: text(raw.location, L.location),
    workMode: WORK_MODE_IDS.includes(raw.workMode) ? raw.workMode : '',
    source: text(raw.source, L.source),
    status: raw.status,
    appliedAt: raw.appliedAt ?? null,
    salaryMin: raw.salaryMin == null ? null : validRupiah(raw.salaryMin),
    salaryMax: raw.salaryMax == null ? null : validRupiah(raw.salaryMax),
    jobDescription: text(raw.jobDescription, L.jobDescription),
    requiredSkills: Array.isArray(raw.requiredSkills) ? parseSkillList(raw.requiredSkills.filter((s) => typeof s === 'string').join('\n')).slice(0, L.requiredSkills) : [],
    notes: text(raw.notes, L.notes),
    links: [],
    interviews: [],
    statusLog: [],
    followUpTaskId: typeof raw.followUpTaskId === 'string' ? raw.followUpTaskId : null,
  };
  if (!STATUS_IDS.includes(app.status)) { app.status = 'applied'; fixed.push('status'); }
  if (app.appliedAt !== null && !isValidISO(app.appliedAt)) { app.appliedAt = null; fixed.push('appliedAt'); }
  if ((raw.salaryMin != null && app.salaryMin === null) || (raw.salaryMax != null && app.salaryMax === null)) fixed.push('salary');
  if (app.salaryMin !== null && app.salaryMax !== null && app.salaryMin > app.salaryMax) {
    [app.salaryMin, app.salaryMax] = [app.salaryMax, app.salaryMin];
    fixed.push('salary');
  }
  if (raw.links !== undefined) {
    const lr = cleanLinks(raw.links);
    app.links = lr.links;
    if (lr.invalid) fixed.push('links');
  }
  if (Array.isArray(raw.interviews)) {
    for (const iv of raw.interviews.slice(0, L.interviews)) {
      if (!iv || typeof iv.id !== 'string' || !isValidISO(iv.date)) { fixed.push('interviews'); continue; }
      app.interviews.push({
        id: iv.id,
        date: iv.date,
        time: typeof iv.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(iv.time) ? iv.time : '',
        type: INTERVIEW_TYPE_IDS.includes(iv.type) ? iv.type : 'other',
        outcome: OUTCOME_IDS.includes(iv.outcome) ? iv.outcome : 'upcoming',
        notes: text(iv.notes, L.interviewNotes),
      });
    }
  }
  if (Array.isArray(raw.statusLog)) {
    app.statusLog = raw.statusLog
      .filter((e) => e && STATUS_IDS.includes(e.status) && stamp(e.at))
      .map((e) => ({ status: e.status, at: e.at }))
      .slice(-50);
  }
  return { record: app, fixed: [...new Set(fixed)] };
}

export function normalizeImportedSkill(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.purged) return { record: tombstoneFrom(raw), fixed: [] };
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return null;
  const fixed = [];
  const skill = {
    ...baseFields(raw),
    name: name.slice(0, CAREER_LIMITS.skillName),
    level: Number(raw.level),
    category: raw.category,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 1000) : '',
  };
  if (!SKILL_LEVELS.some((l) => l.id === skill.level)) { skill.level = 1; fixed.push('level'); }
  if (!SKILL_CATEGORY_IDS.includes(skill.category)) { skill.category = 'technical'; fixed.push('category'); }
  return { record: skill, fixed };
}
