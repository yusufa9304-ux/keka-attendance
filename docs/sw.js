/* Vutto Attendance — service worker.
   NETWORK-FIRST: always try the network so a new deploy shows up immediately,
   and fall back to the cache only when offline. (Cache-first was hiding
   updates — don't change this back.) */

const CACHE = 'vutto-attendance-v24';
const SHELL = [
  './',
  './index.html',
  './404.html',
  './admin.html',
  './dashboard.html',
  './style.css',
  './app.js',
  './config.js',
  './sb.js',
  './vendor/supabase.js',
  './navpill.js',
  './geo.js',
  './xlsx.js',
  './capture.js',
  './manifest.webmanifest',
  './img/logo.svg',
  './img/logo-white.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
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
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network first; keep a copy for offline; fall back to cache when the
  // network is unavailable.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

// Allow the page to trigger an immediate update check.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
