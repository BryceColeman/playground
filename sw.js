// sw.js — offline app shell. Caches the local files so studying works without a
// connection (your data is in IndexedDB, not here). The Tesseract CDN script is
// cached opportunistically once it has loaded so OCR can work offline later too.
const CACHE = 'ward-names-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/srs.js',
  './js/ocr.js',
  './js/study.js',
  './js/backup.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((res) => {
            // Cache same-origin assets and the Tesseract CDN bundle as we go.
            const url = new URL(e.request.url);
            if (
              res.ok &&
              (url.origin === location.origin ||
                url.host.includes('unpkg.com') ||
                url.host.includes('jsdelivr'))
            ) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          })
          .catch(() => hit)
    )
  );
});
