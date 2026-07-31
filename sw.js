const CACHE   = 'louisfit-v1';
const OFFLINE = '/offline.html';

const PRECACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/data.js',
  '/auth.js',
  '/offline-sync.js',
  '/offline.html',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept Supabase API calls — offline-sync handles retry
  if (url.hostname.includes('supabase.co')) return;

  // Navigation — serve cached shell, fall back to offline page
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/index.html').then(r => r || caches.match(OFFLINE))
      )
    );
    return;
  }

  // Static assets — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
