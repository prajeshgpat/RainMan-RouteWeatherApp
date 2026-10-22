import { test } from "vitest"
import assert from "node:assert/strict"
import * as alerts from "../src/features/alerts"
import * as routes from "../src/features/routes"
import * as share from "../src/features/share"
import * as recent from "../src/features/recent"
import * as units from "../src/features/units"
import * as radar from "../src/features/radar"
import * as declutter from "../src/features/declutter"
import { MAP_DARK_STYLES } from "../src/features/darkStyle"

const f: any = {
  ...alerts,
  ...routes,
  ...share,
  ...recent,
  ...units,
  ...radar,
  ...declutter,
  MAP_DARK_STYLES,
}

function fakeStorage(initial?: any) {
  const m = new Map(Object.entries(initial || {}))
  return {
    get length() {
      return m.size
    },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    removeItem: (k) => {
      m.delete(k)
    },
  }
}

function feature(id?: any, severity?: any, event?: any, area?: any) {
  return {
    id,
    properties: {
      severity,
      event: event || "Flood Warning",
      areaDesc: area || "Some County",
      headline: "h",
    },
  }
}

// ---- NWS alerts ----

test("inNwsCoverage covers the contiguous US, Alaska and Hawaii only", () => {
  assert.ok(f.inNwsCoverage(37.77, -122.42))
  assert.ok(f.inNwsCoverage(61.2, -149.9))
  assert.ok(f.inNwsCoverage(21.3, -157.8))
  assert.ok(!f.inNwsCoverage(51.5, -0.12)) // London
  assert.ok(!f.inNwsCoverage(19.4, -99.1)) // Mexico City
})

test("pickAlertPoints keeps at most 8 evenly spaced US points, one per cell", () => {
  const pts = []
  for (let i = 0; i < 40; i++) pts.push({ lat: 35 + i * 0.2, lng: -100 })
  const picked = f.pickAlertPoints(pts, 8)
  assert.strictEqual(picked.length, 8)
  assert.strictEqual(picked[0], pts[0])
  assert.strictEqual(picked[7], pts[39])
  const outside = [
    { lat: 51.5, lng: -0.1 },
    { lat: 48.8, lng: 2.3 },
  ]
  assert.deepStrictEqual(f.pickAlertPoints(outside), [])
  // same 0.1 degree cell collapses
  assert.strictEqual(
    f.pickAlertPoints([
      { lat: 40.01, lng: -100.01 },
      { lat: 40.02, lng: -100.02 },
    ]).length,
    1
  )
  // mixed: foreign points are dropped
  assert.strictEqual(
    f.pickAlertPoints([
      { lat: 51.5, lng: -0.1 },
      { lat: 40, lng: -100 },
    ]).length,
    1
  )
})

test("mergeAlerts de-duplicates by id, filters severity, sorts worst first", () => {
  const a = {
    features: [
      feature("1", "Moderate", "Wind Advisory"),
      feature("2", "Minor", "Frost"),
      feature("3", "Extreme", "Tornado Warning"),
    ],
  }
  const b = {
    features: [
      feature("1", "Moderate", "Wind Advisory"),
      feature("4", "Severe", "Flood Warning"),
      feature("5", "Unknown"),
    ],
  }
  const merged = f.mergeAlerts([a, b, null, {}])
  assert.deepStrictEqual(
    merged.map((x) => x.id),
    ["3", "4", "1"]
  )
  assert.deepStrictEqual(
    merged.map((x) => x.level),
    ["red", "red", "amber"]
  )
  assert.strictEqual(merged[0].event, "Tornado Warning")
  assert.deepStrictEqual(f.mergeAlerts([]), [])
})

test("mergeAlerts drops a repeat of the same event for the same area under another id", () => {
  const wind = (id) => ({
    id,
    properties: { severity: "Moderate", event: "Wind Advisory", areaDesc: "Kern County Mountains" },
  })
  assert.deepStrictEqual(
    f.mergeAlerts([{ features: [wind("a")] }, { features: [wind("b")] }]).map((x) => x.id),
    ["a"]
  )
})

test("truncateText shortens long area lists", () => {
  assert.strictEqual(f.truncateText("short", 20), "short")
  const t = f.truncateText("Alameda; Contra Costa; Marin; Napa; Solano", 20)
  assert.ok(t.length <= 20 && t.endsWith("…"))
})

