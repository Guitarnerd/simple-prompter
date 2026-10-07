// Offline shell. Everything the app needs is cached on install; scripts themselves live in IndexedDB.
// Same-origin files and the Google Fonts are served from cache first and refreshed in the background,
// so a new deploy shows up the second time the app is opened.

// Bump this to make every device drop its cached copy and reload with the new one right away.
const CACHE = 'prompter-v2';
const SHELL = [
  './',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/google.js',
  'js/parser.js',
  'js/prompter.js',
  'js/remote.js',
  'js/sample.js',
  'js/store.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !font) return;   // Google sign-in and Drive calls always go to the network

  e.respondWith(caches.open(CACHE).then(async cache => {
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await cache.match(key);
    // no-cache: check with the server each time, or the host's 10-minute browser cache hides new deploys
    const fresh = fetch(req, sameOrigin ? { cache: 'no-cache' } : undefined).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (hit) {
      e.waitUntil(fresh.catch(() => {}));
      return hit;
    }
    return fresh;
  }));
});
