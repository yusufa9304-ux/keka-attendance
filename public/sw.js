/* Vutto Attendance — service worker for the full-stack app.
   NETWORK-FIRST for the static shell so deploys land immediately; the cache is
   only a fallback for offline. API calls are never cached. */

const CACHE = 'vutto-attendance-app-v14';
const SHELL = [
  '/',
  '/dashboard.html',
  '/admin.html',
  '/css/style.css',
  '/js/api.js',
  '/js/capture.js',
  '/js/login.js',
  '/js/dashboard.js',
  '/js/admin.js',
  '/manifest.webmanifest',
  '/img/logo.png',
  '/img/logo-white.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Never cache the API — it must always hit the server.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
