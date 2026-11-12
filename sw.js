/* Zápisník zostatku — service worker.
   The whole app is four small files, so cache them all on install and serve
   from the cache first. That is what lets the app open with no network. */
const VERSION = "v5";
const CACHE = "zapisnik-" + VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", ev => {
  ev.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the app shell from cache, so a cold start works offline.
  if (req.mode === "navigate"){
    ev.respondWith(
      caches.match("./index.html").then(hit => {
        const net = fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put("./index.html", res.clone()));
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Everything else: cache first, refresh in the background.
  ev.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok && res.type === "basic") caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
