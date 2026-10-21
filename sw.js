// __BUILD__ is replaced with the git short SHA at Netlify build time (see netlify.toml)
const CACHE   = 'maxfit-v34-__BUILD__';
const OFFLINE = '/offline.html';

const PRECACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/data.js',
  '/state.js',
  '/auth.js',
  '/offline-sync.js',
  '/offline.html',
  '/chart.min.js',
  '/supabase.js',
];

// No automatic skipWaiting: a new version waits until the user taps
// "Actualiser" in the update toast (page posts SKIP_WAITING).
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
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
  if (e.request.method !== 'GET') return;

  // Navigation — serve network, fall back to cached shell, then offline page
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/index.html').then(r => r || caches.match(OFFLINE))
      )
    );
    return;
  }

  // JS / CSS — network-first so a fresh index.html never runs stale code
  if (url.origin === location.origin && /\.(js|css)$/.test(url.pathname)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Other static assets (images, icons) — cache-first
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
