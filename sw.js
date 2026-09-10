const CACHE_NAME = 'advyza-v1';
const APP_SHELL = [
  '/',
  '/app.html',
  '/index.html',
  '/login.html',
  '/check-results.html',
  '/css/base.css',
  '/css/app.css',
  '/css/landing.css',
  '/css/check-results.css',
  '/js/grading.js',
  '/js/app.js',
  '/js/check-results.js',
  '/js/landing.js',
  '/js/auth.js',
  '/js/api-config.js',
  '/js/supabase-config.js',
  '/assets/advyza-logo.svg',
  '/assets/advyza-favicon.png',
  '/assets/futo-logo.jpeg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
