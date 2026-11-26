// Offline support: keeps a copy of the app's files on the device.
// Your data is NOT here — it lives in the browser's storage and never leaves the device.
// Bump VERSION whenever app files change so phones pick up the update.
const VERSION = "v3";
const CACHE = `tracker-${VERSION}`;
const FILES = [
  "./",
  "index.html",
  "app.js",
  "styles.css",
  "manifest.webmanifest",
  "icon.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tracker-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up when online), fall back to the saved copy when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.endsWith("/api/data")) return; // old local server only
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
