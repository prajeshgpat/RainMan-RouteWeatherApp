// Route search, weather loading and the per-route state (departures, best window, markers).

import { bestWindow, computeDepartures, maxDepartureOffset } from "../scoring/scoring"
import type { ScoreSample } from "../scoring/scoring"
import { routeChipLabel, routeSuggestion } from "../features/routes"
import { hourFloor } from "../features/share"
import { loadForecasts } from "../weather/forecast"
import type { ForecastEnv } from "../weather/forecast"
import { fetchDirect } from "../weather/forecast"
import { MAX_ROUTES, MAX_SAMPLES, MIN_END_GAP_METERS, SAMPLE_STEP_METERS, state } from "../state"
import type { RouteData, Sample } from "../state"
import { hidePopup, showPopup } from "../ui/popup"
import { renderAlertBanner, renderRouteChips } from "../ui/panels"
import { renderTimeBar } from "../ui/timebar"
import { hideToast, showToast } from "../ui/toast"
import { byId } from "../ui/dom"
import { loadRouteAlerts } from "./alerts"
import { clearEndpointPins, clearMarkers, drawEndpointPins, paintMarkers } from "./markers"
import { ensurePlace } from "./places"
import { resolveEndpoint, syncStartMarker } from "./selection"
import { recordRecentTrip, updateRecentTrips, updateUrl } from "../trip/links"

// Single place that resets all route/weather state and UI
export function resetRoute(): void {
  state.requestId++
  state.alertSeq++
  state.directionsDisplay.setMap(null)
  state.routeShown = false
  clearMarkers(state.samples)
  clearEndpointPins()
  state.routes = []
  state.routeIndex = 0
  state.routeAlerts = []
  state.samples = []
  state.departures = []
  state.bestRange = null
  state.selectedD = 0
  state.maxD = 0
  state.barLoading = false
  hidePopup()
  renderTimeBar({ hidden: true })
  renderRouteChips({ routes: [] })
  renderAlertBanner([])
  byId("share-button").hidden = true
  syncStartMarker()
  updateUrl()
  updateRecentTrips()
}

export function computeRoute(): void {
  const origin = resolveEndpoint(state.startSel, state.startInput)
  const destination = resolveEndpoint(state.destSel, state.destinationInput)
  if (!destination) return
  if (!origin) {
    resetRoute()
    showToast("Enter a starting point or tap Current Location.", { kind: "info" })
    return
  }

  resetRoute()
  state.alertsDismissed = false
  const myRequest = state.requestId
  showToast("Finding route…", { kind: "loading", sticky: true })

  state.directionsService.route(
    {
      origin,
      destination,
      travelMode: google.maps.TravelMode.DRIVING,
      provideRouteAlternatives: true,
    },
    (result, status) => {
      if (myRequest !== state.requestId) return
      if (status !== google.maps.DirectionsStatus.OK || !result) {
        state.pendingLeave = "now"
        showToast("Couldn't find a driving route (" + status + ").", { kind: "error" })
        return
      }
      state.directionsDisplay.setDirections(result)
      state.directionsDisplay.setRouteIndex(0)
      state.directionsDisplay.setMap(state.map)
      state.routeShown = true
      syncStartMarker()

      state.routes = result.routes.slice(0, MAX_ROUTES).map((r): RouteData => {
        const leg = r.legs[0]
        const durationSec = (leg.duration as google.maps.Duration).value
        const tripHours = durationSec / 3600
        return {
          summary: r.summary || "",
          durationSec,
          tripHours,
          leg,
          samples: buildSamples(r.overview_path, tripHours),
          departures: [],
          bestRange: null,
          maxD: -1,
          failed: 0,
          noData: true,
        }
      })
      state.routeIndex = 0
      state.samples = state.routes[0].samples
      drawEndpointPins(state.routes[0].leg)
      byId("share-button").hidden = false
      updateUrl()

      state.barLoading = true
      updateBar()
      showToast("Loading weather along your route…", { kind: "loading", sticky: true })

      // One batched (and cached) forecast request covers every sample of every alternative
      let all: Sample[] = []
      state.routes.forEach((r) => {
        all = all.concat(r.samples)
      })
      void loadWeather(all).then(() => {
        if (myRequest !== state.requestId) return
        onWeatherLoaded()
      })
    }
  )
}

