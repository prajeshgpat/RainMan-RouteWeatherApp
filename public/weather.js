// Pure weather helpers: Open-Meteo request building and normalization, WMO code to icon
// mapping, and localStorage cache helpers. No DOM or Google Maps dependencies, so they can
// be unit-tested in Node. Weather data by Open-Meteo.com (CC BY 4.0).

var OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
var OPEN_METEO_HOURLY = "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,is_day"
var MAX_POINTS_PER_REQUEST = 150
var WX_TTL_MS = 45 * 60 * 1000
var WX_MAX_CELLS = 300
var GEO_MAX_ENTRIES = 300
var HOUR_MS = 3600000

var WEATHER_ICONS = [
  "clear-day",
  "clear-night",
  "partly-cloudy-day",
  "partly-cloudy-night",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "extreme-rain",
  "snow",
  "sleet",
  "thunderstorms-rain",
  "wind",
  "not-available",
]

// ---- Open-Meteo request and response ----

// One request for any number of points: [{ lat, lng }]
function buildForecastUrl(points) {
  var lats = []
  var lngs = []
  for (var i = 0; i < points.length; i++) {
    lats.push(String(Number(Number(points[i].lat).toFixed(4))))
    lngs.push(String(Number(Number(points[i].lng).toFixed(4))))
  }
  return (
    OPEN_METEO_URL +
    "?latitude=" + lats.join(",") +
    "&longitude=" + lngs.join(",") +
    "&hourly=" + OPEN_METEO_HOURLY +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime&timezone=GMT&forecast_days=4"
  )
}

function numOrNull(v) {
  return v == null || isNaN(Number(v)) ? null : Number(v)
}

// Drop the hours already over: keep the first entry whose t + 1h > now, and everything after it
function sliceFromNow(hourly, nowMs) {
  for (var i = 0; i < hourly.length; i++) {
    if (hourly[i].t + HOUR_MS > nowMs) return hourly.slice(i)
  }
  return []
}

// One Open-Meteo location object -> [{ t, temp, pop, wind, gust, code, isDay }] starting at the current hour
function normalizeLocation(loc, nowMs) {
  var h = loc && loc.hourly
  if (!h || !Array.isArray(h.time)) return []
  var out = []
  for (var i = 0; i < h.time.length; i++) {
    var t = numOrNull(h.time[i])
    if (t === null) continue
    var pop = numOrNull(h.precipitation_probability && h.precipitation_probability[i])
    var code = numOrNull(h.weather_code && h.weather_code[i])
    var isDay = h.is_day ? h.is_day[i] : 1
    out.push({
      t: t * 1000,
      temp: numOrNull(h.temperature_2m && h.temperature_2m[i]),
      pop: pop === null ? 0 : Math.min(1, Math.max(0, pop / 100)),
      wind: numOrNull(h.wind_speed_10m && h.wind_speed_10m[i]) || 0,
      gust: numOrNull(h.wind_gusts_10m && h.wind_gusts_10m[i]) || 0,
      code: code === null ? 0 : code,
      isDay: isDay == null ? true : Number(isDay) !== 0,
    })
  }
  return sliceFromNow(out, nowMs)
}

// A single coordinate returns one object, several return an array in request order.
// Always returns an array of hourly arrays, one per requested coordinate.
function normalizeResponse(json, nowMs) {
  var list = Array.isArray(json) ? json : [json]
  return list.map(function (loc) {
    return normalizeLocation(loc, nowMs)
  })
}

// ---- Cells and caches ----

function roundTo(v, step, digits) {
  var r = Math.round(v / step) * step
  var s = r.toFixed(digits)
  return s === "-0.0" || s === "-0.00" ? s.slice(1) : s
}

// Forecast cache cell: 0.1 degree grid
function wxCell(lat, lng) {
  return { key: "wx:" + roundTo(lat, 0.1, 1) + ":" + roundTo(lng, 0.1, 1), lat: Number(roundTo(lat, 0.1, 1)), lng: Number(roundTo(lng, 0.1, 1)) }
}

// Reverse geocode cache key: 0.05 degree grid
function geoKey(lat, lng) {
  return "geo:" + roundTo(lat, 0.05, 2) + ":" + roundTo(lng, 0.05, 2)
}

function storageSet(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    return false
  }
}

function storageGet(storage, key) {
  try {
    var raw = storage.getItem(key)
    return raw == null ? null : JSON.parse(raw)
  } catch (e) {
    return null
  }
}

// Cached hourly forecast for a cell, re-sliced to the current hour, or null on miss/expiry
function wxCacheGet(storage, key, nowMs) {
  if (!storage) return null
  var rec = storageGet(storage, key)
  if (!rec || !Array.isArray(rec.hourly) || typeof rec.fetchedAt !== "number") return null
  if (nowMs - rec.fetchedAt > WX_TTL_MS || rec.fetchedAt > nowMs + 60000) return null
  var hourly = sliceFromNow(rec.hourly, nowMs)
  return hourly.length > 0 ? hourly : null
}

function wxCachePut(storage, key, hourly, nowMs) {
  if (!storage) return false
  return storageSet(storage, key, { fetchedAt: nowMs, hourly: hourly })
}

function storageKeys(storage, prefix) {
  var keys = []
  try {
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i)
      if (k && k.indexOf(prefix) === 0) keys.push(k)
    }
  } catch (e) {}
  return keys
}

function storageRemove(storage, key) {
  try {
    storage.removeItem(key)
  } catch (e) {}
}

