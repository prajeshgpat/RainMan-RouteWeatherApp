// Rain radar (RainViewer) tile URLs. Pure.

export const RADAR_API_URL = "https://api.rainviewer.com/public/weather-maps.json"
export const RADAR_MAX_ZOOM = 7

interface RadarJson {
  host?: string
  radar?: { past?: Array<{ path?: string }> }
}

// weather-maps.json -> tile URL template with {z}/{x}/{y}, or null when there is no radar frame
export function radarTemplate(json: RadarJson | null | undefined): string | null {
  const past = json && json.radar && json.radar.past
  if (!json || !json.host || !Array.isArray(past) || past.length === 0) return null
  const last = past[past.length - 1]
  if (!last || !last.path) return null
  return json.host + last.path + "/256/{z}/{x}/{y}/2/1_1.png"
}

// Tile URL for map tile (x, y) at zoom, wrapping x around the world; null beyond the served
// zoom levels
export function radarTileUrl(
  template: string | null,
  x: number,
  y: number,
  zoom: number
): string | null {
  if (!template || zoom > RADAR_MAX_ZOOM || zoom < 0) return null
  const n = Math.pow(2, zoom)
  if (y < 0 || y >= n) return null
  const wrapped = ((x % n) + n) % n
  return template
    .replace("{z}", String(zoom))
    .replace("{x}", String(wrapped))
    .replace("{y}", String(y))
}
