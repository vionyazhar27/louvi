// Light / dark / match device.
// The choice is also mirrored in localStorage so index.html can apply it before the app loads
// (prevents a flash of the wrong theme). The real setting lives in louvi's data.

const META_COLORS = { light: '#FBF5F3', dark: '#1B1416' };

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try { localStorage.setItem('louvi:theme', theme); } catch { /* storage blocked: fine */ }
  updateMetaColor();
}

function effectiveTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateMetaColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLORS[effectiveTheme()]);
}

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateMetaColor);