// Remove expired forecast cells, then evict the oldest beyond the cap
function wxCachePrune(storage, nowMs, maxCells) {
  if (!storage) return
  var cap = maxCells || WX_MAX_CELLS
  var live = []
  storageKeys(storage, "wx:").forEach(function (key) {
    var rec = storageGet(storage, key)
    if (!rec || typeof rec.fetchedAt !== "number" || nowMs - rec.fetchedAt > WX_TTL_MS) {
      storageRemove(storage, key)
    } else {
      live.push({ key: key, at: rec.fetchedAt })
    }
  })
  live.sort(function (a, b) {
    return a.at - b.at
  })
  while (live.length > cap) storageRemove(storage, live.shift().key)
}

// Reverse geocode results: { name, at }, no TTL
function geoCacheGet(storage, key) {
  if (!storage) return null
  var rec = storageGet(storage, key)
  return rec && typeof rec.name === "string" ? rec.name : null
}

function geoCachePut(storage, key, name, nowMs) {
  if (!storage) return false
  var ok = storageSet(storage, key, { name: name, at: nowMs })
  if (ok) geoCachePrune(storage, GEO_MAX_ENTRIES)
  return ok
}

function geoCachePrune(storage, maxEntries) {
  if (!storage) return
  var keys = storageKeys(storage, "geo:")
  if (keys.length <= maxEntries) return
  var recs = keys.map(function (key) {
    var rec = storageGet(storage, key)
    return { key: key, at: rec && typeof rec.at === "number" ? rec.at : 0 }
  })
  recs.sort(function (a, b) {
    return a.at - b.at
  })
  for (var i = 0; i < recs.length - maxEntries; i++) storageRemove(storage, recs[i].key)
}

// ---- Batched, cached fetching ----

// Hourly forecasts for any number of points, in order: [{ lat, lng }] -> Promise of
// [hourly array | null]. Points in the same 0.1 degree cell share data; only cells missing
// from the cache are requested (at the cell centre), in chunks of MAX_POINTS_PER_REQUEST.
// env = { fetch, storage, now }. A failed chunk leaves its points as null.
function loadForecasts(points, env) {
  var now = env.now()
  var cells = {}
  var order = []
  var cellOf = points.map(function (p) {
    var c = wxCell(p.lat, p.lng)
    if (!cells[c.key]) {
      cells[c.key] = { lat: c.lat, lng: c.lng, hourly: wxCacheGet(env.storage, c.key, now) }
      order.push(c.key)
    }
    return c.key
  })
  var misses = order.filter(function (key) {
    return !cells[key].hourly
  })
  var chunks = []
  for (var i = 0; i < misses.length; i += MAX_POINTS_PER_REQUEST) {
    chunks.push(misses.slice(i, i + MAX_POINTS_PER_REQUEST))
  }

  return Promise.all(
    chunks.map(function (keys) {
      var url = buildForecastUrl(
        keys.map(function (key) {
          return cells[key]
        })
      )
      return env
        .fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error("Open-Meteo returned HTTP " + response.status)
          return response.json()
        })
        .then(function (json) {
          var lists = normalizeResponse(json, now)
          keys.forEach(function (key, idx) {
            var hourly = lists[idx]
            if (hourly && hourly.length > 0) {
              cells[key].hourly = hourly
              wxCachePut(env.storage, key, hourly, now)
            }
          })
        })
        .catch(function (error) {
          if (typeof console !== "undefined") console.error("Weather fetch failed:", error)
        })
    })
  ).then(function () {
    return cellOf.map(function (key) {
      return cells[key].hourly || null
    })
  })
}

// ---- WMO weather code to icon ----

// File name (without .svg) of the Meteocons icon for a WMO code. wind is optional (mph):
// a windy but otherwise fair hour shows the wind icon.
function weatherIconName(code, isDay, wind) {
  var day = isDay !== false
  var c = Number(code)
  if (code == null || isNaN(c)) return "not-available"
  if (c <= 3 && wind > 30) return "wind"
  if (c === 0 || c === 1) return day ? "clear-day" : "clear-night"
  if (c === 2) return day ? "partly-cloudy-day" : "partly-cloudy-night"
  if (c === 3) return "overcast"
  if (c === 45 || c === 48) return "fog"
  if (c === 56 || c === 57 || c === 66 || c === 67) return "sleet"
  if (c >= 51 && c <= 55) return "drizzle"
  if (c === 65 || c === 82) return "extreme-rain"
  if (c === 61 || c === 63 || c === 80 || c === 81) return "rain"
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow"
  if (c === 95 || c === 96 || c === 99) return "thunderstorms-rain"
  return "not-available"
}

if (typeof module !== "undefined") {
  module.exports = {
    WEATHER_ICONS: WEATHER_ICONS,
    WX_TTL_MS: WX_TTL_MS,
    MAX_POINTS_PER_REQUEST: MAX_POINTS_PER_REQUEST,
    buildForecastUrl: buildForecastUrl,
    sliceFromNow: sliceFromNow,
    normalizeLocation: normalizeLocation,
    normalizeResponse: normalizeResponse,
    wxCell: wxCell,
    geoKey: geoKey,
    wxCacheGet: wxCacheGet,
    wxCachePut: wxCachePut,
    wxCachePrune: wxCachePrune,
    geoCacheGet: geoCacheGet,
    geoCachePut: geoCachePut,
    geoCachePrune: geoCachePrune,
    loadForecasts: loadForecasts,
    roundTo: roundTo,
    storageGet: storageGet,
    storageSet: storageSet,
    HOUR_MS: HOUR_MS,
    weatherIconName: weatherIconName,
  }
}
