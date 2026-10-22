// Mock Open-Meteo and NWS payloads for the e2e suite. Coastal California gets rain in the first
// hours, the south gets a thunderstorm tomorrow evening and the north an icy shower: enough
// variety for good, okay and bad departures and for the "drier route" hint.

export interface MockLocation {
  hourly: Record<string, number[]>
}

export function locationFor(lat: number, lng: number, nowMs: number): MockLocation {
  const day0 = Math.floor(nowMs / 86400000) * 86400000
  const hourly: Record<string, number[]> = {
    time: [],
    temperature_2m: [],
    precipitation_probability: [],
    weather_code: [],
    wind_speed_10m: [],
    wind_gusts_10m: [],
    is_day: [],
  }
  const coastal = lng < -120.6
  for (let h = 0; h < 96; h++) {
    const hod = h % 24
    let code = 0
    let pop = 5
    let temp = 64 - Math.abs(12 - hod) / 2 + (lat - 36) * 2
    if (coastal && h >= 3 && h <= 11) {
      code = 63 + (h % 3 === 0 ? 2 : 0)
      pop = 75
    }
    if (!coastal && lat < 35.2 && h >= 20 && h <= 22) {
      code = 95
      pop = 85
    }
    if (h >= 30 && h <= 33 && lat > 37) {
      code = 63
      pop = 80
      temp = 32
    }
    hourly.time.push(day0 / 1000 + h * 3600)
    hourly.temperature_2m.push(temp)
    hourly.precipitation_probability.push(pop)
    hourly.weather_code.push(code)
    hourly.wind_speed_10m.push(8 + (Math.round(lat * 10) % 4) * 5)
    hourly.wind_gusts_10m.push(15 + (Math.round(lat * 10) % 4) * 9)
    hourly.is_day.push(hod >= 13 || hod < 3 ? 1 : 0)
  }
  return { hourly }
}

// What Open-Meteo answers for a request URL: one object for one coordinate, a list for several
export function openMeteoBody(url: string, nowMs: number): unknown {
  const u = new URL(url)
  const lats = (u.searchParams.get("latitude") || "").split(",").map(Number)
  const lngs = (u.searchParams.get("longitude") || "").split(",").map(Number)
  const list = lats.map((lat, i) => locationFor(lat, lngs[i], nowMs))
  return list.length === 1 ? list[0] : list
}

export function nwsBody(lng: number): unknown {
  const features = [
    {
      id: "urn:flood:1",
      properties: {
        severity: "Severe",
        event: "Flood Warning",
        areaDesc: "San Joaquin; Stanislaus; Merced; Madera; Fresno; Kings; Tulare",
        headline: "h",
      },
    },
    {
      id: "urn:minor:1",
      properties: { severity: "Minor", event: "Frost Advisory", areaDesc: "x" },
    },
  ]
  if (lng > -119.5) {
    features.push({
      id: "urn:wind:" + Math.round(lng),
      properties: {
        severity: "Moderate",
        event: "Wind Advisory",
        areaDesc: "Kern County Mountains",
      },
    } as (typeof features)[number])
  }
  return { type: "FeatureCollection", features }
}
