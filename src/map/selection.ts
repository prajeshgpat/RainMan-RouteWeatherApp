// Selected route endpoints and the marker for a picked start.

import { state } from "../state"

export function placeLocation(
  place: google.maps.places.PlaceResult | null | undefined
): google.maps.LatLng | null {
  return place && place.geometry && place.geometry.location ? place.geometry.location : null
}

// A selected place if the input still matches it, otherwise whatever the user typed (as an address)
export function resolveEndpoint(
  sel: typeof state.startSel,
  input: HTMLInputElement
): google.maps.LatLng | google.maps.LatLngLiteral | string | null {
  const text = input.value.trim()
  if (!text) return null
  if (sel && sel.text === input.value) return sel.loc
  return text
}

export function syncStartMarker(): void {
  if (state.startMarker) {
    state.startMarker.setMap(null)
    state.startMarker = null
  }
  if (state.startSel && state.startSel.source === "user" && !state.routeShown) {
    state.startMarker = new google.maps.Marker({ position: state.startSel.loc, map: state.map })
  }
}
