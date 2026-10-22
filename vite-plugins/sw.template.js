// RainMan service worker: caches the app shell so the app opens (and installs) without a network.
// Weather, maps, the /api backend and every other cross-origin request always go straight to the
// network. The precache list and cache version are filled in at build time by
// vite-plugins/precache-sw.ts, so every deploy gets a fresh cache.
const CACHE_VERSION = "__CACHE_VERSION__"
const PRECACHE = /*__PRECACHE__*/ []

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  )
})

function putInCache(request, response) {
  if (!response || !response.ok || response.type !== "basic") return
  const copy = response.clone()
  caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy))
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  // Never touch cross-origin requests (Open-Meteo, NWS, RainViewer, Google Maps, fonts), the
  // backend API, the accuracy data or the worker itself
  if (
    url.origin !== self.location.origin ||
    url.pathname === "/sw.js" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/data/")
  ) {
    return
  }

  if (request.mode === "navigate") {
    // Network first so a deploy shows up straight away; the cached shell is the offline fallback
    const key = url.pathname === "/" ? "/index.html" : url.pathname
    event.respondWith(
      fetch(request)
        .then((response) => {
          putInCache(key, response)
          return response
        })
        .catch(() => caches.match(key).then((cached) => cached || caches.match("/index.html")))
    )
    return
  }

  // Static files: answer from the cache and refresh it in the background
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          putInCache(request, response)
          return response
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
