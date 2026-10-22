// Place names (reverse geocoding is only done on demand, and cached).

import { geoCachePut, geoCacheGet, geoKey } from "../weather/cache"
import { state } from "../state"

function cachedPlace(latLng: google.maps.LatLng): string | null {
  const key = geoKey(latLng.lat(), latLng.lng())
  if (state.placeCache[key]) return state.placeCache[key]
  const stored = geoCacheGet(state.store, key)
  if (stored) state.placeCache[key] = stored
  return stored
}

function reverseGeocodeLatLng(lat: number, lng: number): Promise<string> {
  const geocoder = new google.maps.Geocoder()
  const latLng = new google.maps.LatLng(lat, lng)

  return new Promise((resolve, reject) => {
    geocoder.geocode({ location: latLng }, (results, status) => {
      if (status !== google.maps.GeocoderStatus.OK) {
        reject("Geocoder failed due to: " + status)
        return
      }
      if (!results || !results[0]) {
        reject("No results found")
        return
      }
      let city: string | null = null
      results[0].address_components.forEach((component) => {
        if (city) return
        if (
          component.types.indexOf("locality") !== -1 ||
          component.types.indexOf("administrative_area_level_1") !== -1
        ) {
          city = component.long_name
        }
      })
      if (city) resolve(city)
      else reject("City not found in the address")
    })
  })
}

// Resolve the place name of a sample (from memory, localStorage, then the Geocoder). Results for
// an older search are dropped. Resolves to the name, or null when unknown.
export function ensurePlace(index: number): Promise<string | null> {
  const s = state.samples[index]
  if (!s) return Promise.resolve(null)
  if (s.place) return Promise.resolve(s.place)
  const cached = cachedPlace(s.latLng)
  if (cached) {
    s.place = cached
    return Promise.resolve(cached)
  }
  const key = geoKey(s.latLng.lat(), s.latLng.lng())
  const myRequest = state.requestId
  if (!state.placePending[key]) {
    state.placePending[key] = reverseGeocodeLatLng(s.latLng.lat(), s.latLng.lng())
      .then((city): string | null => {
        state.placeCache[key] = city
        geoCachePut(state.store, key, city, Date.now())
        return city
      })
      .catch((error): string | null => {
        console.error("Error getting city name:", error)
        return null
      })
      .then((city) => {
        delete state.placePending[key]
        return city
      })
  }
  return state.placePending[key].then((city) => {
    if (city && myRequest === state.requestId && state.samples[index] === s) s.place = city
    return myRequest === state.requestId ? city : null
  })
}
