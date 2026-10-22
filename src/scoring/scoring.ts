// Pure scoring helpers for the departure time bar.
// No DOM or Google Maps dependencies so they can be unit-tested in Node.

import type { HourlyEntry } from "../../shared/weather"

export const BADNESS_WEIGHT_MAX = 0.6
export const BADNESS_WEIGHT_MEAN = 0.4
export const GOOD_BELOW = 0.2
export const OKAY_BELOW = 0.5
export const MAX_DEPARTURE_HOURS = 48
export const ICE_MAX_TEMP_F = 34
export const NIGHT_PENALTY = 0.1

export type Severity = "good" | "okay" | "bad" | "unknown"

// The fields of an hourly entry the scoring reads
export type ScoreEntry = Partial<Pick<HourlyEntry, "t">> &
  Pick<HourlyEntry, "code" | "temp" | "pop" | "wind" | "gust" | "isDay">

// A place along the route with its forecast
export interface ScoreSample {
  etaHours?: number
  hourly?: HourlyEntry[] | null
}

// Base badness (0..1) by WMO weather code (Open-Meteo weather_code)
export const WMO_BADNESS: Record<number, number> = {
  0: 0,
  1: 0,
  2: 0,
  3: 0,
  45: 0.4,
  48: 0.6,
  51: 0.2,
  53: 0.3,
  55: 0.4,
  56: 1.0,
  57: 1.0,
  61: 0.4,
  63: 0.6,
  65: 0.9,
  66: 1.0,
  67: 1.0,
  71: 0.8,
  73: 1.0,
  75: 1.0,
  77: 0.8,
  80: 0.4,
  81: 0.6,
  82: 0.9,
  85: 1.0,
  86: 1.0,
  95: 1.0,
  96: 1.0,
  99: 1.0,
}

export const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "freezing drizzle",
  57: "heavy freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light showers",
  81: "showers",
  82: "heavy showers",
  85: "light snow showers",
  86: "snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
}

// Base badness (0..1) for a WMO weather code; unknown codes count as fine
export function conditionBadness(code: number | string): number {
  const b = WMO_BADNESS[Number(code)]
  return b === undefined ? 0 : b
}

export function conditionDescription(code: number | string): string {
  return WMO_DESCRIPTIONS[Number(code)] || "unknown"
}

// Liquid precipitation (drizzle, rain, showers) that freezes into ice on cold roads
function isLiquidPrecip(code: number | string): boolean {
  const c = Number(code)
  return (c >= 51 && c <= 55) || (c >= 61 && c <= 65) || (c >= 80 && c <= 82)
}

export function isIcy(entry: ScoreEntry | null | undefined): boolean {
  return (
    !!entry &&
    isLiquidPrecip(entry.code) &&
    entry.temp != null &&
    Number(entry.temp) <= ICE_MAX_TEMP_F
  )
}

export function isNight(entry: ScoreEntry | null | undefined): boolean {
  return !!entry && entry.isDay === false
}

// Human description of an hourly entry, e.g. "heavy rain (icy) at night"
export function entryDescription(entry: ScoreEntry): string {
  let description = conditionDescription(entry.code)
  if (isIcy(entry)) description += " (icy)"
  if (isNight(entry)) description += " at night"
  return description
}

// Badness of one hourly forecast entry, 0 (great) to 1 (awful)
export function hourBadness(entry: ScoreEntry | null | undefined): number {
  if (!entry) return 0
  let badness = Math.max(conditionBadness(entry.code), (Number(entry.pop) || 0) * 0.5)
  if (isIcy(entry)) badness = 1
  const wind = Number(entry.wind) || 0
  if (wind > 30) badness += 0.3
  else if (wind > 20) badness += 0.15
  if ((Number(entry.gust) || 0) > 45) badness += 0.15
  if (isNight(entry)) badness += NIGHT_PENALTY
  return Math.min(1, Math.max(0, badness))
}

