// Pure SVG builders for the map markers. No DOM or Google Maps dependencies, so they can be
// unit-tested in Node. Weather icons are embedded as base64 <image> elements because external
// references do not load inside an SVG used as a marker data URI.

import type { Severity } from "../scoring/scoring"

export const SEVERITY_COLORS: Record<Severity, string> = {
  good: "#2e9e5b",
  okay: "#e8b923",
  bad: "#d64545",
  unknown: "#9aa3ad",
}
const MARKER_FONT = "Roboto, Arial, Helvetica, sans-serif"
const MARKER_PAD = 8
const MARKER_PILL_H = 16

export function svgBase64(text: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64")
  return btoa(unescape(encodeURIComponent(text)))
}

export function svgDataUri(svg: string): string {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg)
}

function escapeXml(text: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }
  return String(text).replace(/[&<>"']/g, (c) => map[c])
}

export interface MarkerGeometry {
  size: number
  width: number
  height: number
  cx: number
  cy: number
}

// Size and anchor (the badge centre) of a weather marker image
export function markerGeometry(selected?: boolean): MarkerGeometry {
  const size = selected ? 54 : 44
  const width = size + MARKER_PAD * 2
  return {
    size,
    width,
    height: MARKER_PAD + size + 4 + MARKER_PILL_H + 4,
    cx: width / 2,
    cy: MARKER_PAD + size / 2,
  }
}

export interface MarkerOptions {
  iconSvgText?: string
  cls?: string
  temp?: number | string | null
  selected?: boolean
}

// Weather marker: white badge with a severity ring, the weather icon inside and a temperature
// pill underneath. temp is already formatted by the caller as a number in the display unit.
export function markerSvg(opts: MarkerOptions): string {
  const g = markerGeometry(opts.selected)
  const color = SEVERITY_COLORS[opts.cls as Severity] || SEVERITY_COLORS.unknown
  const r = g.size / 2 - 2 // the 4px ring is centred on r, so it stays inside the badge size
  const parts: string[] = []
  parts.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      g.width +
      '" height="' +
      g.height +
      '" viewBox="0 0 ' +
      g.width +
      " " +
      g.height +
      '">'
  )
  parts.push(
    '<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.35"/></filter></defs>'
  )
  parts.push(
    '<circle cx="' +
      g.cx +
      '" cy="' +
      g.cy +
      '" r="' +
      r +
      '" fill="#fff" stroke="' +
      color +
      '" stroke-width="4" filter="url(#s)"/>'
  )
  if (opts.iconSvgText) {
    const iconSize = g.size - 10
    parts.push(
      '<image href="data:image/svg+xml;base64,' +
        svgBase64(opts.iconSvgText) +
        '" x="' +
        (g.cx - iconSize / 2) +
        '" y="' +
        (g.cy - iconSize / 2) +
        '" width="' +
        iconSize +
        '" height="' +
        iconSize +
        '"/>'
    )
  }
  if (opts.temp != null && opts.temp !== "") {
    const label = escapeXml(opts.temp) + "°"
    const pillW = 14 + String(label).length * 7
    const pillX = g.cx - pillW / 2
    const pillY = MARKER_PAD + g.size + 4
    parts.push(
      '<rect x="' +
        pillX +
        '" y="' +
        pillY +
        '" width="' +
        pillW +
        '" height="' +
        MARKER_PILL_H +
        '" rx="8" fill="#0b1f3a" stroke="#fff" stroke-width="1.5"/>'
    )
    parts.push(
      '<text x="' +
        g.cx +
        '" y="' +
        (pillY + 12) +
        '" text-anchor="middle" font-family="' +
        MARKER_FONT +
        '" font-size="11" font-weight="700" fill="#fff">' +
        label +
        "</text>"
    )
  }
  parts.push("</svg>")
  return parts.join("")
}

// Start ("A", green dot) and end ("B", dark flag-style badge) pins for the route
export function pinGeometry(): { width: number; height: number; cx: number; cy: number } {
  return { width: 36, height: 36, cx: 18, cy: 18 }
}

export function pinSvg(kind: "start" | "end" | string): string {
  const isStart = kind !== "end"
  const fill = isStart ? "#1e8e3e" : "#0b1f3a"
  const letter = isStart ? "A" : "B"
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">' +
    '<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%">' +
    '<feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#000" flood-opacity="0.4"/></filter></defs>' +
    '<circle cx="18" cy="18" r="12" fill="' +
    fill +
    '" stroke="#fff" stroke-width="3" filter="url(#s)"/>' +
    '<text x="18" y="22.5" text-anchor="middle" font-family="' +
    MARKER_FONT +
    '" font-size="13" font-weight="900" fill="#fff">' +
    letter +
    "</text>" +
    "</svg>"
  )
}