test("alert cache: per cell, 15 minute TTL, survives broken storage", () => {
  const st = fakeStorage()
  const alerts = [
    { id: "1", event: "x", areaDesc: "", severity: "Severe", level: "red", headline: "" },
  ]
  f.alertCachePut(st, "nws:40.0:-100.0", alerts, 1000)
  assert.deepStrictEqual(f.alertCacheGet(st, "nws:40.0:-100.0", 1000 + 14 * 60000), alerts)
  assert.strictEqual(f.alertCacheGet(st, "nws:40.0:-100.0", 1000 + 16 * 60000), null)
  const broken = {
    getItem() {
      throw new Error("no")
    },
    setItem() {
      throw new Error("full")
    },
  }
  assert.strictEqual(f.alertCacheGet(broken, "k", 0), null)
  assert.strictEqual(f.alertCachePut(broken, "k", [], 0), false)
  assert.strictEqual(f.alertCacheGet(null, "k", 0), null)
})

test("loadAlerts fetches rounded points in parallel, caches per cell, ignores failures", async () => {
  const urls = []
  const st = fakeStorage()
  const fetchFn = (url) => {
    urls.push(url)
    if (url.includes("39.9000")) return Promise.reject(new Error("offline"))
    if (url.includes("41.0000")) return Promise.resolve({ ok: false, status: 500 })
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ features: [feature("a", "Severe"), feature("b", "Minor")] }),
    })
  }
  const warn = console.warn
  console.warn = () => {}
  const env = { fetch: fetchFn, storage: st, now: () => 5000 }
  const points = [
    { lat: 40.00004, lng: -100.123456 },
    { lat: 39.9, lng: -100 },
    { lat: 41, lng: -99 },
    { lat: 51.5, lng: -0.1 },
  ]
  const alerts = await f.loadAlerts(points, env)
  console.warn = warn
  assert.strictEqual(urls.length, 3) // London is skipped
  assert.ok(urls.includes("https://api.weather.gov/alerts/active?point=40.0000,-100.1235"))
  assert.deepStrictEqual(
    alerts.map((a) => a.id),
    ["a"]
  )
  // second call: the good cell is cached, the failed ones are retried
  urls.length = 0
  console.warn = () => {}
  const again = await f.loadAlerts(points, env)
  console.warn = warn
  assert.strictEqual(urls.length, 2)
  assert.deepStrictEqual(
    again.map((a) => a.id),
    ["a"]
  )
})

// ---- Alternative routes ----

test("formatDuration and routeChipLabel", () => {
  assert.strictEqual(f.formatDuration(4 * 3600 + 50 * 60), "4h 50m")
  assert.strictEqual(f.formatDuration(2 * 3600), "2h")
  assert.strictEqual(f.formatDuration(25 * 60), "25m")
  assert.strictEqual(
    f.routeChipLabel({ summary: "I-5", durationSec: 17400, cls: "okay" }, 0),
    "Via I-5 · 4h 50m · Okay"
  )
  assert.strictEqual(
    f.routeChipLabel({ summary: "", durationSec: 600, cls: "unknown" }, 1),
    "Via Route 2 · 10m · No data"
  )
})

test("routeSuggestion suggests a better class within 15 min of the fastest", () => {
  const infos = [
    { summary: "I-5", durationSec: 17400, cls: "bad" },
    { summary: "CA-99", durationSec: 17400 + 8 * 60, cls: "good" },
    { summary: "US-101", durationSec: 17400 + 20 * 60, cls: "good" },
  ]
  const s = f.routeSuggestion(infos, 0)
  assert.strictEqual(s.index, 1)
  assert.strictEqual(s.extraMinutes, 8)
  assert.strictEqual(s.text, "Drier route via CA-99 (+8 min)")
  // not better class: no suggestion
  assert.strictEqual(f.routeSuggestion(infos, 1), null)
  // too slow
  assert.strictEqual(f.routeSuggestion([infos[0], infos[2]], 0), null)
  // unknown class never suggested or compared
  assert.strictEqual(
    f.routeSuggestion(
      [
        { summary: "A", durationSec: 1, cls: "unknown" },
        { summary: "B", durationSec: 1, cls: "good" },
      ],
      0
    ),
    null
  )
  // prefers the better class, then the faster route
  const many = [
    { summary: "A", durationSec: 3600, cls: "bad" },
    { summary: "B", durationSec: 3700, cls: "okay" },
    { summary: "C", durationSec: 3900, cls: "good" },
  ]
  assert.strictEqual(f.routeSuggestion(many, 0).index, 2)
  // a faster alternative is described with a minus
  const faster = f.routeSuggestion(
    [
      { summary: "A", durationSec: 3600, cls: "bad" },
      { summary: "B", durationSec: 3000, cls: "good" },
    ],
    0
  )
  assert.strictEqual(faster.text, "Drier route via B (−10 min)")
})

// ---- Share URL ----

