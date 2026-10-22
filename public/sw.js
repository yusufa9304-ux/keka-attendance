/* Vutto Attendance — service worker for the full-stack app.
   Caches the static shell (pages, CSS, JS, icons) so the installed app opens
   fast and shows something useful offline. API calls are never cached. */

const CACHE = 'vutto-attendance-app-v1';
const SHELL = [
  '/',
  '/dashboard.html',
  '/admin.html',
  '/css/style.css',
  '/js/api.js',
  '/js/login.js',
  '/js/dashboard.js',
  '/js/admin.js',
  '/manifest.webmanifest',
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
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => hit || caches.match('/'));
      return hit || net;
    })
  );
});
