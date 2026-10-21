const test = require("node:test")
const assert = require("node:assert")
const s = require("../public/scoring.js")

const entry = (id, extra) => Object.assign({ weather: [{ id, description: "x" }], pop: 0, wind_speed: 0 }, extra)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`)

test("hourBadness by weather category", () => {
  const cases = [
    [200, 1.0], [232, 1.0], // thunderstorm
    [600, 1.0], [622, 1.0], [511, 1.0], // snow, freezing rain
    [502, 0.9], [503, 0.9], [504, 0.9], [522, 0.9], [531, 0.9], // heavy rain
    [501, 0.6], [521, 0.6], // moderate rain
    [500, 0.4], [520, 0.4], // light rain
    [300, 0.3], [321, 0.3], // drizzle
    [701, 0.4], [741, 0.4], [761, 0.4], // fog, dust, smoke
    [771, 1.0], [781, 1.0], // squall, tornado
    [800, 0], [801, 0], [804, 0], // clear / clouds
  ]
  for (const [id, expected] of cases) near(s.hourBadness(entry(id)), expected)
})

test("hourBadness uses pop as a floor of pop * 0.5", () => {
  near(s.hourBadness(entry(800, { pop: 0.8 })), 0.4)
  near(s.hourBadness(entry(501, { pop: 0.8 })), 0.6) // condition wins
  near(s.hourBadness(entry(800, { pop: 0.2 })), 0.1)
})

test("hourBadness adds wind and clamps to 1", () => {
  near(s.hourBadness(entry(800, { wind_speed: 21 })), 0.15)
  near(s.hourBadness(entry(800, { wind_speed: 20 })), 0)
  near(s.hourBadness(entry(800, { wind_speed: 31 })), 0.3)
  near(s.hourBadness(entry(500, { wind_speed: 25 })), 0.55)
  near(s.hourBadness(entry(200, { wind_speed: 40 })), 1)
  assert.strictEqual(s.hourBadness(null), 0)
})

test("classify thresholds", () => {
  assert.strictEqual(s.classify(0), "good")
  assert.strictEqual(s.classify(0.199), "good")
  assert.strictEqual(s.classify(0.2), "okay")
  assert.strictEqual(s.classify(0.499), "okay")
  assert.strictEqual(s.classify(0.5), "bad")
  assert.strictEqual(s.classify(1), "bad")
  assert.strictEqual(s.classify(null), "unknown")
})

const hourlyOf = (fn) => Array.from({ length: 48 }, (_, h) => fn(h))

test("departureScore blends worst and mean badness", () => {
  const clear = { etaHours: 0, hourly: hourlyOf(() => entry(800)) }
  const rainy = { etaHours: 0, hourly: hourlyOf(() => entry(501)) } // 0.6
  near(s.departureScore([clear, clear], 0), 0)
  near(s.departureScore([clear, rainy], 0), 0.6 * 0.6 + 0.4 * 0.3)
  // wet the whole way is worse than one short shower
  assert.ok(s.departureScore([rainy, rainy], 0) > s.departureScore([clear, rainy], 0))
  assert.strictEqual(s.departureScore([{ etaHours: 1, hourly: null }], 0), null)
  // samples with no data are skipped
  near(s.departureScore([clear, { etaHours: 1, hourly: null }], 0), 0)
})

test("departureScore looks at hourly[round(d + eta)]", () => {
  const sample = { etaHours: 2, hourly: hourlyOf((h) => (h === 5 ? entry(200) : entry(800))) }
  near(s.departureScore([sample], 3), 1)
  near(s.departureScore([sample], 2), 0)
  near(s.departureScore([{ etaHours: 2.4, hourly: sample.hourly }], 3), 1) // rounds 5.4 -> 5
})

test("indexes clamp at the end of the 48h array", () => {
  assert.strictEqual(s.hourIndex(24, 30, 48), 47)
  assert.strictEqual(s.hourIndex(0, -3, 48), 0)
  const sample = { etaHours: 60, hourly: hourlyOf((h) => (h === 47 ? entry(600) : entry(800))) }
  assert.doesNotThrow(() => s.departureScore([sample], 24))
  near(s.departureScore([sample], 24), 1)
})

test("maxDepartureOffset", () => {
  assert.strictEqual(s.maxDepartureOffset(3.2), 24)
  assert.strictEqual(s.maxDepartureOffset(23), 24)
  assert.strictEqual(s.maxDepartureOffset(30), 17)
  assert.strictEqual(s.maxDepartureOffset(46.5), 0)
  assert.ok(s.maxDepartureOffset(47.5) < 0)
})

test("bestWindow picks the earliest run of the lowest score", () => {
  assert.deepStrictEqual(s.bestWindow([0.5, 0.1, 0.1, 0.6, 0.1]), { start: 1, end: 2, score: 0.1 })
  assert.deepStrictEqual(s.bestWindow([0.3, 0.3, 0.3]), { start: 0, end: 2, score: 0.3 })
  // a strictly lower later run beats an earlier, higher one
  assert.deepStrictEqual(s.bestWindow([0.2, 0.2, 0.9, 0.05]), { start: 3, end: 3, score: 0.05 })
  assert.deepStrictEqual(s.bestWindow([null, 0.4, null, 0.4]), { start: 1, end: 1, score: 0.4 })
  assert.strictEqual(s.bestWindow([]), null)
  assert.strictEqual(s.bestWindow([null, null]), null)
})

test("computeDepartures labels and classifies each hour", () => {
  const sample = { etaHours: 0, hourly: hourlyOf((h) => (h < 2 ? entry(500) : entry(800))) }
  const now = new Date(2026, 5, 1, 14, 37).getTime()
  const deps = s.computeDepartures([sample], 4, now)
  assert.strictEqual(deps.length, 5)
  assert.strictEqual(deps[0].timeMs, now)
  assert.strictEqual(new Date(deps[1].timeMs).getHours(), 15)
  assert.deepStrictEqual(deps.map((x) => x.cls), ["okay", "okay", "good", "good", "good"])
  assert.strictEqual(deps[0].worst.description, "x")
})
