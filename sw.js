/* sw.js — Service Worker: App-Shell offline cachen.
   Daten liegen in IndexedDB (nicht hier). Cache-Version bei Änderungen hochzählen. */
const CACHE = "maki-v30";
const ASSETS = [
  "./", "./index.html", "./styles.css?v=30",
  "./js/icons.js?v=30", "./js/db.js?v=30", "./js/sync.js?v=30", "./js/store.js?v=30", "./js/app.js?v=30",
  "./manifest.webmanifest",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Network-first NUR für eigene Dateien. Fremde Domains (Google/Firebase-Auth,
// Firestore, CDN) werden NICHT angefasst — sonst scheitert die Anmeldung.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;  // Cross-Origin durchlassen
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
  );
});
