// RainMan entry point: loads Google Maps, wires the page and registers the service worker.

import { MAP_DARK_STYLES } from "./features/darkStyle"
import { UNIT_KEY, normalizeUnit } from "./features/units"
import { loadRecentTrips } from "./features/recent"
import {
  applyTrip,
  clearAll,
  getCurrentLocation,
  setupAutocomplete,
  startFromShareUrl,
  swapEndpoints,
} from "./map/endpoints"
import { darkModeOn, watchDarkMode } from "./map/darkmode"
import { declutterMarkers, loadIcons, paintMarkers, setMarkerClickHandler } from "./map/markers"
import { loadGoogleMaps } from "./map/loader"
import { toggleRadar } from "./map/radar"
import { FALLBACK_LATLNG, state } from "./state"
import { setTripPicker, shareRoute, updateRecentTrips } from "./trip/links"
import { hidePopup, showPopup } from "./ui/popup"
import { byId } from "./ui/dom"
import { renderUnitToggle } from "./ui/panels"
import { hideToast, showToast } from "./ui/toast"
import { BackendClient } from "./weather/api"
import { storageGet, storageSet, wxCachePrune } from "./weather/cache"
import type { StorageLike } from "./weather/cache"

function getStore(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getSessionStore(): StorageLike | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function toggleUnit(): void {
  state.unit = state.unit === "C" ? "F" : "C"
  storageSet(state.store, UNIT_KEY, state.unit)
  renderUnitToggle(state.unit)
  paintMarkers()
  if (state.openSampleIndex >= 0) showPopup(state.openSampleIndex)
}

function initMap(): void {
  state.directionsService = new google.maps.DirectionsService()
  state.directionsDisplay = new google.maps.DirectionsRenderer({ suppressMarkers: true })
  state.store = getStore()
  state.sessionStore = getSessionStore()
  state.backend = new BackendClient((url) => fetch(url), state.sessionStore)
  wxCachePrune(state.store, Date.now())
  state.iconsReady = loadIcons()
  state.unit = normalizeUnit(storageGet(state.store, UNIT_KEY))
  state.recentTrips = loadRecentTrips(state.store)
  state.map = new google.maps.Map(byId("map"), {
    zoom: 13,
    center: FALLBACK_LATLNG,
    styles: darkModeOn() ? MAP_DARK_STYLES : null,
    mapTypeControlOptions: {
      mapTypeIds: [],
    },
    fullscreenControl: false,
    streetViewControl: false,
    zoomControl: false,
  })

  state.startInput = byId<HTMLInputElement>("search-input")
  state.destinationInput = byId<HTMLInputElement>("destination-input")
  setupAutocomplete()
  setMarkerClickHandler(showPopup)
  setTripPicker((trip) => {
    applyTrip(trip)
  })

  byId("clear-button").addEventListener("click", clearAll)
  byId("swap-button").addEventListener("click", swapEndpoints)
  byId("current-location-button").addEventListener("click", () => {
    getCurrentLocation(true)
  })
  byId("weather-info-close").addEventListener("click", hidePopup)
  byId("toast").addEventListener("click", hideToast)
  byId("unit-toggle").addEventListener("click", toggleUnit)
  byId("share-button").addEventListener("click", shareRoute)
  byId("radar-button").addEventListener("click", toggleRadar)
  renderUnitToggle(state.unit)
  watchDarkMode()
  ;[state.startInput, state.destinationInput].forEach((input) => {
    input.addEventListener("focus", updateRecentTrips)
    input.addEventListener("input", updateRecentTrips)
  })

  // Registered once: clicking the map hides the weather popup
  state.map.addListener("click", hidePopup)
  // Thin out overlapping markers whenever the view settles or the zoom changes
  state.map.addListener("idle", declutterMarkers)
  state.map.addListener("zoom_changed", declutterMarkers)

  const shared = startFromShareUrl()
  updateRecentTrips()

  // Default the start to the user's current location. A link that starts at the current location
  // has already asked for it (and routes once it is known).
  if (shared && shared.from === "current") {
    // handled by startFromShareUrl
  } else if (navigator.geolocation) {
    getCurrentLocation(false)
  } else {
    showToast("Geolocation is not supported by your browser.", { kind: "error" })
  }
}

// ---- Installable app: offline shell ----

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker not registered:", error)
    })
  })
}

registerServiceWorker()
loadGoogleMaps().then(initMap, (error) => {
  console.error("Google Maps failed to load:", error)
  showToast("Google Maps failed to load. Check your connection and reload.", {
    kind: "error",
    sticky: true,
  })
})
