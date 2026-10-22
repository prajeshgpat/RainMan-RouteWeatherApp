// Open-Meteo request building and response normalization, shared by the app and the Firebase
// Functions backend. Pure: no DOM, no network, no Node APIs. Weather data by Open-Meteo.com
// (CC BY 4.0).
//
// functions/src/shared/ holds a byte-for-byte copy of this directory (see scripts/sync-shared.mjs);
// a test fails when the copies differ.

export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
export const OPEN_METEO_HOURLY =
  "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,is_day"
export const HOUR_MS = 3600000

export interface LatLngPoint {
  lat: number
  lng: number
}

// One hourly forecast entry, the shape the whole app works with
export interface HourlyEntry {
  t: number // start of the hour, epoch ms
  temp: number | null // Fahrenheit
  pop: number // precipitation probability 0..1
  wind: number // mph
  gust: number // mph
  code: number // WMO weather code
  isDay: boolean
}

type Series = ReadonlyArray<number | string | null> | undefined

// The parts of an Open-Meteo location object the normalizer reads
export interface OpenMeteoLocation {
  hourly?: {
    time?: Series
    temperature_2m?: Series
    precipitation_probability?: Series
    weather_code?: Series
    wind_speed_10m?: Series
    wind_gusts_10m?: Series
    is_day?: Series
  }
}

// One request for any number of points
export function buildForecastUrl(points: ReadonlyArray<LatLngPoint>): string {
  const lats: string[] = []
  const lngs: string[] = []
  for (const p of points) {
    lats.push(String(Number(Number(p.lat).toFixed(4))))
    lngs.push(String(Number(Number(p.lng).toFixed(4))))
  }
  return (
    OPEN_METEO_URL +
    "?latitude=" +
    lats.join(",") +
    "&longitude=" +
    lngs.join(",") +
    "&hourly=" +
    OPEN_METEO_HOURLY +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime&timezone=GMT&forecast_days=4"
  )
}

export function numOrNull(v: unknown): number | null {
  return v == null || isNaN(Number(v)) ? null : Number(v)
}

// Drop the hours already over: keep the first entry whose t + 1h > now, and everything after it
export function sliceFromNow(hourly: HourlyEntry[], nowMs: number): HourlyEntry[] {
  for (let i = 0; i < hourly.length; i++) {
    if (hourly[i].t + HOUR_MS > nowMs) return hourly.slice(i)
  }
  return []
}

// One Open-Meteo location object -> hourly entries starting at the current hour
export function normalizeLocation(
  loc: OpenMeteoLocation | null | undefined,
  nowMs: number
): HourlyEntry[] {
  const h = loc && loc.hourly
  if (!h || !Array.isArray(h.time)) return []
  const out: HourlyEntry[] = []
  for (let i = 0; i < h.time.length; i++) {
    const t = numOrNull(h.time[i])
    if (t === null) continue
    const pop = numOrNull(h.precipitation_probability && h.precipitation_probability[i])
    const code = numOrNull(h.weather_code && h.weather_code[i])
    const isDay = h.is_day ? h.is_day[i] : 1
    out.push({
      t: t * 1000,
      temp: numOrNull(h.temperature_2m && h.temperature_2m[i]),
      pop: pop === null ? 0 : Math.min(1, Math.max(0, pop / 100)),
      wind: numOrNull(h.wind_speed_10m && h.wind_speed_10m[i]) || 0,
      gust: numOrNull(h.wind_gusts_10m && h.wind_gusts_10m[i]) || 0,
      code: code === null ? 0 : code,
      isDay: isDay == null ? true : Number(isDay) !== 0,
    })
  }
  return sliceFromNow(out, nowMs)
}

// A single coordinate returns one object, several return an array in request order.
// Always returns an array of hourly arrays, one per requested coordinate.
export function normalizeResponse(json: unknown, nowMs: number): HourlyEntry[][] {
  const list = (Array.isArray(json) ? json : [json]) as Array<OpenMeteoLocation | null>
  return list.map((loc) => normalizeLocation(loc, nowMs))
}

// ---- Grid cells ----

export function roundTo(v: number, step: number, digits: number): string {
  const r = Math.round(v / step) * step
  const s = r.toFixed(digits)
  return s === "-0.0" || s === "-0.00" ? s.slice(1) : s
}

export interface WxCell {
  key: string
  lat: number
  lng: number
}

// Forecast cache cell: 0.1 degree grid
export function wxCell(lat: number, lng: number): WxCell {
  return {
    key: "wx:" + roundTo(lat, 0.1, 1) + ":" + roundTo(lng, 0.1, 1),
    lat: Number(roundTo(lat, 0.1, 1)),
    lng: Number(roundTo(lng, 0.1, 1)),
  }
}
