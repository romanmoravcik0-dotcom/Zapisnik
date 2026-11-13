/* Zápisník zostatku — service worker.
   Opening the app: try the network first (briefly), so a new version shows
   on the next launch; with no signal, open from the copy kept on the phone.
   The app's script carries its version in its address, so a new page always
   pulls the matching script. */
const VERSION = "v13";
const CACHE = "zapisnik-" + VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./app.js?v=13",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];
const NAV_TIMEOUT_MS = 2500;

self.addEventListener("install", ev => {
  ev.waitUntil(
    caches.open(CACHE)
      // "reload": skip the browser's own cache, or a fresh install can store old files
      .then(c => c.addAll(SHELL.map(u => new Request(u, {cache: "reload"}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(req, ms){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req, {cache: "no-cache"}).then(res => {
      clearTimeout(t);
      if (res && res.ok){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put("./index.html", copy));
        resolve(res);
      } else reject(new Error("bad response"));
    }, err => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate"){
    ev.respondWith(
      fromNetwork(req, NAV_TIMEOUT_MS).catch(() =>
        caches.match("./index.html").then(hit => hit || caches.match("./")))
    );
    return;
  }

  // Script, icons, manifest: from the phone first; fetch only what is missing.
  ev.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && res.type === "basic"){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
