// The single mutable state object of the app. The Google Maps handles are assigned in initMap
// (src/main.ts) before anything reads them.

import type { HourlyEntry } from "../shared/weather"
import type { NwsAlert } from "../shared/alerts"
import type { Departure, BestWindow } from "./scoring/scoring"
import type { StorageLike } from "./weather/cache"
import type { Trip } from "./features/recent"
import type { Unit } from "./features/units"
import type { BackendClient } from "./weather/api"

// A weather sample point along a route
export interface Sample {
  latLng: google.maps.LatLng
  distMeters: number
  etaHours: number
  hourly: HourlyEntry[] | null
  place: string | null
  marker: google.maps.Marker | null
  markerUrl?: string | null
  badness?: number
  failed?: boolean
}

// One Directions route with its own samples, departures and best window
export interface RouteData {
  summary: string
  durationSec: number
  tripHours: number
  leg: google.maps.DirectionsLeg
  samples: Sample[]
  departures: Departure[]
  bestRange: BestWindow | null
  maxD: number
  failed: number
  noData: boolean
}

// A selected endpoint: the text shown in the input and where it is
export interface Endpoint {
  text: string
  loc: google.maps.LatLng | google.maps.LatLngLiteral
  source: "user" | "geo"
}

export interface AppState {
  map: google.maps.Map
  directionsService: google.maps.DirectionsService
  directionsDisplay: google.maps.DirectionsRenderer
  startInput: HTMLInputElement
  destinationInput: HTMLInputElement

  startSel: Endpoint | null
  destSel: Endpoint | null
  startMarker: google.maps.Marker | null
  userMarker: google.maps.Marker | null
  userLatLng: google.maps.LatLng | null
  routeEndMarkers: google.maps.Marker[] // custom start/end pins for the drawn route

  iconTextCache: Record<string, string> // weather icon SVG text by name, for marker data URIs
  iconsReady: Promise<unknown> | null
  placeCache: Record<string, string> // reverse-geocoded place names by geoKey
  placePending: Record<string, Promise<string | null>>
  store: StorageLike | null // localStorage, or null when unavailable
  sessionStore: StorageLike | null // sessionStorage (alerts cache), or null when unavailable
  backend: BackendClient | null
  unit: Unit // display unit for temperatures; data stays in Fahrenheit
  recentTrips: Trip[]
  pendingLeave: "now" | number // departure from a shared link: "now" or a whole-hour epoch ms
  pendingCurrentStart: boolean // a link or recent trip starts at the current location
  routes: RouteData[] // one entry per Directions route (up to 3)
  routeIndex: number
  routeAlerts: NwsAlert[]
  alertsDismissed: boolean
  alertSeq: number
  radarLayer: google.maps.ImageMapType | null
  radarOn: boolean
  radarBusy: boolean

  // Per-route state, all reset by resetRoute()
  requestId: number // incremented for every route search/reset; stale async results are ignored
  // samples, departures, bestRange and maxD always mirror routes[routeIndex] (see activateRoute)
  samples: Sample[]
  departures: Departure[]
  bestRange: BestWindow | null
  selectedD: number
  maxD: number
  routeShown: boolean
  openSampleIndex: number
  barLoading: boolean
  toastTimer: ReturnType<typeof setTimeout> | null
}

export const state: AppState = {
  map: undefined as unknown as google.maps.Map,
  directionsService: undefined as unknown as google.maps.DirectionsService,
  directionsDisplay: undefined as unknown as google.maps.DirectionsRenderer,
  startInput: undefined as unknown as HTMLInputElement,
  destinationInput: undefined as unknown as HTMLInputElement,

  startSel: null,
  destSel: null,
  startMarker: null,
  userMarker: null,
  userLatLng: null,
  routeEndMarkers: [],

  iconTextCache: {},
  iconsReady: null,
  placeCache: {},
  placePending: {},
  store: null,
  sessionStore: null,
  backend: null,
  unit: "F",
  recentTrips: [],
  pendingLeave: "now",
  pendingCurrentStart: false,
  routes: [],
  routeIndex: 0,
  routeAlerts: [],
  alertsDismissed: false,
  alertSeq: 0,
  radarLayer: null,
  radarOn: false,
  radarBusy: false,

  requestId: 0,
  samples: [],
  departures: [],
  bestRange: null,
  selectedD: 0,
  maxD: 0,
  routeShown: false,
  openSampleIndex: -1,
  barLoading: false,
  toastTimer: null,
}

export const SAMPLE_STEP_METERS = 25 * 1609.34 // a weather sample about every 25 miles
export const MAX_SAMPLES = 60
export const MIN_END_GAP_METERS = 3 * 1609.34 // drop an intermediate sample this close to the destination
export const FALLBACK_LATLNG = { lat: 37.775, lng: -122.434 }
export const MAX_ROUTES = 3
