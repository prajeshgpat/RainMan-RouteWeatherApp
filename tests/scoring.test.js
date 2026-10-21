const test = require("node:test")
const assert = require("node:assert")
const s = require("../public/scoring.js")

const entry = (code, extra) =>
  Object.assign({ t: 0, temp: 60, pop: 0, wind: 0, gust: 0, code: code, isDay: true }, extra)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`)

test("hourBadness by WMO code group", () => {
  const cases = [
    [0, 0], [1, 0], [2, 0], [3, 0], // clear to cloudy
    [45, 0.4], [48, 0.6], // fog, rime fog
    [51, 0.2], [53, 0.3], [55, 0.4], // drizzle (temp 60, not icy)
    [56, 1.0], [57, 1.0], // freezing drizzle
    [61, 0.4], [63, 0.6], [65, 0.9], // rain
    [66, 1.0], [67, 1.0], // freezing rain
    [71, 0.8], [73, 1.0], [75, 1.0], [77, 0.8], // snow
    [80, 0.4], [81, 0.6], [82, 0.9], // showers
    [85, 1.0], [86, 1.0], // snow showers
    [95, 1.0], [96, 1.0], [99, 1.0], // thunderstorm
    [1234, 0], // unknown code
  ]
  for (const [code, expected] of cases) near(s.hourBadness(entry(code)), expected)
})

test("hourBadness uses pop as a floor of pop * 0.5", () => {
  near(s.hourBadness(entry(0, { pop: 0.8 })), 0.4)
  near(s.hourBadness(entry(63, { pop: 0.8 })), 0.6) // condition wins
  near(s.hourBadness(entry(0, { pop: 0.2 })), 0.1)
})

test("hourBadness adds wind and gusts, and clamps to 1", () => {
  near(s.hourBadness(entry(0, { wind: 21 })), 0.15)
  near(s.hourBadness(entry(0, { wind: 20 })), 0)
  near(s.hourBadness(entry(0, { wind: 31 })), 0.3)
  near(s.hourBadness(entry(61, { wind: 25 })), 0.55)
  near(s.hourBadness(entry(95, { wind: 40 })), 1)
  near(s.hourBadness(entry(0, { gust: 46 })), 0.15)
  near(s.hourBadness(entry(0, { gust: 45 })), 0)
  near(s.hourBadness(entry(0, { wind: 31, gust: 50 })), 0.45)
  assert.strictEqual(s.hourBadness(null), 0)
})

test("ice risk: liquid precipitation at or below 34F is 1.0", () => {
  for (const code of [51, 53, 55, 61, 63, 65, 80, 81, 82]) {
    near(s.hourBadness(entry(code, { temp: 34 })), 1)
    assert.ok(s.hourBadness(entry(code, { temp: 35 })) < 1)
  }
  near(s.hourBadness(entry(51, { temp: 35 })), 0.2)
  near(s.hourBadness(entry(61, { temp: 30 })), 1)
  // not liquid precipitation: no ice adjustment
  near(s.hourBadness(entry(45, { temp: 20 })), 0.4)
  near(s.hourBadness(entry(0, { temp: 10 })), 0)
  near(s.hourBadness(entry(71, { temp: 20 })), 0.8)
  // unknown temperature never triggers it
  near(s.hourBadness(entry(61, { temp: null })), 0.4)
  assert.ok(s.isIcy(entry(63, { temp: 30 })))
  assert.ok(!s.isIcy(entry(63, { temp: 50 })))
})

test("night adds 0.1 but a clear night is still good", () => {
  near(s.hourBadness(entry(0, { isDay: false })), 0.1)
  near(s.hourBadness(entry(63, { isDay: false })), 0.7)
  near(s.hourBadness(entry(95, { isDay: false })), 1)
  assert.strictEqual(s.classify(s.hourBadness(entry(0, { isDay: false }))), "good")
  assert.strictEqual(s.classify(s.hourBadness(entry(2, { isDay: false }))), "good")
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

const hourlyOf = (fn, n) => Array.from({ length: n || 96 }, (_, h) => fn(h))

test("departureScore blends worst and mean badness", () => {
  const clear = { etaHours: 0, hourly: hourlyOf(() => entry(0)) }
  const rainy = { etaHours: 0, hourly: hourlyOf(() => entry(63)) } // 0.6
  near(s.departureScore([clear, clear], 0), 0)
  near(s.departureScore([clear, rainy], 0), 0.6 * 0.6 + 0.4 * 0.3)
  // wet the whole way is worse than one short shower
  assert.ok(s.departureScore([rainy, rainy], 0) > s.departureScore([clear, rainy], 0))
  assert.strictEqual(s.departureScore([{ etaHours: 1, hourly: null }], 0), null)
  // samples with no data are skipped
  near(s.departureScore([clear, { etaHours: 1, hourly: null }], 0), 0)
})

test("departureScore looks at hourly[round(d + eta)]", () => {
  const sample = { etaHours: 2, hourly: hourlyOf((h) => (h === 5 ? entry(95) : entry(0))) }
  near(s.departureScore([sample], 3), 1)
  near(s.departureScore([sample], 2), 0)
  near(s.departureScore([{ etaHours: 2.4, hourly: sample.hourly }], 3), 1) // rounds 5.4 -> 5
})

test("indexes clamp to the length of the hourly array, whatever it is", () => {
  assert.strictEqual(s.hourIndex(24, 30, 48), 47)
  assert.strictEqual(s.hourIndex(24, 30, 96), 54)
  assert.strictEqual(s.hourIndex(0, -3, 96), 0)
  const sample = { etaHours: 60, hourly: hourlyOf((h) => (h === 71 ? entry(75) : entry(0)), 72) }
  near(s.departureScore([sample], 24), 1) // 84 clamps to the last index (71)
  const long = { etaHours: 60, hourly: hourlyOf((h) => (h === 84 ? entry(75) : entry(0)), 96) }
  near(s.departureScore([long], 24), 1) // no 48h cap any more
})

test("maxDepartureOffset uses the forecast length, capped at 48", () => {
  assert.strictEqual(s.maxDepartureOffset(3.2, 96), 48)
  assert.strictEqual(s.maxDepartureOffset(3.2, 60), 48)
  assert.strictEqual(s.maxDepartureOffset(3.2, 40), 40 - 1 - 4)
  assert.strictEqual(s.maxDepartureOffset(30, 70), 70 - 1 - 30)
  assert.strictEqual(s.maxDepartureOffset(30, 96), 48)
  assert.strictEqual(s.maxDepartureOffset(94.5, 96), 0)
  assert.ok(s.maxDepartureOffset(95.5, 96) < 0)
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

test("worstStop describes the worst entry, with icy and night notes", () => {
  const mk = (e) => ({ etaHours: 0, hourly: hourlyOf(() => e) })
  const clear = mk(entry(0))
  let w = s.worstStop([clear, mk(entry(65))], 0)
  assert.strictEqual(w.sampleIndex, 1)
  assert.strictEqual(w.description, "heavy rain")
  assert.strictEqual(w.code, 65)
  assert.strictEqual(s.worstStop([mk(entry(56))], 0).description, "freezing drizzle")
  assert.strictEqual(s.worstStop([mk(entry(63, { temp: 30 }))], 0).description, "rain (icy)")
  assert.strictEqual(s.worstStop([mk(entry(2, { isDay: false }))], 0).description, "partly cloudy at night")
  const n = s.worstStop([mk(entry(61, { temp: 28, isDay: false }))], 0)
  assert.strictEqual(n.description, "light rain (icy) at night")
  assert.strictEqual(n.isDay, false)
  assert.strictEqual(s.worstStop([{ etaHours: 0, hourly: null }], 0), null)
  assert.strictEqual(s.conditionDescription(999), "unknown")
  assert.strictEqual(s.conditionDescription(95), "thunderstorm")
})

test("computeDepartures labels and classifies each hour", () => {
  const sample = { etaHours: 0, hourly: hourlyOf((h) => (h < 2 ? entry(61) : entry(0))) }
  const now = new Date(2026, 5, 1, 14, 37).getTime()
  const deps = s.computeDepartures([sample], 4, now)
  assert.strictEqual(deps.length, 5)
  assert.strictEqual(deps[0].timeMs, now)
  assert.strictEqual(new Date(deps[1].timeMs).getHours(), 15)
  assert.deepStrictEqual(deps.map((x) => x.cls), ["okay", "okay", "good", "good", "good"])
  assert.strictEqual(deps[0].worst.description, "light rain")
})
