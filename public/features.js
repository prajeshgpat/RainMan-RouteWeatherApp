// Pure helpers for the extra features: NWS alerts, route comparison, shareable links, recent trips,
// temperature units, the radar tile URL, marker decluttering and the dark map style. No DOM or
// Google Maps dependencies, so they can be unit-tested in Node.

// ---- NWS severe weather alerts (US only) ----

// In the browser these come from weather.js (loaded first); in Node they are imported
if (typeof module !== "undefined") {
  var _wx = require("./weather.js")
  var roundTo = _wx.roundTo
  var storageGet = _wx.storageGet
  var storageSet = _wx.storageSet
  var HOUR_MS = _wx.HOUR_MS
}

var NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?point="
var NWS_TTL_MS = 15 * 60 * 1000
var NWS_MAX_POINTS = 8
var NWS_SEVERITY_RANK = { Extreme: 3, Severe: 2, Moderate: 1 }

// Rough bounding boxes of the contiguous US, Alaska and Hawaii
function inNwsCoverage(lat, lng) {
  if (lat >= 24.4 && lat <= 49.6 && lng >= -125.1 && lng <= -66.8) return true
  if (lat >= 51 && lat <= 71.6 && lng >= -170 && lng <= -129.9) return true
  if (lat >= 18.8 && lat <= 22.4 && lng >= -160.7 && lng <= -154.7) return true
  return false
}

function alertCellKey(lat, lng) {
  return "nws:" + roundTo(lat, 0.1, 1) + ":" + roundTo(lng, 0.1, 1)
}

// At most `max` points inside NWS coverage, evenly spaced along the list [{ lat, lng }],
// one per 0.1 degree cell (the alerts of a cell are cached together)
function pickAlertPoints(points, max) {
  var cap = max || NWS_MAX_POINTS
  var seen = {}
  var usable = points.filter(function (p) {
    if (!inNwsCoverage(p.lat, p.lng)) return false
    var key = alertCellKey(p.lat, p.lng)
    if (seen[key]) return false
    seen[key] = true
    return true
  })
  if (usable.length <= cap) return usable
  var out = []
  for (var i = 0; i < cap; i++) out.push(usable[Math.round((i * (usable.length - 1)) / (cap - 1))])
  return out
}

// GeoJSON FeatureCollections -> unique Moderate/Severe/Extreme alerts, worst first.
// [{ id, event, areaDesc, severity, level: "red" | "amber", headline }]
function mergeAlerts(collections) {
  var lists = collections.map(function (fc) {
    var features = fc && Array.isArray(fc.features) ? fc.features : []
    var list = []
    features.forEach(function (f) {
      var p = (f && f.properties) || {}
      var id = (f && f.id) || p.id
      var rank = NWS_SEVERITY_RANK[p.severity]
      if (!id || !rank) return
      list.push({
        id: id,
        event: p.event || "Weather alert",
        areaDesc: p.areaDesc || "",
        severity: p.severity,
        level: rank >= 2 ? "red" : "amber",
        headline: p.headline || "",
      })
    })
    return list
  })
  return mergeAlertLists(lists)
}

// Lists of already normalized alerts -> unique by id and by event + area, worst first
function mergeAlertLists(lists) {
  var seen = {}
  var out = []
  lists.forEach(function (list) {
    list.forEach(function (a) {
      var sameKey = "event:" + a.event + "|" + a.areaDesc
      if (seen["id:" + a.id] || seen[sameKey]) return
      seen["id:" + a.id] = true
      seen[sameKey] = true
      out.push(a)
    })
  })
  out.sort(function (a, b) {
    return NWS_SEVERITY_RANK[b.severity] - NWS_SEVERITY_RANK[a.severity] || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0)
  })
  return out
}

function truncateText(text, max) {
  var s = String(text || "")
  return s.length > max ? s.slice(0, Math.max(0, max - 1)).replace(/[\s;,]+$/, "") + "…" : s
}

