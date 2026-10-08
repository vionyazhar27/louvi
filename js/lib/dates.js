// Date helpers. All due dates are stored as local calendar dates: "YYYY-MM-DD".
// We never store times for due dates, so time zones can't shift a deadline by a day.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export function isValidISO(s) {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Whole days from a to b (b - a). Uses UTC to stay exact across DST changes.
export function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function weekday(iso) {
  return parseISO(iso).getDay(); // 0 = Sunday
}

// Monday of the week containing iso.
export function startOfWeek(iso) {
  const wd = weekday(iso);
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "Thursday, 8 October 2026"
export function formatLong(iso) {
  const d = parseISO(iso);
  return `${WEEKDAY_LONG[d.getDay()]}, ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

// "8 Oct" (adds the year when it differs from the reference year)
export function formatShort(iso, refISO = todayISO()) {
  const d = parseISO(iso);
  const sameYear = iso.slice(0, 4) === refISO.slice(0, 4);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}

// "Today", "Tomorrow", "Yesterday", "Mon" (within the next 6 days), otherwise "8 Oct".
export function relativeLabel(iso, today = todayISO()) {
  const n = diffDays(today, iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WEEKDAY_SHORT[weekday(iso)];
  return formatShort(iso, today);
}

// Timestamps (createdAt, updatedAt, ...) are ISO strings with time.
export function nowStamp() {
  return new Date().toISOString();
}

export function formatStamp(stamp) {
  if (!stamp) return '';
  const d = new Date(stamp);
  if (isNaN(d)) return '';
  return `${formatShort(toISO(d))} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function daysSince(stamp, now = new Date()) {
  const d = new Date(stamp);
  if (isNaN(d)) return Infinity;
  return Math.floor((now - d) / 86400000);
}
