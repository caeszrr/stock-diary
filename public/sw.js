// App-shell cache-first (background-refreshed), quote-data network-first.
// No hardcoded pre-cache list of hashed build filenames — those change every
// deploy, so the shell is cached lazily as the app is used instead of via a
// build-time manifest. Bump the cache name suffix to force-invalidate old
// caches after a structural change to this file.
const SHELL_CACHE = 'stock-diary-shell-v1';
const DATA_CACHE = 'stock-diary-data-v1';
const CURRENT_CACHES = new Set([SHELL_CACHE, DATA_CACHE]);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !CURRENT_CACHES.has(k)).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Stale-while-revalidate: serve the cached shell instantly, refresh in the background.
    fetch(request).then((response) => cache.put(request, response)).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
