// NWS alert helpers shared by the app and the Firebase Functions backend. Pure: no DOM, no
// network. See shared/weather.ts for how the backend copy is kept in sync.

import { roundTo } from "./weather"
import type { LatLngPoint } from "./weather"

export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?point="
export const NWS_MAX_POINTS = 8
export const NWS_USER_AGENT = "RainMan (github.com/prajeshgpat/RainMan-RouteWeatherApp)"
const NWS_SEVERITY_RANK: Record<string, number> = { Extreme: 3, Severe: 2, Moderate: 1 }

export interface NwsAlert {
  id: string
  event: string
  areaDesc: string
  severity: string
  level: "red" | "amber"
  headline: string
}

interface NwsFeature {
  id?: string
  properties?: {
    id?: string
    event?: string
    areaDesc?: string
    severity?: string
    headline?: string
  }
}

export interface NwsCollection {
  features?: NwsFeature[]
}

// Rough bounding boxes of the contiguous US, Alaska and Hawaii
export function inNwsCoverage(lat: number, lng: number): boolean {
  if (lat >= 24.4 && lat <= 49.6 && lng >= -125.1 && lng <= -66.8) return true
  if (lat >= 51 && lat <= 71.6 && lng >= -170 && lng <= -129.9) return true
  if (lat >= 18.8 && lat <= 22.4 && lng >= -160.7 && lng <= -154.7) return true
  return false
}

export function alertCellKey(lat: number, lng: number): string {
  return "nws:" + roundTo(lat, 0.1, 1) + ":" + roundTo(lng, 0.1, 1)
}

export function nwsPointUrl(p: LatLngPoint): string {
  return NWS_ALERTS_URL + Number(p.lat).toFixed(4) + "," + Number(p.lng).toFixed(4)
}

// At most `max` points inside NWS coverage, evenly spaced along the list, one per 0.1 degree cell
// (the alerts of a cell are cached together)
export function pickAlertPoints(points: LatLngPoint[], max?: number): LatLngPoint[] {
  const cap = max || NWS_MAX_POINTS
  const seen: Record<string, boolean> = {}
  const usable = points.filter((p) => {
    if (!inNwsCoverage(p.lat, p.lng)) return false
    const key = alertCellKey(p.lat, p.lng)
    if (seen[key]) return false
    seen[key] = true
    return true
  })
  if (usable.length <= cap) return usable
  const out: LatLngPoint[] = []
  for (let i = 0; i < cap; i++) out.push(usable[Math.round((i * (usable.length - 1)) / (cap - 1))])
  return out
}

// GeoJSON FeatureCollections -> unique Moderate/Severe/Extreme alerts, worst first
export function mergeAlerts(collections: Array<NwsCollection | null | undefined>): NwsAlert[] {
  const lists = collections.map((fc) => {
    const features = fc && Array.isArray(fc.features) ? fc.features : []
    const list: NwsAlert[] = []
    features.forEach((f) => {
      const p = (f && f.properties) || {}
      const id = (f && f.id) || p.id
      const rank = p.severity ? NWS_SEVERITY_RANK[p.severity] : undefined
      if (!id || !rank) return
      list.push({
        id,
        event: p.event || "Weather alert",
        areaDesc: p.areaDesc || "",
        severity: p.severity as string,
        level: rank >= 2 ? "red" : "amber",
        headline: p.headline || "",
      })
    })
    return list
  })
  return mergeAlertLists(lists)
}

// Lists of already normalized alerts -> unique by id and by event + area, worst first
export function mergeAlertLists(lists: NwsAlert[][]): NwsAlert[] {
  const seen: Record<string, boolean> = {}
  const out: NwsAlert[] = []
  lists.forEach((list) => {
    list.forEach((a) => {
      const sameKey = "event:" + a.event + "|" + a.areaDesc
      if (seen["id:" + a.id] || seen[sameKey]) return
      seen["id:" + a.id] = true
      seen[sameKey] = true
      out.push(a)
    })
  })
  out.sort(
    (a, b) =>
      NWS_SEVERITY_RANK[b.severity] - NWS_SEVERITY_RANK[a.severity] ||
      (a.event < b.event ? -1 : a.event > b.event ? 1 : 0)
  )
  return out
}