test("parseShareUrl and serializeShareState round trip", () => {
  const q = f.serializeShareState({
    from: "San Francisco, CA",
    to: "Los Angeles, CA",
    leave: 1780300800000,
  })
  assert.ok(q.startsWith("?from=San+Francisco%2C+CA&to="))
  assert.deepStrictEqual(f.parseShareUrl(q), {
    from: "San Francisco, CA",
    to: "Los Angeles, CA",
    leave: 1780300800000,
  })
  assert.strictEqual(
    f.serializeShareState({ from: "current", to: "Reno", leave: "now" }),
    "?from=current&to=Reno&leave=now"
  )
  assert.deepStrictEqual(f.parseShareUrl("?from=current&to=Reno&leave=now"), {
    from: "current",
    to: "Reno",
    leave: "now",
  })
})

test("parseShareUrl is forgiving about missing or odd input", () => {
  assert.strictEqual(f.parseShareUrl(""), null)
  assert.strictEqual(f.parseShareUrl("?from=A"), null)
  assert.strictEqual(f.parseShareUrl("?to=B"), null)
  assert.strictEqual(f.parseShareUrl("?from=%20&to=B"), null)
  assert.strictEqual(f.parseShareUrl("?from=A&to=B").leave, "now")
  assert.strictEqual(f.parseShareUrl("?from=A&to=B&leave=abc").leave, "now")
  assert.strictEqual(f.parseShareUrl("?from=A&to=B&leave=12").leave, "now")
  assert.strictEqual(f.serializeShareState(null), "")
  assert.strictEqual(f.serializeShareState({ from: "A", to: "" }), "")
  assert.strictEqual(f.hourFloor(3600000 * 5 + 1234), 3600000 * 5)
})

// ---- Recent trips ----

test("addRecentTrip keeps the newest 5, de-duplicates, ignores blanks", () => {
  let list = []
  for (const to of ["A", "B", "C", "D", "E", "F"]) list = f.addRecentTrip(list, { from: "X", to })
  assert.deepStrictEqual(
    list.map((t) => t.to),
    ["F", "E", "D", "C", "B"]
  )
  list = f.addRecentTrip(list, { from: "x", to: "d" }) // same trip, other case: moves to the front
  assert.deepStrictEqual(
    list.map((t) => t.to),
    ["d", "F", "E", "C", "B"]
  )
  assert.strictEqual(f.addRecentTrip(list, { from: "", to: "Z" }).length, 5)
  assert.deepStrictEqual(
    f.removeRecentTrip(list, 1).map((t) => t.to),
    ["d", "E", "C", "B"]
  )
  assert.strictEqual(list.length, 5) // not mutated
})

test("recent trips persist through storage and tolerate junk", () => {
  const st = fakeStorage()
  assert.deepStrictEqual(f.loadRecentTrips(st), [])
  f.saveRecentTrips(st, [{ from: "A", to: "B" }])
  assert.deepStrictEqual(f.loadRecentTrips(st), [{ from: "A", to: "B" }])
  st.setItem("rm:recent", "not json")
  assert.deepStrictEqual(f.loadRecentTrips(st), [])
  st.setItem("rm:recent", JSON.stringify([{ from: 1 }, null, { from: "A", to: "B" }]))
  assert.deepStrictEqual(f.loadRecentTrips(st), [{ from: "A", to: "B" }])
  assert.deepStrictEqual(f.loadRecentTrips(null), [])
  assert.strictEqual(f.saveRecentTrips(null, []), false)
})

test("tripLabel shortens places and names the current location", () => {
  assert.strictEqual(
    f.tripLabel({ from: "San Francisco, CA, USA", to: "Los Angeles, CA" }),
    "San Francisco → Los Angeles"
  )
  assert.strictEqual(f.tripLabel({ from: "current", to: "Reno, NV" }), "Current location → Reno")
})

// ---- Units ----

test("temperature conversion is display only and rounds", () => {
  assert.strictEqual(f.convertTemp(32, "C"), 0)
  assert.strictEqual(f.convertTemp(212, "C"), 100)
  assert.strictEqual(f.convertTemp(58.4, "F"), 58)
  assert.strictEqual(f.convertTemp(14, "C"), -10)
  assert.strictEqual(f.convertTemp(null, "C"), null)
  assert.strictEqual(f.tempLabel(58, "F"), "58°F")
  assert.strictEqual(f.tempLabel(58, "C"), "14°C")
  assert.strictEqual(f.tempLabel(null, "C"), "")
  assert.strictEqual(f.normalizeUnit("C"), "C")
  assert.strictEqual(f.normalizeUnit("kelvin"), "F")
  assert.strictEqual(f.normalizeUnit(null), "F")
})

// ---- Radar ----

test("radarTemplate takes the latest past frame", () => {
  const json = {
    host: "https://tilecache.rainviewer.com",
    radar: { past: [{ path: "/v2/radar/1" }, { path: "/v2/radar/2" }], nowcast: [] },
  }
  assert.strictEqual(
    f.radarTemplate(json),
    "https://tilecache.rainviewer.com/v2/radar/2/256/{z}/{x}/{y}/2/1_1.png"
  )
  assert.strictEqual(f.radarTemplate({ host: "h", radar: { past: [] } }), null)
  assert.strictEqual(f.radarTemplate({ radar: { past: [{ path: "p" }] } }), null)
  assert.strictEqual(f.radarTemplate(null), null)
})

