// Rain radar overlay (RainViewer tiles).

import { RADAR_API_URL, RADAR_MAX_ZOOM, radarTemplate, radarTileUrl } from "../features/radar"
import { state } from "../state"
import { byId } from "../ui/dom"
import { showToast } from "../ui/toast"

function setRadarButton(pressed: boolean): void {
  const button = byId("radar-button")
  button.setAttribute("aria-pressed", pressed ? "true" : "false")
  button.setAttribute("aria-label", pressed ? "Hide rain radar" : "Show rain radar")
  byId("radar-credit").hidden = !pressed
}

function removeRadar(): void {
  if (!state.radarLayer) return
  const layers = state.map.overlayMapTypes
  for (let i = layers.getLength() - 1; i >= 0; i--) {
    if (layers.getAt(i) === state.radarLayer) layers.removeAt(i)
  }
  state.radarLayer = null
}

export function toggleRadar(): void {
  if (state.radarBusy) return
  if (state.radarOn) {
    removeRadar()
    state.radarOn = false
    setRadarButton(false)
    return
  }
  state.radarBusy = true
  fetch(RADAR_API_URL)
    .then((response) => {
      if (!response.ok) throw new Error("RainViewer returned HTTP " + response.status)
      return response.json()
    })
    .then((json) => {
      const template = radarTemplate(json)
      if (!template) throw new Error("No radar frames")
      state.radarLayer = new google.maps.ImageMapType({
        name: "Radar",
        tileSize: new google.maps.Size(256, 256),
        opacity: 0.6,
        getTileUrl: (coord, zoom) => radarTileUrl(template, coord.x, coord.y, zoom),
      })
      state.map.overlayMapTypes.push(state.radarLayer)
      state.radarOn = true
      setRadarButton(true)
      const zoom = state.map.getZoom()
      if (zoom !== undefined && zoom > RADAR_MAX_ZOOM) {
        showToast("Radar is only drawn when zoomed out a bit.", { kind: "info" })
      }
    })
    .catch((error) => {
      console.warn("Rain radar unavailable:", error)
      const button = byId<HTMLButtonElement>("radar-button")
      button.disabled = true
      button.title = "Rain radar is unavailable right now"
      showToast("Rain radar is unavailable right now.", { kind: "error" })
    })
    .then(() => {
      state.radarBusy = false
    })
}