// Index into the hourly array for departure offset d and ETA t (hours), clamped
export function hourIndex(d: number, etaHours: number, length?: number | null): number {
  let idx = Math.round(d + etaHours)
  if (length != null) idx = Math.min(idx, Math.max(length - 1, 0))
  return Math.max(idx, 0)
}

// The forecast entry a driver meets at a sample when leaving d hours from now
export function entryFor(sample: ScoreSample | null | undefined, d: number): HourlyEntry | null {
  if (!sample || !sample.hourly || sample.hourly.length === 0) return null
  return sample.hourly[hourIndex(d, sample.etaHours || 0, sample.hourly.length)]
}

// Score for leaving d hours from now (0 best .. 1 worst), or null if no sample has data
export function departureScore(samples: ScoreSample[], d: number): number | null {
  let max = 0
  let sum = 0
  let count = 0
  for (const sample of samples) {
    const entry = entryFor(sample, d)
    if (!entry) continue
    const b = hourBadness(entry)
    if (b > max) max = b
    sum += b
    count++
  }
  if (count === 0) return null
  return BADNESS_WEIGHT_MAX * max + BADNESS_WEIGHT_MEAN * (sum / count)
}

export function classify(score: number | null | undefined): Severity {
  if (score == null || isNaN(score)) return "unknown"
  if (score < GOOD_BELOW) return "good"
  if (score < OKAY_BELOW) return "okay"
  return "bad"
}

export interface BestWindow {
  start: number
  end: number
  score: number
}

// Earliest run of consecutive hours sharing the lowest score
export function bestWindow(scores: Array<number | null>): BestWindow | null {
  let min = Infinity
  for (const s of scores) {
    if (s != null && s < min) min = s
  }
  if (min === Infinity) return null
  const eps = 1e-9
  let start = -1
  for (let j = 0; j < scores.length; j++) {
    const s = scores[j]
    if (s != null && s - min < eps) {
      start = j
      break
    }
  }
  let end = start
  while (end + 1 < scores.length) {
    const next = scores[end + 1]
    if (next == null || next - min >= eps) break
    end++
  }
  return { start, end, score: min }
}

// Largest departure offset (hours) the forecast can cover; negative if the trip is too long
export function maxDepartureOffset(tripHours: number, hourlyLength: number): number {
  return Math.min(MAX_DEPARTURE_HOURS, hourlyLength - 1 - Math.ceil(tripHours))
}

export interface WorstStop {
  sampleIndex: number
  badness: number
  description: string
  code: number
  isDay: boolean
  wind: number
}

// Worst conditions met along the route when leaving d hours from now
export function worstStop(samples: ScoreSample[], d: number): WorstStop | null {
  let worst: WorstStop | null = null
  for (let i = 0; i < samples.length; i++) {
    const entry = entryFor(samples[i], d)
    if (!entry) continue
    const b = hourBadness(entry)
    if (worst === null || b > worst.badness) {
      worst = {
        sampleIndex: i,
        badness: b,
        description: entryDescription(entry),
        code: entry.code,
        isDay: entry.isDay !== false,
        wind: Number(entry.wind) || 0,
      }
    }
  }
  return worst
}

export interface Departure {
  d: number
  timeMs: number
  score: number | null
  cls: Severity
  worst: WorstStop | null
  night: boolean // it is dark at the start of the drive
}

// One record per departure hour 0..maxD for the time bar
export function computeDepartures(
  samples: ScoreSample[],
  maxD: number,
  nowMs: number
): Departure[] {
  const hourStart = new Date(nowMs)
  hourStart.setMinutes(0, 0, 0)
  const out: Departure[] = []
  for (let d = 0; d <= maxD; d++) {
    const score = departureScore(samples, d)
    const first = entryFor(samples[0], d)
    out.push({
      d,
      timeMs: d === 0 ? nowMs : hourStart.getTime() + d * 3600000,
      score,
      cls: classify(score),
      worst: worstStop(samples, d),
      night: isNight(first),
    })
  }
  return out
}
