// Client for the optional RainMan backend (Firebase Functions behind /api/**). The app asks the
// backend first so every user shares one CDN-cached copy of each forecast and alert lookup. When
// the backend is not deployed (404), unreachable or answers with something that is not the
// expected JSON, the caller falls back to calling Open-Meteo / NWS directly, and the choice is
// remembered for the session.

import type { HourlyEntry, LatLngPoint } from "../../shared/weather"
import type { NwsAlert } from "../../shared/alerts"
import { storageGet, storageSet } from "./cache"
import type { StorageLike } from "./cache"
import type { FetchLike } from "./forecast"

export const API_MODE_KEY = "rm:api"

type Mode = "unknown" | "backend" | "direct"

export interface BackendPointAlerts {
  lat: number
  lng: number
  alerts: NwsAlert[]
}

export class BackendClient {
  private mode: Mode

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly session: StorageLike | null
  ) {
    this.mode = storageGet<string>(session, API_MODE_KEY) === "direct" ? "direct" : "unknown"
  }

  get usable(): boolean {
    return this.mode !== "direct"
  }

  private giveUp(): void {
    this.mode = "direct"
    storageSet(this.session, API_MODE_KEY, "direct")
  }

  // JSON from the backend, or null when it should not be used for this call
  private async getJson(path: string): Promise<unknown | null> {
    if (!this.usable) return null
    let response
    try {
      response = await this.fetchFn(path)
    } catch {
      this.giveUp() // network error: no backend here
      return null
    }
    if (response.status === 404) {
      this.giveUp() // not deployed
      return null
    }
    if (!response.ok) return null // 429 / 5xx: use the direct path for this call only
    try {
      const json = await response.json()
      this.mode = "backend"
      return json
    } catch {
      this.giveUp() // an HTML fallback page, for example
      return null
    }
  }

  // One hourly list per point, or null when the backend cannot answer
  async forecasts(points: LatLngPoint[]): Promise<HourlyEntry[][] | null> {
    const json = (await this.getJson("/api/forecast?pts=" + formatPoints(points))) as {
      hourly?: unknown
    } | null
    const hourly = json && json.hourly
    if (!Array.isArray(hourly) || hourly.length !== points.length) return null
    return hourly as HourlyEntry[][]
  }

  // Alerts of each point, or null when the backend cannot answer
  async alerts(points: LatLngPoint[]): Promise<BackendPointAlerts[] | null> {
    const json = (await this.getJson("/api/alerts?pts=" + formatPoints(points))) as {
      points?: unknown
    } | null
    const list = json && json.points
    if (!Array.isArray(list) || list.length !== points.length) return null
    return list as BackendPointAlerts[]
  }
}

// "lat,lng;lat,lng" with at most 4 decimals
export function formatPoints(points: LatLngPoint[]): string {
  return points
    .map((p) => Number(Number(p.lat).toFixed(4)) + "," + Number(Number(p.lng).toFixed(4)))
    .join(";")
}
