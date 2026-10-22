// NWS severe weather alerts (US only): per-cell session caching and loading. The pure merge and
// filter helpers live in shared/alerts.ts (the backend uses them too).

import {
  NWS_MAX_POINTS,
  alertCellKey,
  mergeAlertLists,
  mergeAlerts,
  nwsPointUrl,
  pickAlertPoints,
} from "../../shared/alerts"
import type { NwsAlert, NwsCollection } from "../../shared/alerts"
import type { LatLngPoint } from "../../shared/weather"
import { storageGet, storageSet } from "../weather/cache"
import type { StorageLike } from "../weather/cache"
import type { BackendClient } from "../weather/api"
import type { FetchLike } from "../weather/forecast"

export {
  NWS_MAX_POINTS,
  inNwsCoverage,
  mergeAlertLists,
  mergeAlerts,
  pickAlertPoints,
} from "../../shared/alerts"
export type { NwsAlert } from "../../shared/alerts"

export const NWS_TTL_MS = 15 * 60 * 1000

export function truncateText(text: unknown, max: number): string {
  const s = String(text || "")
  return s.length > max ? s.slice(0, Math.max(0, max - 1)).replace(/[\s;,]+$/, "") + "…" : s
}

interface AlertRecord {
  fetchedAt: number
  alerts: NwsAlert[]
}

// Cached alerts of one cell (already merged/filtered), or null on miss/expiry
export function alertCacheGet(
  storage: StorageLike | null,
  key: string,
  nowMs: number
): NwsAlert[] | null {
  if (!storage) return null
  const rec = storageGet<AlertRecord>(storage, key)
  if (!rec || !Array.isArray(rec.alerts) || typeof rec.fetchedAt !== "number") return null
  if (nowMs - rec.fetchedAt > NWS_TTL_MS || rec.fetchedAt > nowMs + 60000) return null
  return rec.alerts
}

export function alertCachePut(
  storage: StorageLike | null,
  key: string,
  alerts: NwsAlert[],
  nowMs: number
): boolean {
  if (!storage) return false
  return storageSet(storage, key, { fetchedAt: nowMs, alerts })
}

export interface AlertEnv {
  fetch: FetchLike
  storage: StorageLike | null // sessionStorage
  now: () => number
  backend?: BackendClient | null
}

function loadAlertsDirect(p: LatLngPoint, env: AlertEnv, now: number): Promise<NwsAlert[]> {
  const key = alertCellKey(p.lat, p.lng)
  return env
    .fetch(nwsPointUrl(p))
    .then((response) => {
      if (!response.ok) throw new Error("NWS returned HTTP " + response.status)
      return response.json()
    })
    .then((json) => {
      const merged = mergeAlerts([json as NwsCollection])
      alertCachePut(env.storage, key, merged, now)
      return merged
    })
    .catch((error) => {
      console.warn("Weather alerts unavailable:", error)
      return [] as NwsAlert[]
    })
}

// Alerts for a list of points: cached per 0.1 degree cell (storage = sessionStorage), the misses
// fetched from the backend in one call when it is available, otherwise from NWS in parallel. Any
// failure is silent (console.warn) and counts as no alerts. Resolves to the merged alert list.
export async function loadAlerts(points: LatLngPoint[], env: AlertEnv): Promise<NwsAlert[]> {
  const now = env.now()
  const chosen = pickAlertPoints(points, NWS_MAX_POINTS)
  const lists: Array<NwsAlert[] | null> = chosen.map((p) =>
    alertCacheGet(env.storage, alertCellKey(p.lat, p.lng), now)
  )
  const missIdx = chosen.map((_, i) => i).filter((i) => !lists[i])

  if (missIdx.length > 0 && env.backend && env.backend.usable) {
    const result = await env.backend.alerts(missIdx.map((i) => chosen[i]))
    if (result) {
      missIdx.forEach((i, n) => {
        const alerts = result[n].alerts
        lists[i] = alerts
        alertCachePut(env.storage, alertCellKey(chosen[i].lat, chosen[i].lng), alerts, now)
      })
    }
  }

  const done = await Promise.all(chosen.map((p, i) => lists[i] || loadAlertsDirect(p, env, now)))
  return mergeAlertLists(done)
}
