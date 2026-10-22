// The accuracy.json contract produced by the accuracy pipeline (pipeline/) and rendered by
// accuracy.html. The deploy workflow copies the pipeline's latest file to /data/accuracy.json.

export interface LeadDayStats {
  lead_day: number
  green_trip_dry_rate: number | null
  okay_trip_dry_rate: number | null
  bad_trip_wet_rate: number | null
  brier_pop: number | null
  rain_pod: number | null
  rain_far: number | null
  n_trips: number
  n_point_hours: number
}

export interface CorridorStats {
  corridor_id: string
  name: string
  green_trip_dry_rate_day1: number | null
  brier_pop_day1: number | null
  n_trips_day1: number
}

export interface AccuracyData {
  generated_at: string
  window: { start: string; end: string }
  corridors: number
  points: number
  departures_evaluated: number
  headline: { lead_day: number; green_trip_dry_rate: number | null; n_green_trips: number }
  by_lead_day: LeadDayStats[]
  by_corridor: CorridorStats[]
  methodology_url: string
}

export const ACCURACY_URL = "/data/accuracy.json"

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

// The parsed file, or null when it does not look like accuracy.json
export function parseAccuracy(json: unknown): AccuracyData | null {
  if (!isObject(json)) return null
  const { headline, window: win, by_lead_day: byLead, by_corridor: byCorridor } = json
  if (!isObject(headline) || !isObject(win)) return null
  if (!Array.isArray(byLead) || !Array.isArray(byCorridor)) return null
  if (typeof json.generated_at !== "string") return null
  return json as unknown as AccuracyData
}

// "91%" for 0.912, "–" for missing values
export function percent(rate: number | null | undefined): string {
  return rate == null || isNaN(rate) ? "–" : Math.round(rate * 100) + "%"
}

export function decimal(value: number | null | undefined, digits = 3): string {
  return value == null || isNaN(value) ? "–" : value.toFixed(digits)
}

export function count(n: number | null | undefined): string {
  return n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("en-US")
}

export function formatDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}
