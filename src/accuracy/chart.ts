// Hand-rolled SVG bar chart of the share of green-rated trips that stayed dry, by days ahead.
// Pure: returns markup. Colours come from CSS classes so the chart follows light/dark mode.

import { percent } from "./data"
import type { LeadDayStats } from "./data"

const W = 520
const H = 240
const PAD = { top: 20, right: 12, bottom: 34, left: 44 }

function escapeXml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
  return text.replace(/[&<>"]/g, (c) => map[c])
}

// Plain-language description, also used as the chart's accessible name
export function chartDescription(rows: LeadDayStats[]): string {
  const parts = rows.map((r) => "day " + r.lead_day + ": " + percent(r.green_trip_dry_rate))
  return (
    "Share of green-rated trips that stayed dry, by days ahead of departure. " + parts.join(", ")
  )
}

export function renderLeadDayChart(rows: LeadDayStats[]): string {
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const y = (rate: number) => PAD.top + innerH * (1 - rate)
  const slot = rows.length > 0 ? innerW / rows.length : innerW
  const barW = Math.min(56, slot * 0.6)
  const out: string[] = []
  out.push(
    '<svg class="chart" viewBox="0 0 ' +
      W +
      " " +
      H +
      '" role="img" aria-labelledby="chart-title chart-desc" xmlns="http://www.w3.org/2000/svg">'
  )
  out.push('<title id="chart-title">Green trips that stayed dry, by lead day</title>')
  out.push('<desc id="chart-desc">' + escapeXml(chartDescription(rows)) + "</desc>")

  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    const ty = y(tick)
    out.push(
      '<line class="grid" x1="' +
        PAD.left +
        '" x2="' +
        (W - PAD.right) +
        '" y1="' +
        ty +
        '" y2="' +
        ty +
        '"/>'
    )
    out.push(
      '<text class="axis" x="' +
        (PAD.left - 8) +
        '" y="' +
        (ty + 4) +
        '" text-anchor="end">' +
        Math.round(tick * 100) +
        "%</text>"
    )
  }

  rows.forEach((r, i) => {
    const cx = PAD.left + slot * i + slot / 2
    const label = "Day " + r.lead_day
    out.push(
      '<text class="axis" x="' +
        cx +
        '" y="' +
        (H - 12) +
        '" text-anchor="middle">' +
        label +
        "</text>"
    )
    if (r.green_trip_dry_rate == null) return
    const rate = Math.min(1, Math.max(0, r.green_trip_dry_rate))
    const top = y(rate)
    out.push(
      '<rect class="bar" x="' +
        (cx - barW / 2) +
        '" y="' +
        top +
        '" width="' +
        barW +
        '" height="' +
        (y(0) - top) +
        '" rx="3"><title>' +
        label +
        ": " +
        percent(rate) +
        "</title></rect>"
    )
    out.push(
      '<text class="value" x="' +
        cx +
        '" y="' +
        (top - 6) +
        '" text-anchor="middle">' +
        percent(rate) +
        "</text>"
    )
  })
  out.push("</svg>")
  return out.join("")
}
