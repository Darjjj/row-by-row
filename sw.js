// Offline support: keep the app files on the phone. Bump VERSION when any file changes.
const VERSION = "rbr-v18";
const FILES = ["./", "index.html", "style.css", "app.js", "pattern.js", "picture.js", "written.js", "backup.js", "attach.js", "builtin.js", "sync.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png"];

// Install a complete set straight from the server ("reload" skips the browser's HTTP cache, which GitHub Pages
// lets keep files for 10 minutes), so one version's files are never mixed with another's.
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first so updates arrive when online; fall back to the saved copy offline.
// App files are always checked with the server ("no-cache" revalidates instead of trusting the HTTP cache),
// and only good responses are saved, so an error page never replaces a working offline copy.
// Only app files and the Firebase library are cached; sync and sign-in traffic goes straight to the network.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const mine = url.origin === self.location.origin;
  if (!mine && url.hostname !== "www.gstatic.com") return;
  // A navigation request can't be copied with new options, so app files are fetched by URL.
  const req = mine ? new Request(url.href, { cache: "no-cache", credentials: "same-origin" }) : e.request;
  const saved = () => caches.match(e.request, { ignoreSearch: true });
  e.respondWith(
    fetch(req).then(res => {
      // The Firebase scripts come back "opaque" (no status visible), so those are kept as they are.
      if (!res.ok && res.type !== "opaque") return saved().then(c => c || res);
      const copy = res.clone();
      e.waitUntil(caches.open(VERSION).then(c => c.put(e.request, copy)));
      return res;
    }).catch(() => saved())
  );
});
