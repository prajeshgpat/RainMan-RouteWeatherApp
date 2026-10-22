// Severe weather alerts (NWS, US only) for the route on screen.

import { loadAlerts, pickAlertPoints } from "../features/alerts"
import { state } from "../state"
import { renderAlertBanner } from "../ui/panels"

function showAlerts(): void {
  renderAlertBanner(state.alertsDismissed ? [] : state.routeAlerts, () => {
    state.alertsDismissed = true
    showAlerts()
  })
}

export function loadRouteAlerts(): void {
  const seq = ++state.alertSeq
  const points = state.samples.map((s) => ({ lat: s.latLng.lat(), lng: s.latLng.lng() }))
  state.routeAlerts = []
  showAlerts()
  if (pickAlertPoints(points).length === 0) return
  void loadAlerts(points, {
    fetch: (url) => fetch(url),
    storage: state.sessionStore,
    now: () => Date.now(),
    backend: state.backend,
  }).then((list) => {
    if (seq !== state.alertSeq) return
    state.routeAlerts = list
    showAlerts()
  })
}
