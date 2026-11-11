// Kaizen web service worker: lets the app open from the home screen, even offline
// (shows the last version of the page; live data still needs the network).
// Network first for the site's own files, never touches the relay (Supabase) or other sites.
const CACHE = 'kaizen-web-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/views.js', 'js/api.js', 'js/util.js', 'js/config.js', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