// Cached alerts of one cell (already merged/filtered), or null on miss/expiry
function alertCacheGet(storage, key, nowMs) {
  if (!storage) return null
  var rec = storageGet(storage, key)
  if (!rec || !Array.isArray(rec.alerts) || typeof rec.fetchedAt !== "number") return null
  if (nowMs - rec.fetchedAt > NWS_TTL_MS || rec.fetchedAt > nowMs + 60000) return null
  return rec.alerts
}

function alertCachePut(storage, key, alerts, nowMs) {
  if (!storage) return false
  return storageSet(storage, key, { fetchedAt: nowMs, alerts: alerts })
}

// Alerts for a list of points [{ lat, lng }]: cached per 0.1 degree cell (storage = sessionStorage),
// the misses fetched in parallel. Any failure is silent (console.warn) and counts as no alerts.
// env = { fetch, storage, now }. Resolves to the merged alert list.
function loadAlerts(points, env) {
  var now = env.now()
  var chosen = pickAlertPoints(points, NWS_MAX_POINTS)
  return Promise.all(
    chosen.map(function (p) {
      var key = alertCellKey(p.lat, p.lng)
      var cached = alertCacheGet(env.storage, key, now)
      if (cached) return cached
      var url = NWS_ALERTS_URL + Number(p.lat).toFixed(4) + "," + Number(p.lng).toFixed(4)
      return env
        .fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error("NWS returned HTTP " + response.status)
          return response.json()
        })
        .then(function (json) {
          var merged = mergeAlerts([json])
          alertCachePut(env.storage, key, merged, now)
          return merged
        })
        .catch(function (error) {
          if (typeof console !== "undefined") console.warn("Weather alerts unavailable:", error)
          return []
        })
    })
  ).then(function (lists) {
    return mergeAlertLists(lists)
  })
}

// ---- Alternative routes ----

var ROUTE_NEAR_FASTEST_SEC = 15 * 60
var CLASS_RANK = { good: 0, okay: 1, bad: 2 }
var CLASS_NAME = { good: "Good", okay: "Okay", bad: "Bad", unknown: "No data" }

function formatDuration(seconds) {
  var minutes = Math.max(1, Math.round(seconds / 60))
  var h = Math.floor(minutes / 60)
  var m = minutes % 60
  if (h === 0) return m + "m"
  return h + "h" + (m ? " " + m + "m" : "")
}

function routeName(info, index) {
  return info.summary ? info.summary : "Route " + (index + 1)
}

// "Via I-5 · 4h 50m · Okay"; info = { summary, durationSec, cls }
function routeChipLabel(info, index) {
  return "Via " + routeName(info, index) + " · " + formatDuration(info.durationSec) + " · " + (CLASS_NAME[info.cls] || CLASS_NAME.unknown)
}

// If another route has a better class at the selected departure and is within 15 minutes of the
// fastest route, suggest it. infos = [{ summary, durationSec, cls }] -> { index, text, extraMinutes } | null
function routeSuggestion(infos, activeIndex) {
  var active = infos[activeIndex]
  if (!active || CLASS_RANK[active.cls] === undefined) return null
  var fastest = Infinity
  infos.forEach(function (r) {
    if (r.durationSec < fastest) fastest = r.durationSec
  })
  var best = null
  infos.forEach(function (r, i) {
    if (i === activeIndex || CLASS_RANK[r.cls] === undefined) return
    if (CLASS_RANK[r.cls] >= CLASS_RANK[active.cls]) return
    if (r.durationSec > fastest + ROUTE_NEAR_FASTEST_SEC) return
    if (
      !best ||
      CLASS_RANK[r.cls] < CLASS_RANK[infos[best.index].cls] ||
      (CLASS_RANK[r.cls] === CLASS_RANK[infos[best.index].cls] && r.durationSec < infos[best.index].durationSec)
    ) {
      best = { index: i }
    }
  })
  if (!best) return null
  var extra = Math.round((infos[best.index].durationSec - active.durationSec) / 60)
  var diff = extra === 0 ? "same time" : (extra > 0 ? "+" : "−") + Math.abs(extra) + " min"
  return {
    index: best.index,
    extraMinutes: extra,
    text: "Drier route via " + routeName(infos[best.index], best.index) + " (" + diff + ")",
  }
}

