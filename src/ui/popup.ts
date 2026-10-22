// The weather details popup of a marker.

import { entryFor, entryDescription } from "../scoring/scoring"
import { tempLabel } from "../features/units"
import { entryIconName, paintMarkers } from "../map/markers"
import { ensurePlace } from "../map/places"
import { state } from "../state"
import { assetUrl, byId } from "./dom"

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function arrivalMs(etaHours: number): number {
  const dep = state.departures[state.selectedD]
  const base = dep ? dep.timeMs : Date.now()
  return base + etaHours * 3600000
}

export function showPopup(index: number): void {
  const s = state.samples[index]
  const entry = s && entryFor(s, state.selectedD)
  if (!s || !entry) return
  const previous = state.openSampleIndex
  state.openSampleIndex = index
  const condition = entryDescription(entry).replace(/^\w/, (c) => c.toUpperCase())
  const temp = entry.temp == null ? "" : " · " + tempLabel(entry.temp, state.unit)
  byId("weather-info-summary").textContent =
    "Arrive ~" + formatClock(arrivalMs(s.etaHours)) + " · " + condition + temp
  const wind = Math.round(entry.wind || 0)
  const gust = Math.round(entry.gust || 0)
  byId("weather-info-extra").textContent =
    "Rain chance " +
    Math.round((entry.pop || 0) * 100) +
    "% · Wind " +
    wind +
    " mph" +
    (gust > wind + 5 ? " (gusts " + gust + ")" : "")
  const icon = byId<HTMLImageElement>("weather-info-icon")
  icon.src = assetUrl("icons/" + entryIconName(entry) + ".svg")
  icon.alt = condition

  const location = byId("weather-info-location")
  location.textContent = s.place || "Along your route"
  const popup = byId("weather-info-window")
  popup.hidden = false
  popup.classList.remove("active")
  void popup.offsetWidth // reflow so the animation replays
  popup.classList.add("active")
  if (previous !== index) paintMarkers()

  if (!s.place) {
    const myRequest = state.requestId
    void ensurePlace(index).then((city) => {
      if (city && myRequest === state.requestId && state.openSampleIndex === index) {
        location.textContent = city
      }
    })
  }
}

export function hidePopup(): void {
  const wasOpen = state.openSampleIndex >= 0
  state.openSampleIndex = -1
  const popup = byId("weather-info-window")
  popup.hidden = true
  popup.classList.remove("active")
  if (wasOpen) paintMarkers()
}
