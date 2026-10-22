// Alternative routes: labels and the "drier route" suggestion. Pure.

import type { Severity } from "../scoring/scoring"

export const ROUTE_NEAR_FASTEST_SEC = 15 * 60
const CLASS_RANK: Record<string, number> = { good: 0, okay: 1, bad: 2 }
const CLASS_NAME: Record<string, string> = {
  good: "Good",
  okay: "Okay",
  bad: "Bad",
  unknown: "No data",
}

export interface RouteInfo {
  summary: string
  durationSec: number
  cls: Severity
}

export interface RouteSuggestion {
  index: number
  extraMinutes: number
  text: string
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return m + "m"
  return h + "h" + (m ? " " + m + "m" : "")
}

function routeName(info: Pick<RouteInfo, "summary">, index: number): string {
  return info.summary ? info.summary : "Route " + (index + 1)
}

// "Via I-5 · 4h 50m · Okay"
export function routeChipLabel(info: RouteInfo, index: number): string {
  return (
    "Via " +
    routeName(info, index) +
    " · " +
    formatDuration(info.durationSec) +
    " · " +
    (CLASS_NAME[info.cls] || CLASS_NAME.unknown)
  )
}

// If another route has a better class at the selected departure and is within 15 minutes of the
// fastest route, suggest it.
export function routeSuggestion(infos: RouteInfo[], activeIndex: number): RouteSuggestion | null {
  const active = infos[activeIndex]
  if (!active || CLASS_RANK[active.cls] === undefined) return null
  let fastest = Infinity
  infos.forEach((r) => {
    if (r.durationSec < fastest) fastest = r.durationSec
  })
  let bestIndex = -1
  infos.forEach((r, i) => {
    if (i === activeIndex || CLASS_RANK[r.cls] === undefined) return
    if (CLASS_RANK[r.cls] >= CLASS_RANK[active.cls]) return
    if (r.durationSec > fastest + ROUTE_NEAR_FASTEST_SEC) return
    if (
      bestIndex < 0 ||
      CLASS_RANK[r.cls] < CLASS_RANK[infos[bestIndex].cls] ||
      (CLASS_RANK[r.cls] === CLASS_RANK[infos[bestIndex].cls] &&
        r.durationSec < infos[bestIndex].durationSec)
    ) {
      bestIndex = i
    }
  })
  if (bestIndex < 0) return null
  const extra = Math.round((infos[bestIndex].durationSec - active.durationSec) / 60)
  const diff = extra === 0 ? "same time" : (extra > 0 ? "+" : "−") + Math.abs(extra) + " min"
  return {
    index: bestIndex,
    extraMinutes: extra,
    text: "Drier route via " + routeName(infos[bestIndex], bestIndex) + " (" + diff + ")",
  }
}
