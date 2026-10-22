// Shareable links and recent trips: keeping the address bar in step with the route on screen.

import { hourFloor, serializeShareState } from "../features/share"
import { addRecentTrip, removeRecentTrip, saveRecentTrips } from "../features/recent"
import type { Trip } from "../features/recent"
import { state } from "../state"
import { renderRecentTrips } from "../ui/panels"
import { showToast } from "../ui/toast"

export function currentTripText(): Trip {
  const from =
    state.startSel && state.startSel.source === "geo" ? "current" : state.startInput.value.trim()
  return { from, to: state.destinationInput.value.trim() }
}

// Keep ?from=&to=&leave= in the address bar in step with the route on screen
export function updateUrl(): void {
  try {
    let query = ""
    if (state.routeShown) {
      const trip = currentTripText()
      const dep = state.departures[state.selectedD]
      const leave = dep && dep.d > 0 ? hourFloor(dep.timeMs) : "now"
      query = serializeShareState({ from: trip.from, to: trip.to, leave })
    }
    history.replaceState(null, "", window.location.pathname + query)
  } catch {
    // no history API (or a sandboxed frame): the link just is not kept in sync
  }
}

export function shareRoute(): void {
  updateUrl()
  const url = window.location.href
  if (navigator.share) {
    navigator
      .share({ title: "RainMan route weather", text: "Weather along my route", url })
      .catch(() => {})
    return
  }
  const done = () => {
    showToast("Link copied to the clipboard.", { kind: "success" })
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => {
      showToast("Copy this link: " + url, { kind: "info", sticky: true })
    })
  } else {
    showToast("Copy this link: " + url, { kind: "info", sticky: true })
  }
}

export function recordRecentTrip(): void {
  const trip = currentTripText()
  state.recentTrips = addRecentTrip(state.recentTrips, trip)
  saveRecentTrips(state.store, state.recentTrips)
  updateRecentTrips()
}

let pickTrip: ((trip: Trip) => void) | null = null

// Called when a recent trip chip is tapped (routes the trip)
export function setTripPicker(handler: (trip: Trip) => void): void {
  pickTrip = handler
}

// Recent trip chips show while there is no route and nothing typed (a start that is just the
// current location does not count as typed)
export function updateRecentTrips(): void {
  const startEmpty =
    !state.startInput.value.trim() || (state.startSel && state.startSel.source === "geo")
  const show = !state.routeShown && startEmpty && !state.destinationInput.value.trim()
  renderRecentTrips(
    show ? state.recentTrips : [],
    (trip) => {
      if (pickTrip) pickTrip(trip)
    },
    (index) => {
      state.recentTrips = removeRecentTrip(state.recentTrips, index)
      saveRecentTrips(state.store, state.recentTrips)
      updateRecentTrips()
    }
  )
}
