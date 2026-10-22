// Batched, cached forecast loading. No DOM or Google Maps dependencies.

import { buildForecastUrl, normalizeResponse, wxCell } from "../../shared/weather"
import type { HourlyEntry, LatLngPoint } from "../../shared/weather"
import { wxCacheGet, wxCachePut } from "./cache"
import type { StorageLike } from "./cache"

export const MAX_POINTS_PER_REQUEST = 150

// The subset of fetch's Response the app uses (also what the tests fake)
export interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}
export type FetchLike = (url: string) => Promise<FetchResponse>

export interface ForecastEnv {
  fetch: FetchLike
  storage: StorageLike | null
  now: () => number
  // Replaces the network step for one chunk of cell centres (the app uses it to try the backend
  // first). Resolves to one hourly list per point. Defaults to asking Open-Meteo directly.
  fetchChunk?: (points: LatLngPoint[], now: number) => Promise<HourlyEntry[][]>
}

// Ask Open-Meteo for any number of points in one request
export function fetchDirect(
  points: LatLngPoint[],
  fetchFn: FetchLike,
  now: number
): Promise<HourlyEntry[][]> {
  return fetchFn(buildForecastUrl(points))
    .then((response) => {
      if (!response.ok) throw new Error("Open-Meteo returned HTTP " + response.status)
      return response.json()
    })
    .then((json) => normalizeResponse(json, now))
}

interface Cell {
  lat: number
  lng: number
  hourly: HourlyEntry[] | null
}

// Hourly forecasts for any number of points, in order: [{ lat, lng }] -> Promise of
// [hourly array | null]. Points in the same 0.1 degree cell share data; only cells missing
// from the cache are requested (at the cell centre), in chunks of MAX_POINTS_PER_REQUEST.
// A failed chunk leaves its points as null.
export function loadForecasts(
  points: LatLngPoint[],
  env: ForecastEnv
): Promise<Array<HourlyEntry[] | null>> {
  const now = env.now()
  const cells: Record<string, Cell> = {}
  const order: string[] = []
  const cellOf = points.map((p) => {
    const c = wxCell(p.lat, p.lng)
    if (!cells[c.key]) {
      cells[c.key] = { lat: c.lat, lng: c.lng, hourly: wxCacheGet(env.storage, c.key, now) }
      order.push(c.key)
    }
    return c.key
  })
  const misses = order.filter((key) => !cells[key].hourly)
  const chunks: string[][] = []
  for (let i = 0; i < misses.length; i += MAX_POINTS_PER_REQUEST) {
    chunks.push(misses.slice(i, i + MAX_POINTS_PER_REQUEST))
  }
  const fetchChunk =
    env.fetchChunk ||
    ((chunkPoints: LatLngPoint[], at: number) => fetchDirect(chunkPoints, env.fetch, at))

  return Promise.all(
    chunks.map((keys) =>
      fetchChunk(
        keys.map((key) => cells[key]),
        now
      )
        .then((lists) => {
          keys.forEach((key, idx) => {
            const hourly = lists[idx]
            if (hourly && hourly.length > 0) {
              cells[key].hourly = hourly
              wxCachePut(env.storage, key, hourly, now)
            }
          })
        })
        .catch((error) => {
          console.error("Weather fetch failed:", error)
        })
    )
  ).then(() => cellOf.map((key) => cells[key].hourly || null))
}
