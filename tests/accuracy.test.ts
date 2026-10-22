import { test } from "vitest"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderLeadDayChart, chartDescription } from "../src/accuracy/chart"
import { count, decimal, formatDate, parseAccuracy, percent } from "../src/accuracy/data"

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../e2e/fixtures/accuracy.json"), "utf8")
)

test("the fixture matches the accuracy.json contract", () => {
  const data = parseAccuracy(fixture)
  assert.ok(data)
  assert.strictEqual(data.headline.lead_day, 1)
  assert.ok(data.by_lead_day.length >= 3)
  assert.ok(data.by_corridor.length >= 3)
  for (const key of [
    "generated_at",
    "window",
    "corridors",
    "points",
    "departures_evaluated",
    "headline",
    "by_lead_day",
    "by_corridor",
    "methodology_url",
  ]) {
    assert.ok(key in fixture, key)
  }
})

test("parseAccuracy rejects things that are not accuracy.json", () => {
  assert.strictEqual(parseAccuracy(null), null)
  assert.strictEqual(parseAccuracy("<html>"), null)
  assert.strictEqual(parseAccuracy({}), null)
  assert.strictEqual(parseAccuracy({ ...fixture, by_lead_day: "x" }), null)
  assert.strictEqual(parseAccuracy({ ...fixture, generated_at: 5 }), null)
})

test("number formatting", () => {
  assert.strictEqual(percent(0.912), "91%")
  assert.strictEqual(percent(1), "100%")
  assert.strictEqual(percent(null), "–")
  assert.strictEqual(decimal(0.08123), "0.081")
  assert.strictEqual(decimal(undefined), "–")
  assert.strictEqual(count(123456), "123,456")
  assert.strictEqual(formatDate("2026-07-24"), "Jul 24, 2026")
  assert.strictEqual(formatDate("2026-10-22T06:00:00Z"), "Oct 22, 2026")
  assert.strictEqual(formatDate("garbage"), "garbage")
})

test("the lead-day chart is an accessible SVG with one bar per day, sized by the rate", () => {
  const svg = renderLeadDayChart(fixture.by_lead_day)
  assert.ok(svg.startsWith("<svg"))
  assert.ok(svg.includes('role="img"') && svg.includes("<title") && svg.includes("<desc"))
  assert.strictEqual((svg.match(/class="bar"/g) || []).length, fixture.by_lead_day.length)
  assert.ok(svg.includes(">Day 1<") && svg.includes(">91%<"))
  assert.ok(chartDescription(fixture.by_lead_day).includes("day 1: 91%"))
  // taller bar for a higher rate
  const heights = [...svg.matchAll(/class="bar"[^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]))
  assert.ok(heights[0] > heights[heights.length - 1])
  // a missing rate draws no bar and does not throw
  const partial = renderLeadDayChart([{ ...fixture.by_lead_day[0], green_trip_dry_rate: null }])
  assert.ok(!partial.includes('class="bar"'))
  assert.ok(renderLeadDayChart([]).includes("</svg>"))
})
