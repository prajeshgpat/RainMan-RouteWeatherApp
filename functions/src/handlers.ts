// The /api request handlers. Pure request in, response out: no firebase-functions imports, so
// they are unit-tested with a fake fetch and clock.

import {
  NWS_USER_AGENT,
  inNwsCoverage,
  mergeAlertLists,
  mergeAlerts,
  nwsPointUrl,
} from "./shared/alerts"
import type { NwsAlert, NwsCollection } from "./shared/alerts"
import { buildForecastUrl, normalizeResponse, roundTo, wxCell } from "./shared/weather"
import type { HourlyEntry, LatLngPoint } from "./shared/weather"
import { TokenBucketLimiter } from "./rateLimit"

export const MAX_FORECAST_POINTS = 200
export const MAX_ALERT_POINTS = 20

export interface ApiRequest {
  method: string
  path: string
  query: Record<string, string | undefined>
  ip: string
}

export interface ApiResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface FetchResult {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface Deps {
  fetch: (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResult>
  now: () => number
  limiter: TokenBucketLimiter
  log: (entry: Record<string, unknown>) => void
}

const FORECAST_CACHE = "public, max-age=300, s-maxage=1800"
const ALERTS_CACHE = "public, max-age=120, s-maxage=600"

function json(status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    body,
  }
}

function fail(status: number, message: string, headers: Record<string, string> = {}): ApiResponse {
  return json(status, { error: message }, { "Cache-Control": "no-store", ...headers })
}

class BadRequest extends Error {}

// "lat,lng;lat,lng;..." -> points. Throws BadRequest with a message for the client.
export function parsePoints(raw: string | undefined, max: number): LatLngPoint[] {
  if (!raw || !raw.trim()) throw new BadRequest("Missing pts: expected lat,lng;lat,lng;...")
  const parts = raw.split(";").filter((p) => p.trim() !== "")
  if (parts.length === 0) throw new BadRequest("Missing pts: expected lat,lng;lat,lng;...")
  if (parts.length > max) throw new BadRequest("Too many points: at most " + max + " per request")
  return parts.map((part) => {
    const pieces = part.split(",")
    const lat = Number(pieces[0])
    const lng = Number(pieces[1])
    if (
      pieces.length !== 2 ||
      pieces[0].trim() === "" ||
      pieces[1].trim() === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      throw new BadRequest('Invalid point "' + part + '": expected lat,lng')
    }
    if (lat < -90 || lat > 90) throw new BadRequest("Latitude out of range (-90..90): " + lat)
    if (lng < -180 || lng > 180) throw new BadRequest("Longitude out of range (-180..180): " + lng)
    return { lat, lng }
  })
}

// One batched Open-Meteo request for the distinct 0.1 degree cells, normalized to the app's
// hourly shape. Cells (not raw points) are what is requested, so users share CDN cache entries.
export async function handleForecast(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  const points = parsePoints(req.query.pts, MAX_FORECAST_POINTS)
  const cells = points.map((p) => wxCell(p.lat, p.lng))
  const distinct: Array<{ lat: number; lng: number }> = []
  const indexOf = new Map<string, number>()
  for (const cell of cells) {
    if (!indexOf.has(cell.key)) {
      indexOf.set(cell.key, distinct.length)
      distinct.push({ lat: cell.lat, lng: cell.lng })
    }
  }

  const now = deps.now()
  let response: FetchResult
  try {
    response = await deps.fetch(buildForecastUrl(distinct))
  } catch (error) {
    deps.log({ severity: "ERROR", message: "Open-Meteo request failed", error: String(error) })
    return fail(502, "Forecast provider unreachable")
  }
  if (!response.ok) {
    deps.log({ severity: "ERROR", message: "Open-Meteo error", upstreamStatus: response.status })
    return fail(502, "Forecast provider returned HTTP " + response.status)
  }
  let lists: HourlyEntry[][]
  try {
    lists = normalizeResponse(await response.json(), now)
  } catch (error) {
    deps.log({ severity: "ERROR", message: "Open-Meteo response unreadable", error: String(error) })
    return fail(502, "Forecast provider returned an unreadable response")
  }
  if (lists.length !== distinct.length) {
    deps.log({ severity: "ERROR", message: "Open-Meteo returned the wrong number of locations" })
    return fail(502, "Forecast provider returned an unexpected response")
  }

  const hourly = cells.map((cell) => lists[indexOf.get(cell.key) as number])
  return json(
    200,
    { generatedAt: new Date(now).toISOString(), hourly },
    { "Cache-Control": FORECAST_CACHE }
  )
}

interface PointAlerts {
  lat: number
  lng: number
  alerts: NwsAlert[]
}

// NWS alerts for a few points: each point is looked up on api.weather.gov (with the User-Agent
// NWS asks for), merged and filtered to Moderate/Severe/Extreme with the shared helpers.
export async function handleAlerts(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  const requested = parsePoints(req.query.pts, MAX_ALERT_POINTS)
  // ~1 km precision keeps the CDN cache effective without moving a point out of its NWS zone
  const points = requested.map((p) => ({
    lat: Number(roundTo(p.lat, 0.01, 2)),
    lng: Number(roundTo(p.lng, 0.01, 2)),
  }))

  let failures = 0
  const results: PointAlerts[] = await Promise.all(
    points.map(async (p): Promise<PointAlerts> => {
      if (!inNwsCoverage(p.lat, p.lng)) return { ...p, alerts: [] }
      try {
        const response = await deps.fetch(nwsPointUrl(p), {
          headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
        })
        if (!response.ok) throw new Error("NWS returned HTTP " + response.status)
        return { ...p, alerts: mergeAlerts([(await response.json()) as NwsCollection]) }
      } catch (error) {
        failures++
        deps.log({ severity: "WARNING", message: "NWS lookup failed", error: String(error) })
        return { ...p, alerts: [] }
      }
    })
  )

  const lookups = points.filter((p) => inNwsCoverage(p.lat, p.lng)).length
  if (lookups > 0 && failures === lookups) return fail(502, "Alert provider unavailable")

  const merged = mergeAlertLists(results.map((r) => r.alerts))
  // A partial answer must not be shared by the CDN for ten minutes
  const cache = failures === 0 ? ALERTS_CACHE : "no-store"
  return json(
    200,
    { generatedAt: new Date(deps.now()).toISOString(), alerts: merged, points: results },
    {
      "Cache-Control": cache,
    }
  )
}

// Routes /api/forecast and /api/alerts, applying the per-IP rate limit and logging each request
export async function handleRequest(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  const started = deps.now()
  const route = req.path.replace(/\/+$/, "")
  let res: ApiResponse
  try {
    if (route !== "/api/forecast" && route !== "/api/alerts") {
      res = fail(404, "Not found")
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      res = fail(405, "Method not allowed", { Allow: "GET, HEAD" })
    } else {
      const limit = deps.limiter.take(req.ip, started)
      if (!limit.allowed) {
        res = fail(429, "Too many requests", { "Retry-After": String(limit.retryAfterSeconds) })
      } else {
        res =
          route === "/api/forecast"
            ? await handleForecast(req, deps)
            : await handleAlerts(req, deps)
      }
    }
  } catch (error) {
    if (error instanceof BadRequest) {
      res = fail(400, error.message)
    } else {
      deps.log({ severity: "ERROR", message: "Unhandled error", error: String(error) })
      res = fail(500, "Internal error")
    }
  }
  deps.log({
    severity: res.status >= 500 ? "ERROR" : "INFO",
    message: "request",
    method: req.method,
    path: route,
    status: res.status,
    durationMs: deps.now() - started,
    points: req.query.pts ? req.query.pts.split(";").length : 0,
  })
  return res
}
