// louvi service worker: makes the app open offline and load instantly.
//
// When you release a new version: bump VERSION (same as APP_VERSION in js/schema.js).
// The app then shows "A new version of louvi is ready" and updates on tap.
// FILES must list every file the app needs; tests/sw-files.test.mjs checks this.

const VERSION = '0.4.1';
const CACHE = `louvi-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/components.css',
  'css/tokens.css',
  'js/app.js',
  'js/backup.js',
  'js/lib/career-import.js',
  'js/lib/career.js',
  'js/lib/csv.js',
  'js/lib/dates.js',
  'js/lib/finance.js',
  'js/lib/id.js',
  'js/lib/links.js',
  'js/lib/merge.js',
  'js/lib/money.js',
  'js/lib/recurrence.js',
  'js/lib/tasks.js',
  'js/migrations.js',
  'js/modules/career-actions.js',
  'js/modules/career.js',
  'js/modules/data-tools.js',
  'js/modules/finance-actions.js',
  'js/modules/finance.js',
  'js/modules/home.js',
  'js/modules/settings.js',
  'js/modules/task-ui.js',
  'js/modules/tasks.js',
  'js/schema.js',
  'js/storage.js',
  'js/store.js',
  'js/sync.js',
  'js/theme.js',
  'js/ui/dialog.js',
  'js/ui/dom.js',
  'js/ui/icons.js',
  'js/ui/line-chart.js',
  'js/ui/link-editor.js',
  'js/ui/toast.js',
  'fonts/nunito.woff2',
  'fonts/plus-jakarta-sans-italic.woff2',
  'fonts/plus-jakarta-sans.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon-maskable.svg',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('louvi-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only this site's own files. GitHub sync requests go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Pages: try the network first so a fresh deploy shows up; fall back to the cached app.
    event.respondWith(fetch(req).catch(() => caches.match('index.html', { ignoreSearch: true })));
    return;
  }
  // Files: from the cache (versioned), falling back to the network.
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
