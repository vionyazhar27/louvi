// Links attached to records (a Google Drive file, a job posting, a paper's DOI…).
// Only http(s) links are allowed, so a pasted "javascript:" link can never run.

const KNOWN_HOSTS = [
  [/^drive\.google\.com$/, 'Google Drive'],
  [/^docs\.google\.com$/, 'Google Docs'],
  [/^(onedrive\.live\.com|1drv\.ms)$/, 'OneDrive'],
  [/sharepoint\.com$/, 'SharePoint'],
  [/^(www\.)?dropbox\.com$/, 'Dropbox'],
  [/^(www\.)?notion\.(so|site)$/, 'Notion'],
  [/^(www\.|id\.)?linkedin\.com$/, 'LinkedIn'],
  [/jobstreet\./, 'JobStreet'],
  [/^(www\.)?glints\.com$/, 'Glints'],
  [/^scholar\.google\./, 'Google Scholar'],
  [/^(dx\.)?doi\.org$/, 'DOI'],
  [/sciencedirect\.com$/, 'ScienceDirect'],
  [/^(www\.)?researchgate\.net$/, 'ResearchGate'],
  [/^(www\.)?youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/^(www\.)?github\.com$/, 'GitHub'],
  [/^maps\.app\.goo\.gl$|^(www\.)?google\.[a-z.]+$/, 'Google'],
];

export const LINK_LIMITS = { count: 20, label: 80, url: 2000 };

// Turns what the user typed into a usable URL, or returns null.
// "drive.google.com/x" → "https://drive.google.com/x"
export function normalizeUrl(input) {
  let s = String(input ?? '').trim();
  if (!s || s.length > LINK_LIMITS.url || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
  return u.href;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function defaultLabel(url) {
  const host = hostOf(url);
  for (const [re, name] of KNOWN_HOSTS) if (re.test(host)) return name;
  return host || 'Link';
}

// Cleans a list of {label, url}. Returns { links, invalid } where invalid counts dropped items.
export function cleanLinks(list) {
  if (!Array.isArray(list)) return { links: [], invalid: list == null ? 0 : 1 };
  const links = [];
  let invalid = 0;
  for (const item of list) {
    const url = normalizeUrl(item?.url);
    if (!url) { invalid++; continue; }
    const label = String(item.label ?? '').trim().slice(0, LINK_LIMITS.label);
    links.push({ label, url });
  }
  if (links.length > LINK_LIMITS.count) invalid += links.length - LINK_LIMITS.count;
  return { links: links.slice(0, LINK_LIMITS.count), invalid };
}

export const linkText = (link) => link.label || defaultLabel(link.url);
