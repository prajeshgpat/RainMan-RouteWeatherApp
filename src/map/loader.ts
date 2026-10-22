// Loads the Google Maps JavaScript API with @googlemaps/js-api-loader. The key comes from
// VITE_GOOGLE_MAPS_KEY (see .env.example).

import { Loader } from "@googlemaps/js-api-loader"

// Libraries the app uses. With the loader's dynamic import every library must be requested.
const LIBRARIES = ["core", "maps", "marker", "places", "geometry", "routes", "geocoding"] as const

let loading: Promise<void> | null = null

export function loadGoogleMaps(): Promise<void> {
  if (!loading) {
    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined
    if (!key)
      console.warn("VITE_GOOGLE_MAPS_KEY is not set: the map cannot load. See .env.example.")
    const loader = new Loader({ apiKey: key || "", version: "weekly" })
    loading = Promise.all(LIBRARIES.map((name) => loader.importLibrary(name))).then(() => undefined)
  }
  return loading
}