// ---- Shareable links ----

// ?from=<text|current>&to=<text>&leave=<epoch-hour ms|now> -> { from, to, leave: "now" | number } or null
function parseShareUrl(search) {
  var params = new URLSearchParams(search || "")
  var from = (params.get("from") || "").trim()
  var to = (params.get("to") || "").trim()
  if (!from || !to) return null
  var leaveRaw = params.get("leave")
  var leave = "now"
  if (leaveRaw && /^\d{10,14}$/.test(leaveRaw)) leave = Number(leaveRaw)
  return { from: from, to: to, leave: leave }
}

// state { from, to, leave } -> query string starting with "?" (empty when there is no route)
function serializeShareState(state) {
  if (!state || !state.from || !state.to) return ""
  var params = new URLSearchParams()
  params.set("from", state.from)
  params.set("to", state.to)
  params.set("leave", typeof state.leave === "number" ? String(state.leave) : "now")
  return "?" + params.toString()
}

// Start of the hour containing ms (UTC hours are the same instant for whole-hour offsets, and
// leave links use the whole-hour instant the sharer saw)
function hourFloor(ms) {
  return Math.floor(ms / HOUR_MS) * HOUR_MS
}

// ---- Recent trips ----

var RECENT_KEY = "rm:recent"
var RECENT_MAX = 5

function sameTrip(a, b) {
  return a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase()
}

// Newest first, no duplicates, at most RECENT_MAX. trip = { from, to } (from may be "current")
function addRecentTrip(list, trip) {
  var from = String(trip.from || "").trim()
  var to = String(trip.to || "").trim()
  if (!from || !to) return list.slice()
  var entry = { from: from, to: to }
  var out = [entry].concat(
    list.filter(function (t) {
      return !sameTrip(t, entry)
    })
  )
  return out.slice(0, RECENT_MAX)
}

function removeRecentTrip(list, index) {
  return list.filter(function (t, i) {
    return i !== index
  })
}

function loadRecentTrips(storage) {
  if (!storage) return []
  var list = storageGet(storage, RECENT_KEY)
  if (!Array.isArray(list)) return []
  return list
    .filter(function (t) {
      return t && typeof t.from === "string" && typeof t.to === "string" && t.from && t.to
    })
    .slice(0, RECENT_MAX)
}

function saveRecentTrips(storage, list) {
  if (!storage) return false
  return storageSet(storage, RECENT_KEY, list)
}

function shortPlace(text) {
  return text === "current" ? "Current location" : String(text).split(",")[0].trim()
}

function tripLabel(trip) {
  return shortPlace(trip.from) + " → " + shortPlace(trip.to)
}

// ---- Temperature units (data stays in F, converted for display only) ----

var UNIT_KEY = "rm:unit"

function normalizeUnit(value) {
  return value === "C" ? "C" : "F"
}

function convertTemp(f, unit) {
  if (f == null || isNaN(Number(f))) return null
  return unit === "C" ? Math.round(((Number(f) - 32) * 5) / 9) : Math.round(Number(f))
}

// "58°F" / "14°C"
function tempLabel(f, unit) {
  var v = convertTemp(f, unit)
  return v === null ? "" : v + "°" + normalizeUnit(unit)
}

// ---- Rain radar (RainViewer) ----

var RADAR_API_URL = "https://api.rainviewer.com/public/weather-maps.json"
var RADAR_MAX_ZOOM = 7

// weather-maps.json -> tile URL template with {z}/{x}/{y}, or null when there is no radar frame
function radarTemplate(json) {
  var past = json && json.radar && json.radar.past
  if (!json || !json.host || !Array.isArray(past) || past.length === 0) return null
  var last = past[past.length - 1]
  if (!last || !last.path) return null
  return json.host + last.path + "/256/{z}/{x}/{y}/2/1_1.png"
}