test("radarTileUrl fills the template, wraps x and stops above zoom 7", () => {
  const t = "https://h/p/256/{z}/{x}/{y}/2/1_1.png"
  assert.strictEqual(f.radarTileUrl(t, 5, 12, 6), "https://h/p/256/6/5/12/2/1_1.png")
  assert.strictEqual(f.radarTileUrl(t, -1, 3, 3), "https://h/p/256/3/7/3/2/1_1.png")
  assert.strictEqual(f.radarTileUrl(t, 9, 3, 3), "https://h/p/256/3/1/3/2/1_1.png")
  assert.strictEqual(f.radarTileUrl(t, 1, 1, 8), null)
  assert.strictEqual(f.radarTileUrl(t, 1, 9, 3), null) // y outside the world
  assert.strictEqual(f.radarTileUrl(null, 1, 1, 3), null)
})

// ---- Declutter ----

test("spreadOrder is a permutation that spreads evenly", () => {
  assert.deepStrictEqual(f.spreadOrder(0), [])
  assert.deepStrictEqual(f.spreadOrder(1), [0])
  assert.deepStrictEqual(f.spreadOrder(2), [0, 1])
  assert.deepStrictEqual(f.spreadOrder(5).slice(0, 3), [0, 4, 2])
  for (const n of [3, 7, 15, 16, 60]) {
    const o = f.spreadOrder(n)
    assert.deepStrictEqual(
      [...o].sort((a, b) => a - b),
      Array.from({ length: n }, (_, i) => i)
    )
  }
})

test("declutterSelect keeps the highest priority first and respects the spacing", () => {
  const pts = [
    { x: 0, y: 0, priority: 0 },
    { x: 10, y: 5, priority: 5 }, // overlaps 0 and wins
    { x: 200, y: 0, priority: 0 },
    { x: 210, y: 3, priority: 0 }, // overlaps 2; equal priority, so the later route end is taken first
  ]
  assert.deepStrictEqual(f.declutterSelect(pts), [1, 3])
})

test("declutterSelect: the selected marker always survives", () => {
  const pts = []
  for (let i = 0; i < 15; i++) pts.push({ x: i * 10, y: 0, priority: i === 7 ? 1000 : 1 })
  const kept = f.declutterSelect(pts)
  assert.ok(kept.includes(7))
  for (let a = 0; a < kept.length; a++) {
    for (let b = a + 1; b < kept.length; b++) {
      assert.ok(Math.abs(pts[kept[a]].x - pts[kept[b]].x) >= 56)
    }
  }
})

test("declutterSelect spreads equal priorities evenly along the route", () => {
  const pts = []
  for (let i = 0; i < 9; i++) pts.push({ x: i * 40, y: 0, priority: 0 }) // 40px apart: every 2nd would fit
  const kept = f.declutterSelect(pts)
  assert.ok(kept.includes(0) && kept.includes(8), "both ends kept")
  assert.deepStrictEqual(kept, [0, 2, 4, 6, 8])
})

test("declutterSelect prefers worse severity over route order", () => {
  const pts = [
    { x: 0, y: 0, priority: 0 },
    { x: 20, y: 0, priority: 9 },
    { x: 40, y: 0, priority: 0 },
  ]
  assert.deepStrictEqual(f.declutterSelect(pts), [1])
})

test("declutterSelect always keeps at least one and handles empty input", () => {
  assert.deepStrictEqual(f.declutterSelect([]), [])
  assert.deepStrictEqual(f.declutterSelect([{ x: 5, y: 5, priority: 0 }]), [0])
  const pile = Array.from({ length: 12 }, () => ({ x: 100, y: 100, priority: 0 }))
  assert.strictEqual(f.declutterSelect(pile).length, 1)
})

test("declutterSelect uses a taller vertical gap so temperature pills do not collide", () => {
  const pts = [
    { x: 0, y: 0, priority: 1 },
    { x: 0, y: 58, priority: 0 },
  ]
  assert.deepStrictEqual(f.declutterSelect(pts), [0])
  assert.deepStrictEqual(f.declutterSelect(pts, { minX: 56, minY: 56 }), [0, 1])
  assert.deepStrictEqual(
    f.declutterSelect([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
    ]),
    [0, 1]
  )
})

test("dark map styles cover geometry, water and roads", () => {
  assert.ok(f.MAP_DARK_STYLES.length > 10)
  assert.ok(f.MAP_DARK_STYLES.some((s) => s.featureType === "water"))
})
