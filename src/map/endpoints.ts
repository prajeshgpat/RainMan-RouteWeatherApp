// Start and destination inputs: autocomplete, swap, clear, the current location, and routing a
// trip from a link or a recent-trip chip.

import { parseShareUrl } from "../features/share"
import type { Trip } from "../features/recent"
import type { ShareState } from "../features/share"
import { state } from "../state"
import { hideToast, showToast } from "../ui/toast"
import { computeRoute, resetRoute } from "./route"
import { placeLocation, resolveEndpoint, syncStartMarker } from "./selection"
import { updateRecentTrips } from "../trip/links"

// Wire the two inputs to Places Autocomplete
export function setupAutocomplete(): void {
  const autocompleteOptions = { fields: ["geometry", "name", "formatted_address"] }
  const startAutocomplete = new google.maps.places.Autocomplete(
    state.startInput,
    autocompleteOptions
  )
  const destinationAutocomplete = new google.maps.places.Autocomplete(
    state.destinationInput,
    autocompleteOptions
  )

  startAutocomplete.addListener("place_changed", () => {
    const place = startAutocomplete.getPlace()
    const loc = placeLocation(place)
    if (!loc) {
      // Enter on typed text: route using the text as an address (see resolveEndpoint)
      if (!state.startInput.value.trim()) return
      state.startSel = null
      computeRoute()
      return
    }
    state.startSel = { text: state.startInput.value, loc, source: "user" }
    syncStartMarker()
    if (!state.routeShown) {
      state.map.panTo(loc)
      state.map.setZoom(14)
    }
    computeRoute()
  })

  destinationAutocomplete.addListener("place_changed", () => {
    const place = destinationAutocomplete.getPlace()
    const loc = placeLocation(place)
    if (!loc) {
      if (!state.destinationInput.value.trim()) return
      state.destSel = null
      computeRoute()
      return
    }
    state.destSel = { text: state.destinationInput.value, loc, source: "user" }
    if (!resolveEndpoint(state.startSel, state.startInput)) {
      state.map.panTo(loc)
      state.map.setZoom(12)
    }
    computeRoute()
  })
}

export function swapEndpoints(): void {
  const tmpText = state.startInput.value
  state.startInput.value = state.destinationInput.value
  state.destinationInput.value = tmpText
  const tmpSel = state.startSel
  state.startSel = state.destSel
    ? { text: state.destSel.text, loc: state.destSel.loc, source: "user" }
    : null
  state.destSel = tmpSel ? { text: tmpSel.text, loc: tmpSel.loc, source: "user" } : null
  resetRoute()
  syncStartMarker()
  computeRoute()
}

export function clearAll(): void {
  state.startInput.value = ""
  state.destinationInput.value = ""
  state.startSel = null
  state.destSel = null
  state.pendingLeave = "now"
  state.pendingCurrentStart = false
  resetRoute()
  hideToast()
  if (state.userLatLng) setStartToCurrentLocation()
}

function setStartToCurrentLocation(): void {
  if (!state.userLatLng) return
  state.startSel = { text: "Current location", loc: state.userLatLng, source: "geo" }
  state.startInput.value = "Current location"
  syncStartMarker()
  updateRecentTrips()
}

// Show the user's position and default the start to it; explicit = the user pressed the button
export function getCurrentLocation(explicit: boolean): void {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported by your browser.", { kind: "error" })
    return
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const userLatLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude)
      state.userLatLng = userLatLng
      const hadRoute = !!state.destSel || state.pendingCurrentStart

      if (state.userMarker) state.userMarker.setMap(null)
      state.userMarker = new google.maps.Marker({
        position: userLatLng,
        map: state.map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "blue",
          fillOpacity: 0.7,
          strokeColor: "white",
          strokeOpacity: 0.7,
          strokeWeight: 3,
          scale: 10,
        },
      })

      if (!state.routeShown) {
        state.map.setCenter({ lat: userLatLng.lat() + 0.005, lng: userLatLng.lng() })
        state.map.setZoom(13)
      }

      // Don't override a start the user picked themselves unless they asked for the current location
      if (explicit || !state.startSel || state.startSel.source === "geo") {
        if (!explicit && state.startInput.value.trim() && !state.startSel) return // user is typing a start
        setStartToCurrentLocation()
        state.pendingCurrentStart = false
        if (hadRoute) computeRoute()
      }
    },
    () => {
      if (state.pendingCurrentStart) {
        state.pendingCurrentStart = false
        state.pendingLeave = "now"
        showToast("Allow location access or type a starting point to plan this trip.", {
          kind: "info",
        })
        return
      }
      showToast("Unable to retrieve your location. You can type a starting point instead.", {
        kind: "info",
      })
    }
  )
}

// Route a { from, to } pair of texts ("current" = the current location)
export function applyTrip(trip: Trip, leave?: "now" | number): void {
  state.pendingLeave = leave === undefined ? "now" : leave
  state.destSel = null
  state.destinationInput.value = trip.to
  state.startSel = null
  if (trip.from === "current") {
    if (state.userLatLng) {
      setStartToCurrentLocation()
      computeRoute()
    } else {
      state.startInput.value = ""
      state.pendingCurrentStart = true
      getCurrentLocation(true)
    }
  } else {
    state.startInput.value = trip.from
    syncStartMarker()
    computeRoute()
  }
}

// On load: route from the link's from/to/leave when present. Returns the parsed link, or null.
export function startFromShareUrl(): ShareState | null {
  const parsed = parseShareUrl(window.location.search)
  if (!parsed) return null
  applyTrip({ from: parsed.from, to: parsed.to }, parsed.leave)
  return parsed
}