// Tile URL for map tile (x, y) at zoom, wrapping x around the world; null beyond the served zoom levels
function radarTileUrl(template, x, y, zoom) {
  if (!template || zoom > RADAR_MAX_ZOOM || zoom < 0) return null
  var n = Math.pow(2, zoom)
  if (y < 0 || y >= n) return null
  var wrapped = ((x % n) + n) % n
  return template.replace("{z}", zoom).replace("{x}", wrapped).replace("{y}", y)
}

// ---- Marker decluttering ----

var DECLUTTER_MIN_X = 56
var DECLUTTER_MIN_Y = 64 // a bit more vertically: the temperature pill hangs below the badge

// Indexes 0..n-1 ordered so that any prefix is spread evenly: both ends, then the middle,
// then the quarters, and so on
function spreadOrder(n) {
  var out = []
  if (n <= 0) return out
  out.push(0)
  if (n > 1) out.push(n - 1)
  var queue = [[0, n - 1]]
  while (queue.length) {
    var iv = queue.shift()
    if (iv[1] - iv[0] < 2) continue
    var mid = (iv[0] + iv[1]) >> 1
    out.push(mid)
    queue.push([iv[0], mid], [mid, iv[1]])
  }
  return out
}

// points: [{ x, y, priority }] in route order (x/y in screen pixels, higher priority is kept first;
// equal priorities are taken evenly spread along the route). Greedily keeps points that are not
// within opts.minX (default 56) horizontally AND opts.minY (default 64) vertically of a kept one.
// Returns the kept indexes in ascending order. At least one point is kept when there are any.
function declutterSelect(points, opts) {
  var minX = (opts && opts.minX) || DECLUTTER_MIN_X
  var minY = (opts && opts.minY) || (opts && opts.minX) || DECLUTTER_MIN_Y
  var rank = spreadOrder(points.length)
  var spreadRank = []
  rank.forEach(function (idx, r) {
    spreadRank[idx] = r
  })
  var order = points.map(function (p, i) {
    return i
  })
  order.sort(function (a, b) {
    return (points[b].priority || 0) - (points[a].priority || 0) || spreadRank[a] - spreadRank[b]
  })
  var kept = []
  order.forEach(function (i) {
    var p = points[i]
    var clear = kept.every(function (k) {
      return Math.abs(points[k].x - p.x) >= minX || Math.abs(points[k].y - p.y) >= minY
    })
    if (clear) kept.push(i)
  })
  return kept.sort(function (a, b) {
    return a - b
  })
}

// ---- Dark map style (night) ----

var MAP_DARK_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa7b8" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d0d7e0" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#9aa7b8" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
]

if (typeof module !== "undefined") {
  module.exports = {
    mergeAlertLists: mergeAlertLists,
    inNwsCoverage: inNwsCoverage,
    pickAlertPoints: pickAlertPoints,
    mergeAlerts: mergeAlerts,
    truncateText: truncateText,
    alertCacheGet: alertCacheGet,
    alertCachePut: alertCachePut,
    loadAlerts: loadAlerts,
    formatDuration: formatDuration,
    routeChipLabel: routeChipLabel,
    routeSuggestion: routeSuggestion,
    parseShareUrl: parseShareUrl,
    serializeShareState: serializeShareState,
    hourFloor: hourFloor,
    addRecentTrip: addRecentTrip,
    removeRecentTrip: removeRecentTrip,
    loadRecentTrips: loadRecentTrips,
    saveRecentTrips: saveRecentTrips,
    tripLabel: tripLabel,
    normalizeUnit: normalizeUnit,
    convertTemp: convertTemp,
    tempLabel: tempLabel,
    radarTemplate: radarTemplate,
    radarTileUrl: radarTileUrl,
    spreadOrder: spreadOrder,
    declutterSelect: declutterSelect,
    MAP_DARK_STYLES: MAP_DARK_STYLES,
  }
}
