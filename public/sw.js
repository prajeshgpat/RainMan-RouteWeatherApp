// RainMan service worker: caches the app shell so the app opens (and installs) without a network.
// Weather, maps and every other cross-origin request always go straight to the network.
var CACHE_VERSION = "rainman-v1"
var SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/scoring.js",
  "/weather.js",
  "/markers.js",
  "/features.js",
  "/timebar.js",
  "/panels.js",
  "/script.js",
  "/manifest.webmanifest",
  "/icons/clear-day.svg",
  "/icons/clear-night.svg",
  "/icons/partly-cloudy-day.svg",
  "/icons/partly-cloudy-night.svg",
  "/icons/overcast.svg",
  "/icons/fog.svg",
  "/icons/drizzle.svg",
  "/icons/rain.svg",
  "/icons/extreme-rain.svg",
  "/icons/snow.svg",
  "/icons/sleet.svg",
  "/icons/thunderstorms-rain.svg",
  "/icons/wind.svg",
  "/icons/not-available.svg",
  "/images/icon-192.png",
  "/images/icon-512.png",
]

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(function (cache) {
        return cache.addAll(SHELL)
      })
      .then(function () {
        return self.skipWaiting()
      })
  )
})

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_VERSION
            })
            .map(function (key) {
              return caches.delete(key)
            })
        )
      })
      .then(function () {
        return self.clients.claim()
      })
  )
})

function putInCache(request, response) {
  if (!response || !response.ok || response.type !== "basic") return
  var copy = response.clone()
  caches.open(CACHE_VERSION).then(function (cache) {
    return cache.put(request, copy)
  })
}

self.addEventListener("fetch", function (event) {
  var request = event.request
  if (request.method !== "GET") return
  var url = new URL(request.url)
  // Never touch cross-origin requests (Open-Meteo, NWS, RainViewer, Google Maps, fonts) or the worker itself
  if (url.origin !== self.location.origin || url.pathname === "/sw.js") return

  if (request.mode === "navigate") {
    // Network first so a deploy shows up straight away; the cached shell is the offline fallback
    event.respondWith(
      fetch(request)
        .then(function (response) {
          putInCache("/index.html", response)
          return response
        })
        .catch(function () {
          return caches.match("/index.html").then(function (cached) {
            return cached || caches.match("/")
          })
        })
    )
    return
  }

  // Static files: answer from the cache and refresh it in the background
  event.respondWith(
    caches.match(request).then(function (cached) {
      var network = fetch(request)
        .then(function (response) {
          putInCache(request, response)
          return response
        })
        .catch(function () {
          return cached
        })
      return cached || network
    })
  )
})
