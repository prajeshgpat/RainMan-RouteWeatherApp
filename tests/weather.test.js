const test = require("node:test")
const assert = require("node:assert")
const w = require("../public/weather.js")

const HOUR = 3600000
// 00:00 GMT of a fixed day
const DAY0 = Date.UTC(2026, 5, 1)

// An Open-Meteo style location object with `hours` hourly values starting at DAY0
function loc(hours, fn) {
  const o = { hourly: { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [], is_day: [] } }
  for (let i = 0; i < hours; i++) {
    const v = Object.assign({ temp: 50 + i, pop: 10, code: 0, wind: 5, gust: 9, day: 1 }, fn ? fn(i) : {})
    o.hourly.time.push(DAY0 / 1000 + i * 3600)
    o.hourly.temperature_2m.push(v.temp)
    o.hourly.precipitation_probability.push(v.pop)
    o.hourly.weather_code.push(v.code)
    o.hourly.wind_speed_10m.push(v.wind)
    o.hourly.wind_gusts_10m.push(v.gust)
    o.hourly.is_day.push(v.day)
  }
  return o
}

function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}))
  return {
    get length() { return m.size },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    _map: m,
  }
}

test("buildForecastUrl lists coordinates and the hourly variables", () => {
  const url = w.buildForecastUrl([{ lat: 37.7749295, lng: -122.4194155 }, { lat: 40, lng: -100.5 }])
  assert.ok(url.startsWith("https://api.open-meteo.com/v1/forecast?"))
  assert.ok(url.includes("latitude=37.7749,40&longitude=-122.4194,-100.5"))
  assert.ok(url.includes("hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,is_day"))
  for (const p of ["temperature_unit=fahrenheit", "wind_speed_unit=mph", "timeformat=unixtime", "timezone=GMT", "forecast_days=4"]) {
    assert.ok(url.includes(p), p)
  }
})

test("normalizeLocation maps fields and units", () => {
  const out = w.normalizeLocation(loc(4, (i) => (i === 1 ? { pop: 80, code: 63, day: 0, wind: 22.5, gust: 40, temp: 31.4 } : {})), DAY0)
  assert.strictEqual(out.length, 4)
  assert.deepStrictEqual(out[1], { t: DAY0 + HOUR, temp: 31.4, pop: 0.8, wind: 22.5, gust: 40, code: 63, isDay: false })
  assert.strictEqual(out[0].isDay, true)
  assert.strictEqual(out[0].pop, 0.1)
})

test("normalizeLocation starts at the current hour", () => {
  const l = loc(10)
  // 03:40 GMT: hour 3 (03:00-04:00) is the current one
  const out = w.normalizeLocation(l, DAY0 + 3 * HOUR + 40 * 60000)
  assert.strictEqual(out.length, 7)
  assert.strictEqual(out[0].t, DAY0 + 3 * HOUR)
  // exactly on the hour: that hour is current
  assert.strictEqual(w.normalizeLocation(l, DAY0 + 5 * HOUR)[0].t, DAY0 + 5 * HOUR)
  // 1ms before the hour is still the previous one
  assert.strictEqual(w.normalizeLocation(l, DAY0 + 5 * HOUR - 1)[0].t, DAY0 + 4 * HOUR)
  assert.deepStrictEqual(w.normalizeLocation(l, DAY0 + 99 * HOUR), [])
})

test("normalizeLocation tolerates nulls and missing data", () => {
  const l = loc(3)
  l.hourly.precipitation_probability[0] = null
  l.hourly.temperature_2m[1] = null
  l.hourly.weather_code[2] = null
  const out = w.normalizeLocation(l, DAY0)
  assert.strictEqual(out[0].pop, 0)
  assert.strictEqual(out[1].temp, null)
  assert.strictEqual(out[2].code, 0)
  assert.deepStrictEqual(w.normalizeLocation({}, DAY0), [])
  assert.deepStrictEqual(w.normalizeLocation(null, DAY0), [])
})

test("normalizeResponse handles a single object and an array", () => {
  const single = w.normalizeResponse(loc(5), DAY0)
  assert.strictEqual(single.length, 1)
  assert.strictEqual(single[0].length, 5)
  const many = w.normalizeResponse([loc(5, () => ({ code: 61 })), loc(6, () => ({ code: 71 }))], DAY0)
  assert.strictEqual(many.length, 2)
  assert.strictEqual(many[0][0].code, 61)
  assert.strictEqual(many[1][0].code, 71)
  assert.strictEqual(many[1].length, 6)
})

