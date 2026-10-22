// Weather markers and the start/end pins on the map: icon loading, painting for the selected
// departure and decluttering.

import { entryFor, classify, hourBadness } from "../scoring/scoring"
import type { HourlyEntry } from "../../shared/weather"
import { WEATHER_ICONS, weatherIconName } from "../weather/icons"
import { declutterSelect } from "../features/declutter"
import { convertTemp } from "../features/units"
import { state } from "../state"
import type { Sample } from "../state"
import { assetUrl } from "../ui/dom"
import { markerGeometry, markerSvg, pinGeometry, pinSvg, svgDataUri } from "./markerSvg"

let onMarkerClick: (index: number) => void = () => {}

// Called with the sample index when a weather marker is clicked
export function setMarkerClickHandler(handler: (index: number) => void): void {
  onMarkerClick = handler
}

// Weather icon SVG text by icon name, preloaded so marker data URIs can embed them
export function loadIcons(): Promise<unknown> {
  return Promise.all(
    WEATHER_ICONS.map((name) =>
      fetch(assetUrl("icons/" + name + ".svg"))
        .then((response) => (response.ok ? response.text() : ""))
        .catch(() => "")
        .then((text) => {
          state.iconTextCache[name] = text
        })
    )
  )
}

export function entryIconName(entry: HourlyEntry): string {
  return weatherIconName(entry.code, entry.isDay, entry.wind)
}

function weatherMarkerIcon(entry: HourlyEntry, selected: boolean): google.maps.Icon {
  const cls = classify(hourBadness(entry))
  const svg = markerSvg({
    iconSvgText: state.iconTextCache[entryIconName(entry)],
    cls,
    temp: convertTemp(entry.temp, state.unit),
    selected,
  })
  const g = markerGeometry(selected)
  return {
    url: svgDataUri(svg),
    scaledSize: new google.maps.Size(g.width, g.height),
    anchor: new google.maps.Point(g.cx, g.cy),
  }
}

function pinIcon(kind: "start" | "end"): google.maps.Icon {
  const g = pinGeometry()
  return {
    url: svgDataUri(pinSvg(kind)),
    scaledSize: new google.maps.Size(g.width, g.height),
    anchor: new google.maps.Point(g.cx, g.cy),
  }
}

export function clearMarkers(list: Sample[]): void {
  list.forEach((s) => {
    if (s.marker) s.marker.setMap(null)
    s.marker = null
    s.markerUrl = null
  })
}

export function clearEndpointPins(): void {
  state.routeEndMarkers.forEach((m) => {
    m.setMap(null)
  })
  state.routeEndMarkers = []
}

export function drawEndpointPins(leg: google.maps.DirectionsLeg): void {
  clearEndpointPins()
  state.routeEndMarkers = [
    new google.maps.Marker({
      position: leg.start_location,
      map: state.map,
      icon: pinIcon("start"),
      title: "Start",
      zIndex: 5,
    }),
    new google.maps.Marker({
      position: leg.end_location,
      map: state.map,
      icon: pinIcon("end"),
      title: "Destination",
      zIndex: 5,
    }),
  ]
}

// Create or update the weather marker of every sample for the selected departure
export function paintMarkers(): void {
  const ready = state.iconsReady || Promise.resolve()
  const myRequest = state.requestId
  void ready.then(() => {
    if (myRequest !== state.requestId) return
    state.samples.forEach((s, index) => {
      const entry = entryFor(s, state.selectedD)
      if (!entry) {
        if (s.marker) {
          s.marker.setMap(null)
          s.marker = null
        }
        return
      }
      const selected = index === state.openSampleIndex
      s.badness = hourBadness(entry)
      const icon = weatherMarkerIcon(entry, selected)
      if (s.marker) {
        if (s.markerUrl !== icon.url) s.marker.setIcon(icon)
        s.marker.setZIndex(selected ? 4 : 1)
      } else {
        s.marker = new google.maps.Marker({
          position: s.latLng,
          map: state.map,
          icon,
          zIndex: selected ? 4 : 1,
        })
        s.marker.addListener("click", () => {
          onMarkerClick(index)
        })
      }
      s.markerUrl = icon.url
    })
    declutterMarkers()
  })
}

// Hide weather markers that would overlap on screen at the current zoom. The open marker is kept
// first, then the worst conditions, then markers spread evenly along the route.
export function declutterMarkers(): void {
  const map = state.map
  if (!map || !state.routeShown || !map.getProjection) return
  const projection = map.getProjection()
  const zoom = map.getZoom()
  if (!projection || zoom == null) return
  const scale = Math.pow(2, zoom)
  const items: Array<{ x: number; y: number; priority: number }> = []
  const owners: Sample[] = []
  state.samples.forEach((s, index) => {
    if (!s.marker) return
    const point = projection.fromLatLngToPoint(s.latLng)
    if (!point) return
    items.push({
      x: point.x * scale,
      y: point.y * scale,
      priority: index === state.openSampleIndex ? 1000 : Math.round((s.badness || 0) * 10),
    })
    owners.push(s)
  })
  const keep: Record<number, boolean> = {}
  declutterSelect(items).forEach((i) => {
    keep[i] = true
  })
  owners.forEach((s, i) => {
    s.marker?.setVisible(!!keep[i])
  })
}
