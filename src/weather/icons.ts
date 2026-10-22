// WMO weather code to Meteocons icon name. Pure, no DOM.

export const WEATHER_ICONS = [
  "clear-day",
  "clear-night",
  "partly-cloudy-day",
  "partly-cloudy-night",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "extreme-rain",
  "snow",
  "sleet",
  "thunderstorms-rain",
  "wind",
  "not-available",
] as const

// File name (without .svg) of the Meteocons icon for a WMO code. wind is optional (mph):
// a windy but otherwise fair hour shows the wind icon.
export function weatherIconName(
  code: number | string | null | undefined,
  isDay?: boolean,
  wind?: number
): string {
  const day = isDay !== false
  const c = Number(code)
  if (code == null || isNaN(c)) return "not-available"
  if (c <= 3 && (wind as number) > 30) return "wind"
  if (c === 0 || c === 1) return day ? "clear-day" : "clear-night"
  if (c === 2) return day ? "partly-cloudy-day" : "partly-cloudy-night"
  if (c === 3) return "overcast"
  if (c === 45 || c === 48) return "fog"
  if (c === 56 || c === 57 || c === 66 || c === 67) return "sleet"
  if (c >= 51 && c <= 55) return "drizzle"
  if (c === 65 || c === 82) return "extreme-rain"
  if (c === 61 || c === 63 || c === 80 || c === 81) return "rain"
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow"
  if (c === 95 || c === 96 || c === 99) return "thunderstorms-rain"
  return "not-available"
}