test("weatherIconName maps WMO codes and day/night", () => {
  const n = w.weatherIconName
  assert.strictEqual(n(0, true), "clear-day")
  assert.strictEqual(n(0, false), "clear-night")
  assert.strictEqual(n(1, true), "clear-day")
  assert.strictEqual(n(2, true), "partly-cloudy-day")
  assert.strictEqual(n(2, false), "partly-cloudy-night")
  assert.strictEqual(n(3, false), "overcast")
  assert.strictEqual(n(45, true), "fog")
  assert.strictEqual(n(48, false), "fog")
  assert.strictEqual(n(53, true), "drizzle")
  assert.strictEqual(n(57, true), "sleet")
  assert.strictEqual(n(61, true), "rain")
  assert.strictEqual(n(65, true), "extreme-rain")
  assert.strictEqual(n(67, true), "sleet")
  assert.strictEqual(n(73, true), "snow")
  assert.strictEqual(n(77, true), "snow")
  assert.strictEqual(n(80, true), "rain")
  assert.strictEqual(n(82, true), "extreme-rain")
  assert.strictEqual(n(86, true), "snow")
  assert.strictEqual(n(95, true), "thunderstorms-rain")
  assert.strictEqual(n(99, false), "thunderstorms-rain")
  assert.strictEqual(n(2, true, 35), "wind")
  assert.strictEqual(n(63, true, 35), "rain") // wind icon only for fair weather
  assert.strictEqual(n(1234, true), "not-available")
  assert.strictEqual(n(null, true), "not-available")
  assert.strictEqual(n(undefined, true), "not-available")
})

test("every mapped icon exists in public/icons", () => {
  const fs = require("node:fs")
  const path = require("node:path")
  const used = new Set()
  for (let code = -1; code <= 100; code++) for (const d of [true, false]) used.add(w.weatherIconName(code, d, 0))
  used.add(w.weatherIconName(0, true, 50))
  for (const name of used) {
    assert.ok(w.WEATHER_ICONS.includes(name), name + " listed")
    assert.ok(fs.existsSync(path.join(__dirname, "../public/icons", name + ".svg")), name + ".svg exists")
  }
  assert.ok(fs.existsSync(path.join(__dirname, "../public/icons/LICENSE")))
})

test("cell and geo keys round to the grid", () => {
  assert.strictEqual(w.wxCell(37.7749, -122.4194).key, "wx:37.8:-122.4")
  assert.strictEqual(w.wxCell(37.7749, -122.4194).lat, 37.8)
  assert.strictEqual(w.wxCell(37.81, -122.44).key, w.wxCell(37.84, -122.36).key)
  assert.strictEqual(w.wxCell(-0.02, 0.01).key, "wx:0.0:0.0")
  assert.strictEqual(w.geoKey(37.7749, -122.4194), "geo:37.75:-122.40")
  assert.strictEqual(w.geoKey(37.76, -122.41), w.geoKey(37.74, -122.39))
})

test("wx cache get/put honours the TTL and re-slices to the current hour", () => {
  const st = fakeStorage()
  const hourly = w.normalizeLocation(loc(10), DAY0)
  w.wxCachePut(st, "wx:1.0:2.0", hourly, DAY0 + 50 * 60000)
  assert.strictEqual(w.wxCacheGet(st, "wx:1.0:2.0", DAY0 + 55 * 60000).length, 10)
  // 30 minutes later hour 0 is over, so the slice starts at hour 1
  const later = w.wxCacheGet(st, "wx:1.0:2.0", DAY0 + 80 * 60000)
  assert.strictEqual(later.length, 9)
  assert.strictEqual(later[0].t, DAY0 + HOUR)
  // expired after 45 minutes
  assert.strictEqual(w.wxCacheGet(st, "wx:1.0:2.0", DAY0 + 50 * 60000 + w.WX_TTL_MS + 1), null)
  assert.strictEqual(w.wxCacheGet(st, "wx:9.0:9.0", DAY0), null)
  // corrupt value is a miss, not a throw
  st.setItem("wx:bad", "{not json")
  assert.strictEqual(w.wxCacheGet(st, "wx:bad", DAY0), null)
  // missing storage is fine
  assert.strictEqual(w.wxCacheGet(null, "wx:1.0:2.0", DAY0), null)
  assert.strictEqual(w.wxCachePut(null, "k", [], 0), false)
})

test("cache helpers survive a storage that throws", () => {
  const boom = { getItem() { throw new Error("denied") }, setItem() { throw new Error("quota") }, removeItem() { throw new Error("x") }, key() { throw new Error("x") }, get length() { throw new Error("x") } }
  assert.strictEqual(w.wxCacheGet(boom, "wx:1:1", DAY0), null)
  assert.strictEqual(w.wxCachePut(boom, "wx:1:1", [], DAY0), false)
  assert.doesNotThrow(() => w.wxCachePrune(boom, DAY0))
  assert.strictEqual(w.geoCacheGet(boom, "geo:1:1"), null)
  assert.strictEqual(w.geoCachePut(boom, "geo:1:1", "X", 0), false)
})