// Weather sample points along the path: the true origin, about every 25 mi, and the true destination
function buildSamples(path: google.maps.LatLng[], tripHours: number): Sample[] {
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    cum.push(
      cum[i - 1] + google.maps.geometry.spherical.computeDistanceBetween(path[i - 1], path[i])
    )
  }
  const total = cum[cum.length - 1]
  const step = Math.max(SAMPLE_STEP_METERS, total / (MAX_SAMPLES - 1))
  const distances = [0]
  if (total > 0) {
    for (let d = step; d < total - MIN_END_GAP_METERS; d += step) distances.push(d)
    distances.push(total)
  }

  let j = 0
  return distances.map((dist) => {
    while (j < path.length - 2 && cum[j + 1] < dist) j++
    let latLng: google.maps.LatLng
    if (path.length === 1) {
      latLng = path[0]
    } else {
      const segLen = cum[j + 1] - cum[j]
      const frac = segLen > 0 ? Math.min(1, Math.max(0, (dist - cum[j]) / segLen)) : 0
      latLng = google.maps.geometry.spherical.interpolate(path[j], path[j + 1], frac)
    }
    return {
      latLng,
      distMeters: dist,
      etaHours: total > 0 ? (dist / total) * tripHours : 0,
      hourly: null,
      place: null,
      marker: null,
    }
  })
}

// Attach hourly forecasts to samples with one batched, cached request: the RainMan backend when
// it is deployed, otherwise Open-Meteo directly. Takes any list of samples (the samples of
// several routes at once).
function loadWeather(list: Sample[]): Promise<void> {
  const points = list.map((s) => ({ lat: s.latLng.lat(), lng: s.latLng.lng() }))
  const fetchFn = (url: string) => fetch(url)
  const backend = state.backend
  const env: ForecastEnv = {
    fetch: fetchFn,
    storage: state.store,
    now: () => Date.now(),
    fetchChunk: async (chunk, now) => {
      if (backend && backend.usable) {
        const fromBackend = await backend.forecasts(chunk)
        if (fromBackend) return fromBackend
      }
      return fetchDirect(chunk, fetchFn, now)
    },
  }
  return loadForecasts(points, env).then((results) => {
    list.forEach((s, i) => {
      const hourly = results[i]
      if (hourly) s.hourly = hourly
      else s.failed = true
    })
  })
}

// Departures, best window and usable forecast length of one route
function analyzeRoute(route: RouteData, nowMs: number): void {
  const withData = route.samples.filter((s) => s.hourly)
  route.failed = route.samples.length - withData.length
  route.noData = withData.length === 0
  route.departures = []
  route.bestRange = null
  route.maxD = -1
  if (route.noData) return
  const hourlyLen = Math.min(...withData.map((s) => (s.hourly as unknown[]).length))
  route.maxD = maxDepartureOffset(route.tripHours, hourlyLen)
  if (route.maxD < 0) return
  route.departures = computeDepartures(route.samples as ScoreSample[], route.maxD, nowMs)
  route.bestRange = bestWindow(route.departures.map((dep) => dep.score))
}

function onWeatherLoaded(): void {
  state.barLoading = false
  const now = Date.now()
  state.routes.forEach((r) => {
    analyzeRoute(r, now)
  })
  if (state.routes.every((r) => r.noData)) {
    renderTimeBar({ hidden: true })
    renderRouteChips({ routes: [] })
    showToast("Weather is unavailable right now. Please try again later.", { kind: "error" })
    return
  }

  // A shared link may ask for a later departure: match its whole hour
  state.selectedD = 0
  const leave = state.pendingLeave
  if (typeof leave === "number") {
    state.routes[state.routeIndex].departures.forEach((dep) => {
      if (dep.d > 0 && hourFloor(dep.timeMs) === leave) state.selectedD = dep.d
    })
  }
  state.pendingLeave = "now"

  activateRoute(state.routeIndex)
  recordRecentTrip()
}

