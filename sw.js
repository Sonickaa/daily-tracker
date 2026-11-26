// Offline support: keeps a copy of the app's files on the device.
// Your data is NOT here — it lives in the browser's storage and never leaves the device.
// Bump VERSION whenever app files change so phones pick up the update.
const VERSION = "v5";
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

// GitHub Pages lets browsers reuse files for 10 minutes without asking. Bypass that,
// otherwise phones keep (and even re-save) the old version after an update.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tracker-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (always asks the server if a file changed; cheap when it hasn't),
// fall back to the saved copy when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith("/api/data")) return; // old local server only
  e.respondWith(
    fetch(req.url, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
