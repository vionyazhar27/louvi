// Rupiah input and display.
// Input is forgiving: "8000000", "8.000.000", "Rp 8.000.000", "8jt", "8,5 jt", "8.5 juta", "750rb".
// Values are stored as whole rupiah (integers).

export const MAX_RUPIAH = 1e13; // Rp10 triliun: a sanity ceiling for typos

// Returns { ok: true, value } (value null for empty input) or { ok: false }.
export function parseRupiah(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return { ok: true, value: null };
  s = s.replace(/^rp\.?\s*/, '').replace(/\s+/g, '');
  if (s.startsWith('-')) return { ok: false };

  const unit = /^(.*?)(jt|juta|rb|ribu|k|m)$/.exec(s);
  let value;
  if (unit) {
    const mult = { jt: 1e6, juta: 1e6, m: 1e6, rb: 1e3, ribu: 1e3, k: 1e3 }[unit[2]];
    // In "8,5jt" and "8.5jt" the separator is a decimal point.
    const num = unit[1].replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(num)) return { ok: false };
    value = Math.round(parseFloat(num) * mult);
  } else {
    // Plain number: dots and commas are thousand separators ("8.000.000"),
    // except a trailing ",00" / ".00" decimal part, which is dropped.
    let plain = s;
    if (/^\d+([.,]\d{3})*[.,]\d{1,2}$/.test(plain)) plain = plain.replace(/[.,]\d{1,2}$/, '');
    if (!/^\d{1,3}([.,]\d{3})+$|^\d+$/.test(plain)) return { ok: false };
    value = parseInt(plain.replace(/[.,]/g, ''), 10);
  }
  if (!Number.isFinite(value) || value > MAX_RUPIAH) return { ok: false };
  return { ok: true, value };
}

const groupID = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// "Rp8.000.000"
export function formatRupiah(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return 'Rp' + groupID(n);
}

// Short form for lists: "Rp8 jt", "Rp8,5 jt", "Rp750 rb", "Rp1,2 M"
export function formatRupiahShort(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (n >= 1e9) return `Rp${fmt(n / 1e9)} M`;
  if (n >= 1e6) return `Rp${fmt(n / 1e6)} jt`;
  if (n >= 1e3) return `Rp${fmt(n / 1e3)} rb`;
  return 'Rp' + groupID(n);
}

// "Rp8–12 jt", "Rp8 jt+", "up to Rp12 jt", or ''
export function formatRange(min, max) {
  const hasMin = Number.isFinite(min), hasMax = Number.isFinite(max);
  if (hasMin && hasMax) {
    if (min === max) return formatRupiahShort(min);
    const a = formatRupiahShort(min), b = formatRupiahShort(max);
    const unitA = a.split(' ')[1], unitB = b.split(' ')[1];
    if (unitA && unitA === unitB) return `${a.split(' ')[0]}–${b.replace('Rp', '')}`;
    return `${a} – ${b}`;
  }
  if (hasMin) return `${formatRupiahShort(min)}+`;
  if (hasMax) return `up to ${formatRupiahShort(max)}`;
  return '';
}