test("wxCachePrune drops expired cells and evicts the oldest beyond the cap", () => {
  const st = fakeStorage()
  st.setItem("other", "keep")
  w.wxCachePut(st, "wx:old", [], DAY0 - w.WX_TTL_MS - 1000)
  for (let i = 0; i < 5; i++) w.wxCachePut(st, "wx:" + i, [], DAY0 - (5 - i) * 1000)
  w.wxCachePrune(st, DAY0, 3)
  assert.deepStrictEqual(Array.from(st._map.keys()).sort(), ["other", "wx:2", "wx:3", "wx:4"])
})

test("geo cache stores names and caps its size, oldest first", () => {
  const st = fakeStorage()
  assert.strictEqual(w.geoCacheGet(st, "geo:1:1"), null)
  w.geoCachePut(st, "geo:1:1", "Fresno", 5)
  assert.strictEqual(w.geoCacheGet(st, "geo:1:1"), "Fresno")
  for (let i = 0; i < 6; i++) st.setItem("geo:x" + i, JSON.stringify({ name: "n" + i, at: 100 + i }))
  w.geoCachePrune(st, 4)
  const keys = Array.from(st._map.keys()).sort()
  assert.strictEqual(keys.length, 4)
  assert.ok(!keys.includes("geo:1:1")) // oldest (at 5) evicted
  assert.ok(keys.includes("geo:x5"))
})

// A fake fetch that answers like Open-Meteo for however many coordinates were asked
function fakeFetch(now, log) {
  return (url) => {
    log.push(url)
    const lats = new URL(url).searchParams.get("latitude").split(",")
    const body = lats.length === 1 ? loc(96, () => ({ code: 61 })) : lats.map((_, i) => loc(96, () => ({ code: 61 + i })))
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }
}

test("loadForecasts batches the missing cells into one request and caches them", async () => {
  const st = fakeStorage()
  const log = []
  const now = DAY0 + 2 * HOUR + 5 * 60000
  const env = { fetch: fakeFetch(now, log), storage: st, now: () => now }
  const pts = [
    { lat: 37.01, lng: -122.02 },
    { lat: 37.04, lng: -122.04 }, // same cell as the first
    { lat: 38.5, lng: -121.5 },
    { lat: 39.5, lng: -120.5 },
  ]
  const res = await w.loadForecasts(pts, env)
  assert.strictEqual(log.length, 1)
  assert.ok(log[0].includes("latitude=37,38.5,39.5&longitude=-122,-121.5,-120.5"), log[0])
  assert.strictEqual(res.length, 4)
  assert.strictEqual(res[0], res[1]) // shared data
  assert.strictEqual(res[0][0].code, 61)
  assert.strictEqual(res[2][0].code, 62)
  assert.strictEqual(res[0][0].t, DAY0 + 2 * HOUR) // sliced to the current hour
  assert.strictEqual(res[0].length, 94)

  // second call: all hits, no requests
  const again = await w.loadForecasts(pts, env)
  assert.strictEqual(log.length, 1)
  assert.strictEqual(again[3][0].code, 63)

  // a new point only fetches itself, a single coordinate returns one object
  const res3 = await w.loadForecasts(pts.concat([{ lat: 10, lng: 10 }]), env)
  assert.strictEqual(log.length, 2)
  assert.ok(log[1].includes("latitude=10&longitude=10"))
  assert.strictEqual(res3[4][0].code, 61)
})

test("loadForecasts re-queries after the TTL", async () => {
  const st = fakeStorage()
  const log = []
  let now = DAY0 + HOUR
  const env = { fetch: fakeFetch(now, log), storage: st, now: () => now }
  await w.loadForecasts([{ lat: 1, lng: 1 }], env)
  now += w.WX_TTL_MS + 1000
  await w.loadForecasts([{ lat: 1, lng: 1 }], env)
  assert.strictEqual(log.length, 2)
})

test("loadForecasts works without storage and chunks large requests", async () => {
  const log = []
  const now = DAY0
  const env = { fetch: fakeFetch(now, log), storage: null, now: () => now }
  const pts = []
  for (let i = 0; i < 320; i++) pts.push({ lat: i * 0.1, lng: 5 })
  const res = await w.loadForecasts(pts, env)
  assert.strictEqual(log.length, 3) // 150 + 150 + 20
  assert.strictEqual(res.filter(Boolean).length, 320)
  assert.strictEqual(log[0].split("latitude=")[1].split("&")[0].split(",").length, 150)
})

test("loadForecasts leaves points null when a request fails", async () => {
  const origError = console.error
  console.error = () => {}
  try {
    const env = { fetch: () => Promise.resolve({ ok: false, status: 429 }), storage: fakeStorage(), now: () => DAY0 }
    assert.deepStrictEqual(await w.loadForecasts([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], env), [null, null])
    const rejecting = { fetch: () => Promise.reject(new Error("offline")), storage: null, now: () => DAY0 }
    assert.deepStrictEqual(await w.loadForecasts([{ lat: 1, lng: 1 }], rejecting), [null])
  } finally {
    console.error = origError
  }
})