// Show one of the routes: the drawn line, markers, time bar and alerts follow it
export function activateRoute(index: number): void {
  const route = state.routes[index]
  if (!route) return
  if (index !== state.routeIndex) {
    clearMarkers(state.samples)
    hidePopup()
    state.routeIndex = index
    state.directionsDisplay.setRouteIndex(index)
    drawEndpointPins(route.leg)
  }
  state.samples = route.samples
  state.departures = route.departures
  state.bestRange = route.bestRange
  state.maxD = route.maxD
  if (state.selectedD > Math.max(state.maxD, 0)) state.selectedD = Math.max(state.maxD, 0)

  if (route.noData) {
    showNote(
      "Weather is unavailable for this route.",
      "Weather is unavailable for this route right now."
    )
  } else if (state.maxD < 0) {
    showNote(
      "This trip is longer than the available forecast",
      "This trip takes about " +
        Math.round(route.tripHours) +
        " hours, longer than the available forecast, so departure times can't be compared. Stops near the end show the last available forecast."
    )
  } else {
    updateBar()
    if (route.failed > 0) {
      showToast(
        "Weather unavailable for " +
          route.failed +
          " of " +
          state.samples.length +
          " stops on this route.",
        { kind: "error" }
      )
    } else {
      hideToast()
    }
  }
  renderChips()
  paintMarkers()
  ensureWorstPlace()
  loadRouteAlerts()
  updateUrl()
}

// A message in place of the departure segments. With only one route there is nothing else to
// show, so the bar is hidden and the message is a (sticky) toast instead.
function showNote(note: string, toast: string): void {
  if (state.routes.length > 1) {
    renderTimeBar({ departures: [], note })
    showToast(toast, { kind: "error" })
  } else {
    renderTimeBar({ hidden: true })
    showToast(toast, { kind: "error", sticky: true })
  }
}

function routeClassAt(route: RouteData, d: number) {
  if (!route.departures.length) return "unknown" as const
  return route.departures[Math.min(d, route.departures.length - 1)].cls
}

function renderChips(): void {
  if (state.routes.length < 2) {
    renderRouteChips({ routes: [] })
    return
  }
  const infos = state.routes.map((r) => ({
    summary: r.summary,
    durationSec: r.durationSec,
    cls: routeClassAt(r, state.selectedD),
  }))
  renderRouteChips(
    {
      routes: infos.map((info, i) => ({
        label: routeChipLabel(info, i),
        active: i === state.routeIndex,
      })),
      hint: routeSuggestion(infos, state.routeIndex),
    },
    activateRoute,
    activateRoute
  )
}

export function updateBar(): void {
  renderTimeBar(
    {
      departures: state.departures,
      best: state.bestRange,
      selected: state.selectedD,
      loading: state.barLoading,
      places: state.samples.map((s) => s.place),
    },
    selectDeparture
  )
}

export function selectDeparture(d: number): void {
  state.selectedD = d
  updateBar()
  renderChips()
  paintMarkers()
  if (state.openSampleIndex >= 0) showPopup(state.openSampleIndex)
  ensureWorstPlace()
  updateUrl()
}

// The time bar subtitle names the worst stop of the selected departure: look up only that one
function ensureWorstPlace(): void {
  const dep = state.departures[state.selectedD]
  if (!dep || !dep.worst) return
  const myRequest = state.requestId
  const index = dep.worst.sampleIndex
  const had = !!(state.samples[index] && state.samples[index].place)
  void ensurePlace(index).then((city) => {
    if (city && !had && myRequest === state.requestId) updateBar()
  })
}
