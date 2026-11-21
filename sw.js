/* Mini Studio — офлайн-кэш. Обновляйте CACHE при изменении файлов. */
const CACHE = 'mini-studio-v15';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/engines.js',
  './js/ui.js',
  './js/pattern.js',
  './js/midi-file.js',
  './js/audio.js',
  './js/export-mp3.js',
  './js/project-io.js',
  './js/touch.js',
  './js/kaoss.js',
  './js/kaoss-ui.js',
  './js/kaoss-deck.js',
  './js/app.js',
  './vendor/lame.min.js',
  './assets/panel-texture.jpg',
  './assets/pad-surface.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

// file:// (APK без локального сервера) — кэш недоступен, просто пропускаем
const canCache = location.protocol === 'http:' || location.protocol === 'https:';

self.addEventListener('install', (e) => {
  if (!canCache) return self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // навигация — сеть, при офлайне кэш
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return r;
    }).catch(() => hit))
  );
});
