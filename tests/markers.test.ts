import { test } from "vitest"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as markerSvg from "../src/map/markerSvg"

const m: any = markerSvg

const icon = readFileSync(join(import.meta.dirname, "../public/icons/rain.svg"), "utf8")

test("markerSvg contains the severity ring color and the temperature", () => {
  const colors: Record<string, string> = {
    good: "#2e9e5b",
    okay: "#e8b923",
    bad: "#d64545",
    unknown: "#9aa3ad",
  }
  for (const cls of Object.keys(colors)) {
    const svg = m.markerSvg({ iconSvgText: icon, cls, temp: 58, selected: false })
    assert.ok(svg.includes('stroke="' + colors[cls] + '"'), cls)
    assert.ok(svg.includes(">58°<"), "temperature pill")
  }
  assert.ok(m.markerSvg({ cls: "nonsense", temp: 1 }).includes("#9aa3ad"))
})

test("markerSvg embeds the icon as base64 and escapes the temperature", () => {
  const svg = m.markerSvg({ iconSvgText: icon, cls: "good", temp: 70 })
  const b64 = svg.match(/href="data:image\/svg\+xml;base64,([^"]+)"/)[1]
  assert.strictEqual(Buffer.from(b64, "base64").toString("utf8"), icon)
  assert.ok(!svg.includes("<script"))
  assert.ok(m.markerSvg({ cls: "good", temp: "<b>" }).includes("&lt;b&gt;"))
  assert.ok(!m.markerSvg({ cls: "good", temp: null }).includes("<text"))
  assert.ok(!m.markerSvg({ cls: "good", temp: 5 }).includes("<image"))
})

test("markerSvg is larger when selected and the anchor is the badge centre", () => {
  const a = m.markerGeometry(false)
  const b = m.markerGeometry(true)
  assert.ok(b.size > a.size && b.width > a.width)
  assert.strictEqual(a.size, 44)
  assert.strictEqual(b.size, 54)
  assert.strictEqual(a.cx, a.width / 2)
  assert.ok(a.cy < a.height / 2) // pill hangs below the badge
  const svg = m.markerSvg({ cls: "okay", temp: 50, selected: true })
  assert.ok(svg.includes('width="' + b.width + '" height="' + b.height + '"'))
  assert.ok(svg.includes('cx="' + b.cx + '" cy="' + b.cy + '"'))
})

test("pinSvg draws A and B pins; svgDataUri is url-encoded svg", () => {
  assert.ok(m.pinSvg("start").includes(">A<"))
  assert.ok(m.pinSvg("end").includes(">B<"))
  assert.notStrictEqual(m.pinSvg("start"), m.pinSvg("end"))
  const uri = m.svgDataUri(m.pinSvg("start"))
  assert.ok(uri.startsWith("data:image/svg+xml;charset=UTF-8,%3Csvg"))
  assert.ok(!uri.includes("<"))
})
